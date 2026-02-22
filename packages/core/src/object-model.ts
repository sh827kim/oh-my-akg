export type Visibility = 'VISIBLE' | 'HIDDEN';
export type ObjectStatus = 'ACTIVE' | 'ARCHIVED' | 'DELETED';
export type RelationType = 'call' | 'expose' | 'read' | 'write' | 'produce' | 'consume' | 'depend_on';

export const VISIBILITY = {
  VISIBLE: 'VISIBLE' as Visibility,
  HIDDEN: 'HIDDEN' as Visibility,
};

export const DEFAULT_SERVICE_TYPE = 'unknown';
export const DEFAULT_OBJECT_STATUS: ObjectStatus = 'ACTIVE';

export interface ServiceObjectMetadata {
  repo_url?: string;
  description?: string | null;
  service_type?: string;
  status?: ObjectStatus;
  last_seen_at?: string;
}

export function inferServiceType(repoName: string, language?: string | null): string {
  const name = repoName.toLowerCase();
  const lang = (language || '').toLowerCase();

  if (/frontend|web|ui|portal|bff|dashboard|mobile|ios|android/.test(name)) {
    return 'frontend';
  }
  if (/gateway|api|service|backend|server|worker|batch/.test(name)) {
    return 'backend';
  }
  if (/kafka|redis|postgres|mysql|mongo|elastic|infra|middleware/.test(name)) {
    return 'middleware';
  }
  if (['typescript', 'javascript', 'tsx', 'jsx'].includes(lang)) {
    return 'frontend';
  }
  if (['go', 'java', 'kotlin', 'python', 'rust', 'c#'].includes(lang)) {
    return 'backend';
  }
  return DEFAULT_SERVICE_TYPE;
}

export function normalizeObjectStatus(input?: string | null): ObjectStatus {
  const value = (input || '').toUpperCase();
  if (value === 'ARCHIVED') return 'ARCHIVED';
  if (value === 'DELETED') return 'DELETED';
  return 'ACTIVE';
}

export function buildServiceMetadata(input: {
  repoUrl?: string | null;
  description?: string | null;
  serviceType?: string | null;
  status?: string | null;
  lastSeenAt?: string | null;
  existing?: unknown;
}): ServiceObjectMetadata {
  const base = (input.existing && typeof input.existing === 'object')
    ? ({ ...(input.existing as Record<string, unknown>) } as ServiceObjectMetadata)
    : ({} as ServiceObjectMetadata);

  if (typeof input.repoUrl === 'string') base.repo_url = input.repoUrl;
  if (input.description !== undefined) base.description = input.description;
  if (typeof input.serviceType === 'string' && input.serviceType.trim()) {
    base.service_type = input.serviceType.trim();
  } else if (!base.service_type) {
    base.service_type = DEFAULT_SERVICE_TYPE;
  }
  if (input.status !== undefined) {
    base.status = normalizeObjectStatus(input.status);
  } else if (!base.status) {
    base.status = DEFAULT_OBJECT_STATUS;
  }
  if (typeof input.lastSeenAt === 'string' && input.lastSeenAt) {
    base.last_seen_at = input.lastSeenAt;
  }

  return base;
}

export function getServiceTypeFromMetadata(metadata: unknown): string {
  if (!metadata || typeof metadata !== 'object') return DEFAULT_SERVICE_TYPE;
  const value = (metadata as Record<string, unknown>).service_type;
  return typeof value === 'string' && value.trim() ? value : DEFAULT_SERVICE_TYPE;
}

export function getObjectStatusFromMetadata(metadata: unknown): ObjectStatus {
  if (!metadata || typeof metadata !== 'object') return DEFAULT_OBJECT_STATUS;
  const value = (metadata as Record<string, unknown>).status;
  return normalizeObjectStatus(typeof value === 'string' ? value : null);
}
