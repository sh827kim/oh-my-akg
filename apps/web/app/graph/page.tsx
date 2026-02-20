import { getDb } from '@archi-navi/core';
import { DependencyGraph } from '@/components/dependency-graph';
import { SidePanel } from '@/components/side-panel';
import { materializeRollup } from '@archi-navi/core';
import { getProjectTypeFromMetadata } from '@archi-navi/core';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

interface GraphNodeRow {
  id: string;
  object_id: string;
  label: string;
  metadata: unknown;
}

interface GraphEdgeRow {
  id: string;
  source: string;
  target: string;
  type: string;
}

interface ProjectTypeRow {
  name: string;
  color_hex: string;
}

function getNodeColor(type: string, colorMap: Map<string, string>) {
  return colorMap.get(type) ?? '#6b7280';
}

async function getGraphData() {
  const db = await getDb();
  const typeResult = await db.query<ProjectTypeRow>(`
    SELECT name, color_hex
    FROM project_types
  `);
  const typeColorMap = new Map<string, string>(typeResult.rows.map((row) => [row.name, row.color_hex]));

  const projects = await db.query<GraphNodeRow>(`
    SELECT
      o.urn AS id,
      o.id AS object_id,
      COALESCE(NULLIF(o.display_name, ''), o.name) AS label,
      o.metadata
    FROM objects o
    WHERE o.workspace_id = 'default'
      AND o.object_type = 'service'
      AND o.urn IS NOT NULL
      AND o.visibility = 'VISIBLE'
      AND COALESCE(o.metadata->>'status', 'ACTIVE') = 'ACTIVE'
    ORDER BY o.name ASC
  `);

  const edges = await db.query<GraphEdgeRow>(`
    SELECT
      r.id::text AS id,
      o_from.urn AS source,
      o_to.urn AS target,
      r.relation_type AS type
    FROM object_relations r
    JOIN objects o_from ON o_from.id = r.subject_object_id
    JOIN objects o_to ON o_to.id = r.target_object_id
    WHERE r.workspace_id = 'default'
      AND r.approved = TRUE
      AND o_from.object_type = 'service'
      AND o_to.object_type = 'service'
      AND o_from.visibility = 'VISIBLE'
      AND o_to.visibility = 'VISIBLE'
      AND COALESCE(o_from.metadata->>'status', 'ACTIVE') = 'ACTIVE'
      AND COALESCE(o_to.metadata->>'status', 'ACTIVE') = 'ACTIVE'
      AND o_from.urn IS NOT NULL
      AND o_to.urn IS NOT NULL
    ORDER BY r.created_at ASC
  `);

  const nodes = projects.rows.map((p) => {
    const type = getProjectTypeFromMetadata(p.metadata);
    return {
      data: {
        id: p.id,
        label: p.label,
        type,
        color: getNodeColor(type, typeColorMap),
      },
    };
  });

  const rolledEdges = materializeRollup(
    edges.rows.map((e) => ({ source: e.source, target: e.target, type: e.type })),
  );

  const graphEdges = rolledEdges.map((e, index) => ({
    data: {
      id: `e-${index + 1}`,
      source: e.source,
      target: e.target,
      type: e.relationType,
    },
  }));

  return { nodes, edges: graphEdges };
}

export default async function GraphPage({ searchParams }: PageProps) {
  const data = await getGraphData();
  const params = await searchParams;
  const nodeId = typeof params.node === 'string' ? params.node : undefined;
  const searchQuery = typeof params.q === 'string' ? params.q : '';

  return (
    <div className="flex h-full flex-col relative p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
            Dependency Graph
          </h1>
          <p className="text-sm text-muted-foreground">Network visualization of project dependencies</p>
        </div>
      </div>
      <div className="flex-1 min-h-[600px] overflow-hidden rounded-xl border border-white/10 bg-black/20 shadow-inner relative backdrop-blur-sm">
        <DependencyGraph data={data} selectedNodeId={nodeId} searchQuery={searchQuery} />
        {nodeId && <SidePanel nodeId={nodeId} searchQuery={searchQuery} />}
      </div>
    </div>
  );
}
