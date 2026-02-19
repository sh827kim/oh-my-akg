# 요구사항 분석서: Module Health Radar + Architecture Knowledge Graph (확장 요구 반영)

작성일: 2026-02-19

---

## 0. 한 줄 요약

- **CLI로 GitHub Org 레포를 동기화**하고(신규/삭제 즉시 반영, 의존성 변경은 승인 절차),
- **로컬 DB(PGlite + pgvector)** 에 메타데이터를 저장,
- **목록/그래프/아키텍처/카프카** 뷰로 시각화하며,
- **표출/미표출(숨김) + 태그/색상 + 별칭 + MW 의존성 편집 + CSV/PNG/draw.io export**까지 제공하고,
- **Agent Chat**이 “내 프로젝트/의존성/아키텍처”를 질의응답으로 안내하는 툴.

---

## 1. 용어/정의

- **프로젝트(Project)**: GitHub Enterprise의 하나의 repository를 기본 단위로 보되, 필요하면 “서비스/모듈/패키지”를 하위 레벨로 확장 가능.
- **표출(Visible) / 미표출(Hidden)**:
  - Visible: 목록/그래프/아키텍처 등 모든 UI에서 노출
  - Hidden: **Graph View, Architecture View에서 무조건 미노출** (요구사항)
  - 단, Hidden 프로젝트도 데이터는 저장(나중에 되살리기 가능) 가능.
- **태그(Tag)**: 프로젝트에 다중 부여 가능. 태그별 색상 지정 가능.
- **MW(Middleware)**: Kafka/DB/Redis/Elastic/Storage/Observability 등 인프라 구성요소를 의미. 그래프/아키텍처에서 별도 노드(블록)로 표현.
- **의존성(Dependency)**:
  - 프로젝트 ↔ 프로젝트: env 기반 런타임 추론 (api 기반 호출)
  - 프로젝트 ↔ MW: 사용 여부(정적 분석/추론/수동편집 기반)
- **동기화(Sync)**: GitHub Org의 레포 목록 및 “의존성 관련 메타”를 갱신하는 CLI 작업.
- **승인(Approval)**: 자동 추론된 변경(특히 의존성 변경)을 UI에서 사용자가 승인해야 반영되는 워크플로우.

---

## 2. 제품 목표(Goal)

1) 조직의 **프로젝트 인벤토리**를 “지속적으로 최신 상태”로 유지  
2) 프로젝트간/프로젝트↔MW 관계를 한 눈에 파악  
3) “숨김/태그/색상/별칭”으로 팀 상황에 맞게 의미를 부여  
4) 의존성 자동 추론을 하되, **최종 진실은 사람이 승인**  
5) export(CSV/PNG/draw.io)로 문서/보고/공유 비용 최소화  
6) Agent Chat으로 “구조 질문/영향 분석/토픽 소비자” 같은 질의응답을 빠르게 처리

---

## 3. 비목표(Non-goal) - 1차 범위에서 제외(권장)

- 소스코드 전문(전체 파일) 저장/검색(보안/용량 이슈)  
- 런타임 tracing(분산추적) 기반 의존성 자동 인퍼런스(난이도↑)  
- 중앙 서버 운영(로컬 퍼스트 유지)  
- 자동 PR 생성 및 자동 머지(조직 정책에 따라 2차)

---

## 4. 사용자/권한 모델(로컬 앱 기준)

### 사용자 역할(논리적)
- **Viewer**: 조회/탐색/Export
- **Editor**: 태그/색상/별칭/표출여부/의존성(MW 포함) 편집
- **Approver**: CLI Sync로 올라온 “의존성 변경 후보” 승인/반려

> 실제로는 로컬 앱이라 계정 시스템 없이 “로컬 사용자=Editor/Approver”로 시작해도 되는데, 팀 협업을 위해 Base Registry(공유 레포)를 쓰면 Approver 개념이 자연스레 생김.

---

## 5. 요구사항 상세 분석

# 5.1 프로젝트 목록 관리(View: List)

