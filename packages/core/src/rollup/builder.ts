/**
 * Rollup Builder - Materialized Roll-up 계산 파이프라인
 *
 * 계산 순서:
 * 1. SERVICE_TO_SERVICE (call+expose → service-to-service)
 * 2. SERVICE_TO_DATABASE (read/write + parent → service-to-db)
 * 3. SERVICE_TO_BROKER (produce/consume + parent → service-to-broker)
 * 4. DOMAIN_TO_DOMAIN (SERVICE_TO_SERVICE + affinities → domain-to-domain)
 */
import { eq, and, inArray, sql } from 'drizzle-orm';
import type { DbClient } from '@archi-navi/db';
import { objectRelations, objects, objectRollups, objectDomainAffinities, objectGraphStats } from '@archi-navi/db';
import { createNewGeneration, activateGeneration } from './generationManager';
import { invalidateCache } from '../graph-index/index';

/**
 * 전체 Rollup 재빌드
 * relation 승인/삭제, parent 변경 등 이벤트 발생 시 호출
 */
export async function rebuildRollups(
  db: DbClient,
  workspaceId: string,
): Promise<number> {
  // 1. 새 generation 생성
  const newVersion = await createNewGeneration(db, workspaceId);

  try {
    // 2. SERVICE_TO_SERVICE 계산
    await buildServiceToService(db, workspaceId, newVersion);

    // 3. SERVICE_TO_DATABASE 계산
    await buildServiceToDatabase(db, workspaceId, newVersion);

    // 4. SERVICE_TO_BROKER 계산
    await buildServiceToBroker(db, workspaceId, newVersion);

    // 5. DOMAIN_TO_DOMAIN 계산
    await buildDomainToDomain(db, workspaceId, newVersion);

    // 6. object_graph_stats 계산 (Hub 감지용 degree 통계)
    await buildObjectGraphStats(db, workspaceId, newVersion);

    // 7. generation ACTIVE로 전환
    await activateGeneration(db, workspaceId, newVersion);

    // 8. 그래프 캐시 무효화
    invalidateCache(workspaceId);

    return newVersion;
  } catch (error) {
    // 빌드 실패 시 BUILDING 상태 유지 (수동 재시도 필요)
    console.error(`Rollup build failed for workspace ${workspaceId}:`, error);
    throw error;
  }
}

/**
 * SERVICE_TO_SERVICE 계산
 * A --call--> endpoint E, B --expose--> endpoint E → A --call--> B
 */
async function buildServiceToService(
  db: DbClient,
  workspaceId: string,
  generationVersion: number,
): Promise<void> {
  // call 관계 조회 (service → api_endpoint)
  const callRelations = await db
    .select()
    .from(objectRelations)
    .where(
      and(
        eq(objectRelations.workspaceId, workspaceId),
        eq(objectRelations.relationType, 'call'),
        eq(objectRelations.isDerived, false),
      ),
    );

  // expose 관계 조회 (service → api_endpoint)
  const exposeRelations = await db
    .select()
    .from(objectRelations)
    .where(
      and(
        eq(objectRelations.workspaceId, workspaceId),
        eq(objectRelations.relationType, 'expose'),
        eq(objectRelations.isDerived, false),
      ),
    );

  // endpoint별 expose 서비스 매핑
  const endpointToService = new Map<string, string>();
  for (const expose of exposeRelations) {
    endpointToService.set(expose.objectId, expose.subjectObjectId);
  }

  // A --call--> E, E --expose--> B → A --call--> B 집계
  const rollupMap = new Map<string, { edgeWeight: number; confidences: number[] }>();

  for (const call of callRelations) {
    const callerServiceId = call.subjectObjectId;
    const endpointId = call.objectId;
    const exposingServiceId = endpointToService.get(endpointId);

    if (!exposingServiceId || callerServiceId === exposingServiceId) continue;

    const key = `${callerServiceId}|${exposingServiceId}`;
    const existing = rollupMap.get(key) ?? { edgeWeight: 0, confidences: [] };
    existing.edgeWeight += 1;
    if (call.confidence != null) existing.confidences.push(call.confidence);
    rollupMap.set(key, existing);
  }

  // rollup 저장
  const rollups = [...rollupMap.entries()].map(([key, { edgeWeight, confidences }]) => {
    const [subjectObjectId, objectId] = key.split('|') as [string, string];
    const confidence = confidences.length > 0
      ? confidences.reduce((a, b) => a + b, 0) / confidences.length
      : null;
    return {
      workspaceId,
      rollupLevel: 'SERVICE_TO_SERVICE',
      relationType: 'call',
      subjectObjectId,
      objectId,
      edgeWeight,
      confidence,
      generationVersion,
    };
  });

  if (rollups.length > 0) {
    await db.insert(objectRollups).values(rollups);
  }
}

