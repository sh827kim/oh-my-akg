# Archi.Navi — 추론 엔진

작성일: 2026-02-22
문서 버전: v2.0

---

## 1. 설계 목적

추론 엔진은 소스코드, DB 스키마, 메시지 설정 등에서 **구조 신호(Signal)**를 추출하고,
이를 기반으로 **Relation 후보**와 **Domain 소속**을 자동으로 생성한다.

모든 추론 결과는 **승인 전 반영 금지** 원칙을 따른다.

---

## 2. Relation 추론

### 2.1 추론 파이프라인

```
소스코드/설정 스캔
      ↓
신호(Signal) 추출
      ↓
Relation 후보 생성
      ↓
relation_candidates (PENDING)
      ↓
사용자 승인/반려
      ↓
object_relations (확정) + evidence 연결
```

### 2.2 신호 소스별 추론 규칙

#### Code 기반 추론

| 신호 | 추론 결과 | 예시 |
|------|----------|------|
| HTTP Client 호출 | `call` relation | `RestTemplate.getForObject("/api/orders")` |
| API Controller 선언 | `expose` relation | `@GetMapping("/api/orders")` |
| Message Producer | `produce` relation | `kafkaTemplate.send("order.created")` |
| Message Consumer | `consume` relation | `@KafkaListener(topics="order.created")` |

#### DB 기반 추론

| 신호 | 추론 결과 | 예시 |
|------|----------|------|
| SELECT 쿼리 | `read` relation | MyBatis XML, JPA Repository |
| INSERT/UPDATE/DELETE | `write` relation | MyBatis XML, JPA Repository |
| FK 제약조건 | 테이블 간 참조 관계 | `orders.customer_id → customers.id` |

#### 설정 기반 추론

| 신호 | 추론 결과 | 예시 |
|------|----------|------|
| application.yml DB 설정 | Object 생성 (database) | `spring.datasource.url` |
| Kafka 설정 | Object 생성 (broker/topic) | `spring.kafka.bootstrap-servers` |
| API Gateway 라우팅 | `call` 관계 | 라우팅 설정에서 서비스 매핑 |

### 2.3 Confidence 산정 기준

| 수준 | confidence | 조건 |
|------|-----------|------|
| 높음 | 0.9~1.0 | AST 기반 정확한 추출 + Evidence 명확 |
| 중간 | 0.6~0.8 | 패턴 매칭 기반 (정규식, 파일명) |
| 낮음 | 0.3~0.5 | 휴리스틱 기반 (이름 유사도, 디렉토리 구조) |

---

## 3. Domain 추론 — Track A: Seed 기반 Named Domain

### 3.1 핵심 개념: Affinity 분포

서비스는 하나의 도메인에 깔끔히 속하지 않을 수 있다.
따라서 도메인 소속은 **단일 라벨**이 아닌 **분포(Distribution)**로 표현한다.

```
affinity = { domainId → score }  // 합이 1.0이 되도록 정규화

primary   = argmax(affinity)     // 가장 높은 소속
secondary = affinity[d] >= 0.25  // threshold 이상 (primary 제외)
purity    = max(affinity)        // 단일 도메인 순수도
```

**Purity 해석:**
- 0.90+: 거의 단일 도메인
- 0.60: 어느 정도 혼재
- 0.40-: 강한 혼재 (통합/게이트웨이/레거시 성격)

### 3.2 입력

- **Seed Domain 목록**: 사용자가 정의 (예: order, payment, user, inventory)
- **Seed 추천**: 서비스 이름/디렉토리/테이블 prefix 빈도 기반 자동 추천 가능

### 3.3 신호(Signal) 설계

#### Code Signals

**(A) Heuristic 기반 (약한 신호)**
- 파일 경로, 패키지명, 클래스/함수명에서 도메인 키워드 매칭
- 점수 상한: domain당 최대 0.30 (오탐 방지)

**(B) AST 기반 (강한 신호)**
- Import graph: 어떤 도메인 모듈을 참조하는지
- Symbol ownership: 심볼이 어느 도메인에 정의되었는지
- Call edges (선택): 실제 호출 관계

**1차 AST 플러그인 지원 언어**: Java/Kotlin, TypeScript/JavaScript, Python

#### DB Signals (강한 신호)

- 테이블 prefix 매칭 (예: `order_*` → order 도메인)
- FK 네이밍 패턴 (FK가 같은 도메인 테이블을 참조하는지)
- FK 커뮤니티 (FK로 연결된 테이블 응집도)

