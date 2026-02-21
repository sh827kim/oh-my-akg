# 추론 엔진 재설계 구현 기록

**날짜**: 2026-02-21
**상태**: 완료
**관련 문서**: `2026-02-21_inference-engine-redesign.md`, `2026-02-21_inference-engine-critical-analysis.md`

---

## 개요

기존 `packages/inference`의 정규식 기반 추론 엔진을 실제 AST 파서 기반으로 완전히 재작성했다.
핵심 목표: PRD In Scope의 `api_endpoint`, `db_table`, `topic`, `queue` 같은 원자 Object를 소스코드에서 자동 발견하고, `service → api_endpoint (expose)`, `service → db_table (read/write)` 같은 올바른 관계를 추론하는 것.

### 기존 구현의 문제

| 항목 | 기존 | 개선 후 |
|------|------|---------|
| 파서 | 정규식 (AST 없음) | `@babel/parser`, `node-sql-parser`, `web-tree-sitter` |
| 추론 대상 | `service → service` | `api_endpoint`, `db_table`, `topic` 포함 |
| Object 생성 | 없음 | `OBJECT_CREATE` change request |
| 파일 선택 | 알파벳 순 30개 | 유형별 우선순위 기반 |
| 관계 해석 | token → repo 매칭 | URL/annotation/ORM 직접 분석 |

---

## 아키텍처

### 2-Pass 파이프라인

```
                ┌─────────────────────────────────────────┐
                │           runInferencePipeline()          │
                └────────────┬──────────────────────────────┘
                             │
              ┌──────────────▼──────────────┐
              │  PASS 1: Object Discovery    │
              │  (knownUrns = 빈 Set)        │
              │                              │
              │  Prisma Scanner              │
              │  SQL DDL Scanner             │  ──→ DiscoveredObject[]
              │  TypeScript Scanner          │
              │  Java/Kotlin Scanner         │
              │  Python Scanner              │
              │  Config Scanner              │
              └──────────────┬──────────────┘
                             │
              ┌──────────────▼──────────────┐
              │  Object Registry 구축        │
              │  (URN 기준 중복 제거)         │
              │  knownUrns = 발견된 URN 집합 │
              └──────────────┬──────────────┘
                             │
              ┌──────────────▼──────────────┐
              │  PASS 2: Relation Discovery  │
              │  (knownUrns 참조 가능)        │
              │                              │
              │  동일 스캐너 재실행           │  ──→ DiscoveredRelation[]
              │  (relations만 수집)           │
              └──────────────┬──────────────┘
                             │
              ┌──────────────▼──────────────┐
              │  deduplicateRelations()      │
              │  toObjectCandidates()        │
              │  toRelationCandidates()      │
              └──────────────┬──────────────┘
                             │
                    InferencePipelineResult
                    ├── objectCandidates[]    → OBJECT_CREATE change requests
                    └── relationCandidates[]  → RELATION_UPSERT change requests
```

### 스캐너 구조

모든 스캐너는 `Scanner` 인터페이스를 구현한다.

```typescript
interface Scanner {
    id: string;
    supports: (filePath: string) => boolean;
    scan: (file: SourceFile, context: ScanContext) => ScanResult;
}
```

각 `scan()` 호출은 `{ objects: DiscoveredObject[], relations: DiscoveredRelation[] }`를 반환한다.
Pass 1과 Pass 2에서 동일 스캐너를 호출하되, `context.knownUrns`의 채워짐 여부로 단계를 구분할 수 있다.

---

## URN 설계

```
service:        urn:{org}:{repo-name}:service
api_endpoint:   urn:{org}:{repo-name}:api_endpoint:{METHOD}:{path}
                  예) urn:myorg:order-service:api_endpoint:POST:/api/v1/orders
db_table:       urn:{org}:{repo-name}:db_table:{table_name}
                  예) urn:myorg:order-service:db_table:orders
topic:          urn:{org}::topic:{topic_name}        ← service 비귀속 (이중 콜론)
                  예) urn:myorg::topic:order.created
queue:          urn:{org}::queue:{queue_name}
message_broker: urn:{org}::message_broker:{broker_name}
cache_instance: urn:{org}::cache_instance:{name}
database:       urn:{org}:{repo-name}:database:{name}
```

