# Archi.Navi Deterministic Query Engine 설계안 (v1)

작성일: 2026-02-21
문서 버전: v1.0

---

## 1. 목적

Archi.Navi의 구조 질의(영향도/경로/사용 주체/요약)를 **LLM 없이도 결정론적으로 계산**하기 위한 Query Engine 설계안이다.  
LLM은 결과를 "설명/요약"하는 표현 레이어로만 사용한다.

---

## 2. 설계 원칙

1. **재현 가능성**: 동일 입력 → 동일 출력
2. **Evidence 중심**: 결과 그래프의 모든 edge/node는 근거 추적 가능
3. **기본 Roll-up, 필요 시 Drill-down**
4. 엔진은 계산/랭킹/추적만 담당, UI/LLM은 표현 담당
5. `workspace_id` 격리 + `generation_version` 스냅샷 기반 조회

---

## 3. 데이터 소스

### 3.1 빠른 그래프(기본)
- `object_rollups` (current generation_version)

### 3.2 상세/근거(드릴다운)
- `object_relations`
- `relation_evidences`
- `evidences`
- (옵션) `relation_candidates` (+ evidence)

---

## 4. Query Type Enum (v1)

- `IMPACT_ANALYSIS` : 변경 영향도(Upstream/Downstream)
- `PATH_DISCOVERY` : A→B 경로 탐색(최단 + 상위 N개)
- `USAGE_DISCOVERY` : 특정 객체(topic/table/api_endpoint)를 사용하는 주체
- `DOMAIN_SUMMARY` : 도메인 요약(결정론적 집계 + LLM 문장화)

(옵션 확장)
- `DEPENDENCY_OVERVIEW`
- `DRIFT_CHECK`

---

## 5. Query DSL (v1 최소 스펙)

### 5.1 QueryRequest

```json
{
  "workspaceId": "uuid",
  "generationVersion": 12,
  "queryType": "PATH_DISCOVERY",
  "scope": {
    "level": "SERVICE_TO_SERVICE",
    "relationTypes": ["call"],
    "visibility": "VISIBLE_ONLY",
    "tagIds": ["uuid1", "uuid2"]
  },
  "params": {
    "fromObjectId": "uuidA",
    "toObjectId": "uuidB",
    "maxHops": 6,
    "topK": 3
  }
}
```

### 5.2 Scope 필드

- `level`: rollup_level
- `relationTypes`: 관계 타입 필터
- `visibility`: VISIBLE_ONLY / INCLUDE_HIDDEN
- `tagIds`: 태그 필터(선택)
- (옵션) `objectTypes`: 노드 타입 제한

---

## 6. QueryResponse 공통 포맷

```json
{
  "queryType": "PATH_DISCOVERY",
  "result": {
    "nodes": [
      {"id":"uuidA","type":"service","name":"order"},
      {"id":"uuidB","type":"service","name":"payment"}
    ],
    "edges": [
      {
        "subjectId":"uuidA",
        "objectId":"uuidB",
        "relationType":"call",
        "level":"SERVICE_TO_SERVICE",
        "edgeWeight": 7,
        "confidence": 0.91,
        "provenance": {
          "rollupId": "uuidRollup",
          "baseRelationIds": ["uuidR1","uuidR2"]
        }
      }
    ],
    "paths": [
      {
        "pathId":"p1",
        "nodeIds":["uuidA","uuidX","uuidB"],
        "score": 0.82
      }
    ]
  },
  "meta": {
    "generationVersion": 12,
    "computedAt": "ISO-8601"
  }
}
```

핵심: **그래프 결과 + provenance 포인터 + score/confidence**를 함께 제공한다.

---

## 7. 질의별 알고리즘(결정론)

### 7.1 PATH_DISCOVERY

- 그래프: `object_rollups` adjacency list
- 알고리즘: BFS (최단 거리 경로 수집)
- topK: 최단 경로 집합 내에서 score 기준 정렬

Score 예시(고정 룰):
- `avg(edge.confidence)` × `log(1 + min(edgeWeight))` ÷ `hops_penalty`

### 7.2 IMPACT_ANALYSIS

- Downstream/Upstream 모드
- 알고리즘: bounded BFS/DFS + maxDepth
- 랭킹: depth 우선, 동일 depth면 confidence/edgeWeight 우선

### 7.3 USAGE_DISCOVERY

- 원자 객체(topic/db_table/api_endpoint): `object_relations` 직접 조회가 정확
- 상위 객체(database/broker/service): `object_rollups` 우선

### 7.4 DOMAIN_SUMMARY

- 결정론적으로 집계 결과 생성(객체 타입별 카운트, 핵심 관계/토픽/테이블)
- LLM은 집계 결과를 받아 문장화(근거 링크 포함)

---

## 8. Evidence / Provenance 체인

Explainable 결과를 위해 아래 체인을 끊지 않는다.

- RollupEdge → `rollup_provenance` → BaseRelations
- BaseRelation → `relation_evidences` → Evidences
- Evidence → file/line/excerpt/uri

---

## 9. 성능/캐싱

- generation_version별 adjacency cache(in-memory)
- query 결과 LRU 캐시(옵션)
- visibility/tag 필터는 query-time 적용(캐시 키에 포함)

---

## 10. 모듈 구조(추천)

`packages/core`:

- `graph-store` : DB access(rollups/relations/evidence)
- `graph-index` : adjacency cache builder
- `query-engine` : BFS/DFS/path/ranking
- `query-dsl` : request/response schema + validation

---

## 11. v1 구현 우선순위

1) PATH_DISCOVERY (service-to-service call)  
2) IMPACT_ANALYSIS (downstream/upstream)  
3) USAGE_DISCOVERY (topic/table usage)  
4) DOMAIN_SUMMARY (집계 + LLM 문장화)

