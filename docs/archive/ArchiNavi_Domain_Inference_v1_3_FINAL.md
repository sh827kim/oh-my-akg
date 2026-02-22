# Archi.Navi Domain Inference 통합 설계안 v1.3 (FULL)

## 0. 설계 목적

이 설계의 목적은 다음 두 가지를 동시에 만족하는 것이다.

1. **현실 구조를 왜곡 없이 관측**한다.
    (완벽한 DDD 경계를 가정하지 않는다.)
2. **Seed 없이도 레거시 시스템을 자동 분석 가능**해야 한다.

따라서 도메인 모델은 다음 두 트랙을 하나의 모델 위에서 통합 제공한다.

- **Track A — Named Domain (Seed 기반)**
- **Track B — Discovered Domain (Seed-less 자동 발견)**

두 트랙은 동일한 Object/Relation 모델 위에서 동작하며,
 Discovered Domain은 이후 Named Domain으로 승격 가능하다.

------

# 1. 핵심 개념

## 1.1 Domain은 "라벨"이 아니라 "분포"

서비스는 하나의 도메인에 깔끔히 속하지 않을 수 있다.

따라서 본질 데이터는:

```
affinity: { domainId -> score }
```

이며,

- primary = max(affinity)
- secondary = threshold 이상
- purity = max(affinity)

primary/secondary는 저장값이 아니라 파생값이다.

------

# 2. Track A — Seed 기반 Domain Inference

## 2.1 입력

- Seed domain 목록 (사용자 정의 또는 추천)
- Code signals (AST 기반 import/call)
- DB signals (table access, FK)
- Message signals (topic produce/consume)
- Manual override

## 2.2 점수 계산

```
v = Wcode * v_code + Wdb * v_db + Wmsg * v_msg + Wmanual
affinity = normalize(v)
```

### 왜 normalize인가?

- 혼재 정도를 비교 가능하게 하기 위함
- purity 계산 가능
- 도메인 분포를 “확률적” 해석 가능

------

# 3. Track B — Seed-less Domain Discovery

## 3.1 목적

- 레거시에서 도메인 seed가 전혀 없는 경우
- 구조 지식이 사라진 시스템을 자동 분석

## 3.2 멀티 레이어 가중 그래프 구성

### 노드

- service (필수)
- db_table (선택)
- topic (선택)
- function/api_endpoint (선택)

### 엣지 가중치 기본값

| 타입             | weight |
| ---------------- | ------ |
| call             | 1.0    |
| read/write       | 0.8    |
| produce/consume  | 0.6    |
| FK               | 0.4    |
| code import/call | 0.7    |

------

## 3.3 알고리즘

- Louvain 또는 Leiden
- resolution 파라미터 지원
- min_cluster_size 지원

결과는 run 스냅샷으로 저장하여 재현 가능하게 한다.

------

## 3.4 Domain 생성

Discovered domain은 objects 테이블에 저장한다.

```
object_type = 'domain'
metadata.kind = 'DISCOVERED'
metadata.cluster_id = 'c-001'
metadata.algo = 'louvain'
```

Label 후보는 metadata.label_candidates에 저장한다.

------

# 4. 데이터베이스 스키마 (통합)

## 4.1 object_domain_affinities

```
create table object_domain_affinities (
  id uuid primary key,
  workspace_id uuid not null,
  object_id uuid not null,
  domain_id uuid not null,
  affinity real not null,
  confidence real,
  source text not null default 'APPROVED_INFERENCE',
  generation_version bigint,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(workspace_id, object_id, domain_id)
);
```

source:

- MANUAL
- APPROVED_INFERENCE
- DISCOVERY

------

## 4.2 domain_inference_profiles (표준 설정 프로필)

