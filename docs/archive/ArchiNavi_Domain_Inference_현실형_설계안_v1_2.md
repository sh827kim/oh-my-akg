# Archi.Navi Domain Inference 고도화 설계안 (현실형: Affinity/Purity + Seed-less Discovery) v1

작성일: 2026-02-21  
문서 버전: v1.2 (Seed 기반 + Seed-less 자동 발견 통합)

---

## 0. 배경과 목표

이 설계의 목적은 “이상적인 DDD 경계”를 강제하는 게 아니라, **실제 서비스 구조(혼재/역사/기술부채 포함)를 관측 가능한 형태로 보여주는 것**이야.

또한 레거시 시스템처럼 **도메인 지식(Seed)이 사라진 환경**에서도, 서비스들이 어떤 “업무 묶음(도메인 유사 군집)”을 이루는지 **자동 분석으로 부트스트랩**할 수 있어야 해.

현실에서 흔한 상황:

- 하나의 도메인에 여러 서비스가 속함 (정상)
- 하나의 서비스가 여러 도메인에 걸쳐 있음 (정상)
- 코드/DB/메시지 경계가 완전히 분리되지 않음 (정상)
- 레거시: 도메인 이름을 아는 사람이 없음 → seed가 없어도 출발해야 함 (필수)

따라서 v1 도메인 기능은 **두 트랙**을 같은 모델 위에서 제공한다.

- **Track A: Named Domain (Seed 기반)**  
  사용자가 도메인 후보를 정의(혹은 추천)하고 affinity를 계산/승인한다.
- **Track B: Discovered Domain (Seed-less 자동 발견)**  
  그래프 커뮤니티 탐지로 도메인 군집을 자동 생성하고, 사람이 나중에 이름을 붙일 수 있게 한다.

둘은 충돌하지 않고 연결 가능하다(Discovered → Named으로 매핑/병합 가능).

---

## 1. 용어 정의

### 1.1 AST (Abstract Syntax Tree)
소스코드를 파싱해 만든 **문법 트리**.  
Archi.Navi에서는 AST를 “규범 검증”이 아니라 **정확한 관측치(Import/Call/Ownership)를 추출하는 도구**로 쓴다.

- 예: Java에서 `import com.foo.order.*` / `OrderService.createOrder()` 호출 등을 구조적으로 추출
- 장점: 정규식보다 정확, 언어 구조를 이해함
- 단점: 언어별 플러그인 필요(예: Tree-sitter)

### 1.2 Heuristic (휴리스틱)
명확히 증명되진 않지만 경험적으로 잘 맞는 **약한 규칙 기반 신호**.

- 예: 파일 경로에 `/order/` 포함, 클래스명이 `Order*`로 시작
- 장점: 빠르게 구현 가능, 언어 독립적으로도 동작
- 단점: 오탐 가능 → v1에서는 **점수 상한을 낮게** 두고 보조로만 사용

### 1.3 Signal
도메인 점수 계산에 사용되는 “증거 조각”.  
Signal은 **결론이 아니라 근거**이며, 승인/설명/디버깅을 위해 저장한다.

### 1.4 Domain Seed / Domain Discovery
- Seed: 사람이 아는 도메인 후보군(예: order/payment/user)
- Discovery: seed 없이 그래프 커뮤니티 탐지로 발견한 도메인 군집(예: cluster-7)

---

## 2. 핵심 모델: Affinity / Purity

### 2.1 Domain Affinity(친화도)
대상 객체 O(보통 service)에 대해 도메인 D별 점수 벡터를 만든다.

```
v = Wcode * v_code + Wdb * v_db + Wmsg * v_msg (+ Wmanual)
affinity = normalize(v)  // 합이 1이 되도록 정규화
```

- affinity[domain]는 “해당 도메인과 얼마나 연관 있는지”를 나타내는 분포 값 (0~1)
- Primary/Secondary는 affinity에서 파생된다 (저장 본질은 affinity)

### 2.2 Purity(혼합도 지표)
서비스가 단일 도메인에 얼마나 “깨끗하게” 속하는지 나타내는 지표.

