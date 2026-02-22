/**
 * POST /api/dev/seed — 샘플 데이터 주입
 *
 * [데이터셋 컨셉] 쇼핑몰 마이크로서비스 아키텍처
 *
 * 규약:
 *  - COMPOUND : 독립 배포 단위(서비스/DB/브로커) → 아키텍처 뷰 표시 대상
 *  - ATOMIC   : 세부 구성요소(API 엔드포인트/테이블/토픽) → Object Mapping 드릴다운용
 *  - 태그     : COMPOUND 오브젝트에만 부착 (auth/commerce/core/async/storage)
 *  - 관계     : COMPOUND ↔ COMPOUND 간 관계만 등록 → 아키텍처 뷰 엣지
 *
 * idempotent: 이미 존재하면 skip
 */
import { type NextRequest, NextResponse } from 'next/server';
import {
  getDb,
  architectureLayers,
  objectLayerAssignments,
  objects,
  objectRelations,
  tags,
  objectTags,
} from '@archi-navi/db';
import { eq, and } from 'drizzle-orm';
import { DEFAULT_WORKSPACE_ID, generateId } from '@archi-navi/shared';

/* ─── 레이어 정의 ─── */
const SAMPLE_LAYERS = [
  { name: 'Presentation',  color: '#3b82f6', sortOrder: 0 },
  { name: 'Application',   color: '#8b5cf6', sortOrder: 1 },
  { name: 'Domain',        color: '#06b6d4', sortOrder: 2 },
  { name: 'Infrastructure',color: '#10b981', sortOrder: 3 },
] as const;

/* ─── 태그 정의 (COMPOUND 오브젝트에만 부착) ─── */
const SAMPLE_TAGS = [
  { name: 'auth',     color: '#818cf8' }, // indigo  — 인증/사용자 관련
  { name: 'commerce', color: '#fb923c' }, // orange  — 상거래 관련
  { name: 'core',     color: '#22d3ee' }, // cyan    — 핵심 경로
  { name: 'async',    color: '#fbbf24' }, // amber   — 비동기 처리
  { name: 'storage',  color: '#34d399' }, // emerald — 데이터 저장소
] as const;

/* ─── COMPOUND 오브젝트 (아키텍처 뷰 표시 대상) ─── */
const SAMPLE_COMPOUND_OBJECTS = [
  // Presentation
  { name: 'api-gateway',          displayName: 'API Gateway',           objectType: 'service',        category: 'COMPUTE', layer: 'Presentation',   tags: ['core'] },
  { name: 'web-frontend',         displayName: 'Web Frontend',          objectType: 'service',        category: 'COMPUTE', layer: 'Presentation',   tags: ['core'] },
  // Application
  { name: 'user-service',         displayName: 'User Service',          objectType: 'service',        category: 'COMPUTE', layer: 'Application',    tags: ['auth', 'core'] },
  { name: 'order-service',        displayName: 'Order Service',         objectType: 'service',        category: 'COMPUTE', layer: 'Application',    tags: ['commerce', 'core'] },
  { name: 'payment-service',      displayName: 'Payment Service',       objectType: 'service',        category: 'COMPUTE', layer: 'Application',    tags: ['commerce'] },
  { name: 'notification-service', displayName: 'Notification Service',  objectType: 'service',        category: 'COMPUTE', layer: 'Application',    tags: ['async'] },
  // Domain
  { name: 'product-service',      displayName: 'Product Service',       objectType: 'service',        category: 'COMPUTE', layer: 'Domain',         tags: ['commerce', 'core'] },
  { name: 'review-service',       displayName: 'Review Service',        objectType: 'service',        category: 'COMPUTE', layer: 'Domain',         tags: ['commerce'] },
  // Infrastructure
  { name: 'user-db',              displayName: 'User DB (PostgreSQL)',   objectType: 'database',       category: 'STORAGE', layer: 'Infrastructure', tags: ['auth', 'storage'] },
  { name: 'order-db',             displayName: 'Order DB (PostgreSQL)',  objectType: 'database',       category: 'STORAGE', layer: 'Infrastructure', tags: ['commerce', 'storage'] },
  { name: 'product-db',           displayName: 'Product DB (PostgreSQL)',objectType: 'database',       category: 'STORAGE', layer: 'Infrastructure', tags: ['commerce', 'storage'] },
  { name: 'kafka',                displayName: 'Kafka Cluster',          objectType: 'message_broker', category: 'CHANNEL', layer: 'Infrastructure', tags: ['async'] },
] as const;

