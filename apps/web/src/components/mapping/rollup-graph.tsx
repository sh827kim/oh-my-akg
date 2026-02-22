/**
 * Object Mapping 그래프 — D3 Force 기반
 *
 * Cytoscape.js → D3 Force 전환 이유:
 *   - 엣지 방향 화살표(SVG marker)를 관계 타입별 색상으로 표현
 *   - 엣지 위 관계 타입 라벨(relationType) 표시
 *   - 드래그 핀 고정(fx/fy) + Shift 클릭으로 핀 해제
 *   - 줌/패닝 (d3.zoom)
 *   - 포스 시뮬레이션: forceLink + forceManyBody + forceCenter + forceCollide
 *
 * 기존 기능 유지:
 *   - 5가지 뷰 레벨 + COMPOUND Roll-down
 *   - 호버 하이라이트, 툴팁
 *   - 더블클릭 포커스 줌
 *   - 빈 공간 클릭 → 핀 초기화 + 전체 뷰
 *
 * 추가 기능:
 *   - Roll-down 포커스 효과: expanded 노드 중심으로 dim / COMPOUND-COMPOUND 엣지 숨김
 *   - 엣지 호버 체인 하이라이트: COMPOUND → ATOMIC → (엣지) → ATOMIC → COMPOUND
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { cn, Spinner } from '@archi-navi/ui';
import { useWorkspace } from '@/contexts/workspace-context';

/* ─── 도메인 타입 ─── */
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

/* ─── D3 시뮬레이션 노드/링크 타입 ─── */
interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  objectType: string;
  isCompound: boolean;
  isChild: boolean;
  color: string;
  radius: number;
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  id: string;
  relationType: string;
  color: string;
  isContains: boolean;
  /**
   * 데이터 흐름이 논리 방향(subjectObject → object)과 반대인 관계.
   *   read   : A가 B에서 데이터를 가져옴  → 시각적 화살표는 B→A
   *   consume: A가 B(브로커)에서 소비      → 시각적 화살표는 B→A
   * 화살표를 반전해서 "데이터가 어디서 오는가"를 직관적으로 표현.
   */
  isReversed: boolean;
  /** 같은 source↔target 쌍에서의 인덱스 (곡률 계산용) */
  parallelIndex: number;
  /** 같은 source↔target 쌍의 총 개수 */
  parallelTotal: number;
  /** 양 끝점이 모두 ATOMIC인지 여부 (체인 하이라이트 히트 영역 대상) */
  isAtomicToAtomic: boolean;
}

/* ─── 뷰 레벨 ─── */
type ViewLevel =
  | 'SERVICE_TO_SERVICE'
  | 'SERVICE_TO_DATABASE'
  | 'SERVICE_TO_BROKER'
  | 'DOMAIN_TO_DOMAIN'
  | 'COMPOUND_VIEW';

const LEVEL_TYPES: Partial<Record<ViewLevel, string[]>> = {
  SERVICE_TO_SERVICE: ['service'],
  SERVICE_TO_DATABASE: ['service', 'database'],
  // topic: 새 샘플 데이터 objectType / kafka_topic: 하위 호환
  SERVICE_TO_BROKER: ['service', 'message_broker', 'topic', 'kafka_topic'],
  DOMAIN_TO_DOMAIN: ['domain'],
};

/*
 * LR Flow 패널에서 표시할 관계 타입 (뷰 레벨별)
 *   SERVICE_TO_SERVICE : 서비스 호출 관계 (call, expose, depend_on)
 *   SERVICE_TO_DATABASE: DB 접근 관계 (read, write)
 *   SERVICE_TO_BROKER  : 메시지 브로커 관계 (produce, consume)
 *   COMPOUND_VIEW / DOMAIN_TO_DOMAIN → null (모든 관계 표시)
 */
const PANEL_RELATION_TYPES: Partial<Record<ViewLevel, string[]>> = {
  SERVICE_TO_SERVICE: ['call', 'expose', 'depend_on'],
  SERVICE_TO_DATABASE: ['read', 'write'],
  SERVICE_TO_BROKER: ['produce', 'consume'],
};

const VIEW_LEVELS: { value: ViewLevel; label: string; color: string }[] = [
  { value: 'SERVICE_TO_SERVICE', label: '서비스 ↔ 서비스', color: '#3b82f6' },
  { value: 'SERVICE_TO_DATABASE', label: '서비스 ↔ DB', color: '#10b981' },
  { value: 'SERVICE_TO_BROKER', label: '서비스 ↔ 브로커', color: '#f59e0b' },
  { value: 'DOMAIN_TO_DOMAIN', label: '도메인 ↔ 도메인', color: '#8b5cf6' },
  { value: 'COMPOUND_VIEW', label: '전체 통합 뷰', color: '#f43f5e' },
];

/* ─── 색상 팔레트 ─── */
const NODE_COLORS: Record<string, string> = {
  service: '#818cf8',
  api_endpoint: '#c084fc',
  database: '#34d399',
  db_table: '#22d3ee',      // DB 테이블 ATOMIC
  topic: '#fbbf24',         // Kafka 토픽 ATOMIC
  kafka_topic: '#fbbf24',   // 하위 호환
  message_broker: '#fbbf24',
  domain: '#22d3ee',        // 하위 호환
  default: '#94a3b8',
};

const EDGE_COLORS: Record<string, string> = {
  call: '#818cf8',
  expose: '#c084fc',
  read: '#34d399',
  write: '#4ade80',
  produce: '#fbbf24',
  consume: '#fb923c',
  depend_on: '#94a3b8',
  contains: '#f87171',
};

/* ─── 툴팁 상태 ─── */
interface TooltipState {
  label: string;
  detail: string;
  x: number;
  y: number;
}

/* ─── Roll-down LR Flow 패널 타입 ─── */
interface CallerInfo {
  compound: { id: string; label: string };
  relationType: string;
}
interface ExposedAtomicInfo {
  id: string;
  label: string;
  objectType: string;
  callers: CallerInfo[];
}
interface ReferencedAtomicInfo {
  id: string;
  label: string;
  objectType: string;
  relationType: string;
  provider: { id: string; label: string } | null;
}
interface RollDownPanelItem {
  targetId: string;
  targetLabel: string;
  targetObjectType: string;
  /** 대상 COMPOUND가 expose하는 Atomic + 그를 참조하는 Compound */
  exposedAtomics: ExposedAtomicInfo[];
  /** 대상 COMPOUND가 참조하는 외부 Atomic + 그것을 expose하는 Compound */
  referencedAtomics: ReferencedAtomicInfo[];
}