- purity = max(affinity)
  - 0.90 이상: 거의 단일 도메인
  - 0.60: 어느 정도 혼재
  - 0.40 이하: 강한 혼재(통합/게이트웨이/레거시 성격 가능)

> 왜 Purity를 두나?  
> 현실 구조를 볼 때 가장 중요한 질문이 “이 서비스는 어느 도메인이야?”가 아니라  
> “이 서비스는 도메인이 섞여 있나?”인 경우가 많기 때문이야.

---

## 3. Track A: Seed 기반 Named Domain 추론

### 3.1 Domain 후보군(Seed) 운영
v1에서는 domain name을 완전 자동 생성하지 않는다(오탐/무의미 위험). 대신:

- Seed 기반: 사용자가 도메인 후보군을 입력/관리
  - 예: order, payment, user, inventory
- seed 추천: 서비스 이름/상위 디렉토리/테이블 prefix 빈도 기반 추천 가능

### 3.2 신호(Signal) 설계: 무엇을 뽑고 어떻게 점수화하나

#### 3.2.1 Code Signals
(A) Heuristic 기반 (약한 신호)
- 파일 경로, 패키지명, 클래스/함수명

정책:
- heuristic는 오탐이 많으니 점수 상한을 둔다(예: domain당 최대 0.30)

(B) AST 기반 (강한 신호)
- import graph
- symbol ownership
- call edges(옵션)

왜 AST를 쓰나?
- 경계 준수 단정이 아니라, 실제 참조 구조(관측치)를 정확히 얻기 위해서다.

#### 3.2.2 DB Signals (강한 신호)
- 테이블 prefix, FK 네이밍, FK 커뮤니티(응집도)

#### 3.2.3 Message Signals (중간 신호)
- topic 네이밍, producer/consumer 응집도

### 3.3 점수 합성(결정론)과 파라미터
권장 가중치:
- Wcode = 0.5
- Wdb   = 0.3
- Wmsg  = 0.2
- Wmanual = override

Primary/Secondary 파생 규칙:
- primary = argmax(affinity)
- secondary = affinity[d] >= secondary_threshold (primary 제외)
- secondary_threshold = 0.25 (현실형)

### 3.4 승인(Approval): 분포를 승인
- 자동 추론 결과 → domain_candidates (PENDING)
- 승인 시 → object_domain_affinities에 반영 + objects.metadata 캐시(선택)

왜 분포를 승인하나?
- 단일 primary만 승인하면 현실의 혼재를 지워버려서, “실제 구조 보기” 목적에 반한다.

---

# 4. Track B: Seed-less Domain Discovery (레거시 부트스트랩)

## 4.1 목적
레거시 환경에서는 도메인 seed 자체가 없으므로, **구조 그래프에서 커뮤니티(군집)를 자동 탐지**해 “도메인 후보”를 생성한다.

핵심은 “도메인은 이름이 아니라 강하게 연결된 묶음”이라는 관점이다.

## 4.2 입력 그래프(멀티 레이어)
Discovery는 하나의 레이어에 의존하지 않는다. 가능한 입력을 모두 합쳐 **가중 그래프**를 만든다.

### 4.2.1 노드
- service (필수)
- db_table (가능하면)
- topic (가능하면)
- (옵션) api_endpoint, function

### 4.2.2 엣지 타입과 기본 가중치(초기값)
- service→service call(rollup): 1.0
- service→table read/write: 0.8
- service→topic produce/consume: 0.6
- table↔table FK: 0.4
- (옵션) code import/call: 0.5~0.9 (환경에 따라)

> 왜 가중치가 필요한가?  
> 레거시에서 “어떤 신호가 더 강한 구조 결합을 의미하는지”를 고정해야, 결과가 결정론적으로 재현되고 튜닝이 가능해진다.

## 4.3 커뮤니티 탐지 알고리즘
권장:
- Louvain 또는 Leiden 계열 (대규모 그래프에서 응집도 기반 군집 탐지에 강함)

대안(간단):
- Label Propagation (품질 변동이 큼)

v1 제안:
- JS 런타임에서 adjacency를 구성한 후 Louvain/Leiden 라이브러리로 실행
  - DB 확장 없이 로컬에서 구현 가능(pglite 친화)
  - 실행 결과는 DB에 스냅샷으로 저장

