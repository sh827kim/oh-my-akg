# Archi.Navi 마스터 로드맵 + 세부 Task

작성일: 2026-02-20
기준 문서:
- PRD: `docs/prd/PRD.md`
- 구현 스펙: `docs/spec/2026-02-20_implementation-spec-core-api.md`
- 스키마 롤아웃/롤백: `docs/spec/2026-02-20_schema-rollout-rollback-strategy.md`
- AST 고도화 스펙: `docs/spec/2026-02-20_ast-inference-pipeline-plan.md`

---

## 0. 목적

현재 코드베이스를 PRD/스펙 기준의 최종 상태(단일 Object 모델 + 승인 기반 반영 + 실행 배포 완성)까지 끌어올리기 위한 실행 로드맵이다.

---

## 1. 큰 Task 로드맵

## Task 1. Core 도메인/데이터 모델 전환 완성
상태: **완료 (2026-02-21)**

목표:
- `projects/edges` 중심 구현을 `objects/object_relations/object_tags` 중심으로 전환

핵심 산출물:
- 전환 마이그레이션 SQL
- Object/Relation 기준 API 경로 및 서비스 레이어
- 레거시 경로 제거

완료 기준:
- 신규/수정 데이터가 `objects` + `object_relations`만을 소스로 동작
- 주요 화면(List/Architecture/Object Mapping)이 신규 모델로 동일 기능 제공

---

## Task 2. 승인 워크플로우 + 추론 신뢰성 고도화
목표:
- 승인 전 반영 금지 원칙을 코드/테스트 레벨에서 강제

핵심 산출물:
- `change_requests` 생성/승인/반려 API
- CLI 일괄 승인/반려 흐름 완성
- inference 결과 스키마 강제(`confidence`, `evidence`)
- AST 기반 다국어 추론 파이프라인(파서 어댑터/정규화/증거 추출)
- 추론 정확도 평가 리포트(언어별 precision/recall)

완료 기준:
- 미승인 관계는 뷰/집계에 반영되지 않음
- 승인 시에만 정규 관계 반영 + roll-up 갱신
- 관련 검증 테스트 통과
- AST 추론 결과가 승인 큐로 안정 유입되고 언어별 최소 품질 기준 충족

---

## Task 3. 실행 배포 체계 정리(npm + Docker)
목표:
- `npx archi-navi up` 중심 실행 경험과 Docker 병행 경로를 안정화

핵심 산출물:
- web 산출물 전략 확정(패키징 포함)
- npm publish 메타데이터 정리
- Docker 실행/운영 가이드

완료 기준:
- 패키지 설치 후 단일 명령으로 기동 가능
- 문서만 보고 npm/Docker 두 경로 모두 재현 가능

---

## Task 4. 품질 보증 + 문서 동기화 + 릴리즈 준비
목표:
- 회귀/성능/UX 기준을 만족하는 릴리즈 가능 상태 확보

핵심 산출물:
- 회귀 테스트 결과
- 2,000 edges 성능 점검 결과
- Object Mapping drill-down UX 점검 리포트
- README/README.ko 최신화(핵심 용어 포함)

완료 기준:
- 필수 검증 항목 통과 또는 불가 사유 명시
- 문서와 실제 동작 불일치 항목 0건

---

## 2. Task별 세부 Task

## Task 1 세부 Task (Core 모델 전환)

### 1-1. 스키마 정렬
- [x] `objects`, `object_relations`, `object_tags`, `change_requests` 최종 스키마 확인/보강
- [x] 인덱스/유니크/FK 제약을 스펙 기준으로 고정
- [x] 롤백 가능한 마이그레이션 전략 확정

### 1-3. API/서비스 전환
- [x] Object/Relation/Tag API를 신규 모델로 전환
- [x] Service List/Architecture/Object Mapping 조회 쿼리 전환
- [x] 레거시 API 경로 사용처 제거 또는 어댑터 최소화
- [x] 구 API 경로 제거 및 `/api/objects` 단일 경로 고정

