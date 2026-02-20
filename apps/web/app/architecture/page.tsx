import { getDb } from '@/lib/db';
import { ArchitectureGraph } from '@/components/architecture-graph';
import { SidePanel } from '@/components/side-panel';
import { materializeRollup } from '@/packages/core/src/rollup';

export const dynamic = 'force-dynamic';

interface PageProps {
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

interface ArchitectureNodeRow {
    id: string;
    repo_name: string;
    label: string;
    type: string;
}

interface ArchitectureEdgeRow {
    id: number;
    source: string;
    target: string;
    type: string;
}

interface ProjectTypeRow {
    id: number;
    name: string;
    color_hex: string;
    sort_order: number;
    enabled: boolean;
}

interface LayerDef {
    key: string;
    label: string;
    color: string;
    sortOrder: number;
}

async function getArchitectureData() {
    const db = await getDb();

    const [projectTypeResult, projectsResult, edgesResult] = await Promise.all([
        db.query<ProjectTypeRow>(`
          SELECT id, name, color_hex, sort_order, enabled
          FROM project_types
          ORDER BY sort_order ASC, id ASC
        `),
        db.query<ArchitectureNodeRow>(`
          SELECT
            id,
            repo_name,
            COALESCE(NULLIF(alias, ''), repo_name) AS label,
            type
          FROM projects
          WHERE visibility = 'VISIBLE'
            AND status = 'ACTIVE'
          ORDER BY repo_name ASC
        `),
        db.query<ArchitectureEdgeRow>(`
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
        `),
    ]);

    const layers: LayerDef[] = projectTypeResult.rows
        .filter((row) => row.enabled)
        .map((row) => ({
            key: row.name,
            label: row.name,
            color: row.color_hex,
            sortOrder: row.sort_order,
        }));

    if (!layers.some((layer) => layer.key === 'unknown')) {
        layers.push({
            key: 'unknown',
            label: 'unknown',
            color: '#6b7280',
            sortOrder: 9999,
        });
    }

    const orderedLayers = [...layers].sort((a, b) => a.sortOrder - b.sortOrder);
    const colorMap = new Map<string, string>(orderedLayers.map((layer) => [layer.key, layer.color]));

    const grouped = new Map<string, ArchitectureNodeRow[]>();
    for (const layer of orderedLayers) {
        grouped.set(layer.key, []);
    }

    for (const row of projectsResult.rows) {
        const layerKey = grouped.has(row.type) ? row.type : 'unknown';
        grouped.get(layerKey)?.push(row);
    }

    const maxPerLayer = Math.max(1, ...orderedLayers.map((layer) => grouped.get(layer.key)?.length ?? 0));
    const totalWidth = Math.max(420, maxPerLayer * 220);
    const layerSpacing = 170;
    const layerBaseY = 120;

    // Top-down: smaller sort_order appears in upper layer.
    const layerNodes = orderedLayers.map((layer, layerIndex) => ({
        data: {
            id: `layer-${layer.key}`,
            label: layer.label,
            type: 'layer',
            color: layer.color,
        },
        position: {
            x: Math.max(220, totalWidth / 2),
            y: layerBaseY + layerIndex * layerSpacing,
        },
    }));

    const projectNodes = orderedLayers.flatMap((layer, layerIndex) => {
        const items = grouped.get(layer.key) ?? [];
        const y = layerBaseY + layerIndex * layerSpacing + 52;

        return items.map((project, itemIndex) => ({
            data: {
                id: project.id,
                label: project.label,
                type: project.type,
                color: colorMap.get(project.type) ?? '#6b7280',
                layer: layer.key,
            },
            position: {
                x: 120 + itemIndex * 220,
                y,
            },
        }));
    });

    const rolledEdges = materializeRollup(
        edgesResult.rows.map((edge) => ({ source: edge.source, target: edge.target, type: edge.type || 'unknown' }))
    );

    const edges = rolledEdges.map((edge, index) => ({
        data: {
            id: `e-${index + 1}`,
            source: edge.source,
            target: edge.target,
            type: edge.relationType || 'unknown',
        },
    }));

    const edgeTypes = Array.from(new Set(edges.map((edge) => edge.data.type))).sort((a, b) =>
        a.localeCompare(b)
    );

    return {
        nodes: [...layerNodes, ...projectNodes],
        edges,
        edgeTypes,
        legendTypes: orderedLayers,
    };
}

export default async function ArchitecturePage({ searchParams }: PageProps) {
    const data = await getArchitectureData();
    const params = await searchParams;
    const nodeId = typeof params.node === 'string' ? params.node : undefined;
    const searchQuery = typeof params.q === 'string' ? params.q : '';

    return (
        <div className="relative flex h-full flex-col p-6">
            <div className="mb-6 flex items-center justify-between gap-4">
                <div>
                    <h1 className="bg-gradient-to-r from-white to-gray-400 bg-clip-text text-2xl font-bold text-transparent">
                        System Architecture
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        Settings의 Type 순서를 반영한 Top-down 레이어 뷰
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    {data.legendTypes.map((type) => (
                        <span
                            key={type.key}
                            className="flex items-center rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs text-gray-300"
                        >
                            <span
                                className="mr-2 h-2 w-2 rounded-full"
                                style={{ backgroundColor: type.color }}
                            />
                            {type.label}
                        </span>
                    ))}
                </div>
            </div>
            <div className="relative min-h-[600px] flex-1 overflow-hidden rounded-xl border border-white/10 bg-black/20 shadow-inner backdrop-blur-sm">
                <ArchitectureGraph
                    data={{ nodes: data.nodes, edges: data.edges }}
                    edgeTypes={data.edgeTypes}
                    selectedNodeId={nodeId}
                    searchQuery={searchQuery}
                />
                {nodeId && <SidePanel nodeId={nodeId} searchQuery={searchQuery} />}
            </div>
        </div>
    );
}
