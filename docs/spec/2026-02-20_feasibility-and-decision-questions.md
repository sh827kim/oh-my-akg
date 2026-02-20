# Archi.Navi 기능 검토 문서 (실현가능성/해법 + 의사결정 항목)

작성일: 2026-02-20

## 목적

- 이전 검토 결과 중 아래 두 항목을 논의용으로 명시한다.
  - `1. 실현가능성 및 해법`
  - `3. 의사결정 필요사항/세부질의`
- 항목별로 순차 합의하고, 합의 결과를 기록한다.

## 용어 합의(진행중)

- UI/문서 기본 용어는 `Project` 대신 `Service`를 사용한다.
- 개념적으로 `Service`는 `Object`의 한 타입(`object_type=service`)으로 취급한다.
- 단, 물리 모델은 아래 D9에서 최종 결정한다.

---

## 1. 실현가능성 및 해법

### 1.1 배포 서비스 간 의존관계 추적/시각화
- 실현가능성: 높음
- 권장 해법:
  - 관계 모델을 `Service ↔ Service` + `Service ↔ Object` 2계층으로 통합
  - 승인 워크플로우(`change_requests`)를 모든 관계 타입(API/MQ/DB)에 공통 적용
  - UI는 Graph + Object Mapping Lens(예: Kafka/DB/API) 구조로 통일
- 핵심 리스크:
  - 관계 타입 확장 시 데이터 표준 불일치
  - 자동 추론 정확도 부족 시 노이즈 증가
- 합의 반영(2026-02-20):
  - 롤업 방식: 저장형(Materialized) 롤업으로 확정
  - 승인 UX: 선택 기반 일괄 승인(전체 선택 + 부분 해제 + 승인/반려)으로 확정
  - 기존 핵심 기능(Architecture View, Service List Export, Tag, Visibility)은 Object 모델 projection으로 유지

### 1.2 서비스별 도메인 추론/시각화 (Language-agnostic)
- 실현가능성: 중간~높음
- 권장 해법:
  - 언어 AST 중심이 아닌 다중 신호 추론(파일/폴더, config key, API path, topic, README, schema 사용흔적)
  - AST는 가능한 언어에서 **정확도 증강 신호**로 포함하되, 파서가 없는 언어/레포도 동일 파이프라인으로 처리
  - 즉, AST는 필수 의존성이 아니라 선택적 플러그인(가중치 신호)로 사용
  - `domain 후보 + evidence + confidence` 저장
  - 사용자가 수동 확정/오버라이드 가능하도록 UI 제공
- 핵심 리스크:
  - 팀별 네이밍 편차가 커서 초기 품질 변동 가능
- 합의 반영(2026-02-20):
  - 도메인 모델: `primary_domain` 1개 + `secondary_domains` N개(가중치)
  - AST 플러그인 1차 언어: Java/Kotlin, TypeScript/JavaScript, Python
  - confidence 기반 분류는 적용하되, D1 정책에 따라 최종 반영은 승인 큐를 통해 처리

### 1.3 DB Schema 기반 엔티티/도메인 추론 + 관계 시각화
- 실현가능성: 높음
- 권장 해법:
  - FK + 컬럼명 유사도 + 식별자 접미사 패턴 + 조인 패턴으로 관계 추론
  - 식별자 접미사 패턴은 `*_id`에 한정하지 않고 `*_no`, `*_uid`, `*_key`, `*_code` 등 확장 패턴을 포함
  - 접미사 사전은 엔진 기본값 + 사용자 정의 규칙으로 관리
  - 엔티티 클러스터링 후 도메인 그룹 추천
  - ERD 생성은 자동화하고, 관계 승인/수정 가능하도록 설계
- 핵심 리스크:
  - FK 없는 레거시 스키마에서 오탐 발생 가능
- 합의 반영(2026-02-20):
  - 식별자 접미사 기본 사전: `*_id`, `*_no`, `*_uid`, `*_key`, `*_code`, `*id`, `*no`, `*uid`
  - 오탐 완화를 위해 감사성 컬럼(`created_by`, `updated_by`, `deleted_by`, `created_at`, `updated_at`)은 기본 제외 규칙 적용
  - ERD는 전역 전체 렌더 대신 선택 Object 기반 roll-down 표시를 기본 전략으로 사용

### 1.4 MW 관점 연결 시각화 (Object Mapping View 일반화)
- 실현가능성: 매우 높음
- 권장 해법:
  - `object_type`(topic, db_table, api_endpoint, queue 등) + `relation_type`(produce/consume/read/write/call) 공통 모델 도입
  - Kafka 전용 View는 유지하지 않고, Object Mapping View에서 drill-down/roll-down으로 통합 표현
