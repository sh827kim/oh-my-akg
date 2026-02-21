# 추론 엔진 현황 비판적 분석

작성일: 2026-02-21
기준 문서: PRD.md, object-model-definition.md, 2026-02-20_feasibility-and-decision-questions.md
분석 대상: `packages/inference/`, `packages/cli/src/commands/sync.ts`, `scripts/schema.sql`

---

## 1. 진단 요약

| 영역 | 상태 | 심각도 |
|------|------|--------|
| 데이터 모델 전환 (Task 1) | 완료 | — |
| 승인 워크플로우 (Task 2-1~2-4) | 완료 | — |
| 서비스 간 의존관계 추론 구조 | 부분 구현 / 스펙 위반 | 높음 |
| 도메인 추론 (PRD 5.1 #2) | 미구현 | 결정적 |
| DB 스키마 추론 (PRD 5.1 #3) | 미구현 | 결정적 |
| call 관계 정규 저장 원칙 준수 | 위반 | 높음 |
| read/write → db_table 연결 | 미작동 | 높음 |
| 변경 이력 (PRD 7.7) | 미구현 | 중간 |
| AST 파이프라인 실체 | 정규식 | 높음 |

---

## 2. PRD In Scope 달성도

### 2.1 달성된 항목

- ✅ 서비스 의존 관계 추적/시각화 (인프라 레벨)
- ✅ Object Mapping View 단일 화면 구조 (UI 레벨)
- ✅ Architecture View(roll-up preset) 유지
- ✅ Service List + CSV Export
- ✅ Tag + Visibility
- ✅ 멀티 워크스페이스 확장 가능한 데이터 모델

### 2.2 결정적으로 미구현된 항목

#### PRD 5.1 #2: 서비스 도메인 추론/시각화

PRD 7.4 및 의사결정 문서 1.2절에서 합의된 내용:
- `primary_domain` + `secondary_domains` 구조
- AST는 선택 플러그인 신호, 도메인 후보 + evidence + confidence 저장
- 사용자 수동 확정/오버라이드 UI

현재 상태:
- `objects` 테이블에 `primary_domain`, `secondary_domains` 컬럼 없음
- `metadata JSONB`에 비구조적으로 넣는 것조차 없음
- 추론 엔진에 도메인 추론 로직 없음
- 도메인 추론 결과를 위한 change_request 타입 없음 (`OBJECT_PATCH`로 처리 가능하나 플로우 없음)

영향: Object Mapping View에서 도메인별 필터/그룹핑 불가. PRD가 약속한 "서비스별 도메인 요약" AI Chat 질의 불가.

---

#### PRD 5.1 #3: DB 스키마 기반 엔티티/도메인 추론 및 관계 시각화

PRD 7.5 및 의사결정 문서 1.3절에서 합의된 내용:
- FK + 컬럼명 유사도 + 접미사 패턴(`*_id`, `*_no`, `*_uid`, `*_key`, `*_code`) + 조인 패턴으로 관계 추론
- 접미사 기본 제외: `created_by`, `updated_by`, `deleted_by`, `created_at`, `updated_at`
- ERD는 선택 Object 기반 roll-down 표시

현재 상태:
- `object_type IN ('db_table', 'db_view')` 타입이 스키마에 정의되어 있으나 실제로 생성되지 않음
- 추론 엔진이 `.sql`, JPA 엔티티, Prisma 스키마, SQLAlchemy 모델을 처리하지 않음
- `SOURCE_FILE_REGEX`가 `.sql` 파일을 제외함 (`/\.(?:java|kt|kts|ts|tsx|js|jsx|py)$/i`)
- ERD 시각화 없음

영향: `db_table` Object가 DB에 존재하지 않으므로 Object Mapping View의 drill-down이 "서비스 목록 재표현"에 불과함. PRD 핵심 시나리오인 "특정 db_table의 사용 주체 추적"이 불가능.

---

#### PRD 7.7: 변경 이력

합의된 내용: 객체/관계 단위 append-only 로그, 수동 오버라이드 우선순위, 되돌리기

현재 상태:
- `change_requests` 테이블은 승인 큐(pre-materialization)이지 이력(post-materialization)이 아님
- 승인 완료 후 어떤 변경이 있었는지 추적 불가
- `reviewed_at`, `reviewed_by` 필드가 있으나 이후 수정 이력 없음

---

## 3. 추론 엔진 구조적 문제

### 3.1 "AST"라는 이름이지만 실제로는 정규식이다

`packages/inference/src/plugins/java-kotlin.ts`, `typescript.ts`, `python.ts`의 `parse` 단계:

```typescript
parse: ({ path, content }): AstParseResult => ({
    ast: undefined,  // 실제 파싱 결과 없음
    diagnostics: [],
    metadata: { parser: 'java-kotlin-regex-v1', ... },
}),
```

`extract` 단계는 `parsed` 파라미터를 완전히 무시하고 `content`에 직접 정규식을 실행한다:

```typescript
extract: ({ path, content }): AstExtractedSignal[] => {
    // parsed 파라미터 사용 안 함
    for (const match of content.matchAll(IMPORT_REGEX)) { ... }
```

결과: `parse → extract → normalize → emit` 4단계 파이프라인은 구조상 존재하지만 실체는 1단계 정규식 파이프라인이다. `@babel/parser`, `tree-sitter`, Java Parser, Python `ast` 모듈 등 실제 파서를 하나도 사용하지 않는다.

정규식 방식의 한계:
- 주석, 문자열 리터럴, 비활성 코드에서 오탐 발생
- `save()`라는 변수명이나 `findAll()`이라는 주석이 ORM 신호로 잘못 감지됨
- 멀티라인 표현식, 메서드 체인, 빌더 패턴 감지 불가
- 언어 문법 구조(scope, 타입, 어노테이션 컨텍스트)를 인식하지 못함

---

### 3.2 `call` 관계가 Object Model Spec을 위반한다

Object Model Spec 3.2절 (합의 확정):

> `call`의 정규 저장 대상은 `service → api_endpoint`로 고정한다.
> `service → service`는 직접 저장하지 않고 `call` 관계를 기반으로 롤업 파생한다.

현재 추론 엔진이 생성하는 candidate:

```typescript
// env-auto-mapping.ts → upsertCandidate()
fromId: 'myorg/payment-service',   // repo URN (service)
toId:   'myorg/order-service',     // repo URN (service)
type:   'call'
```

`api_endpoint` Object가 생성되지 않는다. 추론이 `service → service` 형태의 `call`을 저장하는데, 이는 스펙상 파생(derived) 관계여야 하며 직접 저장이 금지된 형태다. 추론 엔진이 생성하는 모든 `call` 관계가 스펙 위반이다.

올바른 저장 경로:
1. 소스에서 HTTP 클라이언트 호출 + URL 감지 → `POST /api/v1/orders`
2. `order-service`의 `api_endpoint` Object(`POST /api/v1/orders`) 생성 또는 매칭
3. `payment-service → api_endpoint:POST /api/v1/orders (call)` 저장
4. roll-up 계산 시 `payment-service → order-service` 파생

---

### 3.3 `read`/`write`가 db_table과 연결되지 않는다

현재 구현에서 ORM read/write 감지:

```typescript
// java-kotlin.ts
const QUERY_READ_REGEX = /\b(findAll|findBy[A-Za-z0-9_]*|...)\b/gi;
// → 'read' 신호 + hint = 해당 라인 전체 텍스트 토큰
// → 그 토큰을 다른 서비스 이름과 매칭
```

`UserRepository.findAll()` 감지 → hint 토큰 = `['userrepository', 'findall']` → 이것을 서비스 이름 토큰과 매칭 시도

문제:
- `userrepository`라는 이름의 서비스가 없으므로 매칭 실패 → 신호 버려짐
- 설령 매칭되더라도 `service → service (read)` 저장 (스펙 위반)
- 실제로 어떤 `db_table`을 read하는지 추론하지 않음

올바른 경로: ORM 엔티티 클래스(`UserEntity`) → 테이블명 규칙으로 `users` 추론 → `db_table:users` Object 생성/매칭 → `service → db_table:users (read)` 저장

---

### 3.4 hint → service 토큰 매칭의 불안정성

```typescript
function inferTargetProjectId(hint, repoTokens, currentRepoId) {
    const tokens = normalizeHint(hint);
    for (const candidate of repoTokens) {
        for (const token of tokens) {
            if (candidate.tokens.has(token)) score += 1;
        }
    }
    // score 최고점 1개 선택, 동점 시 배열 순서로 결정
}
```

문제:
- `order-service`, `order-processor`, `order-event-service`가 공존하면 `order` 토큰이 셋 다 score 1로 동점 → 첫 번째 서비스로 결정론적 오탐
- URL이 환경변수(`${ORDER_SERVICE_URL}`)로 추상화되면 URL host 추출 불가 → 추론 불가
- 서비스 이름과 무관한 범용 환경변수명(`DATABASE_URL`, `REDIS_HOST`)은 GENERIC_TOKENS로 필터되지만 부분적으로만 걸러짐

---

### 3.5 파일 샘플링 한계

```typescript
const MAX_SOURCE_FILES = 30;
const MAX_CONFIG_FILES = 20;
```

Git 트리 순서(알파벳 근사)로 파일을 가져오므로, `src/infrastructure/kafka/KafkaProducer.java` 같은 중요한 파일이 30개 한도 밖에 위치할 수 있다. 대형 서비스(1,000+ 파일)에서 실질적 커버리지가 3% 미만이 될 수 있다.

---

### 3.6 fromId/toId가 UUID가 아닌 repo URN이다

`MappingCandidate`의 `fromId`/`toId`는 `org/repo-name` 형태의 repo URN이다. `sync.ts`에서 이를 `change_requests.payload`에 그대로 저장한다. 승인 시 `fromId`/`toId` URN을 `objects` 테이블의 UUID로 해결하는 과정이 `approvals` 커맨드 또는 bulk API에 위임되어 있다.

이 URN → UUID 해결 로직이 승인 처리 시점에 집중되어 있어, Object가 아직 생성되지 않은 타겟(예: `api_endpoint`, `db_table`)을 참조하는 change_request의 처리 경로가 정의되지 않았다.

---

## 4. 종합 판단

### 4.1 현재 추론 엔진이 실제로 하는 일

현재 추론 엔진을 정확하게 묘사하면:

> **"서비스 레포 이름 토큰 간 텍스트 유사도 기반 서비스-서비스 depend_on 추론기"**

- 모든 관계 타입(call/read/write/produce/consume)이 결국 `service → service` 형태로 저장된다.
- `api_endpoint`, `db_table`, `topic`, `queue` Object는 한 건도 자동 생성되지 않는다.
- `service → api_endpoint`, `service → db_table` 같은 정규 관계는 수동 입력 외에는 만들어지지 않는다.

### 4.2 Object Mapping View의 현재 가치

PRD의 Object Mapping View는 `db_table`, `api_endpoint`, `topic` 수준의 원자 Object들을 drill-down하는 것이 핵심이다. 그러나 현재는 이 Object들이 존재하지 않으므로, Object Mapping View는 사실상 **서비스 목록 그래프를 다른 레이아웃으로 표현하는 뷰**에 불과하다.

### 4.3 PRD 핵심 시나리오 달성 가능성

| 시나리오 | 현재 가능 여부 |
|----------|--------------|
| 특정 서비스 변경 시 영향 범위 확인 | 부분 가능 (service-service 수준) |
| 특정 topic의 사용 주체 추적 | 불가 (topic Object 없음) |
| 특정 db_table의 사용 주체 추적 | 불가 (db_table Object 없음) |
| 특정 api_endpoint의 호출자 추적 | 불가 (api_endpoint Object 없음) |
| 서비스 도메인 요약 AI Chat | 불가 (도메인 추론 없음) |
| ERD 기반 관계 탐색 | 불가 (DB 스키마 추론 없음) |

---

## 5. 문제 발생 경위

이 문제는 Task 2 구현 시 "추론 파이프라인 고도화"를 아래 방향으로 해석한 데서 비롯된다:

- **실제 구현**: 기존 정규식 기반 신호 추출 구조를 4단계 파이프라인 형식으로 래핑 + confidence/evidence 스키마 강화
- **PRD 의도**: 소스 파일에서 `api_endpoint`, `db_table`, `topic` 같은 원자 Object를 발견하고, 그것들 간의 정규 관계를 추론하는 엔진

두 가지 다른 방향의 구현이 "AST 파이프라인 고도화"라는 동일한 이름으로 진행되었다.

---

## 6. 연계 문서

- 재설계 제안: `docs/design/2026-02-21_inference-engine-redesign.md`
- PRD: `docs/prd/PRD.md`
- Object Model Spec: `docs/spec/object-model-definition.md`
- 의사결정 문서: `docs/spec/2026-02-20_feasibility-and-decision-questions.md`
