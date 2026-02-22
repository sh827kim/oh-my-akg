# 추론 엔진 커버리지 한계 및 보완 방안

**날짜**: 2026-02-21
**상태**: 제안
**관련 문서**: `2026-02-21_inference-engine-implementation.md`

---

## 배경

현재 추론 엔진 구현(v1)은 아래 두 축에서 커버리지 공백이 있다.

1. **SQL 관계 추론**: 지정된 접미사 패턴과 명시적 FK 제약에만 의존
2. **Java 프레임워크**: Spring + JPA 조합 외 MyBatis, JAX-RS, Servlet 미지원

한국 백엔드 생태계 특성상 Spring + MyBatis 조합이 압도적으로 많고,
컬럼 명명 규칙도 `_id` 접미사 외 다양한 형태가 존재한다.

---

## 1. SQL 관계 추론 한계

### 현재 탐지 가능한 경우

| 패턴 | Confidence | 비고 |
|------|-----------|------|
| `FOREIGN KEY ... REFERENCES users(id)` | ~0.80 | 명시적 FK 제약 |
| `user_id`, `order_no`, `product_uid` 등 | ~0.52 | 접미사 패턴 (`_id`, `_no`, `_uid`, `_key`, `_code`) |

### 탐지 불가능한 경우

```sql
-- 비표준 접미사
user_fk, user_seq, product_cd, category_gb, reg_user_no

-- JOIN 조건 (DML)
SELECT o.*, u.name
FROM orders o
INNER JOIN users u ON o.user_fk = u.id        -- ← FK 명시 없어도 관계 명확
LEFT  JOIN products p ON o.product_seq = p.seq

-- 복합 명명 패턴
CREATE TABLE order_detail (
    ord_mst_no   BIGINT,   -- orders 테이블 참조이나 접미사가 _no
    itm_cd       VARCHAR,  -- items 테이블 참조이나 _cd 접미사
    reg_user_no  BIGINT    -- users 테이블 참조이나 reg_ prefix 포함
);
```

---

## 2. MyBatis / non-Spring 한계

### 프레임워크별 커버리지 현황

| 프레임워크 | 지원 여부 | 미지원 이유 |
|-----------|----------|------------|
| Spring MVC `@RestController` | ✅ | 구현됨 |
| JPA `@Entity` | ✅ | 구현됨 |
| MyBatis XML Mapper (`*Mapper.xml`) | ❌ | XML 스캐너 없음 |
| MyBatis Java 어노테이션 (`@Select`, `@Insert`) | ❌ | SQL 파싱 없음 |
| JAX-RS / Jersey / Quarkus (`@Path`, `@GET`) | ❌ | 어노테이션 맵 미등록 |
| Micronaut (`@Controller`, `@Get`) | △ | `@Controller`는 처리되나 `@Get` 미처리 |
| Servlet (`@WebServlet`) | ❌ | 어노테이션 미등록 |

### MyBatis XML 예시

```xml
<!-- OrderMapper.xml: 현재 완전히 스킵됨 -->
<mapper namespace="com.example.mapper.OrderMapper">
    <select id="findByUser" resultType="Order">
        SELECT o.*, u.name
        FROM orders o
        JOIN users u ON o.user_id = u.id
        WHERE o.status = #{status}
    </select>
    <insert id="create">
        INSERT INTO orders (user_id, product_id, amount) VALUES (...)
    </insert>
</mapper>
```

이 파일에서 추론 가능한 정보:
- `service → db_table:orders` (read + write)
- `service → db_table:users` (read, JOIN)
- `service → db_table:products` (write, INSERT)

현재 추론 결과: **없음**

---

## 3. 보완 방안

### 방안 A. DML JOIN 분석

**대상 파일**: `.sql` (DDL과 동일)
**구현 위치**: `sql-ddl-scanner.ts` 확장 또는 신규 `sql-dml-scanner.ts`
**파서**: `node-sql-parser` (DML 완전 지원, 이미 의존성 존재)

#### 동작 방식

`node-sql-parser`로 SELECT/INSERT/UPDATE/DELETE 문을 파싱해
JOIN 조건과 테이블 참조에서 `read`/`write` Relation을 추출한다.

```sql
SELECT o.*, u.name
FROM orders o
INNER JOIN users u ON o.user_fk = u.id   -- JOIN → orders depends_on users
LEFT  JOIN products p ON o.product_seq = p.seq  -- JOIN → orders depends_on products
```

AST 구조:
```
SelectStatement
  └── from: [Table(orders), Join(users, ON ...), Join(products, ON ...)]
```

추출 결과:
```
service → db_table:orders   (read, confidence ~0.80)
service → db_table:users    (read, confidence ~0.80, JOIN 근거)
service → db_table:products (read, confidence ~0.80, JOIN 근거)
```

#### 장점

- `node-sql-parser` 재사용, 추가 의존성 없음
- JOIN 조건에서는 컬럼 명명 규칙과 무관하게 관계 탐지 가능
- 한국 레거시 DB의 비표준 컬럼명 문제를 우회

---

### 방안 B. Cross-table Column Name 매칭

