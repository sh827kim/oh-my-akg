import type { RelationType } from './project-model';

export interface DependencyUpsertPayload {
  fromId: string;
  toId: string;
  type: RelationType;
  evidence?: string;
}

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

export function buildDependencyUpsertPayload(input: {
  fromId: string;
  toId: string;
  type?: string | null;
  evidence?: string;
}): DependencyUpsertPayload {
  return {
    fromId: input.fromId,
    toId: input.toId,
    type: normalizeRelationType(input.type),
    ...(input.evidence ? { evidence: input.evidence } : {}),
  };
}

export function isDependencyUpsertPayload(value: unknown): value is DependencyUpsertPayload {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.fromId === 'string' &&
    typeof v.toId === 'string' &&
    typeof v.type === 'string' &&
    v.fromId.trim().length > 0 &&
    v.toId.trim().length > 0
  );
}
