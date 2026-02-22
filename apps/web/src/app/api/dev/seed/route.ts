/**
 * POST /api/dev/seed — 샘플 데이터 주입
 * 레이어 4개 + 오브젝트 (COMPOUND + ATOMIC 2레벨) + 관계
 * idempotent: 이미 존재하면 skip
 */
import { type NextRequest, NextResponse } from 'next/server';
import { getDb, architectureLayers, objectLayerAssignments, objects, objectRelations } from '@archi-navi/db';
import { eq, and } from 'drizzle-orm';
import { DEFAULT_WORKSPACE_ID, generateId } from '@archi-navi/shared';

/* ─── 샘플 레이어 정의 ─── */
const SAMPLE_LAYERS = [
  { name: 'Presentation', color: '#3b82f6', sortOrder: 0 },
  { name: 'Application',  color: '#8b5cf6', sortOrder: 1 },
  { name: 'Domain',       color: '#06b6d4', sortOrder: 2 },
  { name: 'Infrastructure', color: '#10b981', sortOrder: 3 },
] as const;

/* ─── 1레벨 (루트) 오브젝트 ─── */
const SAMPLE_ROOT_OBJECTS = [
  { name: 'api-gateway',          objectType: 'service',        granularity: 'ATOMIC',   layer: 'Presentation' },
  { name: 'web-frontend',         objectType: 'service',        granularity: 'ATOMIC',   layer: 'Presentation' },
  { name: 'user-service',         objectType: 'service',        granularity: 'COMPOUND', layer: 'Application' },
  { name: 'order-service',        objectType: 'service',        granularity: 'COMPOUND', layer: 'Application' },
  { name: 'payment-service',      objectType: 'service',        granularity: 'ATOMIC',   layer: 'Application' },
  { name: 'notification-service', objectType: 'service',        granularity: 'ATOMIC',   layer: 'Application' },
  { name: 'product-service',      objectType: 'service',        granularity: 'COMPOUND', layer: 'Domain' },
  { name: 'user-db',              objectType: 'database',       granularity: 'ATOMIC',   layer: 'Infrastructure' },
  { name: 'order-db',             objectType: 'database',       granularity: 'ATOMIC',   layer: 'Infrastructure' },
  { name: 'product-db',           objectType: 'database',       granularity: 'ATOMIC',   layer: 'Infrastructure' },
  { name: 'kafka',                objectType: 'message_broker', granularity: 'ATOMIC',   layer: 'Infrastructure' },
] as const;

/* ─── 2레벨 (자식) 오브젝트 ─── */
const SAMPLE_CHILD_OBJECTS = [
  { name: 'user-get-users',    objectType: 'api_endpoint', parentName: 'user-service',    displayName: 'GET /api/users',       layer: 'Application' },
  { name: 'user-post-user',    objectType: 'api_endpoint', parentName: 'user-service',    displayName: 'POST /api/users',      layer: 'Application' },
  { name: 'user-get-by-id',    objectType: 'api_endpoint', parentName: 'user-service',    displayName: 'GET /api/users/:id',   layer: 'Application' },
  { name: 'order-get-orders',  objectType: 'api_endpoint', parentName: 'order-service',   displayName: 'GET /api/orders',      layer: 'Application' },
  { name: 'order-post-order',  objectType: 'api_endpoint', parentName: 'order-service',   displayName: 'POST /api/orders',     layer: 'Application' },
  { name: 'product-search',    objectType: 'api_endpoint', parentName: 'product-service', displayName: 'GET /api/products',    layer: 'Domain' },
  { name: 'product-get-by-id', objectType: 'api_endpoint', parentName: 'product-service', displayName: 'GET /api/products/:id', layer: 'Domain' },
] as const;

