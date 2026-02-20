export type Visibility = 'VISIBLE' | 'HIDDEN';

export const VISIBILITY = {
  VISIBLE: 'VISIBLE' as Visibility,
  HIDDEN: 'HIDDEN' as Visibility,
};

export const DEFAULT_PROJECT_TYPE = 'unknown';

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