### 5.1.1 표출/미표출(숨김)
- 프로젝트마다 `visibility = VISIBLE | HIDDEN`
- HIDDEN이면:
  - **Graph View / Architecture View에서 무조건 미표출**
  - List View에서는 기본은 표시하되(관리 목적), 필터로 숨김 가능
- 우클릭/버튼으로 즉시 토글(요구사항 5.2.5와 연결)

### 5.1.2 다중 태그
- 프로젝트는 태그를 여러 개 가질 수 있음(다대다)
- UI:
  - 태그 추가/삭제
  - 태그 검색/자동완성

### 5.1.3 태그별 색상
- 태그에는 `color` 속성이 있음 (예: HEX)
- 그래프/아키텍처에서 노드 색상 규칙:
  - 기본: “태그 우선순위” 또는 “대표 태그 1개 선택”
  - 다중 태그일 때:
    - (옵션 A) 대표 태그 1개만 적용(가장 단순/일관)
    - (옵션 B) 테두리/배지로 여러 태그 표현(시각 복잡도↑)

### 5.1.4 MW 의존성 수정 가능
- 자동 추출/추론된 MW 태그를 사용자가 수정 가능
- 편집은 “수동 override”로 저장되어, 이후 sync에서 덮어쓰지 않도록 정책 필요(8절)

### 5.1.5 Name Alias
- `display_name`(alias)을 프로젝트에 부여 가능
- 기본은 repo name이지만, 화면/다이어그램에서는 alias 우선 표기
- 검색은 repo name, alias 둘 다 가능해야 함

### 5.1.6 CSV Export
- List View에서 선택/필터 결과를 CSV로 export
- 컬럼 예시:
  - repo_name, alias, type(BE/FE), visibility, tags, mw_tags, last_seen_at, risk_score, inbound_count, outbound_count

---

# 5.2 Graph View

### 5.2.1 프로젝트간 의존성
- 노드: 프로젝트
- 엣지: 프로젝트→프로젝트 (build 의존 + 승인된 env 추론 의존)
- 방향성은 “의존하는 쪽 → 의존되는 쪽” (정의 고정)

### 5.2.2 MW 와의 의존성
- 노드: MW
- 엣지: 프로젝트→MW (사용/연결)
- 예: `order-service → kafka`, `order-service → postgres`

### 5.2.3 Obsidian 스타일(반응형/유연)
- 자유로운 pan/zoom
- 드래그로 노드 이동
- 선택/하이라이트(연결된 이웃 강조)
- 레이아웃 자동 정렬(옵션: force-directed)

### 5.2.4 태그 색상 반영
- 프로젝트 노드 색상은 태그 색상을 적용
- MW 노드는 별도 색상 정책(고정 팔레트 또는 MW 타입별 아이콘)

### 5.2.5 우클릭 → 미표출
- 컨텍스트 메뉴:
  - “미표출로 전환” 클릭 시 `visibility=HIDDEN`
  - 즉시 그래프에서 제거(즉시 반영)
- 숨김 취소는 List View 또는 Side Panel에서 가능

---

# 5.3 아키텍처 View

### 5.3.1 Export
- draw.io export: `.drawio` 형태로 내보내기(가능하면 XML)
- png export: 현재 화면을 이미지로 내보내기

### 5.3.2 MW 블록 사이즈 조절
- MW 노드(블록)에는 `width/height` 혹은 `size` 속성이 있어야 함
- 사용자 조절값은 로컬 DB에 저장(프로젝트마다/뷰마다 정책 결정 필요)
  - 권장: “아키텍처 뷰 레이아웃 설정” 테이블에 저장

### 5.3.3 Top-down flow
- 고정된 레이어/수직 흐름 레이아웃 지원
- 기본 제시 흐름:
  - `Kafka → Mediation → DB/Redis → API → BFF/API-GW → FE`
- 의미:
  - 레이어별로 블록이 모이고, 프로젝트들은 해당 레이어에 자동 배치되거나 사용자가 배치 조정

