# 추론 엔진 근본 재설계 제안

작성일: 2026-02-21
연계 문서:
- 현황 분석: `docs/design/2026-02-21_inference-engine-critical-analysis.md`
- PRD: `docs/prd/PRD.md`
- Object Model Spec: `docs/spec/object-model-definition.md`

---

## 1. 재설계 동기

현재 추론 엔진은 "서비스 이름 토큰 유사도 기반 의존관계 추론기"다. 이 구조에서는 아무리 정규식 품질을 높여도 아래를 달성할 수 없다:

1. `api_endpoint`, `db_table`, `topic`, `queue` Object 자동 생성
2. `service → api_endpoint (call)` 정규 관계 저장
3. `service → db_table (read/write)` 저장
4. 도메인 추론
5. DB 스키마 기반 ERD

목표가 "서비스 간 유사도 매핑"이 아니라 "아키텍처 지식 수집"이라면, 추론 엔진이 다뤄야 하는 대상과 출력이 근본적으로 달라야 한다.

---

## 2. 설계 원칙 전환

### 현재 패러다임

```
소스 파일 → [힌트 토큰 추출] → 서비스 이름 매칭 → service-service 관계 후보
```

### 제안 패러다임

```
소스 파일 → [Object 발견] → Object 후보 (api_endpoint, db_table, topic...)
           → [Relation 발견] → Object 간 관계 후보
           → [Object/Relation Resolution] → change_request 적재
```

**핵심 전환**: 추론의 1차 목표는 "관계를 찾는 것"이 아니라 "Object를 발견하는 것"이다. Object가 먼저 존재해야 관계를 저장할 수 있다.

---

## 3. 새로운 추론 아키텍처

### 3.1 전체 구조

```
packages/inference/src/
  scanners/
    config/               # 설정 파일 스캔
      env-scanner.ts        # 환경변수 참조 → 외부 서비스 의존 힌트
      yaml-scanner.ts       # application.yaml → datasource, broker 설정
    schema/               # DB 스키마 스캔 (신규)
      sql-ddl-scanner.ts    # CREATE TABLE → db_table + 컬럼 + FK 관계
      jpa-entity-scanner.ts # @Entity 클래스 → db_table + 컬럼
      prisma-scanner.ts     # schema.prisma → db_table + 관계
      sqlalchemy-scanner.ts # SQLAlchemy model → db_table
    api/                  # API 엔드포인트 스캔 (신규)
      spring-scanner.ts     # @RestController, @RequestMapping → api_endpoint
      fastapi-scanner.ts    # FastAPI route decorator → api_endpoint
      express-scanner.ts    # express router → api_endpoint
    message/              # 메시지 브로커 스캔 (신규)
      kafka-scanner.ts      # @KafkaListener, KafkaTemplate → topic + produce/consume
      sqs-scanner.ts        # SQS send/receive → queue + produce/consume
    client/               # 클라이언트 호출 스캔 (기존 call 분리)
      http-client-scanner.ts  # RestTemplate, axios, fetch → call 관계
      feign-scanner.ts        # @FeignClient → call 관계 + target api_endpoint
  resolvers/
    object-resolver.ts    # 발견된 URN → 기존 Object UUID 매핑 or 신규 Object 후보
    relation-resolver.ts  # 발견된 관계 → change_request 후보
  domain/
    domain-classifier.ts  # Object 집합 → 도메인 클러스터 추론
  pipeline.ts             # 전체 파이프라인 조율
  types.ts                # 공통 타입 정의
```

### 3.2 핵심 타입 재정의

