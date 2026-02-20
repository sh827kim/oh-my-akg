export type Visibility = 'VISIBLE' | 'HIDDEN';
export type ProjectStatus = 'ACTIVE' | 'ARCHIVED' | 'DELETED';
export type RelationType = 'call' | 'expose' | 'read' | 'write' | 'produce' | 'consume' | 'depend_on';

export const VISIBILITY = {
  VISIBLE: 'VISIBLE' as Visibility,
  HIDDEN: 'HIDDEN' as Visibility,
};

export const DEFAULT_PROJECT_TYPE = 'unknown';
export const DEFAULT_PROJECT_STATUS: ProjectStatus = 'ACTIVE';

export interface ServiceObjectMetadata {
  repo_url?: string;
  description?: string | null;
  project_type?: string;
  status?: ProjectStatus;
  last_seen_at?: string;
}

export function inferProjectType(repoName: string, language?: string | null): string {
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
  return DEFAULT_PROJECT_TYPE;
}

export function normalizeProjectStatus(input?: string | null): ProjectStatus {
  const value = (input || '').toUpperCase();
  if (value === 'ARCHIVED') return 'ARCHIVED';
  if (value === 'DELETED') return 'DELETED';
  return 'ACTIVE';
}

export function buildServiceMetadata(input: {
  repoUrl?: string | null;
  description?: string | null;
  projectType?: string | null;
  status?: string | null;
  lastSeenAt?: string | null;
  existing?: unknown;
}): ServiceObjectMetadata {
  const base = (input.existing && typeof input.existing === 'object')
    ? ({ ...(input.existing as Record<string, unknown>) } as ServiceObjectMetadata)
    : ({} as ServiceObjectMetadata);

  if (typeof input.repoUrl === 'string') base.repo_url = input.repoUrl;
  if (input.description !== undefined) base.description = input.description;
  if (typeof input.projectType === 'string' && input.projectType.trim()) {
    base.project_type = input.projectType.trim();
  } else if (!base.project_type) {
    base.project_type = DEFAULT_PROJECT_TYPE;
  }
  if (input.status !== undefined) {
    base.status = normalizeProjectStatus(input.status);
  } else if (!base.status) {
    base.status = DEFAULT_PROJECT_STATUS;
  }
  if (typeof input.lastSeenAt === 'string' && input.lastSeenAt) {
    base.last_seen_at = input.lastSeenAt;
  }

  return base;
}

export function getProjectTypeFromMetadata(metadata: unknown): string {
  if (!metadata || typeof metadata !== 'object') return DEFAULT_PROJECT_TYPE;
  const value = (metadata as Record<string, unknown>).project_type;
  return typeof value === 'string' && value.trim() ? value : DEFAULT_PROJECT_TYPE;
}

export function getProjectStatusFromMetadata(metadata: unknown): ProjectStatus {
  if (!metadata || typeof metadata !== 'object') return DEFAULT_PROJECT_STATUS;
  const value = (metadata as Record<string, unknown>).status;
  return normalizeProjectStatus(typeof value === 'string' ? value : null);
}
