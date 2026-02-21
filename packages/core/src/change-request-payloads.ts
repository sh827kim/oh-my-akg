import type { RelationType } from './project-model';

export type RelationSource = 'manual' | 'scan' | 'inference' | 'rollup';
export type InferenceReviewTag = 'LOW_CONFIDENCE' | 'NORMAL';

export interface DependencyUpsertPayload {
  fromId: string;
  toId: string;
  type: RelationType;
  source: RelationSource;
  confidence?: number;
  evidence?: string;
  scoreVersion?: string;
  reviewTag?: InferenceReviewTag;
  tags?: string[];
}

const RELATION_SOURCES: RelationSource[] = ['manual', 'scan', 'inference', 'rollup'];
const SOURCES_REQUIRING_SIGNAL = new Set<RelationSource>(['scan', 'inference']);
const REVIEW_TAGS: InferenceReviewTag[] = ['LOW_CONFIDENCE', 'NORMAL'];

const LEGACY_TO_RELATION: Array<{ pattern: RegExp; relationType: RelationType }> = [
  { pattern: /^(http|https|grpc|rpc|api|rest|feign|client|call)$/i, relationType: 'call' },
  { pattern: /^(sql|db|query|select|read)$/i, relationType: 'read' },
  { pattern: /^(insert|update|delete|write)$/i, relationType: 'write' },
  { pattern: /^(kafka|topic|produce|publish|producer)$/i, relationType: 'produce' },
  { pattern: /^(consume|consumer|subscribe)$/i, relationType: 'consume' },
  { pattern: /^(expose|endpoint)$/i, relationType: 'expose' },
];

export function normalizeRelationType(input?: string | null): RelationType {
  const value = (input || '').trim();
  if (!value) return 'depend_on';

  const lower = value.toLowerCase() as RelationType;
  if (['call', 'expose', 'read', 'write', 'produce', 'consume', 'depend_on'].includes(lower)) {
    return lower;
  }

  for (const entry of LEGACY_TO_RELATION) {
    if (entry.pattern.test(value)) return entry.relationType;
  }

  return 'depend_on';
}

function normalizeRelationSource(input?: string | null, fallback: RelationSource = 'manual'): RelationSource {
  const value = (input || '').trim();
  if (!value) return fallback;
  const lower = value.toLowerCase() as RelationSource;
  if (RELATION_SOURCES.includes(lower)) return lower;
  throw new Error('DEP_PAYLOAD_SOURCE_INVALID');
}

function normalizeConfidence(input: unknown): number | undefined {
  if (input === undefined || input === null || input === '') {
    return undefined;
  }

  const numeric = typeof input === 'number' ? input : Number(input);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 1) {
    throw new Error('DEP_PAYLOAD_CONFIDENCE_INVALID');
  }

  return Number(numeric.toFixed(3));
}

function normalizeEvidence(input: unknown): string | undefined {
  if (input === undefined || input === null) return undefined;
  if (typeof input !== 'string') {
    throw new Error('DEP_PAYLOAD_EVIDENCE_INVALID');
  }

  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeScoreVersion(input: unknown): string | undefined {
  if (input === undefined || input === null) return undefined;
  if (typeof input !== 'string') throw new Error('DEP_PAYLOAD_SCORE_VERSION_INVALID');
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeReviewTag(input: unknown): InferenceReviewTag | undefined {
  if (input === undefined || input === null || input === '') return undefined;
  const value = String(input).trim().toUpperCase() as InferenceReviewTag;
  if (!REVIEW_TAGS.includes(value)) throw new Error('DEP_PAYLOAD_REVIEW_TAG_INVALID');
  return value;
}

function normalizeTags(input: unknown): string[] | undefined {
  if (input === undefined || input === null) return undefined;
  if (!Array.isArray(input)) throw new Error('DEP_PAYLOAD_TAGS_INVALID');
  const normalized = input
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
  if (normalized.length === 0) return undefined;
  return Array.from(new Set(normalized));
}

export function parseDependencyUpsertPayload(
  value: unknown,
  options: { defaultSource?: RelationSource } = {},
): DependencyUpsertPayload {
  if (!value || typeof value !== 'object') {
    throw new Error('DEP_PAYLOAD_INVALID');
  }

  const record = value as Record<string, unknown>;
  const fromId = typeof record.fromId === 'string' ? record.fromId.trim() : '';
  const toId = typeof record.toId === 'string' ? record.toId.trim() : '';

  if (!fromId) throw new Error('DEP_PAYLOAD_FROM_REQUIRED');
  if (!toId) throw new Error('DEP_PAYLOAD_TO_REQUIRED');

  const source = normalizeRelationSource(
    typeof record.source === 'string' ? record.source : undefined,
    options.defaultSource ?? 'manual',
  );
  const confidence = normalizeConfidence(record.confidence);
  const evidence = normalizeEvidence(record.evidence);
  const scoreVersion = normalizeScoreVersion(record.scoreVersion);
  const reviewTag = normalizeReviewTag(record.reviewTag);
  const tags = normalizeTags(record.tags);

  if (SOURCES_REQUIRING_SIGNAL.has(source) && confidence === undefined) {
    throw new Error('DEP_PAYLOAD_CONFIDENCE_REQUIRED');
  }
  if (SOURCES_REQUIRING_SIGNAL.has(source) && !evidence) {
    throw new Error('DEP_PAYLOAD_EVIDENCE_REQUIRED');
  }

  return {
    fromId,
    toId,
    type: normalizeRelationType(typeof record.type === 'string' ? record.type : undefined),
    source,
    ...(confidence !== undefined ? { confidence } : {}),
    ...(evidence ? { evidence } : {}),
    ...(scoreVersion ? { scoreVersion } : {}),
    ...(reviewTag ? { reviewTag } : {}),
    ...(tags ? { tags } : {}),
  };
}

export function buildDependencyUpsertPayload(input: {
  fromId: string;
  toId: string;
  type?: string | null;
  source?: string | null;
  confidence?: number | string | null;
  evidence?: string | null;
  scoreVersion?: string | null;
  reviewTag?: string | null;
  tags?: string[] | null;
}): DependencyUpsertPayload {
  return parseDependencyUpsertPayload({
    fromId: input.fromId,
    toId: input.toId,
    type: input.type,
    source: input.source ?? 'inference',
    confidence: input.confidence,
    evidence: input.evidence,
    scoreVersion: input.scoreVersion,
    reviewTag: input.reviewTag,
    tags: input.tags,
  });
}

export function isDependencyUpsertPayload(value: unknown): value is DependencyUpsertPayload {
  try {
    parseDependencyUpsertPayload(value);
    return true;
  } catch {
    return false;
  }
}