```typescript
// 스캐너가 발견한 Object 후보
interface DiscoveredObject {
  urn: string;                  // urn:{org}:{service}:{type}:{name}
  objectType: ObjectType;       // 'api_endpoint' | 'db_table' | 'topic' | ...
  name: string;
  parentUrn?: string;           // 부모 Object URN (예: service URN)
  metadata: Record<string, unknown>;
  evidence: EvidenceRecord;
  confidence: number;
}

// 스캐너가 발견한 Relation 후보
interface DiscoveredRelation {
  subjectUrn: string;           // 주체 Object URN
  relationType: RelationType;
  targetUrn: string;            // 대상 Object URN
  evidence: EvidenceRecord;
  confidence: number;
}

// 스캐너 출력 (Object 발견 + Relation 발견을 함께)
interface ScanResult {
  objects: DiscoveredObject[];
  relations: DiscoveredRelation[];
  metrics: ScanMetrics;
}

// 스캐너 인터페이스
interface Scanner {
  id: string;
  supports: (filePath: string) => boolean;
  scan: (file: SourceFile, context: ScanContext) => ScanResult;
}

// 스캔 컨텍스트: 현재 서비스 정보 + 이미 알려진 Object URN 집합
interface ScanContext {
  currentServiceUrn: string;
  knownObjectUrns: Set<string>;   // DB에 이미 존재하는 Object URN들
  orgName: string;
}
```

---

## 4. 스캐너별 동작 상세

### 4.1 Schema Scanner (DB 스키마 스캔)

SQL DDL 파일, JPA 엔티티, Prisma 스키마를 처리한다.

**입력 대상 파일**:
- `*.sql` (DDL 포함 파일)
- `*Entity.java`, `*Entity.kt` (`@Entity` 어노테이션 파일)
- `schema.prisma`
- `models.py` (SQLAlchemy 모델)

**SQL DDL 예시**:

```sql
CREATE TABLE orders (
  id BIGINT PRIMARY KEY,
  user_id BIGINT REFERENCES users(id),
  payment_method_id BIGINT
);
```

**출력**:

```typescript
// DiscoveredObject 3건
{ urn: 'urn:myorg:order-service:db_table:orders', objectType: 'db_table', ... }
{ urn: 'urn:myorg:order-service:db_table:users',  objectType: 'db_table', ... }  // FK 참조로 발견

// DiscoveredRelation 2건 (FK 기반)
{ subjectUrn: 'urn:...:db_table:orders', relationType: 'depend_on', targetUrn: 'urn:...:db_table:users' }
// payment_method_id → 접미사 패턴(*_id) → payment_method 테이블 추론
{ subjectUrn: 'urn:...:db_table:orders', relationType: 'depend_on', targetUrn: 'urn:...:db_table:payment_methods', confidence: 0.6 }
```

접미사 패턴 적용: PRD 7.5의 `*_id, *_no, *_uid, *_key, *_code` 패턴. 기본 제외: `created_by`, `updated_by`, `deleted_by`, `created_at`, `updated_at`.

**JPA Entity 예시**:

```java
@Entity
@Table(name = "orders")
public class OrderEntity {
    @ManyToOne
    @JoinColumn(name = "user_id")
    private UserEntity user;
}
```

출력: `db_table:orders` Object + `orders → users (depend_on)` Relation

---

### 4.2 API Scanner (API 엔드포인트 스캔)

**Spring Controller 예시**:

```java
@RestController
@RequestMapping("/api/v1/orders")
public class OrderController {
    @PostMapping
    public ResponseEntity<Order> createOrder(...) { ... }

    @GetMapping("/{id}")
    public ResponseEntity<Order> getOrder(...) { ... }
}
```

**출력**:

```typescript
// DiscoveredObject 2건
{ urn: 'urn:myorg:order-service:api_endpoint:POST /api/v1/orders',  objectType: 'api_endpoint' }
{ urn: 'urn:myorg:order-service:api_endpoint:GET /api/v1/orders/{id}', objectType: 'api_endpoint' }

// DiscoveredRelation 2건 (service가 api_endpoint를 expose)
{ subjectUrn: 'urn:myorg:order-service:service', relationType: 'expose', targetUrn: '...api_endpoint:POST /api/v1/orders' }
{ subjectUrn: 'urn:myorg:order-service:service', relationType: 'expose', targetUrn: '...api_endpoint:GET /api/v1/orders/{id}' }
```

FastAPI, Express Router도 동일 방식으로 처리.

---