/* ─── 샘플 관계 ─── */
const SAMPLE_RELATIONS = [
  { subject: 'api-gateway',          relation: 'call',    object: 'user-service' },
  { subject: 'api-gateway',          relation: 'call',    object: 'order-service' },
  { subject: 'api-gateway',          relation: 'call',    object: 'product-service' },
  { subject: 'user-service',         relation: 'write',   object: 'user-db' },
  { subject: 'user-service',         relation: 'read',    object: 'user-db' },
  { subject: 'order-service',        relation: 'write',   object: 'order-db' },
  { subject: 'order-service',        relation: 'call',    object: 'payment-service' },
  { subject: 'order-service',        relation: 'produce', object: 'kafka' },
  { subject: 'notification-service', relation: 'consume', object: 'kafka' },
  { subject: 'product-service',      relation: 'read',    object: 'product-db' },
] as const;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { workspaceId?: string };
    const workspaceId = body.workspaceId ?? DEFAULT_WORKSPACE_ID;
    const db = await getDb();

    let layersInserted = 0;
    let objectsInserted = 0;
    let relationsInserted = 0;

    /* ── 1. 레이어 생성 ── */
    const layerIdMap = new Map<string, string>();
    for (const layerDef of SAMPLE_LAYERS) {
      const existing = await db
        .select({ id: architectureLayers.id })
        .from(architectureLayers)
        .where(and(eq(architectureLayers.workspaceId, workspaceId), eq(architectureLayers.name, layerDef.name)))
        .limit(1);
      if (existing[0]) {
        layerIdMap.set(layerDef.name, existing[0].id);
      } else {
        const id = generateId();
        await db.insert(architectureLayers).values({ id, workspaceId, name: layerDef.name, color: layerDef.color, sortOrder: layerDef.sortOrder, isEnabled: true });
        layerIdMap.set(layerDef.name, id);
        layersInserted++;
      }
    }

    /* ── 2. 루트 오브젝트 생성 (depth=0) ── */
    const objectIdMap = new Map<string, string>();
    for (const objDef of SAMPLE_ROOT_OBJECTS) {
      const existing = await db.select({ id: objects.id }).from(objects)
        .where(and(eq(objects.workspaceId, workspaceId), eq(objects.name, objDef.name))).limit(1);
      let objectId: string;
      if (existing[0]) {
        objectId = existing[0].id;
      } else {
        objectId = generateId();
        await db.insert(objects).values({
          id: objectId, workspaceId,
          objectType: objDef.objectType,
          name: objDef.name,
          granularity: objDef.granularity as 'ATOMIC' | 'COMPOUND',
          path: `/${objDef.name}`,
          depth: 0,
          visibility: 'VISIBLE',
          metadata: {},
        });
        objectsInserted++;
      }
      objectIdMap.set(objDef.name, objectId);
      // 레이어 배치
      const layerId = layerIdMap.get(objDef.layer);
      if (layerId) {
        const existingAssign = await db.select({ id: objectLayerAssignments.id }).from(objectLayerAssignments)
          .where(and(eq(objectLayerAssignments.workspaceId, workspaceId), eq(objectLayerAssignments.objectId, objectId))).limit(1);
        if (!existingAssign[0]) {
          await db.insert(objectLayerAssignments).values({ id: generateId(), workspaceId, objectId, layerId });
        }
      }
    }

    /* ── 3. 자식 오브젝트 생성 (depth=1) ── */
    for (const childDef of SAMPLE_CHILD_OBJECTS) {
      const parentId = objectIdMap.get(childDef.parentName);
      if (!parentId) continue;
      const existing = await db.select({ id: objects.id }).from(objects)
        .where(and(eq(objects.workspaceId, workspaceId), eq(objects.name, childDef.name))).limit(1);
      let childId: string;
      if (existing[0]) {
        childId = existing[0].id;
      } else {
        childId = generateId();
        await db.insert(objects).values({
          id: childId, workspaceId,
          objectType: childDef.objectType,
          name: childDef.name,
          displayName: childDef.displayName,
          granularity: 'ATOMIC',
          parentId,
          path: `/${childDef.parentName}/${childDef.name}`,
          depth: 1,
          visibility: 'VISIBLE',
          metadata: {},
        });
        objectsInserted++;
      }
      objectIdMap.set(childDef.name, childId);
      const layerId = layerIdMap.get(childDef.layer);
      if (layerId) {
        const existingAssign = await db.select({ id: objectLayerAssignments.id }).from(objectLayerAssignments)
          .where(and(eq(objectLayerAssignments.workspaceId, workspaceId), eq(objectLayerAssignments.objectId, childId))).limit(1);
        if (!existingAssign[0]) {
          await db.insert(objectLayerAssignments).values({ id: generateId(), workspaceId, objectId: childId, layerId });
        }
      }
    }

    /* ── 4. 관계 생성 ── */
    for (const relDef of SAMPLE_RELATIONS) {
      const subjectId = objectIdMap.get(relDef.subject);
      const objectId2 = objectIdMap.get(relDef.object);
      if (!subjectId || !objectId2) continue;
      const existing = await db.select({ id: objectRelations.id }).from(objectRelations)
        .where(and(eq(objectRelations.workspaceId, workspaceId), eq(objectRelations.relationType, relDef.relation), eq(objectRelations.subjectObjectId, subjectId), eq(objectRelations.objectId, objectId2))).limit(1);
      if (!existing[0]) {
        await db.insert(objectRelations).values({
          id: generateId(), workspaceId,
          relationType: relDef.relation as 'call' | 'expose' | 'read' | 'write' | 'produce' | 'consume' | 'depend_on',
          subjectObjectId: subjectId,
          objectId: objectId2,
          status: 'APPROVED',
          source: 'MANUAL',
          isDerived: false,
          metadata: {},
        });
        relationsInserted++;
      }
    }

    return NextResponse.json({ ok: true, inserted: { layers: layersInserted, objects: objectsInserted, relations: relationsInserted } });
  } catch (error) {
    console.error('[POST /api/dev/seed]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