### 5.3.4 레이어 분류 규칙(초기안)
- FE: frontend
- API-GW/BFF: gateway/bff 태그 기반
- API: 일반 backend 서비스
- DB/Redis: middleware
- Mediation: integration/stream processor 등 태그 기반
- Kafka: middleware

---

# 5.4 모듈별 상세 View (Side Panel)

### 트리거
- Graph View / Architecture View / List View에서 노드 클릭 → 오른쪽 Side Panel 오픈

### 5.4.1 inbound/outbound 모듈
- inbound: 나를 의존하는(나를 참조하는) 프로젝트 목록
- outbound: 내가 의존하는 프로젝트 목록
- 각 리스트는 클릭해서 그래프에서 하이라이트/센터 이동 가능

### 5.4.2 Kafka consume/produce 토픽
- 프로젝트가 consume/produce 하는 토픽 리스트 표시
- 추출 방법:
  - 1차(MVP): 정적 패턴 기반(예: `@KafkaListener`, `KafkaTemplate.send`, config key)
  - 2차: 운영 설정/manifest 기반 + 승인된 메타

### 5.4.3 DB 분류(core/history/mart 등 다중)
- 프로젝트별로 DB “카테고리”를 여러 개 가질 수 있음
- 데이터 모델:
  - project_db_usage: repo_id, db_category(core|history|mart|...), evidence/override

---

# 5.5 Kafka View

### 목적
- 토픽 중심으로 consume/produce 모듈을 탐색

### 기능
- 토픽 리스트(검색/필터)
- 토픽 선택 시:
  - producers(프로젝트 목록)
  - consumers(프로젝트 목록)
- 토픽별 영향 범위 탐색(옵션)

### 5.5.1 일반화 방향 (확장 요구)

- Kafka 전용 화면을 장기적으로 **Object Mapping View**로 일반화한다.
- 핵심 아이디어:
  - “프로젝트 ↔ 특정 오브젝트(토픽/DB테이블/API/큐/캐시키)” 관계를 공통 모델로 표현
  - Kafka는 Object Type 중 하나(`kafka_topic`)로 취급
- 공통 관계 타입 예시:
  - `produce`, `consume`, `publish`, `subscribe`, `read`, `write`, `call`, `depend_on`
- 기대 효과:
  - Kafka 외에도 DB/API/Queue의 세부 매핑을 같은 UX로 탐색 가능
  - 신규 기술 도입 시 뷰를 다시 만들지 않고 object type만 추가하면 확장 가능

---

# 5.6 Agent Chat

### 목적
- 프로젝트/의존/토픽/아키텍처 정보를 질의응답

### 입력 예시
- “A 서비스가 쓰는 Kafka 토픽 뭐야?”
- “B 모듈 업그레이드하면 영향 받는 모듈 뭐야?”
- “Redis 쓰는 백엔드만 보여줘”

### 동작
- Agent는 pgvector 기반으로:
  - 프로젝트 설명/태그/의존성/evidence/변경 이력(스냅샷)에서 컨텍스트 검색
- 답변은:
  - 텍스트 + 관련 노드/뷰로 이동하는 deep-link(로컬 라우트) 제공

---

# 5.7 CLI (Sync)

### 공통 요구
- GitHub org 기반 repo sync
- private repo 포함 (인증: gh/PAT)
- 결과는 로컬 DB 갱신 + “승인 대기 큐” 생성

### 5.7.1 신규 repo (즉시 반영)
- 새 repo 발견 시 즉시 DB 등록
- type 자동 분류(backend/frontend/python 등)
- visibility 기본값 정책 필요(권장: visible)

### 5.7.2 의존성 변경 repo (승인 절차)
- 스캔 결과가 기존 저장값과 다르면:
  - 변경사항을 change_request로 저장
  - UI에서 diff 확인 후 승인/반려
  - 승인되면 edge/mw_tag 업데이트

### 5.7.3 삭제 repo (즉시 반영)
- org에서 repo가 사라지거나 접근 불가면:
  - 즉시 `status=DELETED`
  - 그래프/아키에서 숨김 처리
  - 히스토리 유지

