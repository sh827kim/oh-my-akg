import type {
  OBJECT_TYPES,
  OBJECT_CATEGORIES,
  OBJECT_GRANULARITIES,
  RELATION_TYPES,
  INTERACTION_KINDS,
  DIRECTIONS,
  ROLLUP_LEVELS,
  QUERY_TYPES,
  VISIBILITY_OPTIONS,
  RELATION_SOURCES,
  CANDIDATE_STATUSES,
  DOMAIN_AFFINITY_SOURCES,
  DOMAIN_KINDS,
  DISCOVERY_ALGOS,
  GENERATION_STATUSES,
  SUPPORTED_LANGUAGES,
  EVIDENCE_TYPES,
  GRAPH_DIRECTIONS,
} from '../constants/index';

// === 기본 유틸리티 타입 ===

/** 배열 타입에서 원소 타입 추출 */
export type ArrayElement<T extends readonly unknown[]> = T[number];

/** Object 타입 유니온 */
export type ObjectType = ArrayElement<typeof OBJECT_TYPES>;

/** Object 카테고리 유니온 */
export type ObjectCategory = ArrayElement<typeof OBJECT_CATEGORIES>;

/** Object 세분도 유니온 */
export type ObjectGranularity = ArrayElement<typeof OBJECT_GRANULARITIES>;

/** Relation 타입 유니온 */
export type RelationType = ArrayElement<typeof RELATION_TYPES>;

/** Interaction Kind 유니온 */
export type InteractionKind = ArrayElement<typeof INTERACTION_KINDS>;

/** Direction 유니온 */
export type Direction = ArrayElement<typeof DIRECTIONS>;

/** Roll-up 레벨 유니온 */
export type RollupLevel = ArrayElement<typeof ROLLUP_LEVELS>;

/** Query 타입 유니온 */
export type QueryType = ArrayElement<typeof QUERY_TYPES>;

/** 가시성 유니온 */
export type Visibility = ArrayElement<typeof VISIBILITY_OPTIONS>;

/** Relation 소스 유니온 */
export type RelationSource = ArrayElement<typeof RELATION_SOURCES>;

/** 후보 상태 유니온 */
export type CandidateStatus = ArrayElement<typeof CANDIDATE_STATUSES>;

/** Domain 소속 소스 유니온 */
export type DomainAffinitySource = ArrayElement<typeof DOMAIN_AFFINITY_SOURCES>;

/** Domain 종류 유니온 */
export type DomainKind = ArrayElement<typeof DOMAIN_KINDS>;

/** 커뮤니티 탐지 알고리즘 유니온 */
export type DiscoveryAlgo = ArrayElement<typeof DISCOVERY_ALGOS>;

/** Generation 상태 유니온 */
export type GenerationStatus = ArrayElement<typeof GENERATION_STATUSES>;

/** 지원 언어 유니온 */
export type SupportedLanguage = ArrayElement<typeof SUPPORTED_LANGUAGES>;

/** Evidence 타입 유니온 */
export type EvidenceType = ArrayElement<typeof EVIDENCE_TYPES>;

/** 그래프 탐색 방향 유니온 */
export type GraphDirection = ArrayElement<typeof GRAPH_DIRECTIONS>;

// === 도메인 엔티티 타입 ===

/** Object 엔티티 */
export interface ObjectEntity {
  id: string;
  workspaceId: string;
  objectType: ObjectType;
  category: ObjectCategory | 'META' | null;
  granularity: ObjectGranularity;
  urn: string | null;
  name: string;
  displayName: string | null;
  description: string | null;
  parentId: string | null;
  path: string;
  depth: number;
  visibility: Visibility;
  metadata: Record<string, unknown>;
  validFrom: Date | null;
  validTo: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Relation 엔티티 (확정) */
export interface RelationEntity {
  id: string;
  workspaceId: string;
  relationType: RelationType;
  subjectObjectId: string;
  objectId: string;
  interactionKind: InteractionKind | null;
  direction: Direction | null;
  isDerived: boolean;
  confidence: number | null;
  metadata: Record<string, unknown>;
  source: RelationSource;
  validFrom: Date | null;
  validTo: Date | null;
  createdAt: Date;
}

/** Relation 후보 (미승인) */
export interface RelationCandidate {
  id: string;
  workspaceId: string;
  relationType: RelationType;
  subjectObjectId: string;
  objectId: string;
  confidence: number;
  metadata: Record<string, unknown>;
  status: CandidateStatus;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  createdAt: Date;
}

/** Roll-up 결과 */
export interface RollupEntity {
  id: string;
  workspaceId: string;
  rollupLevel: RollupLevel;
  relationType: RelationType;
  subjectObjectId: string;
  objectId: string;
  edgeWeight: number;
  confidence: number | null;
  generationVersion: number;
  createdAt: Date;
}

/** Domain Affinity */
export interface DomainAffinity {
  id: string;
  workspaceId: string;
  objectId: string;
  domainId: string;
  affinity: number;
  confidence: number | null;
  source: DomainAffinitySource;
  generationVersion: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Evidence */
export interface EvidenceEntity {
  id: string;
  workspaceId: string;
  evidenceType: EvidenceType;
  filePath: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  excerpt: string | null;
  uri: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

// === API 공통 응답 타입 ===

/** API 성공 응답 */
export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  meta?: {
    total?: number;
    page?: number;
    pageSize?: number;
    generationVersion?: number;
  };
}

/** API 에러 응답 */
export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/** API 응답 (성공 | 에러) */
export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

// === Query Engine 타입 ===

/** Query 범위 */
export interface QueryScope {
  level: RollupLevel;
  relationTypes?: RelationType[];
  visibility: 'VISIBLE_ONLY' | 'INCLUDE_HIDDEN';
  tagIds?: string[];
  objectTypes?: ObjectType[];
}

/** Query 파라미터 */
export interface QueryParams {
  fromObjectId?: string;
  toObjectId?: string;
  targetObjectId?: string;
  objectId?: string;
  domainId?: string;
  direction?: 'UPSTREAM' | 'DOWNSTREAM' | 'BOTH';
  maxHops?: number;
  maxDepth?: number;
  topK?: number;
}

/** Query 요청 */
export interface QueryRequest {
  workspaceId: string;
  generationVersion?: number;
  queryType: QueryType;
  scope: QueryScope;
  params: QueryParams;
}

/** Query 결과 노드 */
export interface QueryNode {
  id: string;
  type: ObjectType;
  name: string;
  displayName?: string;
  depth?: number;
  metadata?: Record<string, unknown>;
}

/** Query 결과 엣지 */
export interface QueryEdge {
  subjectId: string;
  objectId: string;
  relationType: RelationType;
  level: RollupLevel;
  edgeWeight: number;
  confidence: number;
  provenance: {
    rollupId: string;
    baseRelationIds: string[];
  };
}

/** Query 결과 경로 */
export interface QueryPath {
  pathId: string;
  nodeIds: string[];
  score: number;
}

/** Query 응답 */
export interface QueryResponse {
  queryType: QueryType;
  result: {
    nodes: QueryNode[];
    edges: QueryEdge[];
    paths?: QueryPath[];
    summary?: Record<string, unknown>;
  };
  meta: {
    generationVersion: number;
    computedAt: string;
    executionMs: number;
    truncated: boolean;
  };
}
