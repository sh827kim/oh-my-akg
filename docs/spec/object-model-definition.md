## 1. Object: 자산의 일반화 및 계층화
모든 기술적 자산은 `Object`이며, 독립적인 개체인 동시에 다른 객체를 포함하는 '집합체'가 될 수 있다.

### 1.1 Object 계층 및 분류 (Taxonomy)
| 카테고리 | 집합체 (Compound/Parent) | 원자 단위 (Atomic/Child)               | 설명 |
| :--- | :--- |:-----------------------------------| :--- |
| **COMPUTE** | `service` | `api_endpoint`, `function`         | 실행 유닛 및 API 접점 |
| **STORAGE** | `database`, `cache_instance` | `db_table`, `db_view`, `cache_key` | 데이터 저장소 및 세부 엔티티 |
| **CHANNEL** | `message_broker` | `topic`, `queue`           | 비동기 메시지 통로 |

### 1.2 Object 핵심 속성
- **Identity (Primary Key):** `UUID`를 내부 고유 식별자로 사용
- **Identity (URN):** `urn:{org}:{category}:{type}:{name}`는 가독성/외부참조용 식별자로 사용
- **Parent ID:** 상위 집합체 객체의 ID (예: 테이블의 부모는 데이터베이스)
- **Granularity:** `Compound`(집합체) vs `Atomic`(원자 단위)
- **Visibility:** `VISIBLE | HIDDEN` (뷰 노출 제어)
- **Metadata:** JSON 형태의 가변 속성 (엔진 버전, 프로토콜, 언어 등)

### 1.3 Tagging
- 태그는 `object_tags`(N:M)로 관리한다.
- `service`뿐 아니라 모든 object type에 태그 부여 가능하다.
- 기존 서비스 태깅 UX는 Object 태깅으로 확장한다.

---

## 2. Relation: 상호작용의 명시적 정의
객체 간의 관계는 기술적 맥락에 따라 구분하며, 하위 객체 간의 관계는 상위 객체로 '롤업(Roll-up)' 가능하다.

### 2.1 Relation Type 표준안
| 타입 (Type) | 분류 | 적용 대상 (Subject -> Object) |
| :--- | :--- | :--- |
| **`call`** | Control | `service` -> `api_endpoint` |
| **`expose`** | Structure | `service` -> `api_endpoint` (인터페이스 노출) |
| **`read`** | Storage In | `service` -> `db_table` / `database` |
| **`write`** | Storage Out | `service` -> `db_table` / `database` |
| **`produce`** | Channel Out | `service` -> `topic` / `message_broker` |
| **`consume`** | Channel In | `service` -> `topic` / `message_broker` |
| **`depend_on`** | Static | 추론 불가 또는 정적 의존성 (Fallback) |

### 2.2 합의된 정규 관계 저장 원칙
- `call`의 정규 저장 대상은 `service -> api_endpoint`로 고정한다.
- `service -> service`는 직접 저장하지 않고 `call` 관계를 기반으로 롤업 파생한다.
- 저장소/채널 관계도 동일하게 원자 객체 기준으로 저장하고 상위 객체 관계는 파생 계산한다.

### 2.3 Canonical Object Type Enum (합의)
- `service`
- `api_endpoint`
- `function`
- `database`
- `db_table`
- `db_view`
- `cache_instance`
- `cache_key`
- `message_broker`
- `topic`
- `queue`

---

## 3. 상세 설계 및 운영 원칙

### 3.1 계층형 데이터 모델 (D9-A 확장)
1. **Self-Reference:** `objects` 테이블에 `parent_id`를 두어 무한 계층 지원.
2. **Path Materialization:** 조회 성능을 위해 `path` (예: `/db_id/table_id`) 필드 도입 권장.
3. **Relation Roll-up:**
    - 서비스 A가 테이블 B를 `read`하면, 서비스 A -> 데이터베이스 B' `read`는 파생 관계로 계산한다.
    - 서비스 A가 토픽 T를 `consume`하면, 서비스 A -> 브로커 M `consume`은 파생 관계로 계산한다.
    - 서비스 A -> 서비스 X `call`은 서비스 A -> API Endpoint E `call`을 기반으로 파생 계산한다.

### 3.2 파생 관계(derived) 관리
- 파생 여부를 명시적으로 저장한다.
  - `is_derived` (boolean)
  - `derived_from_relation_id` (nullable FK)
  - `confidence` (0~1)
- 원본 관계와 파생 관계를 UI/질의에서 구분해서 표출한다.
- 롤업 전략은 실시간 계산이 아니라 저장형(Materialized) 롤업으로 운영한다.

### 3.3 승인 워크플로우 UX 원칙
- 추론 결과는 승인 전까지 반영하지 않는다.
- 승인 화면은 선택 기반 일괄 처리를 기본으로 한다.
  - 전체 선택
  - 부분 선택 해제
  - 선택 건 승인/반려

### 3.4 View Projection/Preset 원칙
- 같은 Object/Relation 모델을 여러 View로 projection한다.
- 필수 preset:
  - **Architecture View**: roll-up 중심 시각화 preset
  - **Service List View**: `object_type=service` 목록 projection
  - **Object Mapping View**: object type 필터 기반 drill-down/roll-down
- Service List CSV Export는 Service List View projection을 기반으로 생성한다.
### 3.5 의사결정 반영 (D3, D9)
- **D3 (Relation 표준):** 저장소(`read/write`)와 채널(`produce/consume`)을 분리하여 전문성 유지.
- **D9 (물리 통합):** 모든 자산은 단일 `objects` 테이블에서 관리하며, `type` 컬럼으로 성격을 구분함.
- **Fallback 정책:** `depend_on`은 fallback 관계로 유지.

### 3.6 확정 사항 (2026-02-20)
- `call` 정규 저장: `service -> api_endpoint`로 확정
- `expose` 유지: `service -> api_endpoint` 인터페이스 노출 관계로 확정
- Canonical Object Type Enum: 11개 타입으로 확정

---

## 4. 향후 확장성 (Roadmap)
- **Multi-Tenancy (D5):** `workspace_id`를 통한 데이터 격리.
- **Evidence Trace:** 관계 추론의 근거가 된 코드 라인, 설정 파일 경로 등을 메타데이터로 기록.

## 5. 뷰 구성 원칙 (합의)
- Kafka 전용 View는 별도로 두지 않는다.
- Object Mapping View 단일 구조에서 object_type 필터와 drill-down/roll-down으로 탐색한다.
- 즉, `topic`은 Object Mapping View의 한 타입으로만 취급한다.
