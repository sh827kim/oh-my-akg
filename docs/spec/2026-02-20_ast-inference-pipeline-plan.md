# AST Inference 고도화 계획 (Draft v0)

작성일: 2026-02-20
연계 문서:
- PRD: `docs/prd/PRD.md`
- Implementation SPEC: `docs/spec/2026-02-20_implementation-spec-core-api.md`
- Master Roadmap: `docs/tasks/2026-02-20_master-roadmap-and-task-breakdown.md`

---

## 1. 목적

추론 엔진의 신뢰도를 높이기 위해, 기존 정규식 중심 플러그인 구조를 아래 단계형 파이프라인으로 확장한다.

- `parse -> extract -> normalize -> emit`

핵심 목표:
- 언어별 파서 기반 근거 추출 정확도 향상
- `confidence`/`evidence` 생성 규칙 표준화
- 승인 워크플로우에 투입 가능한 후보 품질 확보

---

## 2. 파이프라인 계약

`packages/inference/src/plugins/types.ts` 기준.

### 2.1 Stage 계약

1. `parse(file)`
- 입력: 파일 경로/내용
- 출력: AST 파싱 결과 + diagnostics

2. `extract(file, parsed)`
- 출력: 원시 신호(`hint`, `evidence`, `relationTypeHint`, `symbol`)

3. `normalize(file, parsed, extracted)`
- 출력: 정규화 신호 + `confidence`
- 목적: 중복 제거, 심볼/FQN 정규화, 스코어링

4. `emit(file, parsed, normalized)`
- 출력: 최종 신호(`hint`, `evidence`, `relationType`, `confidence`, `pluginId`)

### 2.2 호환 정책

- 기존 `extractSignals(file)` 경로는 레거시 호환으로 유지한다.
- 플러그인이 stage 메서드를 미구현하면 기본 어댑터를 통해 파이프라인을 보완한다.

---

## 3. 현재 구현 상태 (v0)

현재 코드 기준:
- 공통 인터페이스 및 파이프라인 실행기 추가 완료
  - `packages/inference/src/plugins/index.ts`
  - `packages/inference/src/plugins/types.ts`
- 레거시 플러그인(Java/Kotlin, TS/JS, Python)은 `extractSignals` 경로로 동작

운영/점검 유틸:
- `inspectAstPluginCapabilities()`로 플러그인별 stage 구현 상태 조회 가능

---

## 4. 언어별 고도화 계획

## 4.1 Java/Kotlin
- Spring Controller/Client 호출 추출
- `@Value`, `System.getenv`, config key와 서비스 매핑 강화
- JPA/MyBatis 쿼리 기반 `read`/`write` 후보 추출
- Kafka producer/consumer annotation/SDK 추출

## 4.2 TypeScript/JavaScript
- `fetch/axios` 호출에서 endpoint/service 후보 추출
- ORM(Prisma/TypeORM/Knex) read/write 패턴 추출
- 메시징 SDK(kafka/redis/sqs 등) produce/consume 추출
- import graph + path alias 해석

## 4.3 Python
- FastAPI/Flask route 추출
- SQLAlchemy ORM/query 패턴 read/write 추출
- Celery/Kafka/Redis client produce/consume 추출
- module import + settings/env 추적

---

## 5. confidence/evidence 표준

### 5.1 evidence 스키마
- 최소 필드: 파일 경로, 라인/범위(가능 시), 심볼, 증거 타입(import/env/call/query)
- 문자열 증거만 있을 때도 `file:type:token` 포맷 유지

### 5.2 confidence 가중치(초안)
- 직접 호출/AST call edge: 높음
- annotation/config 기반 추론: 중간
- 단순 문자열 힌트: 낮음

### 5.3 게이트 정책
- low confidence 후보는 자동 승인 금지
- 승인 큐에서 우선순위를 낮추거나 별도 필터로 분리

---

## 6. 평가/릴리즈 전략

## 6.1 오프라인 평가
- 언어별 골든셋 레포 + 정답 relation 구축
- 지표: precision, recall, evidence coverage

## 6.2 점진 적용
- Shadow mode: 생성만, 반영 없음
- Feature flag: 워크스페이스 단위 활성화
- Fallback: 기존 heuristic 경로 유지

## 6.3 운영 지표
- 처리량, 실패율, 평균 confidence
- 언어별 추론 성공률/승인률

---

## 7. 다음 실행 순서

1. 공통 AST 인터페이스 계약 리뷰/고정
2. 플러그인 capability matrix v1 작성
3. Java/Kotlin -> TS/JS -> Python 순서로 stage 구현 확대
4. 골든셋 기반 회귀 벤치 자동화