#### Message Signals (중간 신호)

- Topic 네이밍 패턴 (예: `order.created` → order 도메인)
- Producer/Consumer 응집도 (같은 도메인 서비스끼리 연결되는지)

### 3.4 점수 합성 (결정론)

```
v = Wcode × v_code + Wdb × v_db + Wmsg × v_msg (+ Wmanual)
affinity = normalize(v)   // 합이 1.0이 되도록
```

**권장 가중치:**

| 파라미터 | 기본값 | 설명 |
|---------|--------|------|
| `w_code` | 0.5 | 코드 신호 가중치 |
| `w_db` | 0.3 | DB 신호 가중치 |
| `w_msg` | 0.2 | 메시지 신호 가중치 |
| `heuristic_domain_cap` | 0.3 | 휴리스틱 점수 상한 |
| `secondary_threshold` | 0.25 | Secondary 도메인 포함 기준 |

가중치는 `domain_inference_profiles` 테이블에 저장하여 워크스페이스별 튜닝 가능.

### 3.5 승인 워크플로우

```
신호 추출 + 점수 합성
      ↓
domain_candidates (PENDING)
  - affinity_map: {"orderDomain": 0.62, "paymentDomain": 0.38}
  - purity: 0.62
  - signals: {code: [...], db: [...], msg: [...]}
      ↓
사용자 검토 (분포 전체를 승인)
      ↓
object_domain_affinities (확정)
  + objects.metadata.domain 캐시 갱신
```

**분포를 승인하는 이유:**
단일 primary만 승인하면 현실의 혼재를 지워버려, "실제 구조 보기" 목적에 반한다.

---

## 4. Domain 추론 — Track B: Seed-less Discovery

### 4.1 목적

레거시 환경에서는 도메인 seed 자체가 없다.
구조 그래프에서 **커뮤니티(군집)를 자동 탐지**해 "도메인 후보"를 생성한다.

핵심: "도메인은 이름이 아니라 **강하게 연결된 묶음**"

### 4.2 멀티 레이어 가중 그래프 구성

#### 노드

- `service` (필수)
- `db_table` (가능하면)
- `topic` (가능하면)
- `api_endpoint`, `function` (선택)

#### 엣지 가중치

| 타입 | 기본 가중치 | 설명 |
|------|------------|------|
| service→service call (rollup) | 1.0 | 가장 강한 구조 결합 |
| service→table read/write | 0.8 | DB 접근 |
| service→topic produce/consume | 0.6 | 메시지 기반 결합 |
| table↔table FK | 0.4 | 스키마 레벨 참조 |
| code import/call | 0.7 | 코드 레벨 참조 |

가중치는 `domain_inference_profiles`에서 워크스페이스별 조정 가능.

### 4.3 커뮤니티 탐지 알고리즘

- **권장**: Louvain 또는 Leiden (응집도 기반 군집 탐지)
- **라이브러리**: graphology + graphology-communities-louvain
- **파라미터**: resolution (세밀도 조절), min_cluster_size (최소 클러스터 크기)

```typescript
import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';

// 가중 그래프 구성 후 커뮤니티 탐지
const communities = louvain(graph, {
  resolution: profile.resolution ?? 1.0,
});
```

### 4.4 Discovery Domain 생성

탐지된 커뮤니티마다 `objects`에 Domain Object를 생성한다.

```json
{
  "object_type": "domain",
  "name": "discovered:cluster-7",
  "display_name": "Cluster 7",
  "metadata": {
    "kind": "DISCOVERED",
    "cluster_id": "c-007",
    "algo": "louvain",
    "algo_version": "1.0",
    "input_layers": ["call", "db", "msg"],
    "parameters": { "min_cluster_size": 3 },
    "label_candidates": [
      { "text": "billing", "score": 0.82 },
      { "text": "invoice", "score": 0.61 }
    ]
  }
}
```

### 4.5 Label Suggestion (자동 라벨 후보)

클러스터 내부에서 자주 등장하는 키워드로 라벨 후보를 생성한다.

- 서비스 이름 토큰 빈도
- 테이블 prefix 빈도
- Topic prefix 빈도
- 패키지 top-level 토큰

### 4.6 Discovery Affinity

클러스터 멤버십을 `object_domain_affinities`에 반영한다.

- **단순**: 멤버 = affinity 1.0
- **고급**: 경계가 흐린 서비스는 분포로 반영 (예: 0.6/0.4)