### 1-4. 레거시 정리
- [x] 코드 내 `projects/edges` 직접 의존 구간 제거
- [x] 레거시 테이블/필드 접근 경고 또는 비활성화
- [x] 전환 후 운영 위험 항목 체크리스트 작성 (`docs/tasks/2026-02-21_task1-4-legacy-risk-checklist.md`)

### 1-5. 검증
- [x] 모델 전환 스모크 테스트(조회/수정/태그/가시성) (`scripts/task1-5-smoke-test.ts`)
- [x] 데이터 정합성 점검 스크립트(카운트/무결성) (`scripts/check-object-model-integrity.ts`)

### 1-6. 용어/네이밍 정리 (추가)
- [x] UI/컴포넌트/메시지의 `project` 용어를 `service`/`object` 기준으로 일관화
- [x] API/문서 예시에서 구 경로 제거 최종 점검
- [x] CSV/검색 placeholder 등 사용자 노출 텍스트 정합성 점검

### Task 1 완료 요약
- [x] Core 모델 전환(1-1 ~ 1-6) 완료
- [x] 레거시 경로 제거 + 접근 차단 + 검증 스크립트 반영

---

## Task 2 세부 Task (승인 + 추론)

### 2-1. 승인 큐 API
- [x] `GET /api/change-requests` 구현/정리
- [x] `POST /api/change-requests/bulk` 구현/정리
- [x] 승인/반려 시 감사 필드(`reviewed_by`, `reviewed_at`) 반영

### 2-2. 반영 게이트 강제
- [x] 미승인 관계가 조회/집계에서 제외되도록 공통 필터 적용
- [x] 승인 이벤트 발생 시 정규 관계 반영 + roll-up 갱신
- [x] 반려 시 반영 차단 및 상태 유지

### 2-3. inference 계약 강제
- [x] inference payload에 `confidence`, `evidence` 필수화
- [x] 필수값 누락 시 저장/승인 파이프라인 차단
- [x] source 타입별 검증 규칙 정리(manual/scan/inference/rollup)

### 2-4. 테스트
- [x] core validation unit test (T2-3)
- [x] relation 제약 테스트 (T2-3)
- [x] 승인 전 반영 금지 테스트 + evidence 필수 테스트 (T3-3)

### 2-5. AST 파이프라인 아키텍처 고도화
- [ ] 공통 AST 인터페이스 정의(`parse -> extract -> normalize -> emit`)
- [ ] 언어별 파서 어댑터 계약 고정(Java/Kotlin, TS/JS, Python)
- [ ] 심볼 정규화 규칙 정의(FQN, 모듈 경로, 네임스페이스)
- [ ] relation 후보 생성 규칙을 `relation_type` 기준으로 매핑

### 2-6. 언어별 AST 플러그인 고도화
- [ ] Java/Kotlin: 컨트롤러/클라이언트 호출, ORM read/write, Kafka produce/consume 추출
- [ ] TS/JS: HTTP 클라이언트(fetch/axios), ORM/쿼리빌더, 메시징 SDK 호출 추출
- [ ] Python: FastAPI/Flask 엔드포인트, SQLAlchemy/ORM, 메시지 브로커 호출 추출
- [ ] 플러그인 capability matrix 문서화(지원/제외/제약)

### 2-7. confidence/evidence 스코어링 체계
- [ ] 증거 단위 스키마 고정(파일, 라인, 심볼, 스니펫 해시)
- [ ] 다중 증거 결합 점수 규칙 정의(직접 호출 > 문자열 힌트)
- [ ] `confidence` 계산식 버전화 및 튜닝 포인트 명시
- [ ] low-confidence 후보 자동 태깅 및 우선 검토 큐 분리

