# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

**Archi.Navi** - MSA 팀을 위한 살아있는 아키텍처 맵 도구. GitHub 저장소를 분석하여 탐색 가능한 서비스 의존성 그래프를 생성하고, 추론된 아키텍처 변경에 대한 승인 워크플로우를 제공한다.

## 모노레포 구조

```
apps/web/          # Next.js 웹 앱 (App Router)
packages/
  core/            # 오브젝트/릴레이션 모델, DB 접근, 롤업 로직
  inference/       # AST 플러그인 기반 추론 파이프라인
  cli/             # CLI 커맨드 구현체
  config/          # GitHub API 유틸리티
scripts/           # 검증 스크립트 및 schema.sql
docs/              # PRD, SPEC, DESIGN, TASK 문서
```

패키지 참조 시 `@archi-navi/*` path alias 사용 (tsconfig에 정의됨).

## 주요 명령어

```bash
pnpm install          # 의존성 설치

# 개발
pnpm dev              # 웹앱 개발 서버 (localhost:3000)
pnpm cli              # CLI 개발 모드 (ts-node)

# 빌드
pnpm build            # Next.js 프로덕션 빌드

# 린트
pnpm lint             # ESLint (웹앱)

# 타입 체크 (구조 변경 시 필수)
npx tsc --noEmit

# CLI 검증
pnpm cli --help
pnpm cli status

# 검증 스크립트
pnpm verify:legacy-sql              # 레거시 테이블 사용 여부 검사
pnpm verify:task1-5:smoke           # 오브젝트 모델 스모크 테스트
pnpm verify:task1-5:integrity       # 오브젝트 모델 무결성 검사
pnpm verify:task2-4:approval-gate   # 승인 워크플로우 테스트
pnpm verify:task2-7:inference       # 추론 파이프라인 테스트
pnpm verify:task2-8:benchmark       # 추론 성능 벤치마크
```

## 환경 변수

```env
GITHUB_TOKEN=        # GitHub API 인증 (없으면 gh auth token 폴백)
GITHUB_ORG=          # GitHub 조직명
OPENAI_API_KEY=      # AI 채팅 기능 (선택)
ARCHI_NAVI_DB_PATH=data/akg-db  # DB 파일 경로 (또는 AKG_DB_PATH)
```

## 핵심 아키텍처

### 데이터 모델

**Object**: 모든 엔티티를 단일 타입으로 통합 (`service`, `api_endpoint`, `database`, `topic`, `queue` 등)

**Relation**: 7가지 타입 (`call`, `expose`, `read`, `write`, `produce`, `consume`, `depend_on`)으로 서비스 간 의존성 표현. 모든 릴레이션은 confidence 점수(0.0–1.0)와 evidence를 가짐.

**Change Request**: 릴레이션은 직접 생성되지 않고 `PENDING` → `APPROVED`/`REJECTED` 흐름의 변경요청으로 관리됨. 소스: `manual`, `scan`, `inference`, `rollup`

**Workspace 격리**: 모든 쿼리는 `workspace_id`로 필터링됨 (기본값: `'default'`)

### DB (PGlite)

인프로세스 Postgres 호환 DB. 스키마 정의 소스: `scripts/schema.sql`

레거시 테이블(`projects`, `edges`, `project_tags`) 접근 시 런타임 에러 발생 — 의도된 보호 장치임.

승인된 릴레이션 조회 시 `approved_object_relations` 뷰 사용.

### 추론 파이프라인 흐름

```
GitHub 저장소
  → fetchRepos() (Octokit)
  → envAutoMapping() + AST 플러그인 (Java/Kotlin, Python, TypeScript)
  → MappingCandidate[] (confidence, evidence 포함)
  → Change Requests (PENDING)
  → 승인 큐 UI
  → object_relations (approved=TRUE)
```

### 웹 앱 라우트

| 경로 | 설명 |
|------|------|
| `/` | 서비스 목록 (카드/리스트 전환) |
| `/graph` | Cytoscape.js 의존성 그래프 |
| `/architecture` | 롤업 아키텍처 뷰 |
| `/approvals` | 변경요청 승인 큐 |
| `/settings` | 타입/태그/가시성 설정 |

### CLI 커맨드

| 커맨드 | 설명 |
|--------|------|
| `sync <org>` | GitHub 저장소 동기화 + 추론 실행 + 변경요청 생성 |
| `status` | DB 상태 및 대기 중 승인 현황 표시 |
| `approvals list` | 대기 중인 변경요청 목록 |
| `approvals apply` | 변경요청 일괄 승인/거부 (`--all`, `--dry-run` 지원) |
| `up` | sync + inference + approvals 전체 파이프라인 |

## 작업 규칙 (AGENTS.md 요약)

- **브랜치**: `codex/<task-name>` 형식, Task 단위로 분리
- **커밋**: 한국어 메시지, 변경 의도 명확히
- **구조 변경 후 최소 검증**: `tsc`, `pnpm cli --help`
- **문서**: 작업 시작 전 `docs/` 확인, 완료 후 관련 문서 업데이트
- **패키지 위치**: CLI → `packages/cli`, 웹 → `apps/web`, 루트에 중복 엔트리 금지
- **`main` 브랜치에 직접 커밋 금지**