/* ─── ATOMIC 오브젝트 (세부 구성요소, Object Mapping 드릴다운용) ─── */
const SAMPLE_ATOMIC_OBJECTS = [
  // api-gateway 라우팅 규칙
  { name: 'gw-route-users',         displayName: 'Route /users/**',              objectType: 'api_endpoint', category: 'COMPUTE', parentName: 'api-gateway',          layer: 'Presentation' },
  { name: 'gw-route-orders',        displayName: 'Route /orders/**',             objectType: 'api_endpoint', category: 'COMPUTE', parentName: 'api-gateway',          layer: 'Presentation' },
  { name: 'gw-route-products',      displayName: 'Route /products/**',           objectType: 'api_endpoint', category: 'COMPUTE', parentName: 'api-gateway',          layer: 'Presentation' },
  // user-service API
  { name: 'user-get-users',         displayName: 'GET /api/users',               objectType: 'api_endpoint', category: 'COMPUTE', parentName: 'user-service',         layer: 'Application' },
  { name: 'user-post-user',         displayName: 'POST /api/users',              objectType: 'api_endpoint', category: 'COMPUTE', parentName: 'user-service',         layer: 'Application' },
  { name: 'user-get-by-id',         displayName: 'GET /api/users/:id',           objectType: 'api_endpoint', category: 'COMPUTE', parentName: 'user-service',         layer: 'Application' },
  { name: 'user-delete',            displayName: 'DELETE /api/users/:id',        objectType: 'api_endpoint', category: 'COMPUTE', parentName: 'user-service',         layer: 'Application' },
  // order-service API
  { name: 'order-get-orders',       displayName: 'GET /api/orders',              objectType: 'api_endpoint', category: 'COMPUTE', parentName: 'order-service',        layer: 'Application' },
  { name: 'order-post-order',       displayName: 'POST /api/orders',             objectType: 'api_endpoint', category: 'COMPUTE', parentName: 'order-service',        layer: 'Application' },
  { name: 'order-get-by-id',        displayName: 'GET /api/orders/:id',          objectType: 'api_endpoint', category: 'COMPUTE', parentName: 'order-service',        layer: 'Application' },
  { name: 'order-cancel',           displayName: 'PATCH /api/orders/:id/cancel', objectType: 'api_endpoint', category: 'COMPUTE', parentName: 'order-service',        layer: 'Application' },
  // payment-service API
  { name: 'payment-charge',         displayName: 'POST /api/payments/charge',    objectType: 'api_endpoint', category: 'COMPUTE', parentName: 'payment-service',      layer: 'Application' },
  { name: 'payment-refund',         displayName: 'POST /api/payments/refund',    objectType: 'api_endpoint', category: 'COMPUTE', parentName: 'payment-service',      layer: 'Application' },
  { name: 'payment-get-status',     displayName: 'GET /api/payments/:id',        objectType: 'api_endpoint', category: 'COMPUTE', parentName: 'payment-service',      layer: 'Application' },
  // notification-service API
  { name: 'notif-send-email',       displayName: 'POST /api/notifications/email',objectType: 'api_endpoint', category: 'COMPUTE', parentName: 'notification-service', layer: 'Application' },
  { name: 'notif-send-push',        displayName: 'POST /api/notifications/push', objectType: 'api_endpoint', category: 'COMPUTE', parentName: 'notification-service', layer: 'Application' },
  // product-service API
  { name: 'product-search',         displayName: 'GET /api/products',            objectType: 'api_endpoint', category: 'COMPUTE', parentName: 'product-service',      layer: 'Domain' },
  { name: 'product-get-by-id',      displayName: 'GET /api/products/:id',        objectType: 'api_endpoint', category: 'COMPUTE', parentName: 'product-service',      layer: 'Domain' },
  { name: 'product-create',         displayName: 'POST /api/products',           objectType: 'api_endpoint', category: 'COMPUTE', parentName: 'product-service',      layer: 'Domain' },
  { name: 'product-update',         displayName: 'PUT /api/products/:id',        objectType: 'api_endpoint', category: 'COMPUTE', parentName: 'product-service',      layer: 'Domain' },
  // review-service API
  { name: 'review-list',            displayName: 'GET /api/reviews',             objectType: 'api_endpoint', category: 'COMPUTE', parentName: 'review-service',       layer: 'Domain' },
  { name: 'review-post',            displayName: 'POST /api/reviews',            objectType: 'api_endpoint', category: 'COMPUTE', parentName: 'review-service',       layer: 'Domain' },
  // user-db 테이블
  { name: 'users-table',            displayName: 'users',                        objectType: 'db_table',     category: 'STORAGE', parentName: 'user-db',              layer: 'Infrastructure' },
  { name: 'sessions-table',         displayName: 'sessions',                     objectType: 'db_table',     category: 'STORAGE', parentName: 'user-db',              layer: 'Infrastructure' },
  // order-db 테이블
  { name: 'orders-table',           displayName: 'orders',                       objectType: 'db_table',     category: 'STORAGE', parentName: 'order-db',             layer: 'Infrastructure' },
  { name: 'order-items-table',      displayName: 'order_items',                  objectType: 'db_table',     category: 'STORAGE', parentName: 'order-db',             layer: 'Infrastructure' },
  // product-db 테이블
  { name: 'products-table',         displayName: 'products',                     objectType: 'db_table',     category: 'STORAGE', parentName: 'product-db',           layer: 'Infrastructure' },
  { name: 'product-stock-table',    displayName: 'product_stock',                objectType: 'db_table',     category: 'STORAGE', parentName: 'product-db',           layer: 'Infrastructure' },
  // kafka 토픽
  { name: 'order-events-topic',     displayName: 'order.events',                 objectType: 'topic',        category: 'CHANNEL', parentName: 'kafka',                layer: 'Infrastructure' },
  { name: 'payment-events-topic',   displayName: 'payment.events',               objectType: 'topic',        category: 'CHANNEL', parentName: 'kafka',                layer: 'Infrastructure' },
  { name: 'notification-topic',     displayName: 'notification.events',          objectType: 'topic',        category: 'CHANNEL', parentName: 'kafka',                layer: 'Infrastructure' },
] as const;

