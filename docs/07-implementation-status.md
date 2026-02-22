# Archi.Navi — 설계 대비 구현 현황 (v2)

> 최종 점검일: 2026-02-22
> 점검 대상: 16개 설계 문서 (docs/00~06 + archive/ 9개)
> 참조: 03-inference-engine.md v3.0 기준

## 전체 요약

| 영역 | ✅ 완전 | ⚠️ 부분 | ❌ 미구현 | 충족률 |
|------|---------|---------|----------|--------|
| PRD (00-overview) | 6 | 2 | 0 | 88% |
| 추론 엔진 (03) | 4 | 2 | 7 | 31% |
| 쿼리 엔진 (04) | 7 | 1 | 0 | 94% |
| 롤업/그래프 (05) | 3 | 2 | 1 | 67% |
| 데이터 모델 (02) | 5 | 0 | 0 | 100% |
| AI Reasoning | 1 | 1 | 3 | 30% |
| 아키텍처 (01) | 5 | 0 | 0 | 100% |
| **합계** | **31** | **8** | **11** | **67%** |

---

## 1. PRD (00-overview.md)

| 항목 | 상태 | 비고 |
|------|------|------|
| Roll-up/Roll-down 시각화 | ✅ | Cytoscape + COMPOUND roll-down + 5단계 뷰 레벨 |
| Architecture View (레이어드) | ✅ | 레이어 DnD 관리 + Object 배치 + PNG Export |
| Service List + CSV Export | ✅ | Grid/List 뷰 + 검색 + 필터 + CSV 내보내기 |
| Tag/Visibility 관리 | ✅ | Tag CRUD API + 설정 UI + Object 태그 표시 |
| 추론 승인 UX (일괄) | ✅ | Approval 페이지 일괄 승인/거부 |
| 지식 편집 (displayName/description) | ✅ | 인라인 편집 UI + PATCH API |
| AI Chat | ⚠️ | 스트리밍 + 다중 프로바이더 / Evidence chain 미표시 |
| 멀티 워크스페이스 | ✅ | 스위처 + 마법사 + 전 페이지 연동 |

## 2. 추론 엔진 (03-inference-engine.md v3.0)

### Domain 추론

| 항목 | 상태 | 비고 |
|------|------|------|
| Track A: Seed-based 도메인 추론 | ⚠️ | `seedBased.ts` — code heuristic만 동작 (dbScore=0, msgScore=0) |
| Track B: Seed-less Discovery (Louvain) | ⚠️ | `discovery.ts` — call 레이어만 사용, 라벨 추출 미구현 |
| Confidence 스코어링 | ✅ | 0.0~1.0 범위, 계산 로직 |
| Domain Candidates 승인 API | ❌ | API 라우트 미존재 (Relation 승인만 있음) |

### Relation 추론

| 항목 | 상태 | 비고 |
|------|------|------|
| Relation 추론 파이프라인 | ❌ | 전체 파이프라인 미구현 (Section 2) |
| Config 기반 관계 추론 (Section 7) | ❌ | `configBased.ts` stub (`return 0`) |
| Code Signal: Regex 기반 (Phase 1) | ❌ | 미구현 (Section 6.1) |
| Code Signal: AST 기반 (Phase 2) | ❌ | 미구현 (Section 6.2) — Next Step |
| DB 시그널 추출 | ❌ | `seedBased.ts`의 dbScore=0 하드코딩 |
| Message 시그널 추출 | ❌ | `seedBased.ts`의 msgScore=0 하드코딩 |

### 인프라

| 항목 | 상태 | 비고 |
|------|------|------|
| Relation Approval Workflow (API + UI) | ✅ | PENDING → APPROVED/REJECTED + API + UI |
| Evidence 테이블 스키마 | ✅ | 3종 테이블 정의 완료 (데이터는 비어있음) |
| Code 분석 테이블 스키마 | ✅ | code_artifacts / code_import_edges / code_call_edges 정의 완료 |
| Discovery 멀티 레이어 통합 | ❌ | call 레이어만 사용 (db, msg, code 미통합) |

## 3. 쿼리 엔진 (04-query-engine.md)

| 항목 | 상태 | 비고 |
|------|------|------|
| PATH_DISCOVERY (BFS) | ✅ | Top-K 경로 + 점수 |
| IMPACT_ANALYSIS | ✅ | 양방향 탐색 |
| USAGE_DISCOVERY | ✅ | rollup + atomic 하이브리드 |
| DOMAIN_SUMMARY | ⚠️ | v2 로드맵 — executor stub (LLM 포맷팅 미연결) |
| Evidence Chain 조회 | ✅ | evidenceStore.ts — DB 조인 |
| Query DSL | ✅ | QueryRequest/Response 타입 |
| 인접리스트 캐시 | ✅ | graph-index Map 기반 |
| POST /api/query | ✅ | |

