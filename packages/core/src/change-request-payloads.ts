export interface DependencyUpsertPayload {
  fromId: string;
  toId: string;
  type: string;
  evidence?: string;
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
    type: (input.type || 'unknown').trim() || 'unknown',
    ...(input.evidence ? { evidence: input.evidence } : {}),
  };
}

export function isDependencyUpsertPayload(value: unknown): value is DependencyUpsertPayload {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.fromId === 'string' &&
    typeof v.toId === 'string' &&
    typeof v.type === 'string'
  );
}
