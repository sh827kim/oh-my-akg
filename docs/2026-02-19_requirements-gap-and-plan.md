# Module Health Radar 요구사항 재검토 + 다음 업무 계획 (업데이트)

작성일: 2026-02-19  
기준 문서: `PRD.md`  
검토 기준 코드: `app`, `components`, `cli`, `scripts`

---

## 1. 재검토 요약

이번 재검토 기준으로, 초기 갭 대비 다음 항목이 유의미하게 개선되었다.

- Settings에서 Type/Tag 관리 기능 구현
- Overview에서 Settings 기반 Type/Tag 연동
- Project Detail 모달에 inbound/outbound 상세 탭 구현
- 기본 `alert/confirm/prompt` 제거, 커스텀 모달 적용
- Architecture 계층을 Type 기반으로 생성하고 순서 반영 (현재 Top-down)
- Dependency/Architecture 검색 하이라이트 동작
- Architecture 엣지 필터를 동적 타입 토글 방식으로 개선

다만, 핵심 요구사항 중 다음 축은 여전히 미완료 영역이다.

- 승인 워크플로우(change_request 기반)
- MW(미들웨어) 정식 모델링(project↔mw)
- Kafka View
- draw.io Export
- env 기반 의존성 추론
- Agent Chat의 RAG 고도화

---

## 2. 요구사항 대비 최신 상태 (완료/부분완료/미완료)

### 2.1 프로젝트 목록 관리 (5.1)

| 요구사항 | 상태 | 근거 |
|---|---|---|
| visibility 토글 + hidden 필터 | 완료 | `components/project-list-manager.tsx` |
| 다중 태그 추가/삭제 | 완료 | `components/tag-manager.tsx`, `app/api/projects/[id]/tags/route.ts` |
| 태그 선생성 후 선택 추가 | 완료 | `app/settings/page.tsx`, `components/tag-manager.tsx` |
| alias 편집/표시/검색 | 완료 | `components/project-list-manager.tsx` |
| CSV Export | 완료 | `components/csv-export-button.tsx` |
| 태그 검색/자동완성 | 부분완료 | 드롭다운 선택은 가능하나 검색형 자동완성은 미구현 |
| MW 의존성 수정 | 미완료 | `Dependencies editor ... will be implemented next` placeholder |
| 태그 색상 기반 노드 컬러 반영 | 미완료 | 그래프 색상은 현재 type 기반 |

### 2.2 Graph View (5.2)

| 요구사항 | 상태 | 근거 |
|---|---|---|
| 프로젝트간 의존성 시각화 | 완료 | `app/graph/page.tsx`, `components/dependency-graph.tsx` |
| pan/zoom/선택 하이라이트 | 완료 | Cytoscape 상호작용 구현 |
| 우클릭 숨김(HIDDEN) | 완료 | `components/dependency-graph.tsx` |
| 검색 하이라이트 | 완료 | `components/dependency-graph.tsx` |
| 승인된 의존성만 표시(approved) | 미완료 | edges 조회에 approved 조건 없음 |
| 프로젝트↔MW 정식 노드/엣지 | 미완료 | `project_middlewares` 미사용 |
| 태그 색상 반영 | 미완료 | type 색상 사용 |

### 2.3 Architecture View (5.3)

| 요구사항 | 상태 | 근거 |
|---|---|---|
| Type 기반 계층 생성 | 완료 | `app/architecture/page.tsx` |
| 계층 순서 설정값 반영 | 완료 | `project_types.sort_order` 사용 |
| Top-down 레이아웃 | 완료 | y좌표 계산 Top-down 반영 |
| PNG Export | 완료 | `components/architecture-graph.tsx` |
| 동적 엣지 필터 (All + 타입별) | 완료 | `components/architecture-graph.tsx` |
| 검색 하이라이트 | 완료 | `components/architecture-graph.tsx` |
| draw.io Export | 미완료 | 기능 없음 |
| MW 블록 크기 조절/저장 | 미완료 | 기능 없음 |

### 2.4 모듈 상세 View / Side Panel (5.4)

| 요구사항 | 상태 | 근거 |
|---|---|---|
| inbound/outbound 목록 표시 | 완료 | `components/project-detail-modal.tsx`, `components/side-panel.tsx` |
| 목록 클릭 시 탐색 | 완료(사이드패널) | 사이드패널에서 `?node=` 이동 |
| Kafka consume/produce 토픽 | 미완료 | `project_topics` 미연결 |
| DB 분류(core/history/mart) | 미완료 | 관련 모델/화면 미구현 |

### 2.5 Kafka View (5.5)

| 요구사항 | 상태 | 근거 |
|---|---|---|
| 토픽 중심 View | 미완료 | `/kafka` 라우트/화면 부재 |

### 2.6 Agent Chat (5.6)

| 요구사항 | 상태 | 근거 |
|---|---|---|
| 채팅 UI + 응답 | 부분완료 | `components/agent-chat.tsx`, `app/api/chat/route.ts` |
| pgvector 기반 RAG | 미완료 | embeddings/pgvector 미활성 |
| 의존성/토픽 기반 정밀 응답 | 미완료 | projects 중심 컨텍스트 |
| deep-link 포함 응답 | 미완료 | 텍스트 응답 중심 |