### 4.3 Message Scanner (메시지 브로커 스캔)

**Kafka 예시**:

```java
@KafkaListener(topics = "order.created")
public void handleOrderCreated(OrderEvent event) { ... }

kafkaTemplate.send("payment.requested", paymentEvent);
```

**출력**:

```typescript
// DiscoveredObject 2건
{ urn: 'urn:myorg::topic:order.created',    objectType: 'topic' }
{ urn: 'urn:myorg::topic:payment.requested', objectType: 'topic' }

// DiscoveredRelation 2건
{ subjectUrn: '...order-service:service', relationType: 'consume', targetUrn: '...topic:order.created' }
{ subjectUrn: '...order-service:service', relationType: 'produce', targetUrn: '...topic:payment.requested' }
```

topic의 parentUrn은 메시지 브로커 Object (`message_broker`)로 연결된다. 브로커 이름은 설정 파일(application.yaml의 `spring.kafka.bootstrap-servers`)에서 추출한다.

---

### 4.4 Client Scanner (HTTP 클라이언트 호출 스캔)

기존의 call 추론을 분리하되, 출력 형태를 개선한다.

**현재 방식** (폐기):
```
RestTemplate 감지 → hint 토큰 → 서비스 이름 매칭 → service-service call
```

**새 방식**:

```java
// RestTemplate 또는 @FeignClient에서 URL 추출
restTemplate.exchange("http://order-service/api/v1/orders/{id}", ...)
```

**출력**:

```typescript
// URL에서 host + path 추출
// → target api_endpoint URN 구성 시도
{
  subjectUrn: 'urn:myorg:payment-service:service',
  relationType: 'call',
  targetUrn: 'urn:myorg:order-service:api_endpoint:GET /api/v1/orders/{id}',
  confidence: 0.85,  // URL path 직접 매칭 → 고신뢰
}

// URL은 있지만 target endpoint가 알려지지 않은 경우
{
  subjectUrn: 'urn:myorg:payment-service:service',
  relationType: 'call',
  targetUrn: 'urn:myorg:order-service:service',   // service 수준으로 fallback
  confidence: 0.55,  // host만 매칭, endpoint 불명
}
```

URL 기반 매칭 → endpoint 수준 매칭 실패 시 service 수준으로 fallback. **service → service call은 fallback이지 정규 저장이 아님**으로 명시.

---

### 4.5 ORM Read/Write Scanner

ORM 호출에서 **어떤 테이블을 읽고 쓰는지** 추적한다.

**현재 방식** (폐기):
```
findAll() 감지 → hint 토큰 → 서비스 이름 매칭 (항상 실패 또는 오탐)
```

**새 방식**:

```java
// JPA Repository
public interface OrderRepository extends JpaRepository<OrderEntity, Long> {
    List<OrderEntity> findByUserId(Long userId);
}
// OrderEntity → @Table(name = "orders") → db_table:orders
```

```typescript
// TypeScript + Prisma
const order = await prisma.order.findMany({ where: { userId } });
// prisma.order → schema.prisma의 model Order → db_table:orders
```

**출력**:

```typescript
{
  subjectUrn: 'urn:myorg:order-service:service',
  relationType: 'read',
  targetUrn: 'urn:myorg:order-service:db_table:orders',
  confidence: 0.88,
}
```

이 스캐너는 Schema Scanner가 먼저 `db_table` Object를 발견한 이후에 작동하는 2-pass 구조다.

---

### 4.6 Domain Classifier (도메인 추론)

PRD 5.1 #2, 7.4를 구현한다.

**입력**: 한 서비스의 ScanResult 전체 (발견된 api_endpoint, db_table, topic, import 그래프)

**알고리즘**:

```
1. api_endpoint path 접두어 분석
   - /api/v1/orders/*, /api/v1/carts/* → 'order', 'cart' 도메인 후보
2. db_table 이름 클러스터링
   - orders, order_items, order_history → 'order' 도메인
   - users, user_profiles → 'user' 도메인
3. topic 이름 분석
   - order.created, order.cancelled → 'order' 도메인 강화
4. import graph 분석
   - com.example.order.* 패키지 비율 → 'order' 도메인 강화

결과: primary_domain = 'order', secondary_domains = ['payment', 'user']
```