### 2-8. 평가셋/벤치마크
- [ ] 골든셋(언어별 샘플 레포 + 정답 relation) 구축
- [ ] 오프라인 평가 지표 정의(precision, recall, evidence coverage)
- [ ] 품질 게이트 정의(예: precision 기준 미달 시 배포 차단)
- [ ] 회귀 벤치(플러그인 변경 전/후) 자동 비교 리포트

### 2-9. 배포 전략(점진 롤아웃)
- [ ] shadow mode: 생성만 하고 반영하지 않는 관찰 모드 추가
- [ ] 워크스페이스 단위 feature flag로 AST 플러그인 on/off 제어
- [ ] 장애 대비 fallback(기존 heuristic 추론) 경로 유지
- [ ] 추론 파이프라인 운영 지표(처리량/실패율/평균 confidence) 수집

---

## Task 3 세부 Task (배포/패키징)

### 3-1. web 산출물 전략
- [ ] `apps/web` 빌드 산출물 구조 확정
- [ ] CLI 런타임에서 web 산출물 탐색 경로 고정
- [ ] CLI에서 실행 가능한 형태로 web 산출물 패키징
- [ ] 버전 불일치 감지(클라이언트/CLI) 정책 정의

### 3-2. CLI up 안정화
- [ ] 포트 충돌/헬스체크/종료 처리 보강
- [ ] DB 경로(`AKG_DB_PATH`) 검증 에러 메시지 개선
- [ ] 로그 레벨/실행 URL 출력 일관화

### 3-3. npm 배포 정리
- [ ] `files`, `bin`, `publishConfig` 최종 점검 (T4-3)
- [ ] `npm pack --dry-run` 포함 파일 검증 자동화
- [ ] macOS/Linux 스모크 테스트 재검증

### 3-4. Docker 가이드
- [ ] npm 실행 가이드 작성
- [ ] `Dockerfile` + `docker-compose` 실행 절차 문서화
- [ ] 볼륨/백업/복구 정책 문서화
- [ ] npm 실행 경로와 Docker 경로 차이 명확화

---

## Task 4 세부 Task (품질/문서/릴리즈)

### 4-1. 회귀/품질 검증
- [ ] 기능 회귀 테스트(그래프/승인/채팅/설정)
- [ ] 타입체크/빌드/핵심 CLI 명령 검증
- [ ] 검증 실패 시 원인/재현/우회 문서화

### 4-2. 성능 검증
- [ ] roll-up 2,000 edges 데이터셋 준비
- [ ] 주요 화면 응답 지표 측정(초기 로드/필터/탐색)
- [ ] 병목 구간 개선안 수립

### 4-3. UX 점검
- [ ] Object Mapping drill-down 시나리오 점검
- [ ] 정보 밀도/네비게이션/deep-link 흐름 개선
- [ ] 사용자 관점 점검 항목 체크리스트화

### 4-4. 문서 동기화
- [ ] `README.md`, `README.ko.md` 최종 동기화
- [ ] 핵심 용어(Object/Service/Relation/Roll-up/Roll-down) 설명 최신화
- [ ] AGENTS.md 규칙과 실제 워크플로우 일치 여부 점검

### 4-5. 릴리즈 게이트
- [ ] 릴리즈 노트 초안 작성
- [ ] 남은 리스크/후속 백로그 분리
- [ ] 태그/배포 전 최종 점검 체크리스트 실행

---

## 3. 권장 실행 순서

1. Task 1 완료
2. Task 2 완료
3. Task 3 완료
4. Task 4 완료

의존성 이유:
- Task 2/3/4는 Task 1의 데이터 모델 안정성이 선행되어야 리스크가 낮다.

---

## 4. 즉시 착수 후보 (Next Up)

- [ ] Task 2-1: 승인 큐 API 계약 테스트 케이스 초안
- [ ] Task 2-5: AST 파이프라인 인터페이스 초안 + 플러그인 capability matrix v0
- [ ] Task 2-2: 승인 반영 게이트(조회/집계 공통 필터) 강제
