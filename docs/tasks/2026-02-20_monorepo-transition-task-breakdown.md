# Archi.Navi 모노레포 전환 세부 Task

작성일: 2026-02-20
참조 설계: [`../design/2026-02-20_monorepo-transition-design.md`](../design/2026-02-20_monorepo-transition-design.md)

## Phase 1. 워크스페이스 구성

## T1-1 pnpm workspace 도입
- [x] `pnpm-workspace.yaml` 추가
- [x] `apps/*`, `packages/*` 경로 정의

## T1-2 기본 디렉토리 생성
- [x] `apps/web` 생성
- [x] `packages/core`, `packages/inference`, `packages/cli`, `packages/config` 생성

## T1-3 루트 스크립트 정리
- [x] 루트 `package.json`에 workspace orchestration 스크립트 추가
- [x] 기존 실행 커맨드 backward compatibility 유지

---

## Phase 2. Core 분리

## T2-1 모델/타입 이동
- [x] object/relation 타입 정의를 `packages/core`로 이동
- [x] 웹/CLI에서 공통 타입 import 전환

## T2-2 롤업 엔진 이동
- [x] materialized roll-up 계산 로직 이관
- [x] derived relation 필드(`is_derived` 등) 처리 통합

## T2-3 계약 테스트
- [ ] core validation unit test 추가
- [ ] relation 제약 테스트 추가

---

## Phase 3. Inference 분리

## T3-1 language-agnostic 추론 모듈 이관
- [x] 현재 추론 로직을 `packages/inference`로 이동
- [x] 승인 큐 payload schema 고정

## T3-2 AST 플러그인 구조화
- [x] Java/Kotlin 플러그인 뼈대
- [x] TS/JS 플러그인 뼈대
- [x] Python 플러그인 뼈대

## T3-3 추론 결과 검증
- [ ] confidence/evidence 필드 필수화
- [ ] 승인 전 반영 금지 규칙 테스트

---

## Phase 4. CLI 패키지화

## T4-1 CLI 독립 패키지 정리
- [x] `packages/cli`에서 실행 가능하도록 엔트리/tsconfig 구성
- [x] `bin` 엔트리(`archi-navi`) 설정

## T4-2 승인 커맨드 보강
- [x] 선택 목록 기반 일괄 승인/반려 명령 추가
- [x] dry-run/preview 옵션 추가

## T4-3 배포 준비
- [ ] npm publish metadata 정리
- [x] macOS/Linux 실행 검증

---

## Phase 5. UI 포함 실행 배포

## T5-1 Web standalone 산출물
- [ ] `apps/web` 빌드 산출물 전략 확정
- [ ] CLI에서 실행 가능한 형태로 패키징

## T5-2 `npx archi-navi up` 구현
- [x] DB 경로 환경변수 검증
- [x] 웹 서버 기동/종료 관리
- [x] 실행 URL 출력

## T5-3 문서/운영
- [ ] npm 실행 가이드 작성
- [ ] Docker 병행 가이드 작성

---

## 공통 검증

- [ ] 기존 기능 회귀 테스트(그래프/승인/채팅/설정)
- [ ] Roll-up 2,000 edges 목표에 대한 성능 점검
- [ ] Object Mapping drill-down UX 점검

---

## 현재 메모 (2026-02-20)

- `apps/web` 물리 이관 완료
- `packages/cli up`는 `next` 바이너리를 직접 실행해 UI 기동

---

## 요청 기반 실행 태스크 (2026-02-20)

## Task 1. 웹 앱 물리 이관 + 브랜딩 반영
- [x] 루트 Next.js 리소스(`app`, `components`, `public`, 설정 파일) `apps/web`로 이동
- [x] 웹 워크스페이스 스크립트를 독립 실행 형태(`next dev/build/start`)로 전환
- [x] 브랜딩 표기 `ARCHI.AI` -> `Archi.Navi` 변경

## Task 2. npm 실행형 배포 정리
- [x] 루트 패키지 `bin`/`publishConfig`/`files` 메타데이터 정리
- [x] `up` 명령을 `pnpm` 의존 없이 `next` 직접 실행 방식으로 전환
- [x] `npm pack --dry-run` 결과 검토 후 포함 파일 범위 최종 확정