## 4.4 Discovery Domain 생성 규칙
탐지된 커뮤니티 C마다 `objects`에 domain object를 생성한다.

- object_type: domain
- name: discovered:cluster-{k}
- display_name: (초기) Cluster {k}
- metadata 예시:
```json
{
  "kind": "DISCOVERED",
  "cluster_id": "c-007",
  "algo": "louvain",
  "algo_version": "1.0",
  "input_layers": ["call","db","msg"],
  "parameters": {"min_cluster_size": 3},
  "label_candidates": [
    {"text":"billing", "score":0.82},
    {"text":"invoice", "score":0.61}
  ]
}
```

> 왜 domain도 objects로 만들나?  
> “모든 자산은 Object” 원칙을 유지하면서, 태깅/가시성/검색/링크/뷰 재사용을 위해서다.

## 4.5 Label Suggestion(자동 라벨 후보)
도메인 이름이 없으니, 클러스터 내부에서 자주 등장하는 키워드로 라벨 후보를 만든다.

- 서비스 이름 토큰 빈도
- 테이블 prefix 빈도
- topic prefix 빈도
- (가능하면) 패키지 top-level 토큰

결과는 domain object metadata.label_candidates에 저장한다.

## 4.6 Discovery Affinity(멤버십)
클러스터 멤버십을 `object_domain_affinities`에 반영한다.

- 단순: 멤버십이면 affinity=1.0
- 고급(옵션): 경계가 흐린 서비스는 affinity를 분산(예: 0.6/0.4)
  - 예: 서비스가 두 클러스터와 강하게 연결되면 분포로 반영

> 왜 affinity 테이블을 재사용하나?  
> Seed 기반/Discovery 기반 모두 “도메인 소속의 분포”라는 동일한 표현을 사용하므로, UI/질의/AI 레이어를 그대로 재사용할 수 있다.

## 4.7 Domain-to-Domain 의존(roll-up) 생성(옵션)
Discovery domain이 생기면, 서비스 관계를 domain 단위로 집계해 도메인 의존 그래프를 만들 수 있다.

- 서비스 A(domain X affinity ax)
- 서비스 B(domain Y affinity by)
- A→B call이 있으면
  - X→Y edge_weight += ax*by (가중 누적)

혼재 서비스는 purity가 낮으므로 자연스럽게 분산 반영된다.

---

# 5. 데이터베이스 스키마(통합) + Seed-less 확장분

아래는 기존 v1.1 스키마에 Seed-less Discovery를 추가해도 누락 없이 구현 가능한 형태로 통합 정리한 것이다.

## 5.1 domain은 Object로 저장(공통)
`objects.object_type='domain'`로 통합 관리한다.

- Named domain(seed): metadata.kind = "SEED"
- Discovered domain: metadata.kind = "DISCOVERED"

---

## 5.2 object_domain_affinities (공통 핵심, 확정 데이터)

```sql
create table object_domain_affinities (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,

  object_id uuid not null references objects(id) on delete cascade,
  domain_id uuid not null references objects(id) on delete cascade, -- object_type='domain'

  affinity real not null,               -- 0~1
  confidence real,                      -- optional (0~1)
  source text not null default 'APPROVED_INFERENCE', -- MANUAL/APPROVED_INFERENCE/DISCOVERY

  generation_version bigint,            -- rollup 세대와 맞추고 싶으면 사용(옵션)

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(workspace_id, object_id, domain_id)
);

create index ix_oda_ws_object on object_domain_affinities(workspace_id, object_id);
create index ix_oda_ws_domain on object_domain_affinities(workspace_id, domain_id);
```

변경분(Seed-less):
- source에 `DISCOVERY` 값을 추가(또는 metadata로 구분)  
  → Seed-less로 생성된 affinity인지, 승인된 seed 기반인지 구분하기 위해.

---

## 5.3 domain_candidates (Seed 기반 후보/승인 큐)

