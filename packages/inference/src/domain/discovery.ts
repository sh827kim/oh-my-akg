/**
 * Track B: Seed-less Domain Discovery
 * graphology + Louvain 커뮤니티 탐지로 도메인 군집 자동 발견
 */
import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';
import { eq, and } from 'drizzle-orm';
import type { DbClient } from '@archi-navi/db';
import { objectRollups, domainDiscoveryRuns, domainDiscoveryMemberships, objects } from '@archi-navi/db';
import { generateId } from '@archi-navi/shared';

interface DiscoveryOptions {
  workspaceId: string;
  profileId?: string;
  generationVersion: number;
  minClusterSize?: number;
  resolution?: number;
}

/**
 * Seed-less Discovery 실행
 * 1. SERVICE_TO_SERVICE rollup으로 가중 그래프 구성
 * 2. Louvain 커뮤니티 탐지
 * 3. Domain object 생성 + 멤버십 저장
 */
export async function runDiscovery(
  db: DbClient,
  options: DiscoveryOptions,
): Promise<{ runId: string; clusterCount: number }> {
  const {
    workspaceId,
    generationVersion,
    minClusterSize = 3,
    resolution,
  } = options;

  const runId = generateId();
  const startedAt = new Date();

  // Discovery run 기록 시작
  await db.insert(domainDiscoveryRuns).values({
    id: runId,
    workspaceId,
    algo: 'louvain',
    algoVersion: '1.0',
    inputLayers: ['call'],
    parameters: { minClusterSize, resolution: resolution ?? 1.0 },
    graphStats: {},
    status: 'DONE',
    startedAt,
  });

  // SERVICE_TO_SERVICE rollup으로 가중 그래프 구성
  const s2sEdges = await db
    .select()
    .from(objectRollups)
    .where(
      and(
        eq(objectRollups.workspaceId, workspaceId),
        eq(objectRollups.generationVersion, generationVersion),
        eq(objectRollups.rollupLevel, 'SERVICE_TO_SERVICE'),
      ),
    );

  if (s2sEdges.length === 0) {
    return { runId, clusterCount: 0 };
  }

  // graphology 가중 그래프 구성
  const graph = new Graph({ multi: false, type: 'undirected' });

  for (const edge of s2sEdges) {
    if (!graph.hasNode(edge.subjectObjectId)) graph.addNode(edge.subjectObjectId);
    if (!graph.hasNode(edge.objectId)) graph.addNode(edge.objectId);

    const edgeKey = [edge.subjectObjectId, edge.objectId].sort().join('--');
    if (!graph.hasEdge(edgeKey)) {
      graph.addEdgeWithKey(edgeKey, edge.subjectObjectId, edge.objectId, {
        weight: edge.edgeWeight,
      });
    }
  }

  // Louvain 커뮤니티 탐지
  const communities: Record<string, number> = louvain(graph, {
    resolution: resolution ?? 1.0,
    getEdgeWeight: 'weight', // 'weight' 속성을 엣지 가중치로 사용
  });

  // 클러스터별 멤버 그룹화
  const clusters = new Map<number, string[]>();
  for (const [nodeId, clusterId] of Object.entries(communities)) {
    const members = clusters.get(clusterId) ?? [];
    members.push(nodeId);
    clusters.set(clusterId, members);
  }

  // min_cluster_size 이상인 클러스터만 처리
  const validClusters = [...clusters.entries()].filter(
    ([, members]) => members.length >= minClusterSize,
  );

  for (const [clusterId, members] of validClusters) {
    // Domain object 생성 (kind=DISCOVERED)
    const domainId = generateId();
    const clusterName = `cluster-${clusterId}`;

    await db.insert(objects).values({
      id: domainId,
      workspaceId,
      objectType: 'domain',
      category: null,
      granularity: 'COMPOUND',
      name: `discovered:${clusterName}`,
      displayName: `Cluster ${clusterId}`,
      path: `/${domainId}`,
      depth: 0,
      visibility: 'VISIBLE',
      metadata: {
        kind: 'DISCOVERED',
        clusterId: `c-${clusterId}`,
        algo: 'louvain',
        algoVersion: '1.0',
        labelCandidates: [], // 추후 토큰 빈도 분석으로 채움
      },
    });

    // 멤버십 저장
    for (const serviceId of members) {
      await db.insert(domainDiscoveryMemberships).values({
        id: generateId(),
        workspaceId,
        runId,
        objectId: serviceId,
        domainId,
        affinity: 1.0,
        purity: null,
      });
    }
  }

  // run 완료 기록
  await db
    .update(domainDiscoveryRuns)
    .set({
      finishedAt: new Date(),
      graphStats: {
        nodeCount: graph.order,
        edgeCount: graph.size,
        clusterCount: validClusters.length,
      },
    })
    .where(eq(domainDiscoveryRuns.id, runId));

  return { runId, clusterCount: validClusters.length };
}
