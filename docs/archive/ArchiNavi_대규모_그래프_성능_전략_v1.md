# Archi.Navi 대규모 그래프 성능 전략 설계안 v1.0

작성일: 2026-02-21

------------------------------------------------------------------------

# 1. 설계 목표

본 문서는 Archi.Navi에서 roll-up 기준 2,000 edges 이상을 안정적으로
처리하기 위한 **대규모 그래프 성능 전략**을 정의한다.

목표는 다음과 같다:

1.  1레벨(예: SERVICE_TO_SERVICE, DOMAIN_TO_DOMAIN) 관계는 원칙적으로
    전부 조회 가능해야 한다.
2.  UI는 병목 없이 동작해야 한다.
3.  허브(Object degree가 매우 높은 노드)는 숨김이 아니라 사용자 제어
    기반으로 처리한다.
4.  결정론적 Query Engine 특성을 유지한다.
5.  Local-first 환경(pglite)에서 현실적으로 동작해야 한다.

------------------------------------------------------------------------

# 2. 핵심 원칙

## 2.1 데이터는 전부, 렌더는 제어

-   DB 레벨에서는 rollup 관계를 제한하지 않는다.
-   UI 레벨에서만 렌더링/스트리밍/접기 전략을 적용한다.
-   "Top-K로 잘라내는 기본 정책"은 사용하지 않는다.
-   대신 허브 제어 + 점진적 렌더링을 적용한다.

------------------------------------------------------------------------

# 3. Roll-up 빌드 전략

## 3.1 Materialized Roll-up 구조

모든 상위 관계는 materialized roll-up으로 저장한다.

rollup_level 예:

-   SERVICE_TO_SERVICE
-   DOMAIN_TO_DOMAIN

각 roll-up은 generation_version 단위로 관리한다.

------------------------------------------------------------------------

## 3.2 Rollup Generation 관리

``` sql
create table rollup_generations (
  workspace_id uuid not null,
  generation_version bigint not null,
  built_at timestamptz not null default now(),
  status text not null default 'ACTIVE',
  meta jsonb not null default '{}'::jsonb,
  primary key (workspace_id, generation_version)
);
```

-   ACTIVE generation은 workspace당 1개만 존재
-   모든 질의는 active_generation 기준으로 수행

------------------------------------------------------------------------

## 3.3 빌드 파이프라인

1.  Approved atomic relations 스냅샷 확정
2.  SERVICE_TO_SERVICE rollup 생성
3.  DOMAIN_TO_DOMAIN rollup 생성
4.  object_graph_stats 계산
5.  rollup_generations ACTIVE 전환

------------------------------------------------------------------------

# 4. 허브(Hub) 처리 전략

## 4.1 허브 정의

허브는 다음 조건 중 하나를 만족하는 Object:

-   out_degree \> threshold (예: 200)
-   in_degree \> threshold

threshold는 설정 프로필에서 관리 가능.

------------------------------------------------------------------------

## 4.2 object_graph_stats 테이블

``` sql
create table object_graph_stats (
  workspace_id uuid not null,
  generation_version bigint not null,
  rollup_level text not null,
  object_id uuid not null,
  out_degree int not null,
  in_degree int not null,
  primary key (workspace_id, generation_version, rollup_level, object_id)
);
```

이 테이블은 rollup build 시 함께 계산한다.

------------------------------------------------------------------------

## 4.3 허브 UI 처리 원칙

-   허브는 숨기지 않는다.
-   기본 상태에서 inbound 또는 outbound를 접은 상태로 시작 가능.
-   "Outbound 482개 (접힘)" 형태로 수치 명시.
-   사용자가 토글로 펼칠 수 있어야 한다.

------------------------------------------------------------------------

# 5. Graph 조회 전략

## 5.1 Direction 기반 조회

Graph API는 반드시 direction을 포함한다:

-   OUT
-   IN
-   BOTH

------------------------------------------------------------------------

## 5.2 필수 인덱스

``` sql
create index ix_rollup_out
on object_rollups(workspace_id, generation_version, rollup_level, subject_id);

create index ix_rollup_in
on object_rollups(workspace_id, generation_version, rollup_level, object_id);

create index ix_rollup_type
on object_rollups(workspace_id, generation_version, rollup_level, relation_type);
```

------------------------------------------------------------------------

# 6. 렌더링 성능 전략

## 6.1 점진적 렌더링

-   edge가 많을 경우 200개 단위로 분할 렌더
-   requestAnimationFrame 기반 incremental draw

## 6.2 Layout 전략

-   기본: 규칙 기반 레이아웃
-   선택: force layout(옵션 버튼)

------------------------------------------------------------------------

# 7. Path / Impact 탐색 전략

## 7.1 기본 제한

-   maxDepth 기본 6
-   maxVisited 기본 20,000
-   timeout 2초

## 7.2 캐시 키

캐시는 반드시 generation_version을 포함한다.

------------------------------------------------------------------------

# 8. Domain-first Navigation 전략

대규모 환경에서는 DOMAIN_TO_DOMAIN 그래프를 기본 네비게이션 레이어로
사용한다.

-   1차: DOMAIN 그래프
-   2차: 서비스 drill-down
-   3차: atomic 관계 drill-down

------------------------------------------------------------------------

# 9. Exact Mode vs Fast Mode

## Fast Mode (기본)

-   UI 중심 탐색
-   제한 깊이 / 스트리밍

## Exact Mode

-   제한 완화
-   시간 경고 표시

------------------------------------------------------------------------

# 10. 구현 체크리스트

-   [ ] rollup_generation 관리 구현
-   [ ] object_graph_stats 계산 포함
-   [ ] direction 토글 API 구현
-   [ ] 허브 collapse/expand 구현
-   [ ] incremental rendering 구현
-   [ ] path 제한/timeout 구현
-   [ ] domain-first navigation 구현

------------------------------------------------------------------------

# 11. 결론

-   rollup 관계는 원칙적으로 전부 보여준다.
-   허브는 사용자 제어 기반으로 다룬다.
-   성능 문제는 DB가 아니라 렌더링/레이아웃/탐색 확장에서 발생한다.
-   generation 기반 캐시 전략으로 일관성과 속도를 동시에 확보한다.