**출력**: `OBJECT_PATCH` change_request 생성 (domain 정보를 `metadata`에 반영)

---

## 5. Object Resolver (URN → UUID 해결)

스캐너들이 생성하는 Object/Relation 후보는 모두 URN 기반이다. 승인 파이프라인에 적재하기 전에 URN을 처리해야 한다.

### 5.1 URN 설계

```
urn:{org}:{service-name}:{object-type}:{name}

예시:
urn:myorg:order-service:service           (서비스 자체)
urn:myorg:order-service:api_endpoint:POST /api/v1/orders
urn:myorg:order-service:db_table:orders
urn:myorg::topic:order.created            (service 비귀속 global 리소스)
urn:myorg::message_broker:kafka-prod
```

### 5.2 처리 전략

```typescript
async function resolveObject(urn: string, discoveredObject: DiscoveredObject, db: PGlite): Promise<ResolvedObject> {
    // 1. DB에서 URN으로 기존 Object 검색
    const existing = await db.query('SELECT id FROM objects WHERE urn = $1', [urn]);

    if (existing.rows.length > 0) {
        // 기존 Object 재사용
        return { uuid: existing.rows[0].id, isNew: false };
    }

    // 2. 기존 Object 없음 → 신규 Object 생성 change_request 적재
    // OBJECT_PATCH 타입이 아닌, 신규 Object 생성을 위한 OBJECT_CREATE 타입 필요 (현재 미정의)
    return { uuid: null, pendingCreation: true, changeRequest: buildObjectCreatePayload(discoveredObject) };
}
```

현재 change_requests 테이블의 `request_type`에 `OBJECT_CREATE`가 없다. 신규 Object 생성을 승인 큐로 처리하려면 이 타입 추가가 필요하다.

### 5.3 OBJECT_CREATE 타입 추가 (스키마 변경 필요)

```sql
-- change_requests_request_type_check 제약 수정
ALTER TABLE change_requests DROP CONSTRAINT change_requests_request_type_check;
ALTER TABLE change_requests ADD CONSTRAINT change_requests_request_type_check
  CHECK (request_type IN ('RELATION_UPSERT', 'RELATION_DELETE', 'OBJECT_PATCH', 'OBJECT_CREATE'));
```

승인 시 처리:
- `OBJECT_CREATE` 승인 → `objects` 테이블에 INSERT
- `RELATION_UPSERT` 승인 → subject/target Object가 존재하는지 검증 후 INSERT

---

## 6. 파이프라인 재설계

### 6.1 2-Pass 스캔 구조

1-pass로 모든 것을 하려면 "아직 발견되지 않은 Object를 참조하는 Relation"을 처리할 수 없다. 2-pass 구조가 필요하다.

```typescript
async function runInferencePipeline(repos: RepoInfo[], options: InferenceOptions): Promise<InferenceResult> {
    // Pass 1: Object Discovery (모든 repo의 Object 발견)
    const allDiscoveredObjects: DiscoveredObject[] = [];
    for (const repo of repos) {
        const files = await fetchRepoFiles(repo);
        for (const file of files) {
            const scanners = selectScanners(file.path);  // 파일 유형에 맞는 스캐너 선택
            for (const scanner of scanners) {
                const result = scanner.scan(file, buildContext(repo));
                allDiscoveredObjects.push(...result.objects);
            }
        }
    }

    // Object Resolution: URN → UUID 매핑
    const objectRegistry = await resolveObjects(allDiscoveredObjects, db);
    // objectRegistry: Map<urn, uuid> (기존 + 신규 예정)

    // Pass 2: Relation Discovery (Object Registry를 참조하여 관계 발견)
    const allDiscoveredRelations: DiscoveredRelation[] = [];
    for (const repo of repos) {
        const files = await fetchRepoFiles(repo);  // 캐시 재사용 필요
        for (const file of files) {
            const context = buildContext(repo, objectRegistry);
            const scanners = selectScanners(file.path);
            for (const scanner of scanners) {
                const result = scanner.scan(file, context);
                allDiscoveredRelations.push(...result.relations);
            }
        }
    }

    // change_request 적재
    return buildChangeRequests(allDiscoveredObjects, allDiscoveredRelations, objectRegistry);
}
```

