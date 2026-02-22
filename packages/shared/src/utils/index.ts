import { v7 as uuidv7 } from 'uuid';

/**
 * UUID v7 생성 - 시간순 정렬이 가능한 UUID
 * 데이터베이스 인덱스 성능에 유리
 */
export function generateId(): string {
  return uuidv7();
}

/**
 * URN 생성
 * 형식: urn:{workspace}:{category}:{type}:{normalized_path}
 */
export function buildUrn(
  workspaceId: string,
  category: string,
  type: string,
  normalizedPath: string,
): string {
  return `urn:${workspaceId}:${category.toLowerCase()}:${type}:${normalizedPath}`;
}

/**
 * Materialized path 생성
 * 부모 경로와 자신의 ID로 경로 구성
 */
export function buildPath(parentPath: string | null, id: string): string {
  if (!parentPath || parentPath === '/') {
    return `/${id}`;
  }
  return `${parentPath}/${id}`;
}

/**
 * Affinity 분포 정규화 (합이 1.0이 되도록)
 */
export function normalizeAffinity(scores: Record<string, number>): Record<string, number> {
  const total = Object.values(scores).reduce((sum, v) => sum + v, 0);
  if (total === 0) return scores;
  return Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, v / total]));
}

/**
 * Purity 계산 (최대 affinity 값)
 */
export function calculatePurity(affinity: Record<string, number>): number {
  const values = Object.values(affinity);
  if (values.length === 0) return 0;
  return Math.max(...values);
}

/**
 * Primary domain 추출 (가장 높은 affinity)
 */
export function getPrimaryDomain(affinity: Record<string, number>): string | null {
  if (Object.keys(affinity).length === 0) return null;
  return Object.entries(affinity).sort(([, a], [, b]) => b - a)[0]?.[0] ?? null;
}

/**
 * Secondary domains 추출 (threshold 이상, primary 제외)
 */
export function getSecondaryDomains(
  affinity: Record<string, number>,
  threshold: number = 0.25,
): string[] {
  const primary = getPrimaryDomain(affinity);
  return Object.entries(affinity)
    .filter(([id, score]) => id !== primary && score >= threshold)
    .sort(([, a], [, b]) => b - a)
    .map(([id]) => id);
}

/**
 * Score에 합산 후 경로 점수 계산
 * 설계 문서의 Path Score 공식 구현
 */
export function calculatePathScore(
  avgConfidence: number,
  minEdgeWeight: number,
  hops: number,
): number {
  const hopsPenalty = 1 + (hops - 1) * 0.1;
  return (avgConfidence * Math.log(1 + minEdgeWeight)) / hopsPenalty;
}
