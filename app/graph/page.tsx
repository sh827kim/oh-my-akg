import { getDb } from '@/lib/db';
import { DependencyGraph } from '@/components/dependency-graph';
import { SidePanel } from '@/components/side-panel';

export const dynamic = 'force-dynamic';

interface PageProps {
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

interface GraphNodeRow {
    id: string;
    label: string;
    type: string;
}

interface GraphEdgeRow {
    id: number;
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
    const typeResult = await db.query<ProjectTypeRow>(
        `
          SELECT name, color_hex
          FROM project_types
        `
    );
    const typeColorMap = new Map<string, string>(
        typeResult.rows.map((row) => [row.name, row.color_hex])
    );

    const projects = await db.query<GraphNodeRow>(`
    SELECT id, COALESCE(NULLIF(alias, ''), repo_name) AS label, type
    FROM projects 
    WHERE visibility = 'VISIBLE'
      AND status = 'ACTIVE'
    ORDER BY repo_name ASC
  `);

    // Keep only edges whose both ends are active + visible
    const edges = await db.query<GraphEdgeRow>(`
    SELECT e.id, e.from_id as source, e.to_id as target, e.type
    FROM edges e
    JOIN projects p_from ON p_from.id = e.from_id
    JOIN projects p_to ON p_to.id = e.to_id
    WHERE p_from.visibility = 'VISIBLE'
      AND p_from.status = 'ACTIVE'
      AND p_to.visibility = 'VISIBLE'
      AND p_to.status = 'ACTIVE'
      AND e.approved = TRUE
    ORDER BY e.id ASC
  `);

    const nodes = projects.rows.map(p => ({
        data: {
            id: p.id,
            label: p.label,
            type: p.type,
            color: getNodeColor(p.type, typeColorMap),
        }
    }));

    const graphEdges = edges.rows.map(e => ({
        data: {
            id: `e-${e.id}`,
            source: e.source,
            target: e.target,
            type: e.type
        }
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
                <DependencyGraph
                    data={data}
                    selectedNodeId={nodeId}
                    searchQuery={searchQuery}
                />
                {nodeId && <SidePanel nodeId={nodeId} searchQuery={searchQuery} />}
            </div>
        </div>
    );
}