### 2.7 CLI Sync / 승인 절차 (5.7)

| 요구사항 | 상태 | 근거 |
|---|---|---|
| 신규/업데이트/삭제 동기화 | 부분완료 | `app/api/sync/route.ts` |
| 타입 유효성 보정 | 완료 | Sync 시 invalid type → unknown |
| 의존성 변경 승인큐(change_request) | 미완료 | change_request 생성/처리 없음 |
| 승인 후 반영(approved edge) | 미완료 | 승인 플로우 부재 |

### 2.8 env 기반 의존성 추론 (5.8)

| 요구사항 | 상태 | 근거 |
|---|---|---|
| env 스캔→후보→승인대기→반영 | 미완료 | 관련 파이프라인 미구현 |

---

## 3. 현재 동작 이슈 (구현됐지만 품질/정합 보완 필요)

1. Graph/Architecture에서 `approved` 기준 필터가 없어 미승인 의존성이 표시될 수 있음.
2. 프로젝트 노드 색상은 태그 색상이 아니라 type 색상 기준으로 렌더됨.
3. Type 이름 변경 시 기존 프로젝트 `type` 문자열과 불일치 가능성(마이그레이션 정책 필요).
4. 전체 검증(`tsc`, `next build`)은 로컬 Node ICU 라이브러리 이슈로 현재 수행 불가.

---

## 4. 다음 업무 계획 (우선순위)

## Phase A. 승인 워크플로우 도입 (최우선)

목표
- 의존성 변경은 반드시 승인 후 반영되도록 데이터 흐름 전환

작업
- `change_requests` 생성 API/CLI 연결
- 승인/반려 API 및 간단한 승인 UI 추가
- Graph/Architecture 조회 시 `approved=true` 조건 반영

완료 기준
- 미승인 변경은 시각화에 노출되지 않음
- 승인 후에만 edge 데이터 반영됨

## Phase B. MW 모델링 정식화

목표
- 프로젝트↔MW 관계를 스키마 기반으로 관리

작업
- `middlewares`, `project_middlewares` 조회/편집 API 추가
- List의 Dependencies 메뉴를 실제 편집 UI로 교체
- Graph/Architecture에 MW 노드/엣지 표시

완료 기준
- MW 의존성을 UI에서 편집 가능
- MW 관계가 그래프/아키텍처에 일관 반영

## Phase C. Kafka View 구현 + 관계 뷰 일반화 설계

목표
- 토픽 중심 탐색 제공
- 향후 특정 오브젝트 간 세부 매핑 관계를 공통적으로 표현할 수 있는 구조 확보

작업
- `/kafka` 페이지 추가
- `project_topics` 기반 producers/consumers 목록 구현
- 사이드바 메뉴 활성화
- Object Mapping 추상 모델(`object_type`, `relation_type`) 설계안 작성
- 설계 참고 문서: `docs/2026-02-19_object-mapping-view-ideas.md`
- Kafka View를 해당 추상 모델 위에서 동작하도록 리팩터링 계획 수립

완료 기준
- 토픽 검색 + producer/consumer 탐색 가능
- Kafka 외 object type(DB/API/Queue 등) 확장 시 화면 재사용 전략이 문서화됨

## Phase D. Export 확장

목표
- 문서 공유용 산출물 강화

작업
- Architecture draw.io XML export 구현
- 현재 PNG export와 동일한 필터 상태 반영

완료 기준
- draw.io에서 즉시 import 가능한 파일 생성

## Phase E. Agent Chat 고도화

목표
- 의존성/토픽/구조 질의에 신뢰도 높은 응답

작업
- pgvector 및 embeddings 활성화
- 컨텍스트 소스를 projects + edges + project_topics + change_requests로 확장
- 답변에 deep-link 포함

완료 기준
- 영향도 질의, 토픽 질의, 타입/태그 필터 질의에 근거 기반 응답 제공

## Phase F. Docker화 및 설치형 배포 구조

목표
- 로컬 환경 의존성을 최소화하고 설치 가능한 실행 구조 제공

작업
- `Dockerfile`(app) 및 `docker-compose.yml`(app + optional data volume) 설계
- `.env` 주입/보안 가이드 정리
- PGlite 데이터 볼륨 마운트 정책 수립(백업/복구 포함)
- DB 경로 환경변수(`AKG_DB_PATH`) 및 기본값/검증 정책 정의
- `README`에 Docker 실행/업데이트 절차 추가

완료 기준
- `docker compose up`만으로 앱 실행 가능
- 데이터 영속성 및 환경변수 설정 절차가 문서화됨

---

## 5. 메모

- 본 문서는 2026-02-19 기준 구현 상태 재검토 결과이며, 향후 Phase 진행 시 상태표를 갱신한다.
- 문서 위치 정책에 따라 본 업데이트는 `docs`에 유지한다.