/*
 * ─── COMPOUND 간 관계 (아키텍처 뷰 엣지) ─── source: MANUAL
 *
 * 아키텍처 뷰에서 서비스 간 거시적 의존성을 표현.
 * Roll-up이 ATOMIC 관계를 집계하면 isDerived=true 로 중복 생성될 수 있음.
 * (unique 제약: workspaceId + relationType + subjectId + objectId + isDerived)
 *
 * 방향 규약 (아키텍처 뷰 화살표):
 *  - call/expose/write/produce → subjectObjectId 가 시작점
 *  - read/consume              → 아키텍처 뷰에서 source/target swap (데이터 흐름 방향으로 반전)
 *                                  subject = 읽는 쪽, object = 데이터 출처
 */
const SAMPLE_COMPOUND_RELATIONS = [
  // [Presentation 내부] Web → Gateway
  { subject: 'web-frontend',         relation: 'call',    object: 'api-gateway' },

  // [Presentation → Application] Gateway fanout
  { subject: 'api-gateway',          relation: 'call',    object: 'user-service' },
  { subject: 'api-gateway',          relation: 'call',    object: 'order-service' },
  { subject: 'api-gateway',          relation: 'call',    object: 'product-service' },

  // [Application 내부] 서비스 간 동기 호출
  { subject: 'order-service',        relation: 'call',    object: 'user-service' },   // 주문 시 사용자 검증
  { subject: 'order-service',        relation: 'call',    object: 'payment-service' },// 주문 → 결제 요청
  { subject: 'review-service',       relation: 'call',    object: 'user-service' },   // 리뷰 작성자 검증
  { subject: 'review-service',       relation: 'call',    object: 'product-service' },// 리뷰 대상 상품 확인

  // [Application → Infrastructure] 데이터 쓰기
  { subject: 'user-service',         relation: 'write',   object: 'user-db' },
  { subject: 'order-service',        relation: 'write',   object: 'order-db' },
  { subject: 'product-service',      relation: 'write',   object: 'product-db' },

  // [Application → Infrastructure] 데이터 읽기 (아키텍처 뷰에서 화살표 반전 — source-arrow dot)
  { subject: 'user-service',         relation: 'read',    object: 'user-db' },
  { subject: 'order-service',        relation: 'read',    object: 'order-db' },
  { subject: 'product-service',      relation: 'read',    object: 'product-db' },
  { subject: 'review-service',       relation: 'read',    object: 'product-db' },     // 리뷰 서비스는 product-db 직접 조회

  // [Messaging] 이벤트 발행 (점선)
  { subject: 'order-service',        relation: 'produce', object: 'kafka' },          // 주문 이벤트
  { subject: 'payment-service',      relation: 'produce', object: 'kafka' },          // 결제 이벤트

  // [Messaging] 이벤트 구독 (아키텍처 뷰에서 화살표 반전 — source-arrow dot)
  { subject: 'notification-service', relation: 'consume', object: 'kafka' },          // 알림 서비스 구독

  // [Domain 의존성]
  { subject: 'payment-service',      relation: 'depend_on', object: 'order-service' },// 결제는 주문에 의존
] as const;

