# Archi.Navi Documentation

이 디렉토리는 목적별 문서를 분리해 관리한다.

## 문서 체계

- [`./prd`](./prd)
  - 제품 요구사항(PRD), 목표/범위/비목표/성공지표
- [`./spec`](./spec)
  - 모델/스키마/계약/정책 같은 정형 명세
- [`./design`](./design)
  - 아키텍처 설계, 전환 전략, 기술 의사결정 설계안
- [`./tasks`](./tasks)
  - 실행 계획, 단계별 체크리스트, 진행 상태 문서

## 운영 원칙

1. 요구사항 변경은 먼저 [`./prd`](./prd)에 반영한다.
2. 구현 계약 변경은 [`./spec`](./spec)을 갱신한 뒤 진행한다.
3. 구조/전환 방법은 [`./design`](./design)에 기록한다.
4. 실제 실행 단계와 상태는 [`./tasks`](./tasks)에서 관리한다.
5. 문서 파일명은 `YYYY-MM-DD_slug.md` 형식을 권장한다.

## 현재 핵심 문서

- PRD: [`./prd/PRD.md`](./prd/PRD.md)
- Object Model Spec: [`./spec/object-model-definition.md`](./spec/object-model-definition.md)
- Implementation Spec: [`./spec/2026-02-20_implementation-spec-core-api.md`](./spec/2026-02-20_implementation-spec-core-api.md)
- 합의/의사결정: [`./spec/2026-02-20_feasibility-and-decision-questions.md`](./spec/2026-02-20_feasibility-and-decision-questions.md)
- 레포/배포 검토: [`./design/2026-02-20_repo-structure-and-npm-distribution-review.md`](./design/2026-02-20_repo-structure-and-npm-distribution-review.md)
- 모노레포 전환 설계: [`./design/2026-02-20_monorepo-transition-design.md`](./design/2026-02-20_monorepo-transition-design.md)
- 마스터 로드맵: [`./tasks/2026-02-20_master-roadmap-and-task-breakdown.md`](./tasks/2026-02-20_master-roadmap-and-task-breakdown.md)
