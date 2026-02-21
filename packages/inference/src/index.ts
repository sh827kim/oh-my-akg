// @archi-navi/inference public API
// 구 API (env-auto-mapping 기반)는 하위 호환을 위해 유지

// 신규 파이프라인 API
export { runInferencePipeline } from './pipeline';

// 타입 re-export
export type {
    Scanner,
    ScanResult,
    ScanContext,
    SourceFile,
    DiscoveredObject,
    DiscoveredRelation,
    ObjectType,
    AstRelationType,
    EvidenceRecord,
    EvidenceKind,
    ReviewLane,
    InferenceOptions,
    InferencePipelineResult,
    ObjectCreateCandidate,
    RelationCreateCandidate,
    PipelineMetrics,
} from './scanners/types';

// 기존 API 유지 (sync.ts 등 기존 호출부와의 호환성)
export {
    inferEnvMappingCandidates,
    inferEnvMappingCandidatesWithMetrics,
} from './env-auto-mapping';
export type {
    MappingCandidate,
    InferenceMetrics,
    InferenceResult,
} from './env-auto-mapping';
