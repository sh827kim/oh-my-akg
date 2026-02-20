# Archi.Navi Implementation SPEC (Core Model + API)

작성일: 2026-02-20  
버전: draft-v1
연계 문서:
- PRD: [`../prd/PRD.md`](../prd/PRD.md)
- Object Model: [`./object-model-definition.md`](./object-model-definition.md)
- 의사결정: [`./2026-02-20_feasibility-and-decision-questions.md`](./2026-02-20_feasibility-and-decision-questions.md)

## 1. 목적

이 문서는 구현 단계에서 필요한 데이터 모델/승인 워크플로우/API 계약을 고정한다.

핵심 범위:

1. 단일 Object 모델(`objects`, `object_relations`) 구현
2. 승인 기반 반영(`change_requests`) 구현
3. roll-up(materialized) + roll-down(on-demand) 조회 계약
4. 기존 UX(Architecture/List/Tag/Visibility/CSV) 통합 계약

## 2. 데이터 모델

## 2.1 objects

목적: 모든 자산(Service 포함) 단일 저장

필드:

- `id` UUID PK
- `workspace_id` TEXT NOT NULL
- `object_type` TEXT NOT NULL
- `name` TEXT NOT NULL
- `display_name` TEXT NULL
- `urn` TEXT NULL UNIQUE(workspace scope)
- `parent_id` UUID NULL FK -> objects.id
- `visibility` TEXT NOT NULL DEFAULT `VISIBLE` (`VISIBLE` | `HIDDEN`)
- `granularity` TEXT NOT NULL (`COMPOUND` | `ATOMIC`)
- `metadata` JSONB NOT NULL DEFAULT `{}`
- `created_at` TIMESTAMPTZ NOT NULL
- `updated_at` TIMESTAMPTZ NOT NULL

인덱스:

- `(workspace_id, object_type)`
- `(workspace_id, visibility)`
- `(workspace_id, parent_id)`
- `(workspace_id, name)`

## 2.2 object_relations

목적: 모든 관계를 정규/파생 포함 단일 저장

필드:

- `id` UUID PK
- `workspace_id` TEXT NOT NULL
- `subject_object_id` UUID NOT NULL FK -> objects.id
- `relation_type` TEXT NOT NULL
- `target_object_id` UUID NOT NULL FK -> objects.id
- `approved` BOOLEAN NOT NULL DEFAULT FALSE
- `is_derived` BOOLEAN NOT NULL DEFAULT FALSE
- `derived_from_relation_id` UUID NULL FK -> object_relations.id
- `confidence` NUMERIC(4,3) NULL
- `source` TEXT NOT NULL (`manual` | `scan` | `inference` | `rollup`)
- `evidence` JSONB NOT NULL DEFAULT `[]`
- `created_at` TIMESTAMPTZ NOT NULL
- `updated_at` TIMESTAMPTZ NOT NULL

정규 제약:

- UNIQUE `(workspace_id, subject_object_id, relation_type, target_object_id, is_derived)`
- `is_derived=true`이면 `source='rollup'` 권장

인덱스:

- `(workspace_id, subject_object_id, approved)`
- `(workspace_id, target_object_id, approved)`
- `(workspace_id, relation_type, approved)`
- `(workspace_id, is_derived, approved)`

## 2.3 object_tags / tags

`tags`

- `id` UUID PK
- `workspace_id` TEXT NOT NULL
- `name` TEXT NOT NULL
- `color_hex` TEXT NOT NULL
- UNIQUE `(workspace_id, name)`

`object_tags`

- `workspace_id` TEXT NOT NULL
- `object_id` UUID NOT NULL FK -> objects.id
- `tag_id` UUID NOT NULL FK -> tags.id
- PK `(workspace_id, object_id, tag_id)`

## 2.4 change_requests

목적: 승인 전 반영 금지 원칙 강제

필드:

- `id` UUID PK
- `workspace_id` TEXT NOT NULL
- `request_type` TEXT NOT NULL (`RELATION_UPSERT` | `RELATION_DELETE` | `OBJECT_PATCH`)
- `payload` JSONB NOT NULL
- `status` TEXT NOT NULL (`PENDING` | `APPROVED` | `REJECTED`)
- `requested_by` TEXT NULL
- `reviewed_by` TEXT NULL
- `created_at` TIMESTAMPTZ NOT NULL
- `reviewed_at` TIMESTAMPTZ NULL

인덱스:

