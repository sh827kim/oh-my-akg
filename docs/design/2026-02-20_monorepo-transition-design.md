# Archi.Navi 모노레포 전환 설계서

작성일: 2026-02-20

## 1. 목표

- 단일 패키지 구조를 모노레포로 전환해 모델/추론/UI/CLI 경계를 분리한다.
- UI 포함 npm 배포를 `CLI 실행형 배포`로 실현한다.
- 기존 기능 동작을 유지한 상태에서 점진적으로 이전한다.

## 2. 설계 원칙

1. 동작 동일성 우선: 기능/데이터 모델을 유지한 채 구조만 분리
2. 계약 우선: Object/Relation spec 고정 후 코드 이동
3. 점진 전환: Phase 단위로 리스크를 분리
4. 실행 엔트리 분리: CLI와 Web 런타임을 독립 관리

## 3. 목표 구조

```text
/apps
  /web                 # Next.js UI
/packages
  /core                # object model, relation model, roll-up logic, shared types
  /inference           # auto inference pipeline, AST plugins
  /cli                 # sync/approval/status commands
  /config              # shared config loader (env, paths)
```

선택 확장:

- `/packages/ui-kit`: UI 공통 컴포넌트 분리 필요 시 도입

## 4. 패키지 책임 경계

## 4.1 packages/core

- `objects`, `object_relations`, roll-up 계산 로직
- derived relation 처리(`is_derived`, `derived_from_relation_id`)
- relation/object validation

## 4.2 packages/inference

- Language-agnostic 추론
- AST 플러그인(1차: Java/Kotlin, TS/JS, Python)
- inference 결과를 승인 큐 payload 형태로 생성

## 4.3 packages/cli

- `sync`, `status`, `approvals` 등 실행 명령
- 일괄 승인 실행 옵션(선택 목록 기반)
- npm 배포 패키지의 `bin` 엔트리 제공

## 4.4 apps/web

- Graph + Object Mapping View(단일 drill-down/roll-down UX)
- 승인 UI(전체 선택/부분 해제/일괄 승인)
- Slack 스타일 workspace switch UX

## 5. npm 배포 설계(UI 포함)

## 5.1 권장 모델

- 배포 대상: `@archi-navi/cli`
- 실행 방식: `npx archi-navi up`
- CLI가 수행:
  - 환경변수/DB 경로 검증
  - Web 서버 실행(standalone 빌드 산출물)
  - 접속 URL 출력

## 5.2 보조 모델

- Docker 이미지 병행 제공(`npm`은 빠른 시작, `docker`는 재현성/운영성)

## 5.3 필수 조건

1. DB 경로 환경변수화 (`AKG_DB_PATH` or `ARCHI_NAVI_DB_PATH`)
2. Web standalone 빌드 산출물 생성 전략
3. CLI에서 Web 실행 프로세스 관리(시작/중지/포트)

## 5.4 현재 구현 상태(2026-02-20)

- `@archi-navi/cli`에 `up` 명령 구현 완료
- `up`은 `HOSTNAME`/`PORT`/`ARCHI_NAVI_DB_PATH`를 주입하여 web 실행
- `apps/web` 물리 이관 완료(`app`, `components`, `public`, Next 설정)
- `up`은 `pnpm` 의존 없이 `next` 바이너리를 직접 실행
- 빌드 안정성을 위해 `next build --webpack` 사용
- `packages/inference`에 Java/Kotlin, TS/JS, Python 플러그인 뼈대 추가

## 6. 마이그레이션 단계

## Phase 1. 워크스페이스 부트스트랩

- pnpm workspace 설정
- 기존 코드 경로를 유지한 채 build/test 파이프라인만 분리

## Phase 2. core 분리

- 모델/롤업/검증 로직을 `packages/core`로 이동
- `apps/web`, `packages/cli`가 core를 참조하도록 변경

## Phase 3. inference 분리

- 추론 파이프라인과 AST 플러그인 이관
- 승인 큐 payload 계약 고정

## Phase 4. cli 패키지화

- 실행 엔트리/옵션 정리
- `@archi-navi/cli` publish 준비

## Phase 5. UI 포함 실행 배포

- `npx archi-navi up` 구현
- 로컬 실행 UX/문서화

## 7. 리스크 및 대응

1. 경계 분리 중 import 순환 발생
- 대응: core -> inference -> cli/web 단방향 의존 규칙

2. 이전 중 API 계약 변동
- 대응: spec 기반 계약 테스트 선행

3. 배포 패키지 크기 증가
- 대응: standalone 최적화 + optional install 전략

## 8. 완료 기준

- 모노레포 구조에서 web/cli/core/inference가 독립 빌드 가능
- 추론 -> 승인 -> 반영 -> 시각화 플로우 동일 동작
- `npx archi-navi up`로 UI 실행 가능
