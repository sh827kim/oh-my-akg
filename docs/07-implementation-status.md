# Archi.Navi — 설계 대비 구현 현황 (v1)

> 최종 점검일: 2026-02-22
> 점검 대상: 16개 설계 문서 (docs/00~06 + archive/ 9개)

## 전체 요약

| 영역 | ✅ 완전 | ⚠️ 부분 | ❌ 미구현 | 충족률 |
|------|---------|---------|----------|--------|
| PRD (00-overview) | 6 | 2 | 0 | 88% |
| 추론 엔진 (03) | 4 | 0 | 4 | 50% |
| 쿼리 엔진 (04) | 7 | 1 | 0 | 94% |
| 롤업/그래프 (05) | 3 | 2 | 1 | 67% |
| 데이터 모델 (02) | 5 | 0 | 0 | 100% |
| AI Reasoning | 1 | 1 | 3 | 30% |
| 아키텍처 (01) | 5 | 0 | 0 | 100% |
| **합계** | **31** | **6** | **8** | **76%** |

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

## 2. 추론 엔진 (03-inference-engine.md)

| 항목 | 상태 | 비고 |
|------|------|------|
| Track A: Seed-based 도메인 추론 | ✅ | `seedBased.ts` — 가중치 프로필, affinity, purity 계산 |
| Track B: Seed-less Discovery (Louvain) | ✅ | `discovery.ts` — graphology + Louvain |
| Confidence 스코어링 | ✅ | 0.0~1.0 범위, 계산 로직 |
| Approval Workflow | ✅ | PENDING → APPROVED/REJECTED + API + UI |
| DB 시그널 추출 | ❌ | v2 로드맵 — dbScore=0 하드코딩 |
| Message 시그널 추출 | ❌ | v2 로드맵 — msgScore=0 하드코딩 |
| Config-based 관계 추론 | ❌ | v2 로드맵 — configBased.ts stub |
| AST Plugin (Tree-sitter) | ❌ | v2 로드맵 — 설계만 존재 |

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
| 26개 테이블 | ✅ | 모든 테이블 정의 완료 |
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
| Strict/Explore 모드 | ❌ | v2 로드맵 |

## 7. 아키텍처 (01-architecture.md)

| 항목 | 상태 | 비고 |
|------|------|------|
| 7계층 아키텍처 | ✅ | Presentation/API/Core/AI/Data/CLI/Shared |
| 모노레포 7 패키지 | ✅ | apps/web + packages/ 6개 |
| PGlite + Drizzle ORM | ✅ | @electric-sql/pglite |
| CLI (Commander.js) 5개 커맨드 | ✅ | scan(4모드)/infer/rebuild-rollup/export/snapshot |
| 그래프 시각화 | ✅ | Cytoscape.js (설계: React Flow → 대체 구현) |

---

## v1 범위 완료 기준

위 표에서 **✅ + ⚠️** 항목들이 v1 출시 가능 수준.
**❌** 항목들은 `docs/08-roadmap.md`에 v2 로드맵으로 분류.
