ad d# AST Plugin Capability Matrix v1

작성일: 2026-02-21  
연계 문서:
- `docs/spec/2026-02-20_ast-inference-pipeline-plan.md`
- `docs/tasks/2026-02-20_master-roadmap-and-task-breakdown.md`

---

## 1. 목적

Task 2-5 ~ 2-7 구현 기준으로 AST 파이프라인 계약, 언어별 추출 범위, confidence/evidence 규칙을 고정한다.

---

## 2. 파이프라인 계약 (고정)

- 공통 stage: `parse -> extract -> normalize -> emit`
- 플러그인 3종(Java/Kotlin, TS/JS, Python) 모두 stage 4개 구현
- 레거시 `extractSignals`는 호환 경로로 유지하되, 내부적으로 stage 추출 결과를 재사용

---

## 3. 심볼 정규화 규칙

- `::`, `#` 는 `.`로 정규화
- 공백/문자열 quote 제거
- 상대 심볼(`.foo`)은 파일 경로 namespace를 앞에 붙여 정규화
- 중복 구분자(`..`) 제거

---

## 4. relation_type 매핑 규칙

- HTTP client 호출 패턴: `call`
- ORM/SQL 조회 패턴: `read`
- ORM/SQL 변경 패턴: `write`
- 메시지 publish/producer 패턴: `produce`
- 메시지 subscribe/consumer 패턴: `consume`
- 라우트 노출(FastAPI/Flask): `expose`
- import/env/value 등 정적 근거: `depend_on` (fallback)

---

## 5. Evidence 스키마 v1

각 evidence는 다음 필드를 가진다.

- `schemaVersion`: `v1`
- `kind`: `import|env|value|call|query|message|route|annotation|unknown`
- `file`
- `line` (가능 시)
- `symbol` (가능 시)
- `snippetHash`
- `detail`

저장 직렬화 형식:
- `v1|kind|file|line|symbol|snippetHash|detail`

---

## 6. Confidence 규칙 v1.0

- 버전: `v1.0`
- 근거 가중치 기반 계산(상위 3개 evidence 반영)
- 저신뢰 기준: `< 0.65`
- 저신뢰 후보는 `reviewLane=low_confidence`, `reviewTag=LOW_CONFIDENCE`, `requested_by`에 `:low-confidence` suffix 적용

---

## 7. 언어별 capability matrix

| Plugin | parse | extract | normalize | emit | HTTP/Call | ORM Read/Write | Message Produce/Consume | Route |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `java-kotlin` | O | O | O | O | O | O | O | - |
| `typescript` | O | O | O | O | O | O | O | - |
| `python` | O | O | O | O | - | O | O | O |

---

## 8. 운영상 분리 정책

- low-confidence는 승인 큐에서 별도 필터링 가능한 lane으로 저장
- normal lane과 동일한 승인 워크플로우를 사용하되, 운영 UI/CLI에서 우선순위를 낮춰 처리