- 핵심 리스크:
  - object_key 표준화 실패 시 중복 객체 증가
- 합의 반영(2026-02-20):
  - Kafka View를 별도 메뉴/화면으로 유지하지 않음
  - 탐색 UX는 Object Mapping View 단일 구조로 제공

### 1.5 지식 자유 편집 UI
- 실현가능성: 높음
- 권장 해법:
  - 원본 추론값과 사용자 오버라이드를 분리 저장
  - 변경 이력/되돌리기/승인 상태 노출
- 핵심 리스크:
  - 동시 편집 시 충돌 처리 정책 필요
- 합의 반영(2026-02-20):
  - 편집 허용: `display_name(alias)`, `parent_id`, `metadata`, `relation_type`, 수동 관계 추가/삭제
  - 시스템 필드(`object_id`, 생성시각 등)는 직접 편집 비허용
  - 우선순위: 수동 오버라이드 > 자동 추론
  - 변경 이력은 객체/관계 단위 append-only 로그로 관리
  - `visibility(VISIBLE/HIDDEN)`와 태그 편집을 유지

### 1.6 AI Chat 질의
- 실현가능성: 높음
- 권장 해법:
  - 질의 라우팅(그래프/도메인/ERD/Object Mapping)
  - 답변마다 evidence 링크(노드/화면 deep-link) 강제
  - 무근거 답변 방지 정책 적용
- 핵심 리스크:
  - 최신성 보장을 위한 인덱스 갱신 주기 설계 필요
- 합의 반영(2026-02-20):
  - 응답 포맷: 결론 + 근거(evidence) + confidence + deep-link
  - evidence 부족 시 확정형 답변 금지(보류/추가검증 안내)
  - 1차 우선 질의: 영향도, 경로 탐색, 객체 사용 주체, 도메인 요약

### 1.7 단일 ORG에서 다중 ORG/개별 repo 확장
- 실현가능성: 높음
- 권장 해법:
  - 모든 주요 테이블에 `workspace_id`(or org_id) 도입
  - 수집 단위를 org/repo 둘 다 지원하는 실행 모델로 분리
- 핵심 리스크:
  - 테넌시 경계(권한/가시성) 명확화 필요
- 합의 반영(2026-02-20):
  - 데이터 모델은 `workspace_id` 기반 멀티 테넌시를 선반영
  - UX는 Slack 스타일 workspace 전환 모델로 설계
  - v1은 단일 workspace 운영을 기본으로 하되, workspace switch 확장을 고려한 구조로 구현

---

## 3. 의사결정 필요사항 / 세부질의

### D1. 자동 추론 결과 반영 정책
- 질문: 자동 추론 결과를 `즉시 반영`할지, `승인 후 반영`할지?
- 결정: 승인 후 반영(운영 신뢰성 우선)
- 추가 요구:
  - 다중 선택 승인 지원
  - 일괄 승인/일괄 반려 지원
  - 동일 패턴(예: 동일 relation_type + 동일 대상군) 묶음 승인 지원 권장

### D2. Object Type 초기 범위
- 질문: 1차 릴리즈에 어떤 object_type까지 포함할지?
- 결정: canonical object type enum 전체를 1차 범위에 포함
- 포함 타입:
  - `service`, `api_endpoint`, `function`, `database`, `db_table`, `db_view`, `cache_instance`, `cache_key`, `message_broker`, `topic`, `queue`

### D3. Relation Type 표준
- 질문: relation_type을 어디까지 표준화할지?
- 권장 시작셋: `produce`, `consume`, `read`, `write`, `call`, `serve`, `depend_on`
- 논의 반영(2026-02-20):
  - Object 모델 정의 기준으로 `topic` 명칭 사용
  - `call`은 정규 저장 시 `service -> api_endpoint` 중심으로 사용하고 상위 관계는 롤업 파생
  - `depend_on` fallback은 유지
  - `expose`는 `service -> api_endpoint` 인터페이스 노출 관계로 유지
  - canonical object type enum 확정:
    - `service`, `api_endpoint`, `function`, `database`, `db_table`, `db_view`, `cache_instance`, `cache_key`, `message_broker`, `topic`, `queue`

### D4. 도메인 추론 품질 게이트
- 질문: confidence threshold 미달 항목을 어떻게 처리할지?
- 결정: 자동 반영 금지 + 승인 큐를 통한 수동 승인

### D5. 멀티 ORG 데이터 격리 방식
- 질문: DB를 ORG별 분리할지, 단일 DB + tenant 컬럼으로 갈지?
- 결정: 단일 DB + tenant 컬럼
- 전제: 개발자 개인의 로컬 사용을 기본 시나리오로 가정
- UI 확장 방향: Slack 스타일 workspace switch

