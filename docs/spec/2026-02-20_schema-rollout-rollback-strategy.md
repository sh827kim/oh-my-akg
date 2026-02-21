# Schema Rollout / Rollback 전략 (Task 1-1)

작성일: 2026-02-20
연계 문서:
- Implementation SPEC: `docs/spec/2026-02-20_implementation-spec-core-api.md`
- Master Roadmap: `docs/tasks/2026-02-20_master-roadmap-and-task-breakdown.md`
- Schema: `scripts/schema.sql`

---

## 1. 목표

`projects/edges/project_tags` 기반 레거시 모델을 유지하지 않고,
`objects/object_relations/object_tags/change_requests` 단일 모델로 전환한다.

핵심 원칙:
- Canonical schema only
- 레거시 SQL 경로 제거
- 코드/스키마 동시 전환

---

## 2. 롤아웃 단계 (공격적 전환)

1. **Schema Replace**
- `scripts/schema.sql`에서 레거시 테이블 정의 제거
- canonical 테이블/제약/인덱스만 유지

2. **Code Cutover**
- API/CLI/화면 서버 쿼리를 object 모델로 일괄 전환
- 변경 요청 필드 `change_type -> request_type` 정규화

3. **Smoke Verification**
- `pnpm exec tsc --noEmit`
- `pnpm cli status`
- 핵심 플로우(프로젝트 목록/그래프/승인) 수동 확인

---

## 3. 롤백 전략

공격적 전환이므로 롤백은 "구버전 코드 + 구버전 schema.sql"로 복귀하는 방식으로 정의한다.

1. **애플리케이션 롤백**
- 이전 커밋으로 checkout

2. **DB 롤백**
- 데이터 보존이 필요한 경우 백업 파일 복원
- 신규 스키마를 유지한 채로 구버전 코드 실행은 보장하지 않음

운영 원칙:
- 릴리즈 전 DB 백업 필수
- 롤백은 코드/DB를 같은 시점으로 맞춰서 수행

---

## 4. 검증 체크리스트

- schema apply 후 `pnpm cli status` 정상 동작
- TypeScript 컴파일 정상
- `/api/objects`, `/api/change-requests`, `/api/sync` 기본 동작 확인
- 그래프/아키텍처 페이지 로딩 확인

---

## 5. 후속 작업

- Task 1-3: projection/API 최적화 및 쿼리 성능 보강
- Task 1-4: 레거시 경로 제거 및 접근 차단 가드 적용
- Task 1-5: 스모크/정합성 자동 검증 스크립트 운영 반영
- Task 2: 승인 워크플로우/roll-up 로직 정밀화