/* ─── SVG 마커 ID 헬퍼 ─── */
function markerId(relationType: string) {
  return `arrow-${relationType.replace(/[^a-z0-9]/gi, '_')}`;
}

/**
 * 관계 타입별 선 스타일 (stroke-dasharray)
 *   실선       : call, expose, depend_on  → 동기 RPC / 의존
 *   긴 점선    : produce, consume         → 비동기 메시징 (Kafka 등)
 *   짧은 점선  : read, write              → 데이터 접근 (DB 등)
 *   contains는 별도 처리
 */
function edgeDash(relationType: string): string {
  if (['produce', 'consume'].includes(relationType)) return '8,4';
  if (['read', 'write'].includes(relationType)) return '3,4';
  return 'none';
}

/* ─── 병렬 엣지 곡률 계산 (같은 쌍의 여러 엣지를 벌려서 표시) ─── */
function calcParallelCurve(
  sx: number, sy: number,
  tx: number, ty: number,
  index: number, total: number,
): string {
  if (total === 1) {
    // 단일 엣지 → 직선
    return `M${sx},${sy} L${tx},${ty}`;
  }
  // 곡률 오프셋: 중앙을 0으로 양쪽으로 벌림
  const offset = (index - (total - 1) / 2) * 28;
  const mx = (sx + tx) / 2;
  const my = (sy + ty) / 2;
  // 수직 방향 벡터로 오프셋 적용
  const dx = tx - sx;
  const dy = ty - sy;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const cx = mx + nx * offset;
  const cy = my + ny * offset;
  return `M${sx},${sy} Q${cx},${cy} ${tx},${ty}`;
}