### D6. 편집 충돌 정책
- 질문: 동일 객체 동시 편집 시 규칙?
- 결정: v1에서는 별도 동시 편집 충돌 제어를 도입하지 않음
- 근거: 단일 사용자 로컬 사용 전제
- 추후 재검토 조건: 멀티 사용자/공유 저장소 운영이 도입될 때

### D7. AI Chat 응답 정책
- 질문: evidence 없는 답변을 허용할지?
- 결정: evidence 없는 확정형 답변 금지

### D8. 스케일 목표
- 질문: 1차 목표 스케일을 어디로 둘지?
- 결정:
  - Roll-up 관점 기준 `2,000 edges`를 1차 목표치로 설정
  - Roll-down은 "특정 Object 선택 시 상세 표시" 방식으로 제한해 탐색 복잡도를 제어

### D9. Service를 Object 모델에 물리적으로 어떻게 반영할지
- 질문: `Service=Object type`를 물리 모델까지 즉시 일원화할지?
- 선택지:
  - A) 완전 통합: 단일 `objects` + `object_relations` + 서비스 확장 테이블
  - B) 하이브리드: 기존 `services(projects)` 유지 + `object_catalog`와 논리 매핑
- 결정: A (완전 통합)
- 결정 메모:
  - 서비스를 특수 Object Type으로 취급
  - 관계 모델은 `object_relations` 단일 축으로 정리
  - 서비스 전용 속성은 확장 테이블(`service_profiles` 등)로 분리

---

## 항목별 논의 로그

- 상태 표기: `미논의` | `논의중` | `합의완료`

### 실현가능성/해법 논의 상태
- 1.1 배포 서비스 의존 시각화: 합의완료
- 1.2 도메인 추론(Language-agnostic): 합의완료
- 1.3 DB 기반 엔티티/도메인 추론: 합의완료
- 1.4 MW/Object Mapping 일반화: 합의완료
- 1.5 지식 편집 UI: 합의완료
- 1.6 AI Chat 질의: 합의완료
- 1.7 멀티 ORG/개별 repo 확장: 합의완료

### 의사결정 항목 논의 상태
- D1 자동 추론 반영 정책: 합의완료
- D2 Object Type 초기 범위: 합의완료
- D3 Relation Type 표준: 합의완료
- D4 도메인 추론 품질 게이트: 합의완료
- D5 멀티 ORG 데이터 격리 방식: 합의완료
- D6 편집 충돌 정책: 합의완료
- D7 AI Chat 응답 정책: 합의완료
- D8 스케일 목표: 합의완료
- D9 Service Object 물리모델: 합의완료

## 논의 로그

### 2026-02-20
- 사용자 의견:
  - `Project`보다 `Service` 명칭 선호
  - `Service`도 `Object`의 타입으로 볼 수 있음
- 반영:
  - 본 문서 용어 기본값을 `Service`로 전환
  - D9(물리 모델 결정 항목) 추가
- 합의:
  - D9는 `A(완전 통합)`으로 결정
  - D3는 아래 기준으로 결정
    - `call` 정규 저장: `service -> api_endpoint`
    - `expose`: `service -> api_endpoint` 유지
    - canonical object type enum 11종 확정
  - D1은 `무조건 승인 후 반영`으로 결정
    - 다중/일괄 승인 기능 포함
  - D2는 canonical object type enum 전체를 1차 범위에 포함하기로 결정
  - D4는 도메인 추론도 승인 큐 기반으로 결정
  - D5는 단일 DB + tenant 컬럼(개인 로컬 사용 전제)으로 결정
  - D6는 v1 동시 편집 충돌 제어 미도입으로 결정
  - D7은 evidence 없는 확정형 답변 금지로 결정
  - D8은 roll-up 2,000 edges 목표 + roll-down on-demand 상세 노출로 결정
  - 1.1 구현 원칙 추가 합의
    - 저장형 롤업(Materialized Roll-up)
    - 선택 기반 일괄 승인 UX(전체 선택/부분 해제)
  - 1.4는 Kafka 전용 View 없이 Object Mapping 단일 View로 통합하기로 결정
  - 1.2/1.3/1.5/1.6/1.7 세부 구현 원칙 합의
    - AST는 선택 플러그인 신호로 포함
    - DB 추론 접미사/제외 규칙 반영
    - 수동 오버라이드 우선 + append-only 이력
    - AI Chat evidence 중심 응답 정책
    - 멀티 테넌시 + Slack 스타일 workspace switch 방향
  - 기존 UX(Architecture View, Service List Export, Tag, Visibility)는 Object 모델로 통합 유지
