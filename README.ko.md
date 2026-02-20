# Archi.Navi

> MSA 팀을 위한 살아있는 아키텍처 지도\
> *추측하지 말고, 구조를 직접 확인하세요.*

------------------------------------------------------------------------

## 🚨 이런 고민, 해보신 적 있으신가요?

마이크로서비스를 운영하다 보면 다음과 같은 상황을 자주 겪게 됩니다.

-   이 서비스는 정확히 어떤 서비스를 의존하고 있을까?
-   작은 수정이 왜 예상치 못한 다른 장애로 이어졌을까?
-   문서와 실제 구조가 이미 달라진 건 아닐까?
-   API/MQ/DB 흐름을 한 번에 설명할 수 있을까?

MSA는 문서보다 빠르게 변화합니다.\
그래서 정적인 다이어그램보다 **현재 상태를 반영하는 구조 지도**가
필요합니다.

**Archi.Navi**는 GitHub 조직 기반 레포 구조를 분석하고,\
승인 기반 워크플로우와 함께 탐색 가능한 아키텍처 지도를 제공합니다.

------------------------------------------------------------------------

## 🧩 핵심 개념

Archi.Navi를 처음 사용할 때 아래 용어를 먼저 이해하면 전체 동작이 빠르게
정리됩니다.

-   **Object(오브젝트)**
    Archi.Navi의 통합 모델 단위입니다. 서비스, API 엔드포인트, 데이터베이스,
    테이블, 토픽, 큐 등을 모두 `Object`로 표현합니다.
-   **Service(서비스)**
    `Object` 타입 중 하나(`object_type=service`)이며, 운영 관점의 핵심 경계입니다.
-   **Relation(릴레이션)**
    오브젝트 간 연결 의미입니다. `call`, `read`, `write`, `produce`,
    `consume`, `expose`, `depend_on` 같은 타입으로 구분합니다.
-   **Roll-up View**
    빠른 영향도 분석을 위한 요약 구조 관점입니다.
-   **Roll-down View**
    특정 오브젝트를 기준으로 상세 흐름을 파고드는 관점입니다.
-   **Change Request(승인 큐)**
    자동 추론 결과를 즉시 반영하지 않고, 승인/반려를 거쳐 반영하는 단계입니다.
-   **Evidence(근거)**
    추론된 관계나 AI 응답을 뒷받침하는 근거 정보입니다.
-   **Visibility**
    `VISIBLE` / `HIDDEN`으로 기본 화면 노출 여부를 제어합니다.
-   **Workspace**
    향후 멀티 ORG/레포 확장을 위한 논리적 격리 단위입니다.

이 개념들을 기준으로 보면, Archi.Navi의 화면과 승인 흐름이 훨씬 명확해집니다.

------------------------------------------------------------------------

## 🧭 주요 기능

### 1️⃣ Service Overview

-   서비스 목록 조회 및 검색
-   Alias / Type / Visibility 편집
-   Tag 추가/수정
-   CSV Export

팀 공통 구조 언어를 유지하면서 서비스 정보를 관리할 수 있습니다.

------------------------------------------------------------------------

### 2️⃣ Dependency Graph

-   서비스 의존성 시각화
-   특정 노드 선택 시 Inbound / Outbound 확인
-   검색 기반 하이라이트
-   Visibility(`VISIBLE` / `HIDDEN`) 기반 숨김

릴리스 전 변경 영향 범위를 빠르게 파악할 수 있습니다.

------------------------------------------------------------------------

### 3️⃣ Architecture View + Object Mapping View

-   Architecture View: 상위 roll-up 구조
-   Object Mapping View: drill-down / roll-down 상세 탐색
-   엣지 타입별 필터링
-   PNG Export

전체 구조와 상세 흐름을 같은 제품 안에서 연속적으로 확인할 수 있습니다.

------------------------------------------------------------------------

### 4️⃣ Approval Workflow

-   자동 추론 결과를 `change_requests`에 적재
-   선택 기반 일괄 승인/반려
-   승인 후 관계 반영

자동화의 속도와 운영 데이터 신뢰성을 함께 확보합니다.

------------------------------------------------------------------------

### 5️⃣ AI Chat (evidence 중심)

-   구조 질의 응답
-   confidence + evidence 기반 응답
-   evidence 없는 확정형 답변 금지 정책

------------------------------------------------------------------------

## ✅ 이런 팀에 적합합니다

-   MSA를 실제로 운영 중인 팀
-   여러 레포지토리를 동시에 관리하는 조직
-   변경 영향 분석이 중요한 플랫폼/백엔드 팀
-   신규 온보딩 구조 설명 비용이 큰 팀
-   아키텍처 문서를 최신으로 유지하기 어려운 프로젝트

------------------------------------------------------------------------

## 🏗 레포 구조

```text
apps/
  web/                 # Next.js UI
packages/
  core/                # object/relation 모델, roll-up
  inference/           # 추론 파이프라인 + AST 플러그인 뼈대
  cli/                 # sync/status/approvals/up 명령
  config/              # 공통 설정/github 유틸
```

------------------------------------------------------------------------

## 🛠 기술 스택

-   Next.js (App Router)
-   React + TypeScript
-   Cytoscape.js (Graph 시각화)
-   PGlite (로컬 Postgres 호환 DB)
-   Radix UI
-   Sonner

------------------------------------------------------------------------

## 🚀 실행 방법

### 1. 의존성 설치

```bash
pnpm install
```

### 2. 개발 서버 실행

```bash
pnpm dev
```

브라우저에서 다음 주소로 접속합니다:

    http://localhost:3000

------------------------------------------------------------------------

## 🧑‍💻 CLI 사용

```bash
pnpm cli sync <org>
pnpm cli status
pnpm cli approvals list
pnpm cli approvals apply --all --dry-run
pnpm cli up
```

패키지 실행 형태:

```bash
npx archi-navi up
```

`.env` 예시:

```env
GITHUB_TOKEN=your_token
GITHUB_ORG=your_org
OPENAI_API_KEY=your_openai_key
ARCHI_NAVI_DB_PATH=data/akg-db
```

------------------------------------------------------------------------

## 🗄 데이터 및 스키마

-   기본 DB 경로: `data/akg-db`
-   경로 오버라이드: `ARCHI_NAVI_DB_PATH` (또는 `AKG_DB_PATH`)
-   스키마: `scripts/schema.sql`

------------------------------------------------------------------------

## 📚 제품 문서

-   PRD: `docs/prd/PRD.md`
-   Object Model Spec: `docs/spec/object-model-definition.md`
-   Implementation Spec: `docs/spec/2026-02-20_implementation-spec-core-api.md`
-   마스터 로드맵: `docs/tasks/2026-02-20_master-roadmap-and-task-breakdown.md`

------------------------------------------------------------------------

## 📌 한 줄 요약

> Archi.Navi는 정적 문서가 아니라,\
> **MSA 운영을 위한 실전 아키텍처 내비게이션 도구**입니다.