**대상**: Pass 1 완료 후 (`knownUrns`에 `db_table` URN이 채워진 시점)
**구현 위치**: `resolvers/index.ts` 또는 신규 `resolvers/fk-resolver.ts`
**파서**: 없음 (이미 수집된 Object 정보 활용)

#### 동작 방식

Pass 1에서 수집한 테이블 목록을 토큰화하고,
각 테이블의 컬럼명에서 다른 테이블 이름과 매칭되는 토큰을 찾는다.

```
알려진 테이블: [users, orders, products, item_categories]

orders 테이블의 컬럼: [user_fk, product_seq, reg_user_no, item_category_gb]

매칭 시도:
  user_fk      → 토큰 ["user", "fk"]      → "user" ∈ users     → depend_on users
  product_seq  → 토큰 ["product", "seq"]  → "product" ∈ products → depend_on products
  reg_user_no  → 토큰 ["reg", "user", "no"] → "user" ∈ users   → depend_on users
  item_category_gb → 토큰 [...]           → "item_category" ∈ item_categories → depend_on item_categories
```

#### Confidence 조정

토큰 매칭은 오탐 가능성이 있으므로 낮은 confidence 적용:

| 조건 | Confidence 배수 |
|------|----------------|
| 단일 토큰 매칭 (e.g. `user_fk` → `users`) | × 0.50 |
| 복합 토큰 완전 매칭 (e.g. `item_category_gb` → `item_categories`) | × 0.60 |
| 접미사 패턴 + 토큰 매칭 동시 성립 | × 0.70 |

---

### 방안 C. MyBatis XML Mapper Scanner

**대상 파일**: `*Mapper.xml`, `*mapper.xml`, `mybatis/**/*.xml`
**구현 위치**: 신규 `scanners/mybatis/xml-mapper-scanner.ts`
**파서**: XML 파싱 (Node.js 내장 `DOMParser` 또는 경량 XML 파서) + `node-sql-parser`

#### 동작 방식

1. XML에서 `<select>`, `<insert>`, `<update>`, `<delete>` 태그 추출
2. MyBatis 파라미터 구문 제거 (`#{param}`, `${param}` → 리터럴로 치환)
3. 정제된 SQL을 `node-sql-parser`로 파싱
4. 테이블명 → `db_table` Object, 연산 종류 → `read`/`write` Relation

```xml
<select id="findWithUser">
    SELECT o.*, u.name
    FROM orders o JOIN users u ON o.user_id = u.id
    WHERE o.id = #{id}
</select>
```

파싱 단계:
```
1. SQL 추출: "SELECT o.*, u.name FROM orders o JOIN users u ON o.user_id = u.id WHERE o.id = #{id}"
2. 파라미터 치환: #{id} → 0
3. node-sql-parser 파싱
4. 결과:
   - service → db_table:orders (read)
   - service → db_table:users  (read, JOIN)
```

#### namespace → 서비스 연결

`namespace="com.example.mapper.OrderMapper"`에서 패키지 구조로 서비스 소속 추론.
현재 `currentServiceUrn` 컨텍스트를 그대로 사용하면 무방.

---

### 방안 D. MyBatis Java 어노테이션 SQL 파싱

**대상 파일**: `.java`, `.kt`
**구현 위치**: `scanners/java-kotlin/index.ts` 확장
**파서**: 기존 tree-sitter + `node-sql-parser`

#### 동작 방식

`@Select`, `@Insert`, `@Update`, `@Delete` 어노테이션의 문자열 인수를 추출해
방안 C와 동일한 SQL 파싱 파이프라인에 공급한다.

```java
@Mapper
public interface OrderMapper {
    @Select("SELECT * FROM orders WHERE user_id = #{userId}")
    // → read, db_table:orders

    @Select("""
        SELECT o.*, u.name
        FROM orders o JOIN users u ON o.user_id = u.id
        WHERE o.id = #{id}
    """)
    // → read, db_table:orders + read, db_table:users

    @Insert("INSERT INTO orders (user_id, product_id) VALUES (#{userId}, #{productId})")
    // → write, db_table:orders
}
```

tree-sitter로 어노테이션 텍스트를 추출하면 방안 C의 SQL 파싱 로직을 그대로 재사용할 수 있다.

---

### 방안 E. JAX-RS / Quarkus / Servlet 지원

**대상 파일**: `.java`, `.kt`
**구현 위치**: `scanners/java-kotlin/index.ts` 어노테이션 맵 확장

기존 `SPRING_HTTP_ANNOTATIONS`와 `SPRING_CONTROLLER_ANNOTATIONS`에 항목 추가로 처리 가능하다.
구조 변경 없이 매핑 테이블만 확장하면 된다.