/* ─── 메인 컴포넌트 ─── */
export function RollupGraph() {
  const { workspaceId } = useWorkspace();

  /* SVG 컨테이너 ref */
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  /* 시뮬레이션 ref (cleanup용) */
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null);

  /* 핀 고정 노드 집합 */
  const [pinnedCount, setPinnedCount] = useState(0);
  const pinnedRef = useRef<Set<string>>(new Set());

  /* UI 상태 */
  const [loading, setLoading] = useState(true);
  const [isEmpty, setIsEmpty] = useState(false);
  const [viewLevel, setViewLevel] = useState<ViewLevel>('SERVICE_TO_SERVICE');
  const [expandedSet, setExpandedSet] = useState<Set<string>>(new Set());
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  /* Roll-down LR Flow 패널 데이터 */
  const [rollDownInfo, setRollDownInfo] = useState<RollDownPanelItem[]>([]);

  /* 전체 데이터 캐시 */
  const dataRef = useRef<{ objects: ObjectItem[]; relations: RelationItem[] }>({
    objects: [],
    relations: [],
  });

  /* ─── 데이터 fetch (workspaceId 변경 시 갱신) ─── */
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

  /* ─── D3 그래프 빌드 ─── */
  const buildGraph = useCallback(
    async (level: ViewLevel, expanded: Set<string>) => {
      if (!svgRef.current || !containerRef.current) return;

      setLoading(true);
      setIsEmpty(false);
      setTooltip(null);

      /* 이전 시뮬레이션 정리 */
      simulationRef.current?.stop();
      simulationRef.current = null;

      try {
        const { allObjects, allRelations } = await fetchData();

        /* ── Roll-down LR Flow 패널 데이터 계산 (allObjects/allRelations 전체 기준) ── */
        if (expanded.size > 0) {
          const objMap = new Map(allObjects.map((o) => [o.id, o]));

          /*
           * 뷰 레벨에 맞는 관계 타입 필터 (PANEL_RELATION_TYPES 기반)
           *   SERVICE_TO_SERVICE : call, expose, depend_on → 서비스 호출 관계만
           *   SERVICE_TO_DATABASE: read, write           → DB 접근 관계만
           *   SERVICE_TO_BROKER  : produce, consume      → 브로커 메시지 관계만
           *   COMPOUND_VIEW / DOMAIN_TO_DOMAIN           → null (모두 표시)
           */
          const allowedRelTypes: Set<string> | null = PANEL_RELATION_TYPES[level]
            ? new Set(PANEL_RELATION_TYPES[level]!)
            : null;

          const infos: RollDownPanelItem[] = [];

          expanded.forEach((compoundId) => {
            const compound = objMap.get(compoundId);
            if (!compound) return;

            // 대상 COMPOUND의 모든 ATOMIC 자식
            const atomicChildren = allObjects.filter((o) => o.parentId === compoundId);
            const atomicChildIds = new Set(atomicChildren.map((a) => a.id));

            /* ① Inbound: 각 ATOMIC을 참조하는 외부 COMPOUND (관계 타입 필터 적용) */
            const exposedAtomics: ExposedAtomicInfo[] = atomicChildren.map((atomic) => {
              const callersMap = new Map<string, CallerInfo>();
              allRelations
                .filter((r) => r.objectId === atomic.id)
                .forEach((r) => {
                  // 뷰 레벨에 맞지 않는 관계 타입 제외
                  if (allowedRelTypes && !allowedRelTypes.has(r.relationType)) return;
                  const callerObj = objMap.get(r.subjectObjectId);
                  if (!callerObj) return;
                  // caller의 부모 COMPOUND (ATOMIC이면 부모, COMPOUND면 자신)
                  const callerCompound = callerObj.parentId
                    ? (objMap.get(callerObj.parentId) ?? callerObj)
                    : callerObj;
                  if (callerCompound.id === compoundId) return; // 자기 자신 제외
                  const key = `${callerCompound.id}|${r.relationType}`;
                  if (!callersMap.has(key)) {
                    callersMap.set(key, {
                      compound: {
                        id: callerCompound.id,
                        label: callerCompound.displayName ?? callerCompound.name,
                      },
                      relationType: r.relationType,
                    });
                  }
                });
              return {
                id: atomic.id,
                label: atomic.displayName ?? atomic.name,
                objectType: atomic.objectType,
                callers: [...callersMap.values()],
              };
            });

            /* ② Outbound: 대상 COMPOUND의 ATOMIC이 호출하는 외부 Atomic (관계 타입 필터 적용) */
            const refMap = new Map<string, ReferencedAtomicInfo>();
            allRelations
              .filter((r) => atomicChildIds.has(r.subjectObjectId))
              .forEach((r) => {
                // 뷰 레벨에 맞지 않는 관계 타입 제외
                if (allowedRelTypes && !allowedRelTypes.has(r.relationType)) return;
                const refObj = objMap.get(r.objectId);
                if (!refObj) return;
                // 자기 자신 소속 제외
                if (refObj.id === compoundId || refObj.parentId === compoundId) return;
                if (refMap.has(r.objectId)) return;
                const provider = refObj.parentId ? objMap.get(refObj.parentId) : null;
                refMap.set(r.objectId, {
                  id: refObj.id,
                  label: refObj.displayName ?? refObj.name,
                  objectType: refObj.objectType,
                  relationType: r.relationType,
                  provider: provider
                    ? { id: provider.id, label: provider.displayName ?? provider.name }
                    : null,
                });
              });

            infos.push({
              targetId: compoundId,
              targetLabel: compound.displayName ?? compound.name,
              targetObjectType: compound.objectType,
              exposedAtomics,
              referencedAtomics: [...refMap.values()],
            });
          });

          setRollDownInfo(infos);
        } else {
          setRollDownInfo([]);
        }

        /* ── 뷰 레벨별 노드/엣지 필터링 ── */
        let filteredObjects: ObjectItem[];
        let filteredRelations: RelationItem[];
        let containsLinks: {
          id: string;
          subjectObjectId: string;
          objectId: string;
          relationType: 'contains';
        }[] = [];

        if (level === 'COMPOUND_VIEW') {
          /*
           * 전체 통합 뷰: 서비스↔서비스, 서비스↔DB, 서비스↔브로커 등
           * 타입 구분 없이 모든 depth=0 최상위 오브젝트 + 이들 사이의 모든 관계를 표시.
           * Roll-down(부모-자식 전개) 없음 → containsLinks 생성 안 함.
           */
          filteredObjects = allObjects.filter((o) => o.depth === 0);
          containsLinks = []; // 이 뷰는 상위 레벨 관계만 표시
          const idSet = new Set(filteredObjects.map((o) => o.id));
          filteredRelations = allRelations.filter(
            (r) => idSet.has(r.subjectObjectId) && idSet.has(r.objectId),
          );
        } else {
          const allowedTypes = LEVEL_TYPES[level] ?? [];
          const baseObjects = allObjects.filter(
            (o) => allowedTypes.includes(o.objectType) && o.depth === 0,
          );

          const expandedChildren: ObjectItem[] = [];
          expanded.forEach((parentId) => {
            allObjects
              .filter((o) => o.parentId === parentId)
              .forEach((o) => expandedChildren.push(o));
          });

          filteredObjects = [...baseObjects, ...expandedChildren];

          containsLinks = expandedChildren
            .filter((c) => c.parentId)
            .map((c) => ({
              id: `contains-${c.parentId}-${c.id}`,
              subjectObjectId: c.parentId!,
              objectId: c.id,
              relationType: 'contains' as const,
            }));

          const idSet = new Set(filteredObjects.map((o) => o.id));
          filteredRelations = allRelations.filter(
            (r) => idSet.has(r.subjectObjectId) && idSet.has(r.objectId),
          );
        }

        if (filteredObjects.length === 0) {
          setIsEmpty(true);
          /* SVG 초기화 */
          d3.select(svgRef.current).selectAll('*').remove();
          return;
        }

        /* ── Roll-down 포커스 계산용 맵 (filteredObjects 확정 후) ── */
        // childId → parentId (ATOMIC의 부모 COMPOUND를 역추적)
        const parentMap = new Map<string, string>();
        // COMPOUND 노드 ID 집합 (COMPOUND-COMPOUND 엣지 감지용)
        const compoundIdSet = new Set<string>();
        filteredObjects.forEach((obj) => {
          if (obj.parentId) parentMap.set(obj.id, obj.parentId);
          if (obj.granularity === 'COMPOUND') compoundIdSet.add(obj.id);
        });

        /* ── 노드 배열 생성 ── */
        const nodeMap = new Map<string, GraphNode>();
        const nodes: GraphNode[] = filteredObjects.map((obj) => {
          const isCompound = obj.granularity === 'COMPOUND';
          const isChild = obj.parentId !== null;
          const node: GraphNode = {
            id: obj.id,
            label: obj.displayName ?? obj.name,
            objectType: obj.objectType,
            isCompound,
            isChild,
            color: NODE_COLORS[obj.objectType] ?? NODE_COLORS['default']!,
            radius: isCompound ? 22 : isChild ? 12 : 16,
            // 기존 핀 고정 위치 유지
            fx: pinnedRef.current.has(obj.id) ? undefined : undefined,
            fy: pinnedRef.current.has(obj.id) ? undefined : undefined,
          };
          nodeMap.set(obj.id, node);
          return node;
        });

        /* ── 링크 배열 생성 + 병렬 엣지 인덱스 계산 ── */
        const allLinkRaw = [
          ...filteredRelations.map((r) => ({
            id: r.id,
            subjectObjectId: r.subjectObjectId,
            objectId: r.objectId,
            relationType: r.relationType,
          })),
          ...containsLinks,
        ];

        /* 같은 (source, target) 쌍을 정규화해서 병렬 개수 계산 */
        const pairCount = new Map<string, number>();
        allLinkRaw.forEach((l) => {
          const key = [l.subjectObjectId, l.objectId].sort().join('|');
          pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
        });
        const pairIndex = new Map<string, number>();

        const links: GraphLink[] = allLinkRaw
          .filter(
            (l) => nodeMap.has(l.subjectObjectId) && nodeMap.has(l.objectId),
          )
          .map((l) => {
            const key = [l.subjectObjectId, l.objectId].sort().join('|');
            const total = pairCount.get(key) ?? 1;
            const idx = pairIndex.get(key) ?? 0;
            pairIndex.set(key, idx + 1);
            return {
              id: l.id,
              source: l.subjectObjectId,
              target: l.objectId,
              relationType: l.relationType,
              color: EDGE_COLORS[l.relationType] ?? '#6b7280',
              isContains: l.relationType === 'contains',
              // read/consume은 데이터가 target→source 방향으로 흐름 → 화살표 반전
              isReversed: ['read', 'consume'].includes(l.relationType),
              parallelIndex: idx,
              parallelTotal: total,
              // 체인 하이라이트 대상: 양 끝점이 모두 ATOMIC (contains 제외)
              isAtomicToAtomic:
                l.relationType !== 'contains' &&
                !compoundIdSet.has(l.subjectObjectId) &&
                !compoundIdSet.has(l.objectId),
            };
          });

        /* ── SVG 셋업 ── */
        const svgEl = svgRef.current;
        const { width, height } = containerRef.current.getBoundingClientRect();
        const W = width || 800;
        const H = height || 600;

        const svg = d3.select(svgEl).attr('width', W).attr('height', H);
        svg.selectAll('*').remove();

        /* 줌/패닝 */
        const zoomGroup = svg.append('g').attr('class', 'zoom-group');

        const zoom = d3
          .zoom<SVGSVGElement, unknown>()
          .scaleExtent([0.15, 4])
          .on('zoom', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
            zoomGroup.attr('transform', event.transform.toString());
          });

        svg.call(zoom);

        /* 빈 공간 클릭 → 핀 해제 + 전체 뷰 */
        svg.on('click', (event: MouseEvent) => {
          if ((event.target as SVGElement).tagName === 'svg') {
            /* 모든 노드 핀 해제 */
            nodes.forEach((n) => {
              n.fx = null;
              n.fy = null;
            });
            pinnedRef.current.clear();
            setPinnedCount(0);
            simulationRef.current?.alpha(0.3).restart();

            /* 전체 뷰 fit */
            svg
              .transition()
              .duration(400)
              .call(zoom.transform, d3.zoomIdentity);
          }
        });

        /* ── SVG 마커 정의 (화살표) ── */
        const defs = svg.append('defs');

        /* 관계 타입별 + 기본 마커 */
        const markerTypes = [
          ...new Set(links.map((l) => l.relationType)),
          'default',
        ];

        markerTypes.forEach((rt) => {
          const color = EDGE_COLORS[rt] ?? '#6b7280';
          defs
            .append('marker')
            .attr('id', markerId(rt))
            .attr('viewBox', '0 -5 10 10')
            .attr('refX', 10)
            .attr('refY', 0)
            .attr('markerWidth', 6)
            .attr('markerHeight', 6)
            .attr('orient', 'auto')
            .append('path')
            .attr('d', 'M0,-5L10,0L0,5')
            .attr('fill', color)
            .attr('opacity', 0.85);

          /* contains는 다이아몬드 마커 */
          if (rt === 'contains') {
            defs.select(`#${markerId(rt)}`).selectAll('*').remove();
            defs
              .select(`#${markerId(rt)}`)
              .append('path')
              .attr('d', 'M0,0L5,-4L10,0L5,4Z')
              .attr('fill', color)
              .attr('opacity', 0.7);
          }
        });

        /*
         * read / consume 전용 origin dot 마커 (marker-start)
         * 화살표 반전 엣지의 데이터 출처 노드에 ● 표시하여
         * "이 노드에서 데이터가 나간다"는 것을 직관적으로 전달.
         */
        (['read', 'consume'] as const).forEach((rt) => {
          const color = EDGE_COLORS[rt] ?? '#6b7280';
          defs
            .append('marker')
            .attr('id', `origin-dot-${rt}`)
            .attr('viewBox', '-4 -4 8 8')
            .attr('refX', 0)
            .attr('refY', 0)
            .attr('markerWidth', 5)
            .attr('markerHeight', 5)
            .attr('orient', 'auto')
            .append('circle')
            .attr('r', 3)
            .attr('fill', color)
            .attr('fill-opacity', 0.9);
        });

        /* ── 레이어 순서: 엣지 → 라벨 → 노드 ── */
        const linkGroup = zoomGroup.append('g').attr('class', 'links');
        const linkLabelGroup = zoomGroup.append('g').attr('class', 'link-labels');
        const nodeGroup = zoomGroup.append('g').attr('class', 'nodes');

        /* ── 엣지 경로 ── */
        const linkPaths = linkGroup
          .selectAll<SVGPathElement, GraphLink>('path.link-path')
          .data(links)
          .join('path')
          .attr('class', 'link-path')
          .attr('id', (d) => `link-${d.id}`)
          .attr('stroke', (d) => d.color)
          .attr('stroke-width', (d) => (d.isContains ? 1 : 1.5))
          .attr('stroke-opacity', (d) => (d.isContains ? 0.35 : 0.55))
          /* 선 스타일: contains=점선 / 메시징=긴점선 / 데이터접근=짧은점선 / RPC=실선 */
          .attr('stroke-dasharray', (d) => (d.isContains ? '4,4' : edgeDash(d.relationType)))
          .attr('fill', 'none')
          /* marker-end: 경로 끝(데이터 목적지)에 화살표 */
          .attr('marker-end', (d) =>
            d.isContains ? 'none' : `url(#${markerId(d.relationType)})`,
          )
          /* marker-start: read/consume의 데이터 출처에 원형 점 표시 */
          .attr('marker-start', (d) =>
            d.isReversed ? `url(#origin-dot-${d.relationType})` : 'none',
          );

        /*
         * ── 엣지 호버 히트 영역 (ATOMIC-ATOMIC 엣지 체인 하이라이트용) ──
         * 실제 엣지(1.5px)는 너무 얇아 hover 감지가 어려우므로,
         * 투명한 넓은 스트로크(14px) path를 overlaying해 hover 영역을 확장.
         */
        const linkHitAreas = linkGroup
          .selectAll<SVGPathElement, GraphLink>('path.hit-area')
          .data(links.filter((l) => l.isAtomicToAtomic), (d) => d.id)
          .join('path')
          .attr('class', 'hit-area')
          .attr('stroke', 'transparent')
          .attr('stroke-width', 14)
          .attr('fill', 'none')
          .attr('cursor', 'pointer');

        /* ── 엣지 라벨 (contains 제외) ── */
        const linkLabels = linkLabelGroup
          .selectAll<SVGTextElement, GraphLink>('text')
          .data(links.filter((l) => !l.isContains))
          .join('text')
          .attr('font-size', '9px')
          .attr('font-family', 'ui-monospace, monospace')
          .attr('fill', '#71717a')
          .attr('text-anchor', 'middle')
          .attr('dy', '-3px')
          .attr('pointer-events', 'none')
          .append('textPath')
          .attr('href', (d) => `#link-${d.id}`)
          .attr('startOffset', '50%')
          .text((d) => d.relationType);

        /* ── 노드 그룹 ── */
        const nodeSel = nodeGroup
          .selectAll<SVGGElement, GraphNode>('g')
          .data(nodes, (d) => d.id)
          .join('g')
          .attr('class', 'node')
          .attr('cursor', 'grab')
          .call(
            d3
              .drag<SVGGElement, GraphNode>()
              .on('start', (event, d) => {
                if (!event.active) simulationRef.current?.alphaTarget(0.3).restart();
                d.fx = d.x;
                d.fy = d.y;
              })
              .on('drag', (event, d) => {
                d.fx = event.x;
                d.fy = event.y;
              })
              .on('end', (event, d) => {
                if (!event.active) simulationRef.current?.alphaTarget(0);
                /* 드래그 종료 → 핀 고정 */
                pinnedRef.current.add(d.id);
                setPinnedCount(pinnedRef.current.size);
              }),
          );

        /* 원형 노드 */
        nodeSel
          .append('circle')
          .attr('r', (d) => d.radius)
          .attr('fill', (d) => d.color)
          .attr('fill-opacity', 0.85)
          .attr('stroke', (d) => d.color)
          .attr('stroke-width', (d) => (d.isCompound ? 3 : 2))
          .attr('stroke-opacity', 0.5);

        /* COMPOUND 이중 링 효과 */
        nodeSel
          .filter((d) => d.isCompound)
          .append('circle')
          .attr('r', (d) => d.radius + 5)
          .attr('fill', 'none')
          .attr('stroke', (d) => d.color)
          .attr('stroke-width', 1)
          .attr('stroke-opacity', 0.3)
          .attr('stroke-dasharray', '3,3');

        /* 노드 라벨 */
        nodeSel
          .append('text')
          .text((d) => d.label)
          .attr('font-size', (d) => (d.isCompound ? '11px' : d.isChild ? '9px' : '10px'))
          .attr('font-family', 'ui-monospace, monospace')
          .attr('fill', '#e4e4e7')
          .attr('text-anchor', 'middle')
          .attr('dy', (d) => d.radius + 14)
          .attr('pointer-events', 'none')
          /* 텍스트 배경 효과 (stroke로 simulated) */
          .clone(true)
          .lower()
          .attr('stroke', '#0f0f11')
          .attr('stroke-width', 3)
          .attr('stroke-linejoin', 'round')
          .attr('fill', 'none');

        /* ── 엣지 SVG path 계산 헬퍼 (tick 내 linkPaths + linkHitAreas 공유) ── */
        const calcLinkPath = (d: GraphLink): string => {
          const srcNode = d.source as GraphNode;
          const tgtNode = d.target as GraphNode;

          /*
           * read / consume 은 데이터 흐름이 target → source 이므로
           * 경로 시작(from)과 끝(to)을 바꿔 화살표가 source 쪽을 가리키게 함.
           */
          const [from, to] = d.isReversed
            ? [tgtNode, srcNode]
            : [srcNode, tgtNode];

          if (
            from.x == null || from.y == null ||
            to.x == null   || to.y == null
          ) return '';

          const dx = to.x - from.x;
          const dy = to.y - from.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;

          const toR = to.radius + (d.isContains ? 2 : 8);
          const tx = to.x - (dx / dist) * toR;
          const ty = to.y - (dy / dist) * toR;

          const fromR = from.radius + (d.isReversed ? 7 : 2);
          const sx = from.x + (dx / dist) * fromR;
          const sy = from.y + (dy / dist) * fromR;

          return calcParallelCurve(sx, sy, tx, ty, d.parallelIndex, d.parallelTotal);
        };

        /*
         * ── Roll-down 포커스 상태 적용 ──────────────────────────────────────────
         * expanded.size > 0 일 때:
         *  - expanded COMPOUND + 이웃 COMPOUND(COMPOUND-COMPOUND 엣지 기준) → 밝게
         *  - 나머지 노드 → dim
         *  - COMPOUND-COMPOUND 엣지 → 숨기기 (ATOMIC 레벨 시각화로 대체)
         *  - ATOMIC-ATOMIC 엣지 (focus 노드 관련) → 표시
         * expanded.size === 0 일 때 → 기본 상태 복원
         */
        const applyRollDownFocus = () => {
          if (expanded.size === 0) {
            // 기본 상태 완전 복원 (stroke 색상/두께 포함)
            nodeSel
              .select('circle')
              .attr('fill-opacity', 0.85)
              .attr('stroke', (n: GraphNode) => n.color)
              .attr('stroke-width', (n: GraphNode) => (n.isCompound ? 3 : 2))
              .attr('stroke-opacity', 0.5);
            linkPaths.attr('stroke-opacity', (l: GraphLink) =>
              l.isContains ? 0.35 : 0.55,
            );
            linkLabels.attr('opacity', 1);
            return;
          }

          /* expanded COMPOUND와 COMPOUND 레벨로 연결된 이웃 탐색 */
          const focusCompoundIds = new Set<string>(expanded);
          allLinkRaw.forEach((l) => {
            if (l.relationType === 'contains') return;
            const { subjectObjectId: src, objectId: tgt } = l;
            // 양쪽 모두 COMPOUND이고 한쪽이 expanded → 반대쪽도 focus
            if (compoundIdSet.has(src) && compoundIdSet.has(tgt)) {
              if (expanded.has(src)) focusCompoundIds.add(tgt);
              if (expanded.has(tgt)) focusCompoundIds.add(src);
            }
          });

          /* focus 노드: focus COMPOUND + 그 ATOMIC 자식 */
          const focusNodeIds = new Set<string>(focusCompoundIds);
          filteredObjects.forEach((obj) => {
            if (obj.parentId && focusCompoundIds.has(obj.parentId)) {
              focusNodeIds.add(obj.id);
            }
          });

          /*
           * 노드 밝기 조절 + expanded 노드 특별 강조
           * - expanded (Roll-down 대상): 흰 테두리(5px) + 완전 불투명 → 한눈에 식별
           * - 나머지 focus 노드: 정상 밝기
           * - dim 노드: 거의 투명
           */
          nodeSel
            .select('circle')
            .attr('fill-opacity', (n: GraphNode) => {
              if (expanded.has(n.id)) return 1;
              return focusNodeIds.has(n.id) ? 0.9 : 0.08;
            })
            .attr('stroke', (n: GraphNode) =>
              expanded.has(n.id) ? '#ffffff' : n.color,
            )
            .attr('stroke-width', (n: GraphNode) => {
              if (expanded.has(n.id)) return 5;
              return n.isCompound ? 3 : 2;
            })
            .attr('stroke-opacity', (n: GraphNode) => {
              if (expanded.has(n.id)) return 1;
              return focusNodeIds.has(n.id) ? 0.7 : 0.05;
            });

          /* 엣지 처리: COMPOUND-COMPOUND 숨기기, ATOMIC 관련만 표시 */
          linkPaths.attr('stroke-opacity', (l: GraphLink) => {
            const srcId =
              typeof l.source === 'object'
                ? (l.source as GraphNode).id
                : String(l.source);
            const tgtId =
              typeof l.target === 'object'
                ? (l.target as GraphNode).id
                : String(l.target);

            if (l.isContains) {
              // contains (parent → atomic): focus 노드 관련만 표시
              return focusNodeIds.has(srcId) || focusNodeIds.has(tgtId)
                ? 0.35
                : 0;
            }

            // COMPOUND-COMPOUND 엣지 → 완전히 숨기기 (Roll-down으로 대체)
            if (compoundIdSet.has(srcId) && compoundIdSet.has(tgtId)) return 0;

            // ATOMIC-ATOMIC / COMPOUND-ATOMIC: 양쪽 모두 focus일 때만 표시
            return focusNodeIds.has(srcId) && focusNodeIds.has(tgtId)
              ? 0.7
              : 0.05;
          });

          linkLabels.attr('opacity', (l: GraphLink) => {
            const srcId =
              typeof l.source === 'object'
                ? (l.source as GraphNode).id
                : String(l.source);
            const tgtId =
              typeof l.target === 'object'
                ? (l.target as GraphNode).id
                : String(l.target);
            if (l.isContains) return 0;
            if (compoundIdSet.has(srcId) && compoundIdSet.has(tgtId)) return 0;
            return focusNodeIds.has(srcId) && focusNodeIds.has(tgtId) ? 1 : 0.05;
          });
        };

        /* ── 노드 호버 이벤트 ── */
        nodeSel
          .on('mouseenter', function (event: MouseEvent, d: GraphNode) {
            const connectedIds = new Set<string>([d.id]);
            links.forEach((l) => {
              const src =
                typeof l.source === 'object'
                  ? (l.source as GraphNode).id
                  : String(l.source);
              const tgt =
                typeof l.target === 'object'
                  ? (l.target as GraphNode).id
                  : String(l.target);
              if (src === d.id || tgt === d.id) {
                connectedIds.add(src);
                connectedIds.add(tgt);
              }
            });

            /* 비연결 노드 흐리게 */
            nodeSel
              .select('circle')
              .attr('fill-opacity', (n: GraphNode) =>
                connectedIds.has(n.id) ? 1 : 0.12,
              )
              .attr('stroke-opacity', (n: GraphNode) =>
                connectedIds.has(n.id) ? 1 : 0.08,
              );

            /* 비연결 엣지 흐리게 */
            linkPaths.attr('stroke-opacity', (l: GraphLink) => {
              const src =
                typeof l.source === 'object'
                  ? (l.source as GraphNode).id
                  : l.source;
              const tgt =
                typeof l.target === 'object'
                  ? (l.target as GraphNode).id
                  : l.target;
              return src === d.id || tgt === d.id ? 0.95 : 0.05;
            });

            linkLabels.attr('opacity', (l: GraphLink) => {
              const src =
                typeof l.source === 'object'
                  ? (l.source as GraphNode).id
                  : l.source;
              const tgt =
                typeof l.target === 'object'
                  ? (l.target as GraphNode).id
                  : l.target;
              return src === d.id || tgt === d.id ? 1 : 0.08;
            });

            /* 툴팁 */
            const rect = svgEl.getBoundingClientRect();
            setTooltip({
              label: d.label,
              detail:
                d.isCompound && level !== 'COMPOUND_VIEW'
                  ? '🔽 클릭: Roll-down'
                  : d.objectType,
              x: event.clientX - rect.left,
              y: event.clientY - rect.top - 36,
            });
          })
          .on('mouseleave', function () {
            setTooltip(null);
            // Roll-down 상태에 맞는 포커스 복원
            applyRollDownFocus();
          });

        /* ── 노드 클릭 이벤트 ── */
        nodeSel.on('click', (event: MouseEvent, d: GraphNode) => {
          event.stopPropagation();

          if (event.shiftKey) {
            /* Shift+클릭 → 핀 해제 */
            d.fx = null;
            d.fy = null;
            pinnedRef.current.delete(d.id);
            setPinnedCount(pinnedRef.current.size);
            simulationRef.current?.alpha(0.2).restart();
            return;
          }

          /* COMPOUND 노드 → Roll-down 토글 (전체 통합 뷰에서는 비활성) */
          if (d.isCompound && level !== 'COMPOUND_VIEW') {
            setExpandedSet((prev) => {
              const next = new Set(prev);
              if (next.has(d.id)) {
                next.delete(d.id);
              } else {
                next.add(d.id);
              }
              return next;
            });
          }
        });

        /* ── 더블클릭 → 포커스 줌 ── */
        nodeSel.on('dblclick', (event: MouseEvent, d: GraphNode) => {
          event.stopPropagation();
          const x = d.x ?? 0;
          const y = d.y ?? 0;
          svg
            .transition()
            .duration(500)
            .call(
              zoom.transform,
              d3.zoomIdentity
                .translate(W / 2 - x * 2, H / 2 - y * 2)
                .scale(2),
            );
        });

        /*
         * ── 엣지 호버 체인 하이라이트 (ATOMIC-ATOMIC 엣지 전용) ──────────────
         * 호버 시: COMPOUND → ATOMIC → (엣지) → ATOMIC → COMPOUND 체인 강조
         * 이탈 시: Roll-down 포커스 상태로 복원
         */
        linkHitAreas
          .on('mouseenter', function (event: MouseEvent, d: GraphLink) {
            const srcId =
              typeof d.source === 'object'
                ? (d.source as GraphNode).id
                : String(d.source);
            const tgtId =
              typeof d.target === 'object'
                ? (d.target as GraphNode).id
                : String(d.target);

            // 체인 구성: 양 ATOMIC의 부모 COMPOUND까지 포함
            const chainNodeIds = new Set<string>([srcId, tgtId]);
            const parentSrcId = parentMap.get(srcId);
            const parentTgtId = parentMap.get(tgtId);
            if (parentSrcId) chainNodeIds.add(parentSrcId);
            if (parentTgtId) chainNodeIds.add(parentTgtId);

            // 체인에 포함된 contains 엣지 ID (parent → atomic)
            const chainLinkIds = new Set<string>([d.id]);
            links.forEach((l) => {
              if (!l.isContains) return;
              const lSrc =
                typeof l.source === 'object'
                  ? (l.source as GraphNode).id
                  : String(l.source);
              const lTgt =
                typeof l.target === 'object'
                  ? (l.target as GraphNode).id
                  : String(l.target);
              if (chainNodeIds.has(lSrc) && chainNodeIds.has(lTgt)) {
                chainLinkIds.add(l.id);
              }
            });

            /* 체인 노드 → 밝게, 나머지 → dim */
            nodeSel
              .select('circle')
              .attr('fill-opacity', (n: GraphNode) =>
                chainNodeIds.has(n.id) ? 1 : 0.06,
              )
              .attr('stroke-opacity', (n: GraphNode) =>
                chainNodeIds.has(n.id) ? 1 : 0.04,
              );

            /* 체인 엣지 → 강조, 나머지 → dim */
            linkPaths.attr('stroke-opacity', (l: GraphLink) => {
              if (l.id === d.id) return 0.95; // 호버 중인 엣지
              if (chainLinkIds.has(l.id)) return 0.55; // contains 체인 엣지
              return 0.04;
            });

            linkLabels.attr('opacity', (l: GraphLink) =>
              l.id === d.id ? 1 : 0.04,
            );

            /* 툴팁: [ParentA] AtomicA → AtomicB [ParentB] */
            const srcNode = nodeMap.get(srcId);
            const tgtNode2 = nodeMap.get(tgtId);
            const parentSrcNode = parentSrcId ? nodeMap.get(parentSrcId) : null;
            const parentTgtNode = parentTgtId ? nodeMap.get(parentTgtId) : null;

            const srcLabel = srcNode?.label ?? srcId;
            const tgtLabel = tgtNode2?.label ?? tgtId;
            const pSrcLabel = parentSrcNode ? `[${parentSrcNode.label}]` : '';
            const pTgtLabel = parentTgtNode ? `[${parentTgtNode.label}]` : '';

            const rect = svgEl.getBoundingClientRect();
            setTooltip({
              label: d.relationType,
              detail: `${pSrcLabel} ${srcLabel} → ${tgtLabel} ${pTgtLabel}`.trim(),
              x: event.clientX - rect.left,
              y: event.clientY - rect.top - 36,
            });
          })
          .on('mouseleave', function () {
            setTooltip(null);
            applyRollDownFocus();
          });

        /* ── 포스 시뮬레이션 ── */
        const simulation = d3
          .forceSimulation<GraphNode>(nodes)
          .force(
            'link',
            d3
              .forceLink<GraphNode, GraphLink>(links)
              .id((d) => d.id)
              .distance((l) => (l.isContains ? 60 : 120))
              .strength(0.4),
          )
          .force('charge', d3.forceManyBody<GraphNode>().strength(-320))
          .force('center', d3.forceCenter(W / 2, H / 2))
          .force(
            'collide',
            d3
              .forceCollide<GraphNode>()
              .radius((d) => d.radius + 18)
              .strength(0.8),
          )
          .alphaDecay(0.025);

        simulationRef.current = simulation;

        /*
         * D3 forceLink.initialize() 호출 시점(시뮬레이션 생성 직후)에
         * links의 source/target이 이미 GraphNode 객체로 resolve되므로,
         * applyRollDownFocus를 안전하게 호출 가능.
         */
        applyRollDownFocus();

        /* ── 틱마다 위치 업데이트 ── */
        simulation.on('tick', () => {
          /* 엣지 경로 업데이트 */
          linkPaths.attr('d', (d: GraphLink) => calcLinkPath(d));
          /* 히트 영역도 동일 경로 */
          linkHitAreas.attr('d', (d: GraphLink) => calcLinkPath(d));
          /* 노드 위치 업데이트 */
          nodeSel.attr('transform', (d: GraphNode) => `translate(${d.x ?? 0},${d.y ?? 0})`);
        });

        /* ── 초기 fit (시뮬레이션 안정화 후) ── */
        simulation.on('end', () => {
          const xs = nodes.map((n) => n.x ?? 0);
          const ys = nodes.map((n) => n.y ?? 0);
          const minX = Math.min(...xs);
          const maxX = Math.max(...xs);
          const minY = Math.min(...ys);
          const maxY = Math.max(...ys);
          const padding = 80;
          const scaleX = (W - padding * 2) / (maxX - minX || 1);
          const scaleY = (H - padding * 2) / (maxY - minY || 1);
          const scale = Math.min(scaleX, scaleY, 1.2);
          const tx = W / 2 - ((minX + maxX) / 2) * scale;
          const ty = H / 2 - ((minY + maxY) / 2) * scale;

          svg
            .transition()
            .duration(500)
            .call(
              zoom.transform,
              d3.zoomIdentity.translate(tx, ty).scale(scale),
            );
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

  /* ── 뷰 레벨/전개 상태 변경 시 재빌드 ── */
  useEffect(() => {
    void buildGraph(viewLevel, expandedSet);
    return () => {
      simulationRef.current?.stop();
    };
  }, [viewLevel, expandedSet, buildGraph]);

  /* ── 레벨 변경 시 전개 초기화 ── */
  const handleLevelChange = (level: ViewLevel) => {
    setExpandedSet(new Set());
    setViewLevel(level);
  };

  /* ── 창 크기 변경 대응 (SVG 크기 재조정) ── */
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      void buildGraph(viewLevel, expandedSet);
    });
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  // 의도적으로 viewLevel/expandedSet 의존성 제외 (buildGraph가 포함)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildGraph]);

  return (
    <div ref={containerRef} className="relative h-full w-full bg-[#0f0f11]">
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

      {/* 핀 고정 카운트 + 모두 접기 버튼 (우상단) */}
      <div className="absolute right-4 top-4 z-10 flex flex-col items-end gap-1.5">
        {pinnedCount > 0 && (
          <button
            onClick={() => {
              /* 모든 핀 해제 */
              simulationRef.current?.nodes().forEach((n) => {
                n.fx = null;
                n.fy = null;
              });
              pinnedRef.current.clear();
              setPinnedCount(0);
              simulationRef.current?.alpha(0.3).restart();
            }}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium border border-amber-500/30 bg-amber-500/10 text-amber-400 backdrop-blur-sm hover:bg-amber-500/20"
          >
            📌 핀 해제 ({pinnedCount})
          </button>
        )}

        {expandedSet.size > 0 && (
          <button
            onClick={() => setExpandedSet(new Set())}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium border border-rose-500/30 bg-rose-500/10 text-rose-400 backdrop-blur-sm hover:bg-rose-500/20"
          >
            ↩ 모두 접기 ({expandedSet.size})
          </button>
        )}
      </div>

      {/* Roll-down LR Flow 패널 */}
      {rollDownInfo.length > 0 && (
        /*
         * 패널 너비: 고정 w 대신 auto로 내용에 맞게 늘어남.
         * - min-w-[300px]: 최소 너비 보장
         * - max-w-[min(520px,calc(100vw-6rem))]: 화면 밖으로 벗어나지 않도록 캡
         */
        <div className="absolute left-4 bottom-20 z-20 flex flex-col gap-2 max-h-[55vh] overflow-y-auto min-w-[300px] max-w-[min(520px,calc(100vw-6rem))] pointer-events-none">
          {rollDownInfo.map((info) => (
            <div
              key={info.targetId}
              className="rounded-xl bg-zinc-950/95 border border-zinc-700/80 backdrop-blur-md text-xs pointer-events-auto shadow-xl"
            >
              {/* 헤더: Roll-down 대상 */}
              <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 min-w-0">
                {/* expanded 노드와 동일한 흰 링 시각 */}
                <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full ring-2 ring-white bg-zinc-300" />
                <span className="font-semibold text-white tracking-tight break-words min-w-0 flex-1">{info.targetLabel}</span>
                <span className="ml-2 shrink-0 text-[10px] text-zinc-500 font-mono">{info.targetObjectType}</span>
              </div>

              {/*
               * grid → flex 로 변경해 각 컬럼이 min-w-0 을 가질 수 있게 함.
               * truncate 대신 break-words 사용 → 긴 텍스트가 패널을 넘치지 않고 줄바꿈.
               */}
              <div className="flex">
                {/* 왼쪽: 참조 받음 (노출 Atomic → 참조 Compound) */}
                <div className="flex-1 min-w-0 p-2.5">
                  <p className="mb-1.5 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider whitespace-nowrap">
                    ← Inbound
                  </p>
                  {info.exposedAtomics.flatMap((atom) =>
                    atom.callers.map((caller) => (
                      <div
                        key={`${atom.id}-${caller.compound.id}-${caller.relationType}`}
                        className="mb-1.5 leading-tight"
                      >
                        {/* Caller Compound: break-words로 줄바꿈 허용 */}
                        <div className="text-indigo-300 font-medium break-words">{caller.compound.label}</div>
                        {/* relType + 대상 ATOMIC: items-start로 줄바꿈 시 상단 정렬 */}
                        <div className="flex items-start gap-1 pl-2 text-zinc-500 min-w-0">
                          <span className="shrink-0 text-[9px] font-mono text-violet-400">{caller.relationType}</span>
                          <span className="shrink-0 text-zinc-600">→</span>
                          <span className="text-purple-300 break-all min-w-0">{atom.label}</span>
                        </div>
                      </div>
                    )),
                  )}
                  {info.exposedAtomics.every((a) => a.callers.length === 0) && (
                    <span className="text-zinc-600 italic">없음</span>
                  )}
                </div>

                {/* 구분선 */}
                <div className="w-px shrink-0 bg-zinc-800" />

                {/* 오른쪽: 참조함 (대상 Atomic → 외부 Atomic → Provider Compound) */}
                <div className="flex-1 min-w-0 p-2.5">
                  <p className="mb-1.5 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider whitespace-nowrap">
                    Outbound →
                  </p>
                  {info.referencedAtomics.map((ref) => (
                    <div key={ref.id} className="mb-1.5 leading-tight">
                      {/* Provider Compound: break-words로 줄바꿈 허용 */}
                      {ref.provider && (
                        <div className="text-indigo-300 font-medium break-words">{ref.provider.label}</div>
                      )}
                      {/* relType + 참조 ATOMIC */}
                      <div className="flex items-start gap-1 pl-2 text-zinc-500 min-w-0">
                        <span className="shrink-0 text-[9px] font-mono text-violet-400">{ref.relationType}</span>
                        <span className="shrink-0 text-zinc-600">→</span>
                        <span className="text-purple-300 break-all min-w-0">{ref.label}</span>
                      </div>
                    </div>
                  ))}
                  {info.referencedAtomics.length === 0 && (
                    <span className="text-zinc-600 italic">없음</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 로딩 스피너 */}
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

      {/* 노드/엣지 툴팁 */}
      {tooltip && (
        <div
          className="absolute z-20 pointer-events-none rounded-md bg-zinc-800/90 border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-200 backdrop-blur-sm"
          style={{
            left: tooltip.x,
            top: tooltip.y,
            transform: 'translateX(-50%)',
          }}
        >
          <div className="font-medium">{tooltip.label}</div>
          <div className="text-zinc-400 text-[10px]">{tooltip.detail}</div>
        </div>
      )}

      {/* 조작 힌트 + 화살표 범례 */}
      {!loading && !isEmpty && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-1.5">
          {/* 화살표 방향 규칙 */}
          <div className="flex gap-4 text-[10px] text-zinc-500 bg-black/30 rounded-full px-3 py-1 backdrop-blur-sm">
            <span>→ 화살표: 데이터 목적지</span>
            <span className="text-zinc-600">|</span>
            <span>● 점: 데이터 출처 (read/consume)</span>
            <span className="text-zinc-600">|</span>
            <span className="border-b border-zinc-500">실선</span>: 동기호출
            <span className="text-zinc-600">|</span>
            <span style={{ borderBottom: '1px dashed #71717a' }}>긴점선</span>: 메시징
            <span className="text-zinc-600">|</span>
            <span style={{ borderBottom: '1px dotted #71717a' }}>짧은점선</span>: 데이터접근
          </div>
          {/* 조작 방법 */}
          <div className="flex gap-3 text-[10px] text-zinc-600">
            <span>드래그: 핀 고정</span>
            <span>Shift+클릭: 핀 해제</span>
            <span>스크롤: 줌</span>
            {/* 전체 통합 뷰에서는 Roll-down 없음 */}
            {viewLevel !== 'COMPOUND_VIEW' && (
              <span>클릭(COMPOUND): Roll-down</span>
            )}
            <span>더블클릭: 포커스</span>
            <span>빈 공간: 전체 보기</span>
          </div>
        </div>
      )}

      {/* D3 SVG 렌더 영역 */}
      <svg
        ref={svgRef}
        className="h-full w-full"
        style={{ display: loading ? 'none' : 'block' }}
      />
    </div>
  );
}