```sql
create table domain_candidates (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,

  run_id uuid, -- inference_runs 참조(선택)
  object_id uuid not null references objects(id) on delete cascade,

  affinity_map jsonb not null,          -- {"<domainId>":0.62, ...}
  purity real not null,
  primary_domain_id uuid references objects(id) on delete set null,
  secondary_domain_ids jsonb not null default '[]'::jsonb,

  signals jsonb not null default '{}'::jsonb,

  status text not null default 'PENDING', -- PENDING/APPROVED/REJECTED
  reviewed_at timestamptz,
  reviewed_by text,

  created_at timestamptz not null default now()
);

create index ix_domcand_ws_status on domain_candidates(workspace_id, status);
create index ix_domcand_ws_object on domain_candidates(workspace_id, object_id);
```

---

## 5.4 domain_candidate_evidences (Seed 기반 후보-근거)

```sql
create table domain_candidate_evidences (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  candidate_id uuid not null references domain_candidates(id) on delete cascade,
  evidence_id uuid not null references evidences(id) on delete cascade,
  primary key (workspace_id, candidate_id, evidence_id)
);
```

---

## 5.5 NEW: domain_discovery_runs (Seed-less 실행 스냅샷)  ✅ 추가

Discovery 결과를 재현/비교하려면 run 단위가 필요하다(특히 레거시 분석에서 중요).

```sql
create table domain_discovery_runs (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,

  algo text not null,                 -- louvain/leiden/...
  algo_version text,
  input_layers jsonb not null,        -- ["call","db","msg","code"]
  parameters jsonb not null default '{}'::jsonb,

  graph_stats jsonb not null default '{}'::jsonb, -- nodes/edges 등
  status text not null default 'DONE',            -- DONE/FAILED

  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index ix_ddr_ws_time on domain_discovery_runs(workspace_id, started_at desc);
```

왜 필요한가?
- 레거시 분석은 “다시 돌려서 동일 결과가 나오는지”가 핵심이며,
- 파라미터 튜닝/비교를 위해 run 스냅샷이 필요하다.

---

## 5.6 NEW: domain_discovery_memberships (멤버십 스냅샷) ✅ 추가

Discovery 결과를 run 단위로 보관하는 테이블.  
확정 affinity는 object_domain_affinities에 반영하되, run별 결과를 따로 남겨 재현성을 확보한다.

```sql
create table domain_discovery_memberships (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,

  run_id uuid not null references domain_discovery_runs(id) on delete cascade,

  object_id uuid not null references objects(id) on delete cascade, -- 보통 service
  domain_id uuid not null references objects(id) on delete cascade, -- discovered domain object

  affinity real not null,             -- 0~1 (1.0 또는 분산)
  purity real,                        -- optional (run 기준)

  created_at timestamptz not null default now(),

  unique(workspace_id, run_id, object_id, domain_id)
);

create index ix_ddm_ws_run on domain_discovery_memberships(workspace_id, run_id);
create index ix_ddm_ws_object on domain_discovery_memberships(workspace_id, object_id);
create index ix_ddm_ws_domain on domain_discovery_memberships(workspace_id, domain_id);
```

왜 run별 membership이 필요한가?
- object_domain_affinities는 “현재 확정(승인/운영) 상태”를 담는 게 좋고,
- discovery는 실험/비교/튜닝이 반복되므로 “스냅샷 히스토리”가 필요하다.

운영 반영 정책(v1 권장):
- 최신 discovery run을 “참고 결과”로 보되,
- 사용자가 “적용”을 누르면 object_domain_affinities(source=DISCOVERY)로 반영하거나,
- discovered domain을 named domain으로 rename/merge 후 seed 트랙으로 흡수.

---

## 5.7 objects.metadata 캐시(공통 권장)
primary/secondary/purity는 파생이지만 UI 응답성 때문에 캐시 권장.

```json
{
  "domain": {
    "primary": "<domainId>",
    "secondary": ["<domainId2>", "<domainId3>"],
    "purity": 0.62,
    "kind": "SEED|DISCOVERED",
    "lastApprovedAt": "ISO-8601",
    "lastDiscoveryRunId": "<uuid>"
  }
}
```

---

# 6. AST 플러그인 산출 스키마(관측치) v1 (변경 없음, Discovery에서도 재사용)