### 4.7 실행 스냅샷 관리

```
Discovery 실행
      ↓
domain_discovery_runs (실행 메타 기록)
      ↓
domain_discovery_memberships (클러스터별 멤버십 저장)
      ↓
사용자 검토
      ↓
"적용" → object_domain_affinities (source=DISCOVERY)
또는
"이름 변경/병합" → Named Domain으로 승격
```

**왜 run별 스냅샷이 필요한가?**
- 레거시 분석은 결과 재현이 핵심
- 파라미터 튜닝/비교를 위해 히스토리 보존 필요

---

## 5. DB 추론 강화

### 5.1 기본 추론 소스

| 소스 | 추론 방식 |
|------|----------|
| **FK 제약조건** | 테이블 간 참조 관계 직접 추출 |
| **컬럼명 유사도** | `*_id`, `*_no` 등 접미사 패턴 매칭 |
| **식별자 접미사** | `*_id`, `*_no`, `*_uid`, `*_key`, `*_code`, `*id`, `*no`, `*uid` |
| **제외 패턴** | `created_by`, `updated_by`, `deleted_by`, `created_at`, `updated_at` |

### 5.2 확장 추론 소스 (v1+)

| 소스 | 추론 방식 |
|------|----------|
| **인덱스 패턴** | 복합 인덱스에 포함된 컬럼 → 조인 관계 힌트 |
| **Unique 제약조건** | 유니크 키 패턴 → 엔티티 식별 관계 |
| **MyBatis XML** | SQL 매퍼에서 테이블 접근 직접 추출 |
| **JPA Mapping** | `@Entity`, `@ManyToOne` 등에서 관계 추출 |

---

## 6. AST 플러그인 설계

### 6.1 아키텍처

```
소스코드 파일
      ↓
Tree-sitter 파서 (언어별 문법)
      ↓
AST → 구조적 추출
      ↓
code_artifacts + code_import_edges + code_call_edges
```

### 6.2 추출 산출물

| 산출물 | 테이블 | 설명 |
|--------|--------|------|
| 파일/모듈 메타 | `code_artifacts` | 언어, 경로, 패키지, 소유 Object |
| Import 관계 | `code_import_edges` | 어떤 모듈/패키지를 참조하는지 |
| Call 관계 | `code_call_edges` | 어떤 심볼을 호출하는지 |

### 6.3 지원 언어 (v1)

| 언어 | Tree-sitter 문법 | 주요 추출 대상 |
|------|-----------------|---------------|
| **Java/Kotlin** | tree-sitter-java, tree-sitter-kotlin | import, annotation, method call |
| **TypeScript/JS** | tree-sitter-typescript | import/require, decorator, function call |
| **Python** | tree-sitter-python | import, decorator, function call |

### 6.4 설계 원칙

- AST는 "규범 검증"이 아니라 **정확한 관측치 추출 도구**
- 언어별 플러그인은 선택적 (AST 없어도 휴리스틱으로 동작)
- 파일 해시(`sha256`)로 변경 감지 → 변경된 파일만 재분석

---

## 7. 승인 워크플로우 통합

### 7.1 Relation 승인

```
relation_candidates (PENDING)
      ↓
승인 UI:
  - 전체 선택
  - 부분 선택 해제
  - Evidence 링크 확인
  - 일괄 승인/반려
      ↓
승인 → object_relations (확정) + rollup rebuild 트리거
반려 → status='REJECTED'
```

### 7.2 Domain 승인

```
domain_candidates (PENDING)
      ↓
승인 UI:
  - affinity 분포 확인 (primary/secondary/purity)
  - 신호 근거 확인
  - 일괄 승인/반려
      ↓
승인 → object_domain_affinities (확정) + DOMAIN_TO_DOMAIN rollup 트리거
반려 → status='REJECTED'
```

### 7.3 편집 우선순위

**수동 오버라이드 > 자동 추론**

- 수동으로 설정한 관계/도메인은 자동 추론으로 덮어쓰지 않음
- source 필드로 구분: `MANUAL` > `APPROVED_INFERENCE` > `DISCOVERY`

---

## 관련 문서

| 문서 | 설명 |
|------|------|
| [02-data-model.md](./02-data-model.md) | 추론 관련 테이블 스키마 |
| [05-rollup-and-graph.md](./05-rollup-and-graph.md) | 승인 후 Roll-up 재빌드 |
| [04-query-engine.md](./04-query-engine.md) | 추론 결과 활용 (Query Engine) |