```typescript
// 현재
const SPRING_CONTROLLER_ANNOTATIONS = new Set(['RestController', 'Controller']);
const SPRING_HTTP_ANNOTATIONS = new Map([['GetMapping', 'GET'], ['PostMapping', 'POST'], ...]);

// 확장 후
const CONTROLLER_ANNOTATIONS = new Set([
    'RestController', 'Controller',  // Spring MVC
    'Path',                          // JAX-RS (Jersey, Quarkus, RESTEasy)
]);

const HTTP_METHOD_ANNOTATIONS = new Map([
    // Spring MVC
    ['GetMapping', 'GET'], ['PostMapping', 'POST'], ['PutMapping', 'PUT'],
    ['PatchMapping', 'PATCH'], ['DeleteMapping', 'DELETE'],
    // JAX-RS
    ['GET', 'GET'], ['POST', 'POST'], ['PUT', 'PUT'],
    ['PATCH', 'PATCH'], ['DELETE', 'DELETE'],
    // Micronaut
    ['Get', 'GET'], ['Post', 'POST'], ['Put', 'PUT'],
    ['Patch', 'PATCH'], ['Delete', 'DELETE'],
]);
```

`@WebServlet` 처리:

```java
@WebServlet("/api/orders/*")
public class OrderServlet extends HttpServlet {
    protected void doGet(...)  { ... }  // → api_endpoint:GET:/api/orders/*
    protected void doPost(...) { ... }  // → api_endpoint:POST:/api/orders/*
}
```

`@WebServlet` 어노테이션 탐지 후 클래스 body의 `doGet`/`doPost` 메서드 존재 여부로 HTTP 메서드 결정.

---

## 4. 구현 우선순위

### 우선순위 기준

- **커버리지 임팩트**: 얼마나 많은 실제 코드를 새로 탐지하는가
- **구현 난이도**: 기존 코드 재사용 가능성, 신규 의존성 필요 여부
- **오탐 위험**: 잘못된 관계가 추론될 가능성

### 우선순위 표

| 우선순위 | 방안 | 커버리지 임팩트 | 구현 난이도 | 오탐 위험 | 비고 |
|---------|------|--------------|------------|----------|------|
| **P0** | A. DML JOIN 분석 | 높음 | 낮음 | 낮음 | `node-sql-parser` 재사용, sql-ddl-scanner 확장 |
| **P0** | C. MyBatis XML Scanner | 높음 | 중간 | 낮음 | 한국 레거시 생태계 핵심 |
| **P1** | D. MyBatis Java 어노테이션 | 중간 | 낮음 | 낮음 | C 구현 후 SQL 파싱 로직 재사용 |
| **P1** | E. JAX-RS / Servlet | 중간 | 낮음 | 낮음 | 어노테이션 맵 확장만으로 처리 |
| **P2** | B. Cross-table 컬럼 매칭 | 중간 | 중간 | 높음 | false positive 관리 필요 |

### 구현 순서 및 의존 관계

```
P0 ─┬─ A. DML JOIN 분석
    │    └── sql-ddl-scanner.ts에 DML 파싱 로직 추가
    │        (node-sql-parser 재사용, 추가 의존성 없음)
    │
    └─ C. MyBatis XML Scanner
         └── 신규 xml-mapper-scanner.ts
             └── A에서 구현한 SQL 파싱 로직 공유

P1 ─┬─ D. MyBatis @Select 어노테이션
    │    └── C의 SQL 파싱 파이프라인 재사용
    │        java-kotlin scanner에 어노테이션 탐지 추가
    │
    └─ E. JAX-RS / Servlet
         └── java-kotlin scanner 어노테이션 맵만 확장

P2 ─── B. Cross-table 컬럼 매칭
          └── Pass 1 결과(knownUrns의 db_table 목록) 활용
              pipeline.ts 또는 fk-resolver.ts에 추가
```

### P0 우선 이유

A와 C는 서로 의존 관계가 있다.
A(DML JOIN 파싱)를 먼저 구현하면 그 SQL 파싱 로직을 C(MyBatis XML)에서 그대로 재사용할 수 있다.
두 방안을 묶어 구현하면 **한국 Spring + MyBatis 코드베이스의 관계 탐지율이 크게 향상**된다.

---

## 5. 보완 후 예상 커버리지

### SQL 관계 추론

| 상황 | 현재 | 보완 후 (A + B) |
|------|------|----------------|
| 표준 접미사 (`_id`, `_no`) | ✅ | ✅ |
| 비표준 접미사 (`_fk`, `_seq`, `_cd`) | ❌ | ✅ (A: DML JOIN) |
| Prefix 포함 (`reg_user_no`) | ❌ | ✅ (B: 토큰 매칭, 낮은 confidence) |
| JOIN 없는 암묵적 참조 | ❌ | △ (B: 토큰 매칭, 낮은 confidence) |

### Java 관계/Object 추론

| 상황 | 현재 | 보완 후 (C + D + E) |
|------|------|-------------------|
| Spring `@RestController` | ✅ | ✅ |
| JPA `@Entity` | ✅ | ✅ |
| MyBatis XML Mapper | ❌ | ✅ (C) |
| MyBatis `@Select` 어노테이션 | ❌ | ✅ (D) |
| JAX-RS `@Path` + `@GET` | ❌ | ✅ (E) |
| Servlet `@WebServlet` | ❌ | ✅ (E) |
| Micronaut `@Get` | △ | ✅ (E) |