service 비귀속 리소스(topic, queue, message_broker, cache_instance)는 org 레벨이므로 service 자리를 비운다.

---

## 파일 선택 전략

기존 알파벳 순 30개 제한을 유형별 우선순위 + 최대 개수 규칙으로 교체했다.

| 패턴 | max | priority | 이유 |
|------|-----|----------|------|
| `schema.prisma` | 3 | 100 | DB 스키마 확정 소스 |
| `*.sql` | 10 | 90 | DDL 파일 |
| `*Entity.(java\|kt)` | 20 | 85 | JPA Entity = DB 테이블 매핑 |
| `models.py` | 10 | 85 | SQLAlchemy 모델 |
| `*Controller.(java\|kt)` | 20 | 80 | Spring REST Controller |
| `router.(ts\|js)` | 10 | 75 | Express/Next.js 라우터 |
| `application*.yml` | 5 | 70 | Spring 설정 |
| `kafka/consumer/producer.*` | 10 | 65 | 메시지 패턴 |
| `*.java/kt/kts` | 30 | 40 | 일반 Java/Kotlin |
| `*.ts/tsx/js` | 30 | 35 | 일반 TypeScript/JS |
| `*.py` | 20 | 30 | 일반 Python |

---

## 스캐너별 구현 상세

### 1. SQL DDL Scanner (`scanners/schema/sql-ddl-scanner.ts`)

**파서**: `node-sql-parser` (PostgreSQL 방언)
**대상**: `.sql` 파일

**탐지 패턴**:
- `CREATE TABLE orders (...)` → `db_table:orders` Object (confidence ~0.8)
- `FOREIGN KEY ... REFERENCES users(id)` → `depend_on` Relation (confidence ~0.8)
- 컬럼명 접미사 패턴 (`user_id`, `order_no`, `product_uid`) → 암묵적 FK (confidence ~0.52)

**제외 컬럼**: `created_by`, `updated_by`, `deleted_by`, `created_at`, `updated_at`, `deleted_at`

```sql
-- 이 DDL에서:
CREATE TABLE orders (
    id BIGINT PRIMARY KEY,
    user_id BIGINT NOT NULL,           -- → depend_on db_table:users (접미사 패턴)
    FOREIGN KEY (user_id) REFERENCES users(id)  -- → depend_on db_table:users (명시적 FK)
);
-- 결과: db_table:orders Object + depend_on db_table:users Relation
```

### 2. Prisma Scanner (`scanners/schema/prisma-scanner.ts`)

**파서**: 정규식 (Prisma SDL은 단순 구조)
**대상**: `schema.prisma`

**탐지 패턴**:
- `model Order { ... }` → `db_table:orders` Object (복수형 변환, `@@map` 존재 시 우선)
- `@relation` 어노테이션 → `depend_on` Relation (confidence ~0.76)
- `userId Int` 같은 FK 접미사 필드 → 암묵적 `depend_on` (confidence ~0.5)

```prisma
model Order {
    id       Int      @id
    userId   Int                     // → depend_on db_table:users (접미사 패턴)
    user     User     @relation(...)  // → depend_on db_table:users (@relation)
    @@map("orders")                   // → db_table:orders (@@map 우선)
}
```

### 3. TypeScript Scanner (`scanners/typescript/index.ts`)

**파서**: `@babel/parser` + `@babel/traverse`
**대상**: `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`

**탐지 패턴**:

| 소스 패턴 | 추론 결과 |
|-----------|-----------|
| `@Controller('/orders')` + `@Get('/:id')` | `api_endpoint:GET:/orders/:id` Object + `expose` Relation |
| `app.get('/api/v1/orders', handler)` | `api_endpoint:GET:/api/v1/orders` Object + `expose` Relation |
| `prisma.order.findMany()` | `read` Relation → `db_table:orders` |
| `prisma.user.create()` | `write` Relation → `db_table:users` |
| `producer.send({ topic: 'order-events' })` | `topic:order-events` Object + `produce` Relation |
| `consumer.subscribe({ topics: ['payment'] })` | `topic:payment` Object + `consume` Relation |
| `fetch('https://order-service/api/v1/orders')` | `call` Relation → `urn:org:order-service:service` |

**NestJS 처리 방식**:
- `ClassDeclaration enter/exit`에서 `@Controller` prefix 스택 관리
- `ClassMethod`에서 HTTP 데코레이터 탐지 후 prefix + method path 결합

**Express 조건**:
- 경로 인수가 `/`로 시작하고, 두 번째 인수(핸들러)가 있어야 라우트로 판단 (오탐 방지)

### 4. Java/Kotlin Scanner (`scanners/java-kotlin/index.ts`)

**파서**: Java = `web-tree-sitter` (tree-sitter-java.wasm), Kotlin = 정규식
**대상**: `.java`, `.kt`, `.kts`

**탐지 패턴**:

| 어노테이션/패턴 | 추론 결과 |
|-----------------|-----------|
| `@RestController` + `@GetMapping("/path")` | `api_endpoint` Object + `expose` Relation |
| `@RequestMapping(value="/prefix")` | 클래스 레벨 prefix로 조합 |
| `@Entity` + `@Table(name="orders")` | `db_table:orders` Object |
| `@KafkaListener(topics={"order.created"})` | `topic:order.created` Object + `consume` Relation |
| `kafkaTemplate.send("order.created", ...)` | `topic:order.created` Object + `produce` Relation |
| `restTemplate.exchange("https://payment-service/...")` | `call` Relation → payment-service |

**어노테이션 값 추출 방식**:
- tree-sitter로 구조 파악 (class/method 경계)
- annotation text에 정규식 적용 (값 추출)
- 단일 문자열 인수: `@GetMapping("/{id}")` → `/{id}`
- named 인수: `@RequestMapping(value = "/path")` → `/path`

### 5. Python Scanner (`scanners/python/index.ts`)

**파서**: `web-tree-sitter` (tree-sitter-python.wasm) + 정규식 fallback
**대상**: `.py`

**탐지 패턴**:

| 소스 패턴 | 추론 결과 |
|-----------|-----------|
| `@app.get("/orders")` | `api_endpoint:GET:/orders` Object + `expose` Relation |
| `@router.post("/users")` | `api_endpoint:POST:/users` Object + `expose` Relation |
| `class Order(Base):` | `db_table:orders` Object (SQLAlchemy) |
| `__tablename__ = "custom_orders"` | `db_table:custom_orders` Object (우선) |
| `producer.produce("order.created", ...)` | `topic:order.created` Object + `produce` Relation |
| `consumer.subscribe(["payment.events"])` | `topic:payment.events` Object + `consume` Relation |

tree-sitter 초기화 실패 시 정규식 fallback으로 라우트와 SQLAlchemy 모델 탐지.

### 6. Config Scanner (`scanners/config/index.ts`)

**파서**: 정규식
**대상**: `application*.yml`, `.properties`, `docker-compose.yml`, `.env`

**탐지 패턴**:

| 설정 패턴 | 추론 결과 |
|-----------|-----------|
| `spring.datasource.url: jdbc:postgresql://host/db` | `database:db` Object + `depend_on` Relation |
| `kafka.bootstrap-servers: kafka:9092` | `message_broker:kafka` Object + `depend_on` Relation |
| `spring.redis.host: redis-master` | `cache_instance:redis-master` Object + `depend_on` Relation |
| `mongodb://host:27017/mydb` | `database:mydb` Object + `depend_on` Relation |
| `ORDER_SERVICE_URL: http://order-service` | `depend_on` Relation → `urn:org:order-service:service` |

