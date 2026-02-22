# Archi.Navi DB 스키마 정밀 설계안 (v1)

작성일: 2026-02-21
문서 버전: v1.0
대상: PRD/SPEC (2026-02-20) 기준

---

## 0. 설계 목표

이 스키마는 다음을 만족하도록 설계한다.

1. 단일 Object 모델 + 무한 계층(parent_id, path)
2. 원자 관계 정규 저장 + 저장형(Materialized) Roll-up
3. 승인 전 반영 금지 (추론 후보 큐 분리)
4. Evidence 기반 근거 추적
5. 수동 오버라이드 우선
6. Append-only 변경 이력

전제: Local-first, PostgreSQL 호환(pglite)

---

## 1. Core Tables

### 1.1 workspaces

create table workspaces (
  id uuid primary key,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

---

### 1.2 objects

create table objects (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,

  object_type text not null,
  category text,
  granularity text not null default 'ATOMIC',

  urn text,
  name text not null,
  display_name text,
  description text,

  parent_id uuid references objects(id) on delete set null,

  path text not null,
  depth int not null default 0,

  visibility text not null default 'VISIBLE',
  metadata jsonb not null default '{}'::jsonb,

  valid_from timestamptz,
  valid_to timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index ux_objects_ws_urn
on objects(workspace_id, urn) where urn is not null;

create index ix_objects_ws_type on objects(workspace_id, object_type);
create index ix_objects_ws_parent on objects(workspace_id, parent_id);
create index ix_objects_ws_path on objects(workspace_id, path);

---

### 1.3 object_relations (확정 관계)

create table object_relations (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,

  relation_type text not null,

  subject_object_id uuid not null references objects(id) on delete cascade,
  object_id uuid not null references objects(id) on delete cascade,

  interaction_kind text,
  direction text,

  is_derived boolean not null default false,
  confidence real,

  metadata jsonb not null default '{}'::jsonb,
  source text not null default 'MANUAL',

  created_at timestamptz not null default now(),

  unique(workspace_id, relation_type, subject_object_id, object_id, is_derived)
);

create index ix_rel_ws_subject on object_relations(workspace_id, subject_object_id);
create index ix_rel_ws_object on object_relations(workspace_id, object_id);

---

### 1.4 relation_candidates (승인 전 큐)

create table relation_candidates (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,

  relation_type text not null,
  subject_object_id uuid not null references objects(id),
  object_id uuid not null references objects(id),

  confidence real not null,
  metadata jsonb not null default '{}'::jsonb,

  status text not null default 'PENDING',

  created_at timestamptz not null default now()
);

create index ix_relcand_ws_status on relation_candidates(workspace_id, status);

---

### 1.5 object_rollups (Materialized Roll-up)

create table object_rollups (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,

  rollup_level text not null,
  relation_type text not null,

  subject_object_id uuid not null references objects(id),
  object_id uuid not null references objects(id),

  edge_weight int not null default 1,
  confidence real,
  generation_version bigint not null,

  created_at timestamptz not null default now()
);

create index ix_rollups_ws_level_subject
on object_rollups(workspace_id, rollup_level, subject_object_id);

---

## 2. 운영 원칙 요약

- 자동 추론 결과는 relation_candidates에만 저장
- 승인 후 object_relations로 이동
- Roll-up은 object_rollups에 저장
- UI는 항상 최신 generation_version 기준으로 조회