- `(workspace_id, status, created_at)`
- `(workspace_id, request_type, status)`

## 2.5 object_type enum (canonical)

- `service`
- `api_endpoint`
- `function`
- `database`
- `db_table`
- `db_view`
- `cache_instance`
- `cache_key`
- `message_broker`
- `topic`
- `queue`

## 2.6 relation_type enum

- `call`
- `expose`
- `read`
- `write`
- `produce`
- `consume`
- `depend_on`

## 3. 관계 저장 규칙

1. `call` 정규 저장: `service -> api_endpoint`
2. `service -> service`는 정규 저장 금지, roll-up 파생만 허용
3. 저장소/채널도 원자 객체 기준 정규 저장
- 예: `service -> db_table(read)` 저장, `service -> database(read)` 파생
4. `depend_on`은 fallback으로 유지

## 4. 롤업(materialized) 규격

## 4.1 생성 시점

- 승인 이벤트(RELATION_UPSERT/DELETE 승인 완료) 발생 시 동기 갱신
- 대량 변경 시 배치 재생성 job 제공

## 4.2 파생 대상

- `service -> service` (call roll-up)
- `service -> database` (read/write roll-up)
- `service -> message_broker` (produce/consume roll-up)

## 4.3 파생 표식

- `is_derived = true`
- `derived_from_relation_id` 설정
- `source = rollup`

## 5. Visibility 규격

- `objects.visibility` 기본값 `VISIBLE`
- `HIDDEN` 객체는 기본 그래프/아키텍처/목록에서 제외 가능
- List/관리 화면에서는 "숨김 포함" 필터로 조회 가능
- export는 기본 `VISIBLE`만, 옵션으로 `HIDDEN` 포함 허용

## 6. View Projection 규격

## 6.1 Service List View

- 기준: `object_type=service`
- 지원 기능:
  - 검색(name/display_name)
  - tag 필터
  - visibility 필터
  - CSV Export

## 6.2 Architecture View

- 기준: roll-up 관계(`approved=true`) + service 중심
- hidden 객체 제외 기본
- edge 2,000개 범위에서 탐색 가능해야 함

## 6.3 Object Mapping View

- 기준: object_type 필터 + relation_type 필터
- 기본은 roll-up, 특정 object 선택 시 roll-down 상세
- Kafka 전용 뷰 없음

## 7. 승인 워크플로우 API

## 7.1 후보 조회

- `GET /api/change-requests?workspaceId={id}&status=PENDING`

## 7.2 일괄 승인/반려

- `POST /api/change-requests/bulk`
- body:

```json
{
  "workspaceId": "w1",
  "action": "APPROVE",
  "requestIds": ["cr1", "cr2", "cr3"]
}
```

요구사항:

- 전체 선택 + 일부 해제 UX를 지원할 수 있도록 `requestIds` 목록 기반 처리
- 승인 처리 시 정규 관계 반영 + roll-up 갱신 수행

## 8. Object/Relation API (v1)

## 8.1 Object

- `GET /api/objects`
- `GET /api/objects/{id}`
- `PATCH /api/objects/{id}` (display_name, parent_id, visibility, metadata)

## 8.2 Relation

- `GET /api/relations`
- `POST /api/relations/manual` (manual relation upsert)
- `DELETE /api/relations/{id}` (manual relation delete)

## 8.3 Tag

- `GET /api/tags`
- `POST /api/tags`
- `POST /api/objects/{id}/tags`
- `DELETE /api/objects/{id}/tags/{tagId}`

## 8.4 Export

- `GET /api/export/services.csv?workspaceId={id}&includeHidden=false`

## 9. AI Chat API 계약

- `POST /api/chat`
- 응답 필수 필드:
  - `answer`
  - `confidence`
  - `evidences[]`
  - `deepLinks[]`
- 정책:
  - evidence가 없으면 확정형 답변 금지

## 10. 비기능 구현 체크

1. 승인 전 반영 금지 보장 테스트
2. roll-up 생성/삭제 정합성 테스트
3. workspace 경계 테스트
4. visibility 필터 테스트
5. CSV export 회귀 테스트

## 11. 구현 순서 권고

1. DB 마이그레이션(`objects`, `object_relations`, `object_tags`, `change_requests`)
2. 승인 일괄 API 구현
3. roll-up 엔진 구현
4. Service List/Architecture/Object Mapping projection API 구현
5. Chat evidence 계약 적용