---

## Confidence 스코어링

### Evidence 종류별 가중치

| kind | 가중치 | 예시 |
|------|--------|------|
| `call` | 0.90 | 직접 함수 호출 |
| `message` | 0.85 | Kafka send/subscribe |
| `query` | 0.80 | SQL 쿼리, ORM 호출 |
| `route` | 0.78 | HTTP 라우트 어노테이션 |
| `annotation` | 0.76 | @Entity, @Table |
| `env` | 0.72 | 설정 파일 값 |
| `value` | 0.70 | 접미사 패턴 추론 |
| `import` | 0.62 | import 구문 |

### 할인 규칙

- 접미사 패턴(암묵적 FK) 추론: `× 0.65`
- URL 호스트명 기반 서비스 추론: `× 0.75`
- 설정 파일 URL: `× 0.85`
- FK로 추론된 참조 테이블 Object: `× 0.7`
- `LOW_CONFIDENCE_THRESHOLD = 0.65` → 미만이면 `reviewLane: 'low_confidence'`

---

## Core 패키지 변경

### ChangeRequestType 확장

```typescript
// Before
type ChangeRequestType = 'RELATION_UPSERT' | 'RELATION_DELETE' | 'OBJECT_PATCH';

// After
type ChangeRequestType = 'RELATION_UPSERT' | 'RELATION_DELETE' | 'OBJECT_PATCH' | 'OBJECT_CREATE';
```

### ObjectCreatePayload

```typescript
interface ObjectCreatePayload {
    urn: string;
    objectType: string;       // 'api_endpoint' | 'db_table' | 'topic' | ...
    name: string;
    displayName?: string;
    parentUrn?: string;       // api_endpoint → 부모 service URN
    granularity: 'COMPOUND' | 'ATOMIC';
    metadata?: Record<string, unknown>;
    source: 'inference';
    confidence: number;
    evidence: string;         // stringified EvidenceRecord
    scoreVersion?: string;
}
```

### resolveObjectByUrn

기존 `resolveServiceObjectId`는 `object_type = 'service'` 필터가 있어 다른 Object 타입을 찾을 수 없었다.
`resolveObjectByUrn`을 추가해 OBJECT_CREATE 승인 시 `parentUrn` 해결에 사용한다.

```typescript
// 기존: service만 조회
async function resolveServiceObjectId(db, workspaceId, urn): Promise<string | null>

// 추가: 모든 object_type 조회
async function resolveObjectByUrn(db, workspaceId, urn): Promise<string | null>
```

### OBJECT_CREATE 승인 처리 (`applyChangeRequest`)

```typescript
if (nextStatus === 'APPROVED' && cr.request_type === 'OBJECT_CREATE') {
    const payload = parseObjectCreatePayload(cr.payload);
    const parentId = payload.parentUrn
        ? await resolveObjectByUrn(db, workspaceId, payload.parentUrn)
        : null;
    await db.query(
        `INSERT INTO objects (...) VALUES (...)
         ON CONFLICT (workspace_id, urn) WHERE urn IS NOT NULL DO NOTHING`,
        [...],
    );
}
```

`ON CONFLICT DO NOTHING`으로 동일 URN이 이미 존재하면 무시한다.

---

## 스키마 변경

```sql
-- change_requests 테이블 constraint에 OBJECT_CREATE 추가
ALTER TABLE change_requests DROP CONSTRAINT IF EXISTS change_requests_request_type_check;
ALTER TABLE change_requests ADD CONSTRAINT change_requests_request_type_check CHECK (
    request_type IN ('RELATION_UPSERT', 'RELATION_DELETE', 'OBJECT_PATCH', 'OBJECT_CREATE')
);
```

---

## sync.ts / api/sync/route.ts 변경

### 적재 순서

