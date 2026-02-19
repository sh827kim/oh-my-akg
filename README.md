# OH-MY-AKG

Module Health Radar + Architecture Knowledge Graph를 위한 로컬 우선(Local-first) 분석 도구입니다.

- GitHub 조직 레포를 동기화하고
- 프로젝트/의존성 데이터를 로컬 DB(PGlite)에 저장하며
- Overview / Dependency Graph / Architecture 화면에서 구조를 탐색합니다.

## 핵심 목적

이 프로젝트의 1차 목표는 다음입니다.

1. 프로젝트 인벤토리를 최신으로 유지
2. 프로젝트 간 의존성과 계층 구조를 시각적으로 파악
3. Type/Tag/Alias/Visibility로 실무 관점의 분류 제공
4. 향후 승인 기반 의존성 관리와 Agent 질의응답으로 확장

## 현재 주요 기능

- Overview
  - 프로젝트 목록 조회/검색
  - Alias, Type, Visibility 편집
  - 태그 추가/삭제
  - CSV Export
- Dependency Graph
  - 프로젝트 의존성 시각화
  - 노드 선택/하이라이트
  - 검색어 기반 노드 하이라이트
  - 우클릭 숨김(HIDDEN)
- Architecture
  - Settings의 Type/순서 기반 Top-down 계층 뷰
  - 엣지 타입별 토글(All + 동적 타입)
  - PNG Export
- Settings
  - Type 추가/수정/활성화/삭제/순서 조정
  - Tag 추가/수정/삭제

## 기술 스택

- Next.js (App Router)
- React + TypeScript
- Cytoscape.js (Graph 시각화)
- PGlite (로컬 Postgres 호환 DB)
- Radix UI, Sonner

## 실행 방법

### 1) 의존성 설치

```bash
pnpm install
```

### 2) 개발 서버 실행

```bash
pnpm dev
```

브라우저에서 `http://localhost:3000` 접속

## CLI 사용

기본 CLI 명령:

```bash
pnpm cli sync <org>
pnpm cli status
```

환경변수(`.env`) 예시:

```bash
GITHUB_TOKEN=your_token
GITHUB_ORG=your_org
OPENAI_API_KEY=your_openai_key
```

## 데이터/스키마

- DB 파일 경로: `data/akg-db`
- 스키마: `scripts/schema.sql`

## 문서

- PRD: `PRD.md`
- 요구사항 갭/실행 계획: `docs/2026-02-19_requirements-gap-and-plan.md`

## 해야 할 일 (요약)

- 승인 워크플로우(change_request) 도입
- MW(미들웨어) 관계 모델링 고도화
- Kafka View 구현
- draw.io Export 구현
- Agent Chat RAG 고도화
- Docker화 및 설치 가능한 배포 구조 설계/구현
