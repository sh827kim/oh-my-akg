/**
 * Object Mapping 그래프 — Cytoscape.js 기반 Obsidian-스타일 포스 그래프
 * - cose 레이아웃: 물리 기반 자동 배치 (인터랙티브)
 * - 노드 드래그, 클릭, 호버 지원
 * - 레벨 필터: objectType 조합 선택
 * - COMPOUND 뷰: 복합 오브젝트 + 자식 전체 보기
 * - Roll-down: COMPOUND 노드 클릭 → 자식 노드 전개
 * - 다크 테마 스타일
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type cytoscape from 'cytoscape';
import { cn, Spinner } from '@archi-navi/ui';
import { useWorkspace } from '@/contexts/workspace-context';

/* ─── 타입 ─── */
interface ObjectItem {
  id: string;
  name: string;
  displayName: string | null;
  objectType: string;
  granularity: string;
  parentId: string | null;
  depth: number;
}

interface RelationItem {
  id: string;
  subjectObjectId: string;
  objectId: string;
  relationType: string;
}

/* 기존 롤업 레벨 + COMPOUND 뷰 */
type ViewLevel =
  | 'SERVICE_TO_SERVICE'
  | 'SERVICE_TO_DATABASE'
  | 'SERVICE_TO_BROKER'
  | 'DOMAIN_TO_DOMAIN'
  | 'COMPOUND_VIEW';

/* 기존 레벨별 허용 objectType (COMPOUND_VIEW 제외) */
const LEVEL_TYPES: Partial<Record<ViewLevel, string[]>> = {
  SERVICE_TO_SERVICE: ['service'],
  SERVICE_TO_DATABASE: ['service', 'database'],
  SERVICE_TO_BROKER: ['service', 'message_broker', 'kafka_topic'],
  DOMAIN_TO_DOMAIN: ['domain'],
};

/* 레벨 메타데이터 */
const VIEW_LEVELS: { value: ViewLevel; label: string; color: string }[] = [
  { value: 'SERVICE_TO_SERVICE', label: '서비스 ↔ 서비스', color: '#3b82f6' },
  { value: 'SERVICE_TO_DATABASE', label: '서비스 ↔ DB', color: '#10b981' },
  { value: 'SERVICE_TO_BROKER', label: '서비스 ↔ 브로커', color: '#f59e0b' },
  { value: 'DOMAIN_TO_DOMAIN', label: '도메인 ↔ 도메인', color: '#8b5cf6' },
  { value: 'COMPOUND_VIEW', label: 'Compound 전개', color: '#f43f5e' },
];

/** objectType별 노드 색상 (Cosmic 테마) */
const NODE_COLORS: Record<string, string> = {
  service: '#818cf8',       // indigo-400
  api_endpoint: '#c084fc',  // purple-400
  database: '#34d399',      // emerald-400
  kafka_topic: '#fbbf24',   // amber-400
  message_broker: '#fbbf24',// amber-400
  domain: '#22d3ee',        // cyan-400
  default: '#94a3b8',       // slate-400
};

/** 엣지 관계 타입별 색상 */
const EDGE_COLORS: Record<string, string> = {
  call: '#818cf8',          // indigo
  expose: '#c084fc',        // purple
  read: '#34d399',          // emerald
  write: '#4ade80',         // green-400
  produce: '#fbbf24',       // amber
  consume: '#fb923c',       // orange-400
  depend_on: '#94a3b8',     // slate
  contains: '#f87171',      // red-400
};