/*
 * ─── ATOMIC 간 관계 (Object Mapping 드릴다운 + Roll-up 소스) ───
 *
 * 실제 서비스 내부 엔드포인트/테이블/토픽 간의 구체적인 의존 관계.
 * Roll-up 엔진은 이 관계를 부모(COMPOUND) 기준으로 집계하여
 * "어떤 서비스의 어떤 엔드포인트가 다른 서비스의 어떤 엔드포인트를 호출하는지" 파악.
 *
 * 예시) order-post-order → call → user-get-by-id
 *       ↳ Roll-up: order-service → call → user-service (isDerived=true, source='ROLLUP')
 */
const SAMPLE_ATOMIC_RELATIONS = [
  // ── api-gateway 라우팅 (게이트웨이 내부 라우팅 규칙 → 실제 엔드포인트) ──────────
  { subject: 'gw-route-users',    relation: 'call', object: 'user-get-users' },
  { subject: 'gw-route-users',    relation: 'call', object: 'user-post-user' },
  { subject: 'gw-route-users',    relation: 'call', object: 'user-get-by-id' },
  { subject: 'gw-route-orders',   relation: 'call', object: 'order-get-orders' },
  { subject: 'gw-route-orders',   relation: 'call', object: 'order-post-order' },
  { subject: 'gw-route-orders',   relation: 'call', object: 'order-get-by-id' },
  { subject: 'gw-route-orders',   relation: 'call', object: 'order-cancel' },
  { subject: 'gw-route-products', relation: 'call', object: 'product-search' },
  { subject: 'gw-route-products', relation: 'call', object: 'product-get-by-id' },

  // ── 크로스 서비스 호출 (Roll-up → COMPOUND 관계 도출 가능) ──────────────────────
  // order-service ↔ user-service: 주문 시 사용자 검증
  { subject: 'order-post-order', relation: 'call', object: 'user-get-by-id' },
  // order-service ↔ payment-service: 주문 → 결제 / 취소 → 환불
  { subject: 'order-post-order', relation: 'call', object: 'payment-charge' },
  { subject: 'order-cancel',     relation: 'call', object: 'payment-refund' },
  // review-service ↔ user-service: 리뷰 작성자 검증
  { subject: 'review-post',      relation: 'call', object: 'user-get-by-id' },
  // review-service ↔ product-service: 상품 존재 확인
  { subject: 'review-post',      relation: 'call', object: 'product-get-by-id' },
  { subject: 'review-list',      relation: 'call', object: 'product-get-by-id' },

  // ── DB 읽기 (ATOMIC 엔드포인트 → DB 테이블) ──────────────────────────────────────
  { subject: 'user-get-users',    relation: 'read', object: 'users-table' },
  { subject: 'user-get-by-id',    relation: 'read', object: 'users-table' },
  { subject: 'order-get-orders',  relation: 'read', object: 'orders-table' },
  { subject: 'order-get-by-id',   relation: 'read', object: 'orders-table' },
  { subject: 'order-get-by-id',   relation: 'read', object: 'order-items-table' },
  { subject: 'product-search',    relation: 'read', object: 'products-table' },
  { subject: 'product-get-by-id', relation: 'read', object: 'products-table' },
  { subject: 'product-get-by-id', relation: 'read', object: 'product-stock-table' },
  { subject: 'review-list',       relation: 'read', object: 'products-table' },

  // ── DB 쓰기 (ATOMIC 엔드포인트 → DB 테이블) ──────────────────────────────────────
  { subject: 'user-post-user',    relation: 'write', object: 'users-table' },
  { subject: 'user-delete',       relation: 'write', object: 'users-table' },
  { subject: 'order-post-order',  relation: 'write', object: 'orders-table' },
  { subject: 'order-post-order',  relation: 'write', object: 'order-items-table' },
  { subject: 'order-cancel',      relation: 'write', object: 'orders-table' },
  { subject: 'product-create',    relation: 'write', object: 'products-table' },
  { subject: 'product-update',    relation: 'write', object: 'products-table' },
  { subject: 'product-update',    relation: 'write', object: 'product-stock-table' },

  // ── Kafka 토픽 발행 (produce) ──────────────────────────────────────────────────────
  // order-service 엔드포인트 → order.events 토픽
  { subject: 'order-post-order', relation: 'produce', object: 'order-events-topic' },
  { subject: 'order-cancel',     relation: 'produce', object: 'order-events-topic' },
  // payment-service 엔드포인트 → payment.events 토픽
  { subject: 'payment-charge',   relation: 'produce', object: 'payment-events-topic' },
  { subject: 'payment-refund',   relation: 'produce', object: 'payment-events-topic' },

  // ── Kafka 토픽 구독 (consume) — notification-service 가 이벤트를 소비 ───────────
  // 주문 이벤트 → 이메일 알림 발송
  { subject: 'notif-send-email', relation: 'consume', object: 'order-events-topic' },
  // 결제 이벤트 → 푸시 알림 발송
  { subject: 'notif-send-push',  relation: 'consume', object: 'payment-events-topic' },
] as const;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { workspaceId?: string };
    const workspaceId = body.workspaceId ?? DEFAULT_WORKSPACE_ID;
    const db = await getDb();

    let layersInserted = 0;
    let objectsInserted = 0;
    let compoundRelationsInserted = 0;
    let atomicRelationsInserted = 0;
    let tagsInserted = 0;
    let tagLinksInserted = 0;

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
        await db.insert(architectureLayers).values({
          id, workspaceId,
          name: layerDef.name,
          color: layerDef.color,
          sortOrder: layerDef.sortOrder,
          isEnabled: true,
        });
        layerIdMap.set(layerDef.name, id);
        layersInserted++;
      }
    }

    /* ── 2. 태그 생성 ── */
    const tagIdMap = new Map<string, string>();
    for (const tagDef of SAMPLE_TAGS) {
      const existing = await db
        .select({ id: tags.id })
        .from(tags)
        .where(and(eq(tags.workspaceId, workspaceId), eq(tags.name, tagDef.name)))
        .limit(1);
      if (existing[0]) {
        tagIdMap.set(tagDef.name, existing[0].id);
      } else {
        const id = generateId();
        await db.insert(tags).values({ id, workspaceId, name: tagDef.name, color: tagDef.color });
        tagIdMap.set(tagDef.name, id);
        tagsInserted++;
      }
    }

    /* ── 3. COMPOUND 오브젝트 생성 (depth=0) ── */
    const objectIdMap = new Map<string, string>();
    for (const objDef of SAMPLE_COMPOUND_OBJECTS) {
      const existing = await db
        .select({ id: objects.id })
        .from(objects)
        .where(and(eq(objects.workspaceId, workspaceId), eq(objects.name, objDef.name)))
        .limit(1);

      let objectId: string;
      if (existing[0]) {
        objectId = existing[0].id;
      } else {
        objectId = generateId();
        await db.insert(objects).values({
          id: objectId, workspaceId,
          objectType: objDef.objectType,
          category: objDef.category,
          granularity: 'COMPOUND',
          name: objDef.name,
          displayName: objDef.displayName,
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
        const existingAssign = await db
          .select({ id: objectLayerAssignments.id })
          .from(objectLayerAssignments)
          .where(and(eq(objectLayerAssignments.workspaceId, workspaceId), eq(objectLayerAssignments.objectId, objectId)))
          .limit(1);
        if (!existingAssign[0]) {
          await db.insert(objectLayerAssignments).values({ id: generateId(), workspaceId, objectId, layerId });
        }
      }

      // 태그 연결 (COMPOUND만 태그 부착)
      for (const tagName of objDef.tags) {
        const tagId = tagIdMap.get(tagName);
        if (!tagId) continue;
        try {
          await db.insert(objectTags).values({ workspaceId, objectId, tagId });
          tagLinksInserted++;
        } catch {
          // 중복 무시
        }
      }
    }

    /* ── 4. ATOMIC 오브젝트 생성 (depth=1) ── */
    for (const childDef of SAMPLE_ATOMIC_OBJECTS) {
      const parentId = objectIdMap.get(childDef.parentName);
      if (!parentId) continue;

      const existing = await db
        .select({ id: objects.id })
        .from(objects)
        .where(and(eq(objects.workspaceId, workspaceId), eq(objects.name, childDef.name)))
        .limit(1);

      let childId: string;
      if (existing[0]) {
        childId = existing[0].id;
      } else {
        childId = generateId();
        await db.insert(objects).values({
          id: childId, workspaceId,
          objectType: childDef.objectType,
          category: childDef.category,
          granularity: 'ATOMIC',
          name: childDef.name,
          displayName: childDef.displayName,
          parentId,
          path: `/${childDef.parentName}/${childDef.name}`,
          depth: 1,
          visibility: 'VISIBLE',
          metadata: {},
        });
        objectsInserted++;
      }
      objectIdMap.set(childDef.name, childId);

      // ATOMIC도 동일 레이어에 배치 (Object Mapping에서 부모와 같은 레이어)
      const layerId = layerIdMap.get(childDef.layer);
      if (layerId) {
        const existingAssign = await db
          .select({ id: objectLayerAssignments.id })
          .from(objectLayerAssignments)
          .where(and(eq(objectLayerAssignments.workspaceId, workspaceId), eq(objectLayerAssignments.objectId, childId)))
          .limit(1);
        if (!existingAssign[0]) {
          await db.insert(objectLayerAssignments).values({ id: generateId(), workspaceId, objectId: childId, layerId });
        }
      }
    }

    /* ── 5. 관계 생성 헬퍼 ── */
    type RelationType = 'call' | 'expose' | 'read' | 'write' | 'produce' | 'consume' | 'depend_on';

    const insertRelation = async (
      subjectName: string,
      relation: string,
      objectName: string,
    ): Promise<boolean> => {
      const subjectId = objectIdMap.get(subjectName);
      const objectId2 = objectIdMap.get(objectName);
      if (!subjectId || !objectId2) return false;

      const existing = await db
        .select({ id: objectRelations.id })
        .from(objectRelations)
        .where(and(
          eq(objectRelations.workspaceId, workspaceId),
          eq(objectRelations.relationType, relation),
          eq(objectRelations.subjectObjectId, subjectId),
          eq(objectRelations.objectId, objectId2),
          eq(objectRelations.isDerived, false),
        ))
        .limit(1);

      if (!existing[0]) {
        await db.insert(objectRelations).values({
          id: generateId(), workspaceId,
          relationType: relation as RelationType,
          subjectObjectId: subjectId,
          objectId: objectId2,
          status: 'APPROVED',
          source: 'MANUAL',
          isDerived: false,
          metadata: {},
        });
        return true;
      }
      return false;
    };

    /* ── 6. COMPOUND 간 관계 (아키텍처 뷰용) ── */
    for (const relDef of SAMPLE_COMPOUND_RELATIONS) {
      if (await insertRelation(relDef.subject, relDef.relation, relDef.object)) {
        compoundRelationsInserted++;
      }
    }

    /* ── 7. ATOMIC 간 관계 (Object Mapping 드릴다운 + Roll-up 소스) ── */
    for (const relDef of SAMPLE_ATOMIC_RELATIONS) {
      if (await insertRelation(relDef.subject, relDef.relation, relDef.object)) {
        atomicRelationsInserted++;
      }
    }

    return NextResponse.json({
      ok: true,
      inserted: {
        layers: layersInserted,
        tags: tagsInserted,
        tagLinks: tagLinksInserted,
        objects: objectsInserted,
        compoundRelations: compoundRelationsInserted,
        atomicRelations: atomicRelationsInserted,
      },
    });
  } catch (error) {
    console.error('[POST /api/dev/seed]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