---

# 5.8 env 기반 의존성 자동 매핑 추론

### 목표
- env 설정에서 런타임 의존성을 추론

### 추론 대상 예시
- `*_URL`, `*_HOST`, `*_ENDPOINT`, `SPRING_*`, `KAFKA_*`, `REDIS_*`, `DB_*`
- k8s manifest/helm values/docker-compose env

### 절차
1) CLI가 설정파일에서 env 키 후보를 스캔
2) taxonomy 규칙으로 매핑 후보 생성
3) 후보는 무조건 승인 대기 등록
4) 사용자가 승인 시 edge/MW tag 반영
5) 수동 편집(override) 가능

---

# 5.9 PGlite + pgvector

- 로컬 퍼스트에 적합
- 별도 설치 부담 낮음
- pgvector로 Agent Chat RAG 가능

저장 대상:
- 프로젝트/태그/색상/별칭/표출여부
- 그래프 edges
- MW 태깅
- Kafka 토픽 메타
- change_request(승인)
- 임베딩(프로젝트 설명/근거 텍스트)

---

# 5.10 배포/운영 (Docker 설치형 고려)

- 본 프로젝트는 향후 Docker 기반 설치형 배포를 지원해야 한다.
- 컨테이너 실행 시, 로컬 DB 저장 경로는 환경변수로 주입 가능해야 한다.
  - 예시: `AKG_DB_PATH` (컨테이너 내부 경로), `AKG_DB_VOLUME` (호스트 볼륨 매핑 기준)
- 요구사항:
  - DB 경로 미지정 시 기본값으로 안전한 경로 사용
  - 경로 유효성 검사 및 초기 디렉터리 자동 생성
  - `docker-compose`에서 `.env` 기반 설정 가능



---

## 6. 데이터 모델(요구사항 충족 관점) - 초안

### 핵심 엔티티
- project(id, repo_full_name, repo_url, type, visibility, alias, status, last_seen_at)
- tag(id, name, color_hex)
- project_tag(project_id, tag_id)
- middleware(id, name, kind)
- edge(from_id, to_id, edge_type, confidence, evidence_text, source, approved, created_at)
- kafka_topic(id, name)
- project_kafka(project_id, topic_id, direction, evidence, source, approved)
- project_db_category(project_id, category, evidence, source, approved)
- change_request(id, project_id, change_type, before_json, after_json, diff_summary, status, created_at, decided_at)

### 숨김 정책
- Graph/Architecture는 `visibility=visible AND status=active`만 렌더
- List는 기본 visible만 보여주되 “숨김 포함” 토글 제공

---

## 7. 덮어쓰기/우선순위 정책(자동 vs 수동)

우선순위(권장):
1) Manual override(사용자 편집)
2) Approved inference(승인된 자동 추론)
3) Static scan(정적 스캔)
4) Heuristic guess(낮은 신뢰)

구현:
- 각 항목(edge/mw/topic/db)에 `source`, `approved`, `confidence` 저장
- UI에서 “근거(evidence)”를 보여줘야 신뢰도가 생김

---

## 8. Export 요구사항 정리

- List: CSV export
- Architecture: PNG export, draw.io(.drawio) export

---

## 9. 위험요소/결정 포인트

1) GitHub Enterprise rate limit → file fetching 전략 필요  
2) Gradle 복잡 파싱 → 정적 파싱 + (선택) CI 리포트 전략  
3) env 기반 추론 정확도 → 승인 절차 필수  
4) Obsidian급 그래프 UX → 노드 수 증가 시 성능 최적화 필요  
5) draw.io export → MVP는 기본 도형/연결 위주로 시작 권장

---

## 10. MVP 범위 제안

- MVP-1: List(태그/색/별칭/숨김/CSV) + Graph(project+MW) + Side Panel(in/out+MW) + CLI(sync/승인큐)
- MVP-2: Architecture(top-down) + PNG + Kafka View
- MVP-3: env 추론 후보 + 승인 + Agent Chat(pgvector)

---