## 4. 롤업 & 그래프 (05-rollup-and-graph.md)

| 항목 | 상태 | 비고 |
|------|------|------|
| 4단계 롤업 (S2S, S2DB, S2Broker, D2D) | ✅ | builder.ts 완전 구현 |
| Generation 관리 (BUILDING→ACTIVE→ARCHIVED) | ✅ | generationManager.ts |
| object_graph_stats 계산 | ✅ | rebuildRollups에서 degree 집계 |
| 증분 리빌드 | ⚠️ | v2 로드맵 — 전체 리빌드만 |
| Hub 처리 UI | ⚠️ | v2 로드맵 — stats는 계산됨, UI 미구현 |
| 프로그레시브 렌더링 | ❌ | v2 로드맵 — 전체 한번에 렌더 |

## 5. 데이터 모델 (02-data-model.md)

| 항목 | 상태 | 비고 |
|------|------|------|
| 21개 테이블 | ✅ | 모든 테이블 정의 완료 |
| URN 스키마 | ✅ | buildUrn() 유틸 |
| interaction_kind / direction | ✅ | object_relations 스키마 |
| Temporal 아키텍처 (valid_from/to) | ✅ | objects 테이블 컬럼 |
| change_logs 감사 테이블 | ✅ | 테이블 정의 완료 |

## 6. AI Reasoning

| 항목 | 상태 | 비고 |
|------|------|------|
| Chat API (스트리밍) | ✅ | Vercel AI SDK, 다중 프로바이더 |
| Query Router (규칙 기반) | ⚠️ | 키워드 감지로 impact analysis 주입 |
| Evidence Assembler | ❌ | v2 로드맵 |
| Answer Composer 템플릿 | ❌ | v2 로드맵 |
| Strict/Explore 모드 | ❌ | v3+ 로드맵 (우선순위 하향) |

## 7. 아키텍처 (01-architecture.md)

| 항목 | 상태 | 비고 |
|------|------|------|
| 7계층 아키텍처 | ✅ | Presentation/API/Core/AI/Data/CLI/Shared |
| 모노레포 7 패키지 | ✅ | apps/web + packages/ 6개 |
| PGlite + Drizzle ORM | ✅ | @electric-sql/pglite |
| CLI (Commander.js) 5개 커맨드 | ✅ | scan(4모드)/infer/rebuild-rollup/export/snapshot |
| 그래프 시각화 | ✅ | Cytoscape.js (설계: React Flow → 대체 구현) |

---

## 추론 엔진 구현 로드맵 (03-inference-engine.md v3.0 Section 9 기준)

### Phase 1 — 추론 파이프라인 MVP (v2.0)

| # | 작업 | 현재 상태 | 예상 효과 |
|---|------|----------|----------|
| 1 | Config 기반 Relation 추론 | ❌ stub | 서비스↔DB, 서비스↔Broker 자동 발견 (30~40%) |
| 2 | Regex 기반 Code Signal 추출 | ❌ 미구현 | call, expose, produce, consume 자동 발견 (30~40%) |
| 3 | DB Signal 구현 (dbScore) | ❌ =0 하드코딩 | Domain 추론 정확도 향상 |
| 4 | Domain Candidates 승인 API + UI | ❌ 미구현 | Track A/B 결과 활용 |
| 5 | Discovery 다중 레이어 통합 | ❌ call만 사용 | Track B 정확도 향상 |
| 6 | 클러스터 Label 자동 추출 | ❌ 빈 배열 | Discovery UX 개선 |

### Phase 2 — AST 기반 정밀 추출 (v2.1, Next Step)

| # | 작업 | 현재 상태 | 예상 효과 |
|---|------|----------|----------|
| 1 | Tree-sitter Java/Kotlin 플러그인 | ❌ 설계만 | Spring Boot 정밀 분석 (confidence +0.1~0.2) |
| 2 | Tree-sitter TypeScript/JS 플러그인 | ❌ 설계만 | Node.js 정밀 분석 |
| 3 | Tree-sitter Python 플러그인 | ❌ 설계만 | Python 서비스 정밀 분석 |
| 4 | 변수 추적 (data-flow analysis) | ❌ 설계만 | Phase 1 미감지 패턴 커버 |

---

## v1 범위 완료 기준

위 표에서 **✅ + ⚠️** 항목들이 v1 출시 가능 수준.
**❌** 항목들 중 추론 엔진 Phase 1은 `docs/08-roadmap.md`에 v2.0 로드맵으로 분류.
AST Plugin은 Phase 2 (v2.1, Next Step)로 분류.