/**
 * SERVICE_TO_DATABASE 계산
 * S --read/write--> Table T, T.parent = DB → S --read/write--> DB
 */
async function buildServiceToDatabase(
  db: DbClient,
  workspaceId: string,
  generationVersion: number,
): Promise<void> {
  for (const relType of ['read', 'write']) {
    const relations = await db
      .select({
        relation: objectRelations,
        tableParentId: objects.parentId,
      })
      .from(objectRelations)
      .innerJoin(objects, eq(objectRelations.objectId, objects.id))
      .where(
        and(
          eq(objectRelations.workspaceId, workspaceId),
          eq(objectRelations.relationType, relType),
          eq(objectRelations.isDerived, false),
        ),
      );

    const rollupMap = new Map<string, { edgeWeight: number; confidences: number[] }>();

    for (const { relation, tableParentId } of relations) {
      if (!tableParentId) continue;
      const key = `${relation.subjectObjectId}|${tableParentId}`;
      const existing = rollupMap.get(key) ?? { edgeWeight: 0, confidences: [] };
      existing.edgeWeight += 1;
      if (relation.confidence != null) existing.confidences.push(relation.confidence);
      rollupMap.set(key, existing);
    }

    const rollups = [...rollupMap.entries()].map(([key, { edgeWeight, confidences }]) => {
      const [subjectObjectId, objectId] = key.split('|') as [string, string];
      const confidence = confidences.length > 0
        ? confidences.reduce((a, b) => a + b, 0) / confidences.length
        : null;
      return {
        workspaceId,
        rollupLevel: 'SERVICE_TO_DATABASE',
        relationType: relType,
        subjectObjectId,
        objectId,
        edgeWeight,
        confidence,
        generationVersion,
      };
    });

    if (rollups.length > 0) {
      await db.insert(objectRollups).values(rollups);
    }
  }
}

/**
 * SERVICE_TO_BROKER 계산
 * S --produce/consume--> Topic T, T.parent = Broker → S --produce/consume--> Broker
 */
async function buildServiceToBroker(
  db: DbClient,
  workspaceId: string,
  generationVersion: number,
): Promise<void> {
  for (const relType of ['produce', 'consume']) {
    const relations = await db
      .select({
        relation: objectRelations,
        topicParentId: objects.parentId,
      })
      .from(objectRelations)
      .innerJoin(objects, eq(objectRelations.objectId, objects.id))
      .where(
        and(
          eq(objectRelations.workspaceId, workspaceId),
          eq(objectRelations.relationType, relType),
          eq(objectRelations.isDerived, false),
        ),
      );

    const rollupMap = new Map<string, { edgeWeight: number; confidences: number[] }>();

    for (const { relation, topicParentId } of relations) {
      if (!topicParentId) continue;
      const key = `${relation.subjectObjectId}|${topicParentId}`;
      const existing = rollupMap.get(key) ?? { edgeWeight: 0, confidences: [] };
      existing.edgeWeight += 1;
      if (relation.confidence != null) existing.confidences.push(relation.confidence);
      rollupMap.set(key, existing);
    }

    const rollups = [...rollupMap.entries()].map(([key, { edgeWeight, confidences }]) => {
      const [subjectObjectId, objectId] = key.split('|') as [string, string];
      const confidence = confidences.length > 0
        ? confidences.reduce((a, b) => a + b, 0) / confidences.length
        : null;
      return {
        workspaceId,
        rollupLevel: 'SERVICE_TO_BROKER',
        relationType: relType,
        subjectObjectId,
        objectId,
        edgeWeight,
        confidence,
        generationVersion,
      };
    });

    if (rollups.length > 0) {
      await db.insert(objectRollups).values(rollups);
    }
  }
}

/**
 * DOMAIN_TO_DOMAIN 계산
 * 설계 문서의 공식 구현:
 *   edge_weight[X,Y] += w_ab × a[X] × b[Y]
 *   confidence[X,Y] = sum(c_ab × w_ab × a[X] × b[Y]) / sum(w_ab × a[X] × b[Y])
 */