### 6.2 파일 선택 전략 개선

현재: `MAX_SOURCE_FILES = 30` (알파벳 순서)

제안: **파일 유형별 우선순위 기반 선택**

```typescript
const FILE_PRIORITY = [
    // 스키마/엔티티 최우선 (Object Discovery)
    { regex: /\bschema\.prisma$/i,                        priority: 100, maxCount: 5  },
    { regex: /\.sql$/i,                                   priority: 90,  maxCount: 10 },
    { regex: /Entity\.(java|kt)$/i,                       priority: 85,  maxCount: 20 },
    { regex: /models\.py$/i,                              priority: 85,  maxCount: 10 },
    // API 컨트롤러
    { regex: /Controller\.(java|kt)$/i,                   priority: 80,  maxCount: 20 },
    { regex: /router?\.(ts|js)$/i,                        priority: 75,  maxCount: 10 },
    // 설정 파일
    { regex: /application(-\w+)?\.(yaml|yml|properties)$/i, priority: 70, maxCount: 10 },
    // 메시지 브로커 관련
    { regex: /(kafka|sqs|rabbitmq|consumer|producer)\.(ts|java|kt|py)$/i, priority: 65, maxCount: 15 },
    // 일반 소스
    { regex: SOURCE_FILE_REGEX,                           priority: 10,  maxCount: 30 },
];
```

---

## 7. 도메인 추론을 위한 스키마 확장

PRD 7.4 구현을 위해 `objects` 테이블 또는 `metadata` JSONB 확장이 필요하다.

### 옵션 A: metadata JSONB 활용 (스키마 변경 최소화)

```typescript
// objects.metadata에 도메인 정보 저장
{
    "primary_domain": "order",
    "secondary_domains": [
        { "name": "payment", "confidence": 0.72 },
        { "name": "user",    "confidence": 0.45 }
    ],
    "domain_evidence": ["api_endpoint:POST /api/v1/orders", "db_table:orders"]
}
```

OBJECT_PATCH change_request로 metadata.primary_domain, metadata.secondary_domains를 업데이트.

### 옵션 B: 전용 컬럼 추가 (타입 안전성 우선)

```sql
ALTER TABLE objects
  ADD COLUMN IF NOT EXISTS primary_domain TEXT,
  ADD COLUMN IF NOT EXISTS secondary_domains JSONB NOT NULL DEFAULT '[]'::jsonb;
```

**권장: 옵션 A** (스키마 변경 없이 시작, 필요 시 B로 이전)

---

## 8. 전환 전략 (단계적 마이그레이션)

전체를 한번에 재작성하지 않고 단계적으로 전환한다.

### Phase 1: 구조 분리 (기존 기능 유지)

- 현재 `env-auto-mapping.ts`를 `scanners/config/env-scanner.ts`로 이동
- 현재 정규식 플러그인을 `scanners/client/http-client-scanner.ts`로 이동 (logic 변경 없이)
- `ScanResult` 타입 도입, 기존 `MappingCandidate` 타입과 어댑터로 연결
- 출력은 여전히 `service → service` 수준

목표: 기존 기능 회귀 없이 디렉토리 구조 재편

### Phase 2: Schema Scanner 도입 (Object Discovery 시작)

- SQL DDL Scanner 구현 (`node-sql-parser` 라이브러리 사용)
- JPA Entity Scanner 구현 (정규식 기반 → 이 단계는 정규식 허용)
- Prisma Schema Scanner 구현 (`@prisma/internals`의 파서 활용)
- `OBJECT_CREATE` change_request 타입 추가
- `db_table` Object가 처음으로 자동 생성되기 시작

