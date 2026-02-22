# Archi.Navi Roll-up 계산 알고리즘 설계안 (v1)

작성일: 2026-02-21
문서 버전: v1.0

---

## 1. 목적

Roll-up은 원자 관계(object_relations)를 기반으로
상위 레벨 의존성을 Materialized 형태로 계산하여
고속 그래프 탐색을 가능하게 한다.

---

## 2. Roll-up Level 정의

- SERVICE_TO_SERVICE
- SERVICE_TO_DATABASE
- SERVICE_TO_BROKER

---

## 3. 계산 규칙

### 3.1 SERVICE_TO_SERVICE

Base:
A --call--> endpoint E
B --expose--> endpoint E

Roll-up:
A --call--> B

---

### 3.2 SERVICE_TO_DATABASE

Base:
Service S --read/write--> Table T
T.parent = Database DB

Roll-up:
S --read/write--> DB

---

### 3.3 SERVICE_TO_BROKER

Base:
Service S --produce/consume--> Topic T
T.parent = Broker M

Roll-up:
S --produce/consume--> M

---

## 4. 집계 전략

edge_weight:
동일 roll-up edge를 구성하는 base relation 개수

confidence:
avg(base.confidence)

---

## 5. Full Rebuild 알고리즘

1. new_generation = last_generation + 1
2. 기존 rollup 삭제 또는 version 분리
3. relation_type별 집계 수행
4. object_rollups insert
5. generation_version 갱신

---

## 6. Incremental 전략(확장)

트리거:
- relation 승인/삭제
- parent 변경
- expose 변경

영향 범위만 재계산 가능하도록 설계

---

## 7. 성능 전략

- UI는 항상 rollups 기반 조회
- drill-down에서만 원자 relation 조회
- provenance는 Lazy Load

---

## 8. 핵심 API

- rebuildRollups(workspaceId)
- getRollupGraph(workspaceId, level)
- getRollupProvenance(rollupId)