async function buildDomainToDomain(
  db: DbClient,
  workspaceId: string,
  generationVersion: number,
): Promise<void> {
  // SERVICE_TO_SERVICE rollup 조회 (현재 generation)
  const s2sRollups = await db
    .select()
    .from(objectRollups)
    .where(
      and(
        eq(objectRollups.workspaceId, workspaceId),
        eq(objectRollups.generationVersion, generationVersion),
        eq(objectRollups.rollupLevel, 'SERVICE_TO_SERVICE'),
      ),
    );

  if (s2sRollups.length === 0) return;

  // 모든 서비스의 도메인 affinity 조회
  const allServiceIds = [...new Set([
    ...s2sRollups.map((r: typeof s2sRollups[0]) => r.subjectObjectId),
    ...s2sRollups.map((r: typeof s2sRollups[0]) => r.objectId),
  ])];

  const affinities = await db
    .select()
    .from(objectDomainAffinities)
    .where(
      and(
        eq(objectDomainAffinities.workspaceId, workspaceId),
        inArray(objectDomainAffinities.objectId, allServiceIds),
      ),
    );

  // 서비스별 affinity 맵 구성
  const serviceAffinityMap = new Map<string, Map<string, number>>();
  for (const aff of affinities) {
    if (!serviceAffinityMap.has(aff.objectId)) {
      serviceAffinityMap.set(aff.objectId, new Map());
    }
    serviceAffinityMap.get(aff.objectId)!.set(aff.domainId, aff.affinity);
  }

  // DOMAIN_TO_DOMAIN 집계
  const d2dMap = new Map<
    string,
    { weightedSum: number; weightedConfSum: number; denominator: number }
  >();

  for (const rollup of s2sRollups) {
    const wAb = rollup.edgeWeight;
    const cAb = rollup.confidence ?? 0;
    const aAffinities = serviceAffinityMap.get(rollup.subjectObjectId);
    const bAffinities = serviceAffinityMap.get(rollup.objectId);

    if (!aAffinities || !bAffinities) continue;

    for (const [domainX, ax] of aAffinities) {
      for (const [domainY, by] of bAffinities) {
        if (ax < 0.2 || by < 0.2) continue; // min_membership_threshold

        const key = `${domainX}|${domainY}`;
        const existing = d2dMap.get(key) ?? { weightedSum: 0, weightedConfSum: 0, denominator: 0 };
        const contribution = wAb * ax * by;
        existing.weightedSum += contribution;
        existing.weightedConfSum += cAb * contribution;
        existing.denominator += contribution;
        d2dMap.set(key, existing);
      }
    }
  }

  const rollups = [...d2dMap.entries()].map(([key, { weightedSum, weightedConfSum, denominator }]) => {
    const [domainX, domainY] = key.split('|') as [string, string];
    return {
      workspaceId,
      rollupLevel: 'DOMAIN_TO_DOMAIN',
      relationType: 'call',
      subjectObjectId: domainX,
      objectId: domainY,
      edgeWeight: Math.round(weightedSum),
      confidence: denominator > 0 ? weightedConfSum / denominator : null,
      generationVersion,
    };
  });

  if (rollups.length > 0) {
    await db.insert(objectRollups).values(rollups);
  }
}

/**
 * object_graph_stats 계산
 * 각 rollup level별로 노드의 inDegree / outDegree를 집계하여 저장
 */
async function buildObjectGraphStats(
  db: DbClient,
  workspaceId: string,
  generationVersion: number,
): Promise<void> {
  const LEVELS = [
    'SERVICE_TO_SERVICE',
    'SERVICE_TO_DATABASE',
    'SERVICE_TO_BROKER',
    'DOMAIN_TO_DOMAIN',
  ];

  for (const level of LEVELS) {
    // 현재 generation의 rollup 데이터 조회
    const levelRollups = await db
      .select({
        subjectObjectId: objectRollups.subjectObjectId,
        objectId: objectRollups.objectId,
      })
      .from(objectRollups)
      .where(
        and(
          eq(objectRollups.workspaceId, workspaceId),
          eq(objectRollups.generationVersion, generationVersion),
          eq(objectRollups.rollupLevel, level),
        ),
      );

    if (levelRollups.length === 0) continue;

    // outDegree: subjectObjectId 기준 카운트
    const outMap = new Map<string, number>();
    // inDegree: objectId 기준 카운트
    const inMap = new Map<string, number>();

    for (const r of levelRollups) {
      outMap.set(r.subjectObjectId, (outMap.get(r.subjectObjectId) ?? 0) + 1);
      inMap.set(r.objectId, (inMap.get(r.objectId) ?? 0) + 1);
    }

    // 모든 관련 노드 ID 수집
    const allNodeIds = new Set([...outMap.keys(), ...inMap.keys()]);

    const statsRows = [...allNodeIds].map((nodeId) => ({
      workspaceId,
      generationVersion,
      rollupLevel: level,
      objectId: nodeId,
      outDegree: outMap.get(nodeId) ?? 0,
      inDegree: inMap.get(nodeId) ?? 0,
    }));

    if (statsRows.length > 0) {
      await db.insert(objectGraphStats).values(statsRows);
    }
  }
}