### Phase 3: API Scanner + ORM Relation Scanner 도입

- Spring Controller Scanner 구현 (tree-sitter-java 또는 정규식 기반 시작)
- FastAPI/Express Scanner 구현
- ORM Read/Write Scanner (Phase 2에서 발견된 db_table URN 참조)
- `expose`, `read`, `write` 관계가 api_endpoint/db_table과 연결되기 시작

### Phase 4: 실제 AST 파서 도입

- TypeScript: `@babel/parser` 또는 `ts-morph` 도입
- Java/Kotlin: `tree-sitter`의 Java/Kotlin 바인딩 또는 GitHub 언어 서버 API 활용
- 정규식 대비 정확도 측정 후 단계적 대체

### Phase 5: 도메인 추론 활성화

- Domain Classifier 구현
- `primary_domain`, `secondary_domains` OBJECT_PATCH 생성
- AI Chat의 도메인 질의 경로 활성화

---

## 9. 파서 라이브러리 선택

| 대상 | 라이브러리 | 비고 |
|------|-----------|------|
| SQL DDL | `node-sql-parser` (npm) | 가볍고 CREATE TABLE 파싱 지원 |
| TypeScript/JS | `@babel/parser` (npm) | 광범위한 문법 지원, 빠름 |
| TypeScript (타입 정보) | `ts-morph` (npm) | TypeScript Compiler API 래핑 |
| Prisma Schema | `@prisma/internals` | Prisma 공식 파서 |
| Java/Kotlin | `tree-sitter` + `tree-sitter-java` | WASM 바인딩 가능 |
| Python | `tree-sitter` + `tree-sitter-python` | WASM 바인딩 가능 |

Phase 1~3는 추가 라이브러리 없이 정규식과 기존 npm 패키지로 구현 가능하다. Phase 4부터 tree-sitter 또는 babel parser 도입.

---

## 10. 기대 효과

### 10.1 PRD In Scope 달성

| 항목 | Phase 1 | Phase 2 | Phase 3 | Phase 5 |
|------|---------|---------|---------|---------|
| 서비스 의존 관계 추적 | ✅ 유지 | ✅ | ✅ | ✅ |
| DB 스키마 추론 + ERD | - | ✅ 시작 | ✅ | ✅ |
| api_endpoint 자동 생성 | - | - | ✅ | ✅ |
| call 정규 저장 (→ api_endpoint) | - | - | ✅ | ✅ |
| topic/queue 자동 생성 | - | - | ✅ | ✅ |
| 도메인 추론 | - | - | - | ✅ |

### 10.2 PRD 핵심 시나리오 달성

| 시나리오 | 달성 Phase |
|----------|-----------|
| 특정 db_table 사용 주체 추적 | Phase 2~3 |
| 특정 topic 사용 주체 추적 | Phase 3 |
| 특정 api_endpoint 호출자 추적 | Phase 3 |
| 서비스 도메인 요약 AI Chat | Phase 5 |
| ERD 기반 관계 탐색 | Phase 2 |

---

## 11. 현재 코드 재사용 범위

| 현재 코드 | 재사용 여부 | 처리 |
|----------|------------|------|
| `env-auto-mapping.ts`의 환경변수 추출 로직 | ✅ 재사용 | Config Scanner로 이동 |
| 4단계 파이프라인 인터페이스 (`AstPlugin`) | ⚠ 부분 재사용 | Scanner 인터페이스로 대체 |
| `EvidenceRecord`, confidence 계산 | ✅ 재사용 | 그대로 유지 |
| `combineConfidence`, `deriveReviewLane` | ✅ 재사용 | 그대로 유지 |
| 정규식 신호 추출 로직 | ⚠ 부분 유지 | Client Scanner로 이동 (Phase 4에서 대체) |
| `inferTargetProjectId` (토큰 매칭) | ❌ 폐기 | Client Scanner에서 URL 기반 매칭으로 대체 |
| `change_requests` 적재 로직 | ✅ 재사용 | OBJECT_CREATE 타입 추가 후 확장 |
