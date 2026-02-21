# Task 1-4 레거시 제거 운영 위험 체크리스트

작성일: 2026-02-21
범위: `projects/edges/project_tags` 레거시 경로 제거 이후 운영 리스크 점검

---

## 1) 코드/경로 고정

- [x] API 경로를 `/api/objects` 단일 경로로 고정
- [x] 구 호환 API 라우트 제거
- [x] 코드에서 레거시 테이블 직접 SQL 접근 정적 점검 스크립트 추가 (`scripts/check-no-legacy-table-usage.ts`)

## 2) 런타임 안전장치

- [x] DB 레이어에 레거시 테이블 접근 감지 + 즉시 차단 적용 (`packages/core/src/db.ts`)

## 3) 데이터 무결성/회귀

- [x] 모델 전환 스모크 테스트 스크립트 추가 (`scripts/task1-5-smoke-test.ts`)
- [x] object 모델 정합성 점검 스크립트 추가 (`scripts/check-object-model-integrity.ts`)
- [ ] 릴리즈 직전 CI에서 `verify:legacy-sql`, `verify:task1-5:integrity` 실행

## 4) 운영 관찰 포인트

- [ ] 배포 후 `/api/objects` 4xx/5xx 비율 모니터링
- [ ] 변경요청 승인 워크플로우(`change_requests`) 연동 회귀 확인
- [x] 사용자 노출 용어(`project`) 정리 Task(1-6) 반영
