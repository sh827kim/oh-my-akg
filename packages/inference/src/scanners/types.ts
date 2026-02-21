// 추론 엔진 핵심 타입. Object Discovery + Relation Discovery 기반 아키텍처

export type ObjectType =
    | 'service'
    | 'api_endpoint'
    | 'function'
    | 'database'
    | 'db_table'
    | 'db_view'
    | 'cache_instance'
    | 'cache_key'
    | 'message_broker'
    | 'topic'
    | 'queue';

export type AstRelationType =
    | 'call'
    | 'expose'
    | 'read'
    | 'write'
    | 'produce'
    | 'consume'
    | 'depend_on';

export type EvidenceKind =
    | 'import'
    | 'env'
    | 'value'
    | 'call'
    | 'query'
    | 'message'
    | 'route'
    | 'annotation'
    | 'unknown';

export type ReviewLane = 'normal' | 'low_confidence';

export interface EvidenceRecord {
    schemaVersion: 'v1';
    kind: EvidenceKind;
    file: string;
    line?: number;
    symbol?: string;
    snippetHash?: string;
    detail?: string;
}

// 스캐너가 소스에서 발견한 Object 후보
// URN 형식: urn:{org}:{service-name}:{objectType}:{name}
// 예: urn:myorg:order-service:api_endpoint:POST:/api/v1/orders
// 예: urn:myorg:order-service:db_table:orders
// 예: urn:myorg::topic:order.created  (service 비귀속 글로벌 리소스는 service 자리 비움)
export interface DiscoveredObject {
    urn: string;
    objectType: ObjectType;
    name: string;
    displayName?: string;
    parentUrn?: string;       // api_endpoint의 부모 service URN
    granularity: 'COMPOUND' | 'ATOMIC';
    metadata?: Record<string, unknown>;
    evidence: EvidenceRecord;
    confidence: number;
}

// 스캐너가 발견한 Object 간 Relation 후보
export interface DiscoveredRelation {
    subjectUrn: string;
    relationType: AstRelationType;
    targetUrn: string;
    evidence: EvidenceRecord;
    confidence: number;
}

// 스캐너 단위 결과
export interface ScanResult {
    objects: DiscoveredObject[];
    relations: DiscoveredRelation[];
}

// 스캔 시 각 파일에 제공되는 컨텍스트
export interface ScanContext {
    currentServiceUrn: string;  // 현재 repo의 service URN
    orgName: string;            // GitHub org 이름
    // Pass 2에서 사용: Pass 1에서 발견된 모든 Object의 URN 집합
    knownUrns: Set<string>;
}

export interface SourceFile {
    path: string;
    content: string;
}

// Scanner 인터페이스 - 모든 스캐너가 구현
export interface Scanner {
    id: string;
    supports: (filePath: string) => boolean;
    scan: (file: SourceFile, context: ScanContext) => ScanResult;
}

// sync.ts → pipeline.ts 사이의 inference 옵션
export interface InferenceOptions {
    astPluginsEnabled?: boolean;   // tree-sitter 기반 Java/Python 스캐너 활성화
    fallbackEnabled?: boolean;     // 설정 파일 기반 env 스캐너 활성화
}

// 파이프라인 전체 결과
export interface InferencePipelineResult {
    objectCandidates: ObjectCreateCandidate[];    // OBJECT_CREATE change request 대상
    relationCandidates: RelationCreateCandidate[]; // RELATION_UPSERT change request 대상
    metrics: PipelineMetrics;
}

// OBJECT_CREATE change request payload 후보
export interface ObjectCreateCandidate {
    urn: string;
    objectType: ObjectType;
    name: string;
    displayName?: string;
    parentUrn?: string;
    granularity: 'COMPOUND' | 'ATOMIC';
    metadata?: Record<string, unknown>;
    source: 'inference';
    confidence: number;
    evidence: string;          // stringified EvidenceRecord
    scoreVersion: string;
    reviewLane: ReviewLane;
    tags: string[];
}

// RELATION_UPSERT change request payload 후보
export interface RelationCreateCandidate {
    fromId: string;            // subject URN
    toId: string;              // target URN
    type: AstRelationType;
    source: 'inference';
    confidence: number;
    evidence: string;          // stringified EvidenceRecord
    scoreVersion: string;
    reviewLane: ReviewLane;
    reviewTag: 'LOW_CONFIDENCE' | 'NORMAL';
    tags: string[];
}

export interface PipelineMetrics {
    mode: 'full' | 'fallback' | 'disabled';
    repoCount: number;
    configFilesScanned: number;
    sourceFilesScanned: number;
    objectsDiscovered: number;
    relationsDiscovered: number;
    lowConfidenceCount: number;
    avgConfidence: number;
    failures: number;
    durationMs: number;
    throughputPerSec: number;
}