Seed-less Discovery에서도 code layer를 입력으로 넣으려면 동일 관측치가 필요하다.

## 6.1 code_artifacts: 파일/모듈 단위 메타 + 소속(Ownership)

```sql
create table code_artifacts (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,

  language text not null,           -- java/kotlin/ts/js/python
  repo_root text,                   -- local path or workspace-relative
  file_path text not null,          -- relative path
  package_name text,                -- java/kotlin
  module_name text,                 -- monorepo package name 등(선택)

  owner_object_id uuid references objects(id) on delete set null, -- 보통 service 또는 function
  sha256 text,                     -- 파일 해시(재현/변경감지)

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(workspace_id, file_path)
);

create index ix_code_artifacts_ws_owner on code_artifacts(workspace_id, owner_object_id);
create index ix_code_artifacts_ws_lang on code_artifacts(workspace_id, language);
```

## 6.2 code_import_edges: import graph

```sql
create table code_import_edges (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,

  from_artifact_id uuid not null references code_artifacts(id) on delete cascade,

  to_module text,
  to_artifact_id uuid references code_artifacts(id) on delete set null,

  weight int not null default 1,
  evidence_id uuid references evidences(id) on delete set null,

  created_at timestamptz not null default now()
);

create index ix_import_edges_ws_from on code_import_edges(workspace_id, from_artifact_id);
create index ix_import_edges_ws_to_art on code_import_edges(workspace_id, to_artifact_id);
```

## 6.3 (선택) code_call_edges: call graph

```sql
create table code_call_edges (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,

  caller_artifact_id uuid not null references code_artifacts(id) on delete cascade,
  callee_symbol text not null,
  callee_owner_object_id uuid references objects(id) on delete set null,

  weight int not null default 1,
  evidence_id uuid references evidences(id) on delete set null,

  created_at timestamptz not null default now()
);

create index ix_call_edges_ws_caller on code_call_edges(workspace_id, caller_artifact_id);
create index ix_call_edges_ws_callee_owner on code_call_edges(workspace_id, callee_owner_object_id);
```

---

# 7. 실행 파이프라인 요약(누락 방지)

## 7.1 Seed 기반(Named) 파이프라인
1) seed 준비(사용자 입력/추천)  
2) signals 계산(code/db/msg)  
3) 합성+normalize → affinity  
4) purity/primary/secondary 파생  
5) domain_candidates(PENDING) 적재 + evidence 연결  
6) 승인 시 object_domain_affinities 반영 + objects.metadata 캐시

## 7.2 Seed-less(Discovery) 파이프라인
1) 입력 레이어 선택(call/db/msg/code)  
2) 가중 그래프 구성(결정론적 weights)  
3) 커뮤니티 탐지(louvain/leiden) → clusters  
4) cluster마다 domain object 생성(kind=DISCOVERED) + label 후보 생성  
5) run 스냅샷 저장(domain_discovery_runs, domain_discovery_memberships)  
6) (옵션) 적용 시 object_domain_affinities(source=DISCOVERY) 반영 + cache

---

# 8. UI 출력(현실 구조 관측 최적)

- Service List: primary + purity + top secondary + top signals 요약
- Graph: 노드 색=primary, 배지/스타일=purity(mixed 강조)
- Report: domain crossing을 “위반”이 아니라 “복잡도/혼재 관측치”로 제공
- Discovery 탭: Cluster 목록 + label 후보 + 구성 서비스 + “적용/이름 변경/병합”

---

## 부록: 설계 선택 요약(왜 이렇게 했나)

- 분류(label) 대신 분포(affinity): 혼재가 많은 현실 구조를 왜곡하지 않기 위해  
- purity 도입: 운영 관점에서 “섞였는지”가 더 중요한 질문이기 때문  
- 후보는 jsonb, 확정은 N:M 정규화: 유연한 후보 수용 + 빠른 조회/정렬  
- AST는 관측치 추출 도구: 규범 강제보다 실제 의존 구조를 정확히 보여주기 위함  
- Seed-less discovery 추가: 레거시에서 seed가 없어도 분석을 시작하기 위해  
- discovery run/membership 스냅샷: 결과 재현/비교/튜닝을 가능하게 하기 위해
