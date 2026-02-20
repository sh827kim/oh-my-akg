export interface EdgeLike {
  source: string;
  target: string;
  type: string;
}

export interface RolledEdge {
  source: string;
  target: string;
  relationType: string;
}

/**
 * Minimal materialized roll-up helper: dedupes relation edges by source/target/type.
 * Canonical relation storage uses `object_relations`; this helper keeps roll-up logic centralized.
 */
export function materializeRollup(edges: EdgeLike[]): RolledEdge[] {
  const seen = new Set<string>();
  const out: RolledEdge[] = [];

  for (const e of edges) {
    const key = `${e.source}|${e.target}|${e.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      source: e.source,
      target: e.target,
      relationType: e.type,
    });
  }

  return out;
}