OBJECT_CREATE → RELATION_UPSERT 순서로 적재한다.
Relation 승인 시 `applyChangeRequest`가 subject/target Object를 DB에서 조회하므로, Object가 먼저 존재해야 한다.

### 중복 방지 로직

**OBJECT_CREATE**:
1. `objects` 테이블에 해당 URN 이미 존재 → 스킵
2. PENDING 상태의 동일 URN OBJECT_CREATE 존재 → 스킵

**RELATION_UPSERT**:
1. PENDING 상태의 동일 (fromId, toId, type) Relation 존재 → 스킵
2. `approved_object_relations`에 이미 승인된 동일 관계 존재 → 스킵

### 메트릭 매핑

```typescript
candidateCount: objectCandidates.length + relationCandidates.length,
// (기존 inferenceResult.metrics.candidateCount 대체)
```

---

## web-tree-sitter 초기화

`tree-sitter-loader.ts`는 싱글톤 패턴으로 WASM 파서를 관리한다.

```typescript
// pipeline.ts에서 스캔 시작 전 호출
await initTreeSitterParsers();
// → web-tree-sitter 런타임 초기화 (tree-sitter.wasm)
// → tree-sitter-java.wasm 로드
// → tree-sitter-python.wasm 로드

// 스캐너에서 동기 접근
const parser = getLoadedParser('java');  // null이면 해당 스캐너 스킵
```

WASM 파일 경로는 `require.resolve('tree-sitter-java/package.json')`으로 런타임에 탐색한다.
초기화 실패는 `Promise.allSettled`로 처리하므로 한쪽이 실패해도 파이프라인은 계속 동작한다.

---

## 구현에서의 결정 사항

### Kotlin 파서

`tree-sitter-kotlin` npm 패키지가 의존성에 없어 Kotlin은 정규식 기반으로 처리했다.
Spring 어노테이션 구문이 Java와 동일하므로 동일 정규식을 재사용할 수 있다.

### Python 스캐너 전략

tree-sitter로 AST를 파싱하고, 초기화 실패 또는 파싱 오류 시 정규식으로 fallback한다.
Kafka 패턴은 tree-sitter와 무관하게 항상 정규식으로 탐지한다.

### Express 라우트 오탐 방지

`app.get('/path', handler)` 패턴 탐지 시:
- 첫 번째 인수가 `/`로 시작하는 문자열 리터럴이어야 함
- 두 번째 인수(핸들러)가 반드시 존재해야 함

`db.get(key)` 같은 유사 패턴과 구별하기 위한 조건이다.

### topic Object의 scope

topic, message_broker, cache_instance는 service에 귀속되지 않는 글로벌 리소스다.
URN의 service 자리를 비워 `urn:org::topic:name` 형식으로 표현한다.
Pass 1에서 `knownUrns`에 없을 때만 Object로 등록하고, 중복 스캔 시 덮어쓰지 않는다.

---

## 남은 과제

1. **JPA Scanner 분리**: 현재 Java 스캐너 내에 포함되어 있는 JPA Entity 탐지를 별도 scanner로 분리하면 테스트 및 유지보수가 쉬워진다.
2. **Kotlin grammar 추가**: `tree-sitter-kotlin` 패키지를 devDependencies에 추가해 Kotlin도 tree-sitter 기반으로 전환.
3. **TypeORM 지원**: 현재 Prisma 중심의 ORM 탐지에 TypeORM `getRepository(Entity).find()` 패턴 추가.
4. **topic URN 크로스 서비스 해결**: 서로 다른 서비스가 같은 topic을 produce/consume할 때 URN이 일치하는지 검증 로직.
5. **벤치마크 업데이트**: `scripts/task2-8-inference-benchmark.ts`를 새 output 형식(`objectCandidates`, `relationCandidates`)에 맞게 수정.
6. **golden set 확장**: `db_table`, `api_endpoint` 발견 케이스를 포함하는 golden set 테스트 추가.
