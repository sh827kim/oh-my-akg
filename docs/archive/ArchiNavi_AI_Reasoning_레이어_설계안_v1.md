# Archi.Navi AI Reasoning 레이어 설계안 (v1)

작성일: 2026-02-21
문서 버전: v1.0

---

## 1. 목적

Deterministic Query Engine의 계산 결과를 기반으로
LLM은 "설명/요약"만 수행하는 안전한 AI 레이어 설계안이다.

핵심 원칙:

- Evidence 없는 확정형 답변 금지
- 결론 + evidence + confidence + deep-link 강제
- 구조 계산은 Deterministic Engine만 수행

---

## 2. 레이어 구성

### 2.1 주요 컴포넌트

- Query Router
- Deterministic Engine Client
- Evidence Assembler
- Answer Composer
- LLM Formatter

### 2.2 데이터 흐름

1. 사용자 질문
2. Query Router → QueryRequest 생성
3. Deterministic Engine 호출
4. Evidence Assembler가 근거 묶음 구성
5. Answer Composer가 구조화된 답변 골격 생성
6. LLM Formatter가 자연어로 정리

---

## 3. Query Router 설계

질문 유형을 다음으로 분류:

- IMPACT_ANALYSIS
- PATH_DISCOVERY
- USAGE_DISCOVERY
- DOMAIN_SUMMARY

Router는 rule-based 우선, 애매한 경우에만 LLM 보조 사용.

---

## 4. Evidence Assembler 규칙

### 4.1 Evidence 수 제한

- 기본 최대 10개
- confidence/edge_weight 우선 정렬

### 4.2 선택 기준

1. confidence 높은 순
2. edge_weight 높은 순
3. hop 가까운 순
4. 최신 valid_from 우선

---

## 5. Answer Composer 포맷 강제

### 응답 형식

1. 결론
2. Confidence
3. Evidence 목록
4. 경로/영향 요약
5. Deep-link

예시:

결론: 주문 서비스는 결제 서비스를 호출한다.
Confidence: 0.91
Evidence:
- Rollup edge (edge_weight=7)
- Base relation (file: OrderController.java:120-145)
Deep-link: /mapping?path=p1

---

## 6. LLM Formatter 규칙

LLM은:

- 주어진 데이터만 문장화
- 새로운 사실 추가 금지
- confidence 변경 금지
- evidence 삭제 금지

---

## 7. 부족 근거 처리

근거가 부족하면:

- "확정 불가" 명시
- 부족한 근거 유형 안내
- 필요한 데이터 제안

---

## 8. 모드 설계

### Strict Mode (기본)
- evidence 없는 결론 금지

### Explore Mode (옵션)
- 가설 허용 (UI에 Hypothesis 라벨 표기)

---

## 9. v1 구현 우선순위

1. Answer Composer 템플릿 구현
2. Evidence Assembler 구현
3. Router 구현
4. Strict Mode 먼저 출시
