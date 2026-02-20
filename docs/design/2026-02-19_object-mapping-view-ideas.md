# Kafka View 일반화 검토 메모

작성일: 2026-02-19

## 1. 문제 정의

현재 요구는 Kafka Topic 중심 탐색이다.  
하지만 실제 운영에서는 다음 질문이 함께 발생한다.

- 어떤 서비스가 어떤 DB/Table을 읽고 쓰는가?
- 어떤 서비스가 어떤 API를 호출하는가?
- 어떤 Queue/Topic을 publish/consume 하는가?

즉, Kafka 전용 화면보다 “프로젝트 ↔ 오브젝트” 관계를 공통 표현하는 구조가 더 확장성이 높다.

---

## 2. 권장 방향

Kafka View를 유지하되, 내부 모델을 **Object Mapping View**로 일반화한다.

- Kafka는 `object_type = kafka_topic`
- DB Table은 `object_type = db_table`
- API Endpoint는 `object_type = api_endpoint`
- Queue/Cache Key도 동일 방식으로 확장

UI는 “렌즈(Lens)” 방식으로 제공:

1. 기본 렌즈: Kafka
2. 확장 렌즈: DB / API / Queue
3. 공통 컴포넌트 재사용 (목록, 관계 그래프, 양방향 리스트)

---

## 3. 데이터 모델 제안 (초안)

## object_catalog
- `id`
- `object_type` (`kafka_topic`, `db_table`, `api_endpoint`, ...)
- `object_key` (고유 식별자; 예: `topic.order.created`, `db1.public.users`)
- `display_name`
- `meta_json`

## project_object_relations
- `id`
- `project_id`
- `object_id`
- `relation_type` (`produce`, `consume`, `read`, `write`, `call`, `serve` ...)
- `approved`
- `source` (`manual`, `scan`, `inference`)
- `evidence`
- `created_at`

장점
- Kafka 전용 테이블에 종속되지 않고, 새로운 object type을 추가해도 화면/질의 구조를 유지 가능

---

## 4. 화면/UX 제안

## A안: Lens + 2-Panel
- 좌측: Object 목록(타입/검색/필터)
- 우측: 선택 object에 대한 Producers/Consumers(또는 Readers/Writers)
- 난이도 낮고 빠른 구현 가능

## B안: Bipartite Graph
- 좌: Project, 우: Object
- 관계 타입별 edge 스타일
- 탐색성 높지만 초기 복잡도 증가

## C안: Matrix View
- 행: Project, 열: Object
- 셀: relation_type
- 대량 데이터 비교에 강함, 실시간 상호작용은 다소 약함

권장
- 1차는 A안
- 2차로 B안 추가

---

## 5. 구현 로드맵 제안

1. Kafka View를 A안으로 먼저 구현 (`project_topics` 기반)
2. 공통 인터페이스(`object_type`, `relation_type`) 추상화
3. DB/API object type을 순차 추가
4. Agent Chat 질의를 object type 기반으로 일반화

---

## 6. 리스크

- object_key 표준화 규칙 미정 시 중복/불일치 발생
- relation_type 과다 확장 시 UI 복잡도 증가
- 자동 추론 정확도 문제로 승인 워크플로우 연동이 필수

