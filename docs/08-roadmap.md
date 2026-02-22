# Archi.Navi — v2+ 로드맵

> 작성일: 2026-02-22
> v1 구현 현황: `docs/07-implementation-status.md` 참고

---

## 우선순위 정의

| 등급 | 의미 | 예상 시기 |
|------|------|----------|
| **P1** | 핵심 추론 정밀도 향상 — v2 초기 | v2.0 |
| **P2** | AI/UX 고도화 — v2 중반 | v2.1~v2.2 |
| **P3** | 대규모 그래프 성능 — v2 후반 | v2.3+ |

---

## P1: 추론 정밀도 향상

### 1-1. DB 시그널 추출
- **파일:** `packages/inference/src/domain/seedBased.ts`
- **현재:** dbScore=0 하드코딩
- **구현:** FK 제약조건 분석 → 테이블 접두사 매칭 → 도메인 affinity 계산
- **의존:** DB 스키마 메타데이터 수집 파이프라인

### 1-2. Message 시그널 추출
- **파일:** `packages/inference/src/domain/seedBased.ts`
- **현재:** msgScore=0 하드코딩
- **구현:** 토픽 네이밍 패턴 분석 → producer/consumer 결합도 → 도메인 affinity
- **의존:** Kafka/RabbitMQ 설정 파싱

### 1-3. Config-based 관계 추론
- **파일:** `packages/inference/src/relation/configBased.ts`
- **현재:** stub (candidateCount: 0)
- **구현:**
  - `application.yml` → DB 접속 URL → read/write 관계 추론
  - `docker-compose.yml` → 서비스 의존성 → depend_on 관계
  - `API Gateway routing config` → call 관계 추론
- **결과:** relation_candidates 테이블에 PENDING 상태로 저장

---

## P2: AI/UX 고도화

### 2-1. AST Plugin (Tree-sitter)
- **파일:** `packages/inference/src/` 신규 디렉토리
- **언어:** Java/Kotlin, TypeScript/JavaScript, Python
- **추출 대상:**
  - import/require 문 → code_import_edges
  - HTTP client call → call 관계 후보
  - Controller/handler 등록 → expose 관계
  - DB query 패턴 → read/write 관계
- **의존:** tree-sitter 바인딩 + 언어별 grammar

### 2-2. Evidence Assembler
- **파일:** `packages/core/src/ai/evidence-assembler.ts` (신규)
- **기능:**
  - 쿼리 결과 → 증거 체인 구조화 (max 10개)
  - confidence × weight × hop 거리 기준 우선순위
  - 파일 경로 + 라인 + excerpt 포함
- **연동:** Chat API에서 queryContext 대신 evidence chain 주입

### 2-3. Answer Composer 템플릿
- **파일:** `apps/web/src/app/api/chat/route.ts` 확장
- **구조:** 결론 → 신뢰도 → 증거 목록 → 요약 → deep-link
- **UI:** `floating-chat.tsx`에 evidence 카드 렌더링

### 2-4. Strict / Explore 모드
- **설정:** localStorage 또는 AI 설정 탭
- **Strict Mode:** 증거 없으면 "판단 불가" 반환
- **Explore Mode:** 가설 허용 (단, "추정" 명시)

### 2-5. DOMAIN_SUMMARY 쿼리 완성
- **파일:** `packages/core/src/query-engine/executor.ts`
- **현재:** stub 반환
- **구현:** deterministic 집계 + LLM 포맷팅 (도메인별 서비스 수, 관계 밀도, purity 통계)

---

## P3: 대규모 그래프 성능

### 3-1. 증분 리빌드
- **파일:** `packages/core/src/rollup/builder.ts`
- **현재:** 전체 rebuild (모든 level 재계산)
- **목표:** 변경 영향 범위만 부분 재계산
- **트리거:** 관계 승인/삭제, 부모 변경, expose 변경

### 3-2. Hub 처리 UI
- **기준:** object_graph_stats.inDegree > threshold (기본 200)
- **UI:** Hub 노드 접기/펼치기, 카운트 배지 표시
- **의존:** P1의 object_graph_stats 활용 (이미 계산됨)

### 3-3. 프로그레시브 렌더링
- **파일:** `apps/web/src/components/mapping/rollup-graph.tsx`
- **현재:** 전체 엣지 한번에 렌더
- **목표:** 200 엣지/배치 → requestAnimationFrame으로 분할
- **기준:** 2000+ 엣지에서 UI 버벅임 방지

### 3-4. Domain-first 내비게이션
- **현재:** 뷰 레벨 필터는 있으나 drill-down 순서 미강제
- **목표:** DOMAIN_TO_DOMAIN → 클릭 → SERVICE_TO_SERVICE → 클릭 → Atomic 자동 전환
- **UI:** 브레드크럼 내비게이션 + "상위로" 버튼

---

## 참고 설계 문서

| 로드맵 항목 | 참조 문서 |
|------------|----------|
| DB/Message 시그널 | `docs/03-inference-engine.md` §3 Signal 추출 |
| Config-based 추론 | `docs/03-inference-engine.md` §3.3 Config Signal |
| AST Plugin | `docs/03-inference-engine.md` §5 AST Plugin Design |
| Evidence Assembler | `docs/archive/ArchiNavi_AI_Reasoning_레이어_설계안_v1.md` §3 |
| Answer Composer | `docs/archive/ArchiNavi_AI_Reasoning_레이어_설계안_v1.md` §4 |
| DOMAIN_SUMMARY | `docs/04-query-engine.md` §4 DOMAIN_SUMMARY |
| 증분 리빌드 | `docs/05-rollup-and-graph.md` §4 Incremental Rebuild |
| Hub 처리 | `docs/archive/ArchiNavi_대규모_그래프_성능_전략_v1.md` §2 |
| 프로그레시브 렌더링 | `docs/archive/ArchiNavi_대규모_그래프_성능_전략_v1.md` §5 |
| Domain-first | `docs/05-rollup-and-graph.md` §6 Navigation Strategy |