export function RollupGraph() {
  const { workspaceId } = useWorkspace();
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const [loading, setLoading] = useState(true);
  const [isEmpty, setIsEmpty] = useState(false);
  const [viewLevel, setViewLevel] = useState<ViewLevel>('SERVICE_TO_SERVICE');
  const [tooltip, setTooltip] = useState<{
    label: string;
    detail: string;
    x: number;
    y: number;
  } | null>(null);

  /* 전체 데이터 캐시 (roll-down 시 재사용) */
  const dataRef = useRef<{ objects: ObjectItem[]; relations: RelationItem[] }>({
    objects: [],
    relations: [],
  });

  /* 현재 전개된 COMPOUND 노드 ID 집합 */
  const [expandedSet, setExpandedSet] = useState<Set<string>>(new Set());

  /* ─── 데이터 로드 ─── */
  const fetchData = useCallback(async () => {
    const [objRes, relRes] = await Promise.all([
      fetch(`/api/objects?workspaceId=${workspaceId}`),
      fetch(`/api/relations?workspaceId=${workspaceId}`),
    ]);
    if (!objRes.ok || !relRes.ok) throw new Error('데이터 로드 실패');
    const allObjects = (await objRes.json()) as ObjectItem[];
    const allRelations = (await relRes.json()) as RelationItem[];
    dataRef.current = { objects: allObjects, relations: allRelations };
    return { allObjects, allRelations };
  }, [workspaceId]);

  /* ─── Cytoscape 스타일 정의 ─── */
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const getCyStyles = (): any[] => [
    /* 기본 노드 */
    {
      selector: 'node',
      style: {
        'background-color': 'data(color)',
        'background-opacity': 0.85,
        'border-width': 2,
        'border-color': 'data(color)',
        'border-opacity': 0.4,
        label: 'data(label)',
        color: '#e4e4e7',
        'font-size': '11px',
        'font-family': 'ui-monospace, monospace',
        'text-valign': 'bottom',
        'text-halign': 'center',
        'text-margin-y': 6,
        width: 36,
        height: 36,
        'text-background-color': '#0f0f11',
        'text-background-opacity': 0.7,
        'text-background-padding': '3px',
        'text-background-shape': 'roundrectangle',
        'overlay-opacity': 0,
      },
    },
    /* COMPOUND 노드 — 더 크고 테두리 다르게 */
    {
      selector: 'node[?isCompound]',
      style: {
        width: 48,
        height: 48,
        'border-width': 3,
        'border-style': 'double',
        shape: 'round-rectangle',
        'font-size': '12px',
      },
    },
    /* 자식 노드 — 작은 크기 */
    {
      selector: 'node[?isChild]',
      style: {
        width: 26,
        height: 26,
        'font-size': '9px',
        'border-width': 1,
      },
    },
    /* 호버 */
    {
      selector: 'node:hover',
      style: {
        'background-opacity': 1,
        'border-opacity': 1,
        'border-width': 3,
        width: 44,
        height: 44,
        'font-size': '12px',
        'z-index': 10,
      },
    },
    /* 하이라이트 */
    {
      selector: 'node.highlighted',
      style: {
        'background-opacity': 1,
        'border-opacity': 1,
        'border-width': 3,
        width: 44,
        height: 44,
        'z-index': 10,
      },
    },
    /* 흐림 */
    {
      selector: 'node.dimmed',
      style: {
        'background-opacity': 0.15,
        'border-opacity': 0.1,
        color: '#52525b',
      },
    },
    /* 기본 엣지 */
    {
      selector: 'edge',
      style: {
        width: 1.5,
        'line-color': 'data(color)',
        'line-opacity': 0.5,
        'target-arrow-color': 'data(color)',
        'target-arrow-shape': 'triangle',
        'arrow-scale': 0.8,
        'curve-style': 'bezier',
        label: 'data(label)',
        'font-size': '9px',
        color: '#71717a',
        'font-family': 'ui-monospace, monospace',
        'text-rotation': 'autorotate',
        'text-background-color': '#0f0f11',
        'text-background-opacity': 0.7,
        'text-background-padding': '2px',
        'text-background-shape': 'roundrectangle',
        'overlay-opacity': 0,
      },
    },
    /* 포함 관계 엣지 (부모→자식) — 점선 */
    {
      selector: 'edge[relationType="contains"]',
      style: {
        'line-style': 'dashed',
        'line-dash-pattern': [4, 4],
        'target-arrow-shape': 'diamond',
        'arrow-scale': 0.6,
        width: 1,
        'line-opacity': 0.4,
        'font-size': '0px', // 라벨 숨김
      },
    },
    /* 엣지 하이라이트 */
    {
      selector: 'edge.highlighted',
      style: {
        width: 2.5,
        'line-opacity': 1,
      },
    },
    /* 엣지 흐림 */
    {
      selector: 'edge.dimmed',
      style: {
        'line-opacity': 0.08,
        'target-arrow-shape': 'none',
      },
    },
  ];

  /* ─── 그래프 빌드 ─── */
  const buildGraph = useCallback(
    async (level: ViewLevel, expanded: Set<string>) => {
      if (!containerRef.current) return;
      setLoading(true);
      setIsEmpty(false);
      setTooltip(null);

      try {
        const { allObjects, allRelations } = await fetchData();

        let filteredObjects: ObjectItem[];
        let filteredRelations: RelationItem[];
        let containsEdges: {
          data: { id: string; source: string; target: string; label: string; color: string; relationType: string };
        }[] = [];

        if (level === 'COMPOUND_VIEW') {
          /* ── COMPOUND 뷰: 모든 COMPOUND 부모 + 자식 노드 표시 ── */
          const compoundParents = allObjects.filter(
            (o) => o.granularity === 'COMPOUND' && o.depth === 0,
          );
          const children = allObjects.filter((o) => o.parentId !== null);
          filteredObjects = [...compoundParents, ...children];

          // 부모→자식 포함 관계 엣지
          containsEdges = children
            .filter((c) => c.parentId)
            .map((c) => ({
              data: {
                id: `contains-${c.parentId}-${c.id}`,
                source: c.parentId!,
                target: c.id,
                label: 'contains',
                color: EDGE_COLORS['contains'] ?? '#f43f5e',
                relationType: 'contains',
              },
            }));

          // 실제 관계도 포함 (표시 범위 내에 있는 것만)
          const idSet = new Set(filteredObjects.map((o) => o.id));
          filteredRelations = allRelations.filter(
            (r) => idSet.has(r.subjectObjectId) && idSet.has(r.objectId),
          );
        } else {
          /* ── 기존 롤업 레벨 ── */
          const allowedTypes = LEVEL_TYPES[level] ?? [];

          // depth=0인 Object만 기본 표시 (roll-down 전)
          const baseObjects = allObjects.filter(
            (o) => allowedTypes.includes(o.objectType) && o.depth === 0,
          );

          // 전개된 COMPOUND 노드의 자식 추가
          const expandedChildren: ObjectItem[] = [];
          expanded.forEach((parentId) => {
            const kids = allObjects.filter((o) => o.parentId === parentId);
            expandedChildren.push(...kids);
          });

          filteredObjects = [...baseObjects, ...expandedChildren];

          // 전개된 부모→자식 포함 엣지
          containsEdges = expandedChildren
            .filter((c) => c.parentId)
            .map((c) => ({
              data: {
                id: `contains-${c.parentId}-${c.id}`,
                source: c.parentId!,
                target: c.id,
                label: 'contains',
                color: EDGE_COLORS['contains'] ?? '#f43f5e',
                relationType: 'contains',
              },
            }));

          const idSet = new Set(filteredObjects.map((o) => o.id));
          filteredRelations = allRelations.filter(
            (r) => idSet.has(r.subjectObjectId) && idSet.has(r.objectId),
          );
        }

        if (filteredObjects.length === 0) {
          setIsEmpty(true);
          cyRef.current?.destroy();
          cyRef.current = null;
          return;
        }

        // 기존 인스턴스 정리
        if (cyRef.current) {
          cyRef.current.destroy();
          cyRef.current = null;
        }

        // Cytoscape 동적 import (SSR 방지)
        const CytoScape = (await import('cytoscape')).default;

        // 노드 생성
        const nodes = filteredObjects.map((obj) => ({
          data: {
            id: obj.id,
            label: obj.displayName ?? obj.name,
            objectType: obj.objectType,
            color: NODE_COLORS[obj.objectType] ?? NODE_COLORS['default'],
            isCompound: obj.granularity === 'COMPOUND',
            isChild: obj.parentId !== null,
            isExpanded: expanded.has(obj.id),
          },
        }));

        // 관계 엣지
        const relationEdges = filteredRelations.map((r) => ({
          data: {
            id: r.id,
            source: r.subjectObjectId,
            target: r.objectId,
            label: r.relationType,
            color: EDGE_COLORS[r.relationType] ?? '#6b7280',
            relationType: r.relationType,
          },
        }));

        const edges = [...relationEdges, ...containsEdges];

        cyRef.current = CytoScape({
          container: containerRef.current,
          elements: { nodes, edges },
          style: getCyStyles(),
          layout: {
            name: 'cose',
            animate: true,
            animationDuration: 600,
            animationEasing: 'ease-out-cubic',
            fit: true,
            padding: 60,
            randomize: true,
            componentSpacing: 80,
            nodeRepulsion: () => 12000,
            nodeOverlap: 20,
            idealEdgeLength: () => 120,
            edgeElasticity: () => 100,
            nestingFactor: 5,
            gravity: 80,
            numIter: 1000,
            coolingFactor: 0.95,
            minTemp: 1.0,
          },
        });

        /* ── 이벤트 바인딩 ── */

        // 호버 → 하이라이트
        cyRef.current.on('mouseover', 'node', (evt) => {
          const node = evt.target as cytoscape.NodeSingular;
          const cy = cyRef.current;
          if (!cy) return;

          const connectedEdges = node.connectedEdges();
          const connectedNodes = connectedEdges.connectedNodes();

          cy.elements().addClass('dimmed');
          node.removeClass('dimmed').addClass('highlighted');
          connectedEdges.removeClass('dimmed').addClass('highlighted');
          connectedNodes.removeClass('dimmed').addClass('highlighted');

          const pos = evt.renderedPosition;
          const isCompound = node.data('isCompound') as boolean;
          const detail = isCompound ? '🔽 클릭: Roll-down' : (node.data('objectType') as string);
          setTooltip({
            label: node.data('label') as string,
            detail,
            x: pos.x,
            y: pos.y - 30,
          });
        });

        cyRef.current.on('mouseout', 'node', () => {
          const cy = cyRef.current;
          if (!cy) return;
          cy.elements().removeClass('dimmed').removeClass('highlighted');
          setTooltip(null);
        });

        // 클릭 → COMPOUND 노드 Roll-down 토글
        cyRef.current.on('tap', 'node', (evt) => {
          const node = evt.target as cytoscape.NodeSingular;
          const isCompound = node.data('isCompound') as boolean;
          if (!isCompound) return;

          const nodeId = node.data('id') as string;
          setExpandedSet((prev) => {
            const next = new Set(prev);
            if (next.has(nodeId)) {
              next.delete(nodeId); // 접기
            } else {
              next.add(nodeId); // 전개
            }
            return next;
          });
        });

        // 더블클릭 → 포커스 확대
        cyRef.current.on('dblclick', 'node', (evt) => {
          const node = evt.target as cytoscape.NodeSingular;
          cyRef.current?.animate({
            fit: { eles: node.neighborhood().add(node), padding: 80 },
            duration: 400,
            easing: 'ease-in-out-cubic',
          });
        });

        // 빈 공간 클릭 → 전체 뷰 복원
        cyRef.current.on('tap', (evt) => {
          if (evt.target === cyRef.current) {
            cyRef.current?.fit(undefined, 60);
            cyRef.current?.elements().removeClass('dimmed').removeClass('highlighted');
            setTooltip(null);
          }
        });
      } catch (err) {
        console.error('[RollupGraph] 로드 실패:', err);
        setIsEmpty(true);
      } finally {
        setLoading(false);
      }
    },
    [fetchData],
  );

  /* ── 레벨 변경 또는 전개 상태 변경 시 재빌드 ── */
  useEffect(() => {
    void buildGraph(viewLevel, expandedSet);
    return () => {
      cyRef.current?.destroy();
      cyRef.current = null;
    };
  }, [viewLevel, expandedSet, buildGraph]);

  /* ── 레벨 변경 시 전개 상태 초기화 ── */
  const handleLevelChange = (level: ViewLevel) => {
    setExpandedSet(new Set());
    setViewLevel(level);
  };

  return (
    <div className="relative h-full w-full bg-[#0f0f11]">
      {/* 레벨 선택 버튼 */}
      <div className="absolute left-4 top-4 z-10 flex flex-wrap gap-2">
        {VIEW_LEVELS.map((level) => (
          <button
            key={level.value}
            onClick={() => handleLevelChange(level.value)}
            className={cn(
              'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium',
              'border backdrop-blur-sm whitespace-nowrap',
              viewLevel === level.value
                ? 'border-primary bg-primary/20 text-primary'
                : 'border-white/10 bg-black/40 text-zinc-400 hover:text-white hover:border-white/20',
            )}
          >
            <span
              className="inline-block h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: level.color }}
            />
            {level.label}
          </button>
        ))}
      </div>

      {/* 전개 상태 표시 (전개된 노드가 있을 때) */}
      {expandedSet.size > 0 && (
        <div className="absolute right-4 top-4 z-10">
          <button
            onClick={() => setExpandedSet(new Set())}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium border border-rose-500/30 bg-rose-500/10 text-rose-400 backdrop-blur-sm hover:bg-rose-500/20"
          >
            ↩ 모두 접기 ({expandedSet.size})
          </button>
        </div>
      )}

      {/* 로딩 */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Spinner size="lg" />
        </div>
      )}

      {/* 빈 상태 */}
      {!loading && isEmpty && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-zinc-500">
          <p className="text-sm">이 레벨에 해당하는 Object 데이터가 없습니다.</p>
          <p className="text-xs">
            설정 &gt; 개발자 도구에서{' '}
            <span className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-zinc-300">
              샘플 넣기
            </span>
            를 실행하거나 Object를 직접 등록하세요.
          </p>
        </div>
      )}

      {/* 노드 툴팁 */}
      {tooltip && (
        <div
          className="absolute z-20 pointer-events-none rounded-md bg-zinc-800/90 border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-200 backdrop-blur-sm"
          style={{ left: tooltip.x, top: tooltip.y, transform: 'translateX(-50%)' }}
        >
          <div className="font-medium">{tooltip.label}</div>
          <div className="text-zinc-400 text-[10px]">{tooltip.detail}</div>
        </div>
      )}

      {/* 조작 힌트 */}
      {!loading && !isEmpty && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex gap-3 text-[10px] text-zinc-600">
          <span>드래그: 노드 이동</span>
          <span>스크롤: 줌</span>
          <span>클릭(COMPOUND): Roll-down</span>
          <span>더블클릭: 포커스</span>
          <span>빈 공간 클릭: 전체 보기</span>
        </div>
      )}

      {/* Cytoscape 렌더 컨테이너 */}
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