```
create table domain_inference_profiles (
  id uuid primary key,
  workspace_id uuid not null,
  name text not null,
  kind text not null default 'NAMED',
  is_default boolean default false,

  w_code real default 0.5,
  w_db real default 0.3,
  w_msg real default 0.2,

  heuristic_domain_cap real default 0.3,
  secondary_threshold real default 0.25,

  edge_w_call real default 1.0,
  edge_w_rw real default 0.8,
  edge_w_msg real default 0.6,
  edge_w_fk real default 0.4,
  edge_w_code real default 0.7,

  min_cluster_size int default 3,
  resolution real,

  enabled_layers jsonb default '["call","db","msg","code"]',

  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  unique(workspace_id, name)
);
```

### 왜 DB로 설정을 관리하는가?

- 워크스페이스별 튜닝
- 실험/비교 가능
- 동일 설정 + 동일 입력 → 동일 결과 (결정론)

------

## 4.3 domain_discovery_runs

```
create table domain_discovery_runs (
  id uuid primary key,
  workspace_id uuid not null,
  profile_id uuid references domain_inference_profiles(id),
  algo text not null,
  algo_version text,
  input_layers jsonb not null,
  parameters jsonb not null,
  graph_stats jsonb,
  status text default 'DONE',
  started_at timestamptz default now(),
  finished_at timestamptz
);
```

------

## 4.4 domain_discovery_memberships

```
create table domain_discovery_memberships (
  id uuid primary key,
  workspace_id uuid not null,
  run_id uuid not null,
  object_id uuid not null,
  domain_id uuid not null,
  affinity real not null,
  purity real,
  created_at timestamptz default now(),
  unique(workspace_id, run_id, object_id, domain_id)
);
```

------

# 5. Domain-to-Domain Roll-up 통합 설계

## 5.1 설계 원칙

도메인 그래프는 별도 체계로 두지 않는다.
 기존 object_rollups에 편입한다.

새 rollup_level:

```
DOMAIN_TO_DOMAIN
```

------

## 5.2 계산 공식 (결정론)

입력:

- SERVICE_TO_SERVICE rollup
- object_domain_affinities

서비스 edge: A → B
 weight = w_ab
 confidence = c_ab

A 도메인 분포: a[X]
 B 도메인 분포: b[Y]

도메인 edge 누적:

```
edge_weight[X,Y] += w_ab * a[X] * b[Y]

confidence[X,Y] =
  sum(c_ab * w_ab * a[X] * b[Y]) /
  sum(w_ab * a[X] * b[Y])
```

threshold 예:

```
min_membership_threshold = 0.2
```

------

## 5.3 domain_rollup_provenances

```
create table domain_rollup_provenances (
  id uuid primary key,
  workspace_id uuid not null,
  generation_version bigint not null,
  domain_rollup_id uuid not null,
  source_service_rollup_id uuid not null,
  factor real not null,
  contributed_weight real not null,
  contributed_confidence real,
  created_at timestamptz default now()
);
```

### 왜 provenance가 필요한가?

- Domain edge는 집계 결과
- 어떤 서비스 edge들이 기여했는지 drill-down 가능해야 함
- AI evidence 추적을 위해 필수

------

# 6. generation_version 전략

Rollup 빌드 시:

1. SERVICE_TO_SERVICE 생성
2. DOMAIN_TO_DOMAIN 생성

같은 generation_version으로 묶는다.

이렇게 하면 Query Engine은 일관된 그래프를 조회 가능하다.

------

# 7. 설계 철학 요약

- 도메인은 “규범”이 아니라 “관측된 군집”
- 혼재를 숨기지 않는다 (purity)
- Seed 없어도 자동 부트스트랩 가능
- 설정은 코드가 아닌 DB
- Domain rollup은 기존 그래프 체계에 통합
- provenance로 evidence 체인 유지

------

# 8. 구현 순서 제안

1. object_domain_affinities 확정
2. profile 테이블 도입
3. Seed 기반 inference 완성
4. Discovery run + membership 저장
5. DOMAIN_TO_DOMAIN rollup 구현
6. provenance 저장
7. UI에 purity / mixed 표시
8. 도메인 그래프 뷰 추가
