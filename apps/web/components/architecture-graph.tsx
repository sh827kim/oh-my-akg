'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Download, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

interface NodeElement {
    data: {
        id: string;
        label: string;
        type: string;
        color?: string;
        layer?: string;
    };
    position?: {
        x: number;
        y: number;
    };
}

interface EdgeElement {
    data: {
        id: string;
        source: string;
        target: string;
        type?: string;
    };
}

interface GraphData {
    nodes: NodeElement[];
    edges: EdgeElement[];
}

interface ArchitectureGraphProps {
    data: GraphData;
    edgeTypes: string[];
    selectedNodeId?: string;
    searchQuery?: string;
}

export function ArchitectureGraph({
    data,
    edgeTypes,
    selectedNodeId,
    searchQuery,
}: ArchitectureGraphProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const cyRef = useRef<cytoscape.Core | null>(null);

    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const [graphData, setGraphData] = useState<GraphData>(data);
    const [hideTarget, setHideTarget] = useState<{ id: string; label: string } | null>(null);
    const [isHiding, setIsHiding] = useState(false);
    const [edgeVisibility, setEdgeVisibility] = useState<Record<string, boolean>>({});

    useEffect(() => {
        setGraphData(data);
    }, [data]);

    useEffect(() => {
        setEdgeVisibility((prev) => {
            const next: Record<string, boolean> = {};
            for (const type of edgeTypes) {
                next[type] = prev[type] ?? true;
            }
            return next;
        });
    }, [edgeTypes]);

    const allEdgesVisible = useMemo(() => {
        if (edgeTypes.length === 0) return true;
        return edgeTypes.every((type) => edgeVisibility[type] !== false);
    }, [edgeTypes, edgeVisibility]);

    const hideProject = useCallback(
        async (projectId: string) => {
            try {
                setIsHiding(true);
                const res = await fetch('/api/objects', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: projectId, visibility: 'HIDDEN' }),
                });

                if (!res.ok) {
                    const errorJson = await res.json().catch(() => ({}));
                    throw new Error(errorJson.error || 'Failed to hide service');
                }

                setGraphData((prev) => ({
                    nodes: prev.nodes.filter((node) => node.data.id !== projectId),
                    edges: prev.edges.filter(
                        (edge) => edge.data.source !== projectId && edge.data.target !== projectId
                    ),
                }));

                const params = new URLSearchParams(searchParams.toString());
                if (params.get('node') === projectId) {
                    params.delete('node');
                    const qs = params.toString();
                    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
                }

                toast.success('서비스를 숨김 처리했습니다.');
            } catch (error) {
                console.error(error);
                toast.error(error instanceof Error ? error.message : '서비스 숨김 처리에 실패했습니다.');
            } finally {
                setIsHiding(false);
            }
        },
        [pathname, router, searchParams]
    );

    useEffect(() => {
        if (!containerRef.current) return;

        const cy = cytoscape({
            container: containerRef.current,
            elements: {
                nodes: graphData.nodes,
                edges: graphData.edges,
            },
            style: [
                {
                    selector: 'node[type = "layer"]',
                    style: {
                        'background-color': '#0b1220',
                        'background-opacity': 0.8,
                        'border-color': 'data(color)',
                        'border-width': '1px',
                        label: 'data(label)',
                        color: 'data(color)',
                        'text-valign': 'center',
                        'text-halign': 'center',
                        'font-size': '12px',
                        width: '280px',
                        height: '42px',
                        shape: 'round-rectangle',
                    },
                },
                {
                    selector: 'node[type != "layer"]',
                    style: {
                        'background-color': 'data(color)',
                        label: 'data(label)',
                        color: '#f8fafc',
                        'font-size': '10px',
                        'text-wrap': 'wrap',
                        'text-max-width': '130px',
                        'text-valign': 'center',
                        'text-halign': 'center',
                        width: '130px',
                        height: '46px',
                        shape: 'round-rectangle',
                        'border-color': '#111827',
                        'border-width': '1px',
                    },
                },
                {
                    selector: 'edge',
                    style: {
                        width: '2px',
                        'line-color': '#475569',
                        'target-arrow-color': '#475569',
                        'target-arrow-shape': 'triangle',
                        'curve-style': 'taxi',
                        'taxi-direction': 'downward',
                    },
                },
                {
                    selector: 'edge[type = "kafka"]',
                    style: {
                        'line-color': '#d97706',
                        'target-arrow-color': '#d97706',
                        'line-style': 'dashed',
                    },
                },
                {
                    selector: '.hidden-edge',
                    style: { display: 'none' },
                },
                {
                    selector: '.selected-node',
                    style: {
                        'border-width': '3px',
                        'border-color': '#ffffff',
                    },
                },
                {
                    selector: '.neighborhood',
                    style: {
                        opacity: 1,
                    },
                },
                {
                    selector: '.dimmed',
                    style: {
                        opacity: 0.15,
                    },
                },
                {
                    selector: '.search-match',
                    style: {
                        'border-width': '3px',
                        'border-color': '#facc15',
                        'line-color': '#facc15',
                        'target-arrow-color': '#facc15',
                        opacity: 1,
                    },
                },
                {
                    selector: '.search-dim',
                    style: {
                        opacity: 0.18,
                    },
                },
            ],
            layout: {
                name: 'preset',
                fit: true,
                padding: 40,
                animate: false,
            },
            minZoom: 0.2,
            maxZoom: 2.5,
        });

        cy.on('tap', 'node', (event) => {
            const node = event.target;
            if (node.data('type') === 'layer') return;

            const params = new URLSearchParams(searchParams.toString());
            params.set('node', node.id());
            router.replace(`${pathname}?${params.toString()}`, { scroll: false });
        });

        cy.on('cxttap', 'node', (event) => {
            const node = event.target;
            if (node.data('type') === 'layer') return;

            setHideTarget({ id: node.id(), label: String(node.data('label')) });
        });

        cyRef.current = cy;
        return () => {
            cy.destroy();
            cyRef.current = null;
        };
    }, [graphData, pathname, router, searchParams]);

    useEffect(() => {
        const cy = cyRef.current;
        if (!cy) return;

        cy.edges().removeClass('hidden-edge');
        cy.edges().forEach((edge) => {
            const type = String(edge.data('type') || 'unknown');
            if (edgeVisibility[type] === false) {
                edge.addClass('hidden-edge');
            }
        });
    }, [edgeVisibility, graphData]);

    useEffect(() => {
        const cy = cyRef.current;
        if (!cy) return;

        cy.elements().removeClass('selected-node neighborhood dimmed');

        if (!selectedNodeId) return;
        const selected = cy.getElementById(selectedNodeId);
        if (!selected || selected.length === 0) return;

        const neighborhood = selected.closedNeighborhood();
        selected.addClass('selected-node');
        neighborhood.addClass('neighborhood');
        cy.elements().not(neighborhood).addClass('dimmed');

        cy.animate({
            fit: { eles: selected, padding: 200 },
            duration: 250,
        });
    }, [selectedNodeId, graphData]);

    useEffect(() => {
        const cy = cyRef.current;
        if (!cy) return;

        cy.elements().removeClass('search-match search-dim');

        const q = (searchQuery || '').trim().toLowerCase();
        if (!q) return;

        const matchedNodes = cy
            .nodes('[type != "layer"]')
            .filter((node) => {
                const label = String(node.data('label') || '').toLowerCase();
                const id = node.id().toLowerCase();
                const type = String(node.data('type') || '').toLowerCase();
                return label.includes(q) || id.includes(q) || type.includes(q);
            });

        if (matchedNodes.length === 0) return;

        cy.nodes().not(matchedNodes).addClass('search-dim');
        cy.edges().addClass('search-dim');
        matchedNodes.addClass('search-match');
        matchedNodes.connectedEdges().removeClass('search-dim').addClass('search-match');

        cy.animate({
            fit: { eles: matchedNodes, padding: 140 },
            duration: 220,
        });
    }, [searchQuery, graphData]);

    const handleExportPng = () => {
        const cy = cyRef.current;
        if (!cy) return;
        const png = cy.png({ full: true, scale: 2, bg: '#020617' });
        const link = document.createElement('a');
        link.download = 'architecture-view.png';
        link.href = png;
        link.click();
    };

    const toggleAllEdges = () => {
        const nextVisible = !allEdgesVisible;
        setEdgeVisibility((prev) => {
            const next = { ...prev };
            for (const type of edgeTypes) {
                next[type] = nextVisible;
            }
            return next;
        });
    };

    return (
        <div className="relative h-full w-full">
            <div ref={containerRef} className="h-full w-full" />

            <div className="absolute left-4 top-4 z-20 flex max-w-[60vw] flex-wrap gap-2">
                <button
                    onClick={toggleAllEdges}
                    className="flex items-center gap-2 rounded-full border border-white/20 bg-black/50 px-3 py-2 text-xs text-white hover:bg-black/70"
                >
                    {allEdgesVisible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                    <span>All</span>
                </button>

                {edgeTypes.map((type) => {
                    const visible = edgeVisibility[type] !== false;
                    return (
                        <button
                            key={type}
                            onClick={() =>
                                setEdgeVisibility((prev) => ({
                                    ...prev,
                                    [type]: !(prev[type] ?? true),
                                }))
                            }
                            className={`flex items-center gap-2 rounded-full border px-3 py-2 text-xs hover:bg-black/70 ${
                                visible
                                    ? 'border-white/20 bg-black/50 text-white'
                                    : 'border-white/10 bg-black/30 text-gray-500'
                            }`}
                        >
                            {visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                            <span>{type}</span>
                        </button>
                    );
                })}
            </div>

            <button
                onClick={handleExportPng}
                className="absolute right-4 top-4 z-20 flex items-center gap-2 rounded-full border border-white/20 bg-black/50 px-4 py-2 text-xs text-white hover:bg-black/70"
            >
                <Download className="h-3 w-3" />
                <span>PNG Export</span>
            </button>

            <div className="pointer-events-none absolute bottom-4 left-4 z-20 rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-xs text-gray-300">
                <p>Top-down 레이어 아키텍처 뷰</p>
                <p>노드 우클릭: 숨김(HIDDEN)</p>
                <p>검색어 입력 시 매칭 노드 하이라이트</p>
            </div>

            {isHiding && (
                <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 text-sm text-white">
                    서비스 숨김 처리 중...
                </div>
            )}

            {graphData.nodes.filter((node) => node.data.type !== 'layer').length === 0 && (
                <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-gray-400">
                    표시할 아키텍처 노드가 없습니다.
                </div>
            )}

            <ConfirmDialog
                open={Boolean(hideTarget)}
                title="서비스 숨김"
                description={
                    hideTarget
                        ? `"${hideTarget.label}" 서비스를 숨김(HIDDEN) 처리할까요? 그래프/아키텍처 뷰에서 즉시 제외됩니다.`
                        : undefined
                }
                destructive
                loading={isHiding}
                confirmText="숨김 처리"
                onOpenChange={(open) => {
                    if (!open) setHideTarget(null);
                }}
                onConfirm={async () => {
                    if (!hideTarget) return;
                    const targetId = hideTarget.id;
                    setHideTarget(null);
                    await hideProject(targetId);
                }}
            />
        </div>
    );
}
