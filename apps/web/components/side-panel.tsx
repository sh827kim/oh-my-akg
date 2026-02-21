import { getDb } from '@archi-navi/core';
import { X } from 'lucide-react';
import Link from 'next/link';
import { getProjectTypeFromMetadata } from '@archi-navi/core';

interface SidePanelProps {
  nodeId: string;
  searchQuery?: string;
}

interface Project {
  object_id: string;
  urn: string | null;
  name: string;
  display_name: string | null;
  metadata: unknown;
  updated_at: Date;
}

interface RelatedDependency {
  project_id: string;
  label: string;
  type: string;
}

export async function SidePanel({ nodeId, searchQuery }: SidePanelProps) {
  const db = await getDb();

  const projectRes = await db.query<Project>(
    `SELECT id AS object_id, urn, name, display_name, metadata, updated_at
     FROM objects
     WHERE workspace_id = 'default'
       AND object_type = 'service'
       AND urn = $1`,
    [nodeId],
  );

  const project = projectRes.rows[0];
  if (!project) return null;

  const inboundRes = await db.query<RelatedDependency>(
    `SELECT
       o_from.urn AS project_id,
       COALESCE(NULLIF(o_from.display_name, ''), o_from.name) AS label,
       r.relation_type AS type
     FROM approved_object_relations r
     JOIN objects o_from ON o_from.id = r.subject_object_id
     WHERE r.workspace_id = 'default'
       AND r.target_object_id = $1
       AND o_from.object_type = 'service'
       AND o_from.visibility = 'VISIBLE'
       AND COALESCE(o_from.metadata->>'status', 'ACTIVE') = 'ACTIVE'
     ORDER BY o_from.name ASC`,
    [project.object_id],
  );

  const outboundRes = await db.query<RelatedDependency>(
    `SELECT
       o_to.urn AS project_id,
       COALESCE(NULLIF(o_to.display_name, ''), o_to.name) AS label,
       r.relation_type AS type
     FROM approved_object_relations r
     JOIN objects o_to ON o_to.id = r.target_object_id
     WHERE r.workspace_id = 'default'
       AND r.subject_object_id = $1
       AND o_to.object_type = 'service'
       AND o_to.visibility = 'VISIBLE'
       AND COALESCE(o_to.metadata->>'status', 'ACTIVE') = 'ACTIVE'
     ORDER BY o_to.name ASC`,
    [project.object_id],
  );

  const metadata = (project.metadata && typeof project.metadata === 'object')
    ? (project.metadata as Record<string, unknown>)
    : {};
  const repoUrl = typeof metadata.repo_url === 'string' ? metadata.repo_url : '#';
  const description = typeof metadata.description === 'string' ? metadata.description : null;
  const projectType = getProjectTypeFromMetadata(metadata);

  const title = project.display_name?.trim() ? project.display_name : project.name;
  const closeHref = searchQuery ? `?q=${encodeURIComponent(searchQuery)}` : '?';
  const createNodeHref = (id: string) => {
    const params = new URLSearchParams();
    params.set('node', id);
    if (searchQuery) params.set('q', searchQuery);
    return `?${params.toString()}`;
  };

  return (
    <div className="fixed right-0 top-0 z-50 h-full w-96 border-l border-[#333] bg-[#0a0a0a] shadow-2xl transition-transform duration-300 ease-in-out">
      <div className="flex h-16 items-center justify-between border-b border-[#333] px-6">
        <h2 className="w-64 truncate text-lg font-bold text-white">{title}</h2>
        <Link href={closeHref} scroll={false} className="text-gray-400 hover:text-white">
          <X className="h-5 w-5" />
        </Link>
      </div>

      <div className="h-[calc(100vh-64px)] space-y-6 overflow-y-auto p-6">
        <div>
          <h3 className="mb-2 text-sm font-medium uppercase tracking-wider text-gray-400">Metadata</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">URN</span>
              <span className="max-w-[170px] truncate text-gray-300">{project.urn}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Type</span>
              <span className="text-blue-400">{projectType}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Updated</span>
              <span className="text-gray-300">{new Date(project.updated_at).toLocaleDateString()}</span>
            </div>
            {description && <div className="mt-2 border-t border-[#222] pt-2 text-gray-400">{description}</div>}
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-medium uppercase tracking-wider text-gray-400">
            Depends On ({outboundRes.rows.length})
          </h3>
          {outboundRes.rows.length === 0 ? (
            <p className="text-sm text-gray-600">No outgoing dependencies.</p>
          ) : (
            <ul className="space-y-2">
              {outboundRes.rows.map((edge) => (
                <li key={`${edge.project_id}-${edge.type}`} className="rounded bg-[#1a1a1a] p-2 text-sm">
                  <Link href={createNodeHref(edge.project_id)} scroll={false}>
                    <span className="flex items-center justify-between">
                      <span className="w-44 truncate text-gray-300 hover:text-white">{edge.label}</span>
                      <span className="rounded bg-[#333] px-1.5 py-0.5 text-xs text-gray-500">{edge.type}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="mb-2 text-sm font-medium uppercase tracking-wider text-gray-400">
            Used By ({inboundRes.rows.length})
          </h3>
          {inboundRes.rows.length === 0 ? (
            <p className="text-sm text-gray-600">No incoming dependencies.</p>
          ) : (
            <ul className="space-y-2">
              {inboundRes.rows.map((edge) => (
                <li key={`${edge.project_id}-${edge.type}`} className="rounded bg-[#1a1a1a] p-2 text-sm">
                  <Link href={createNodeHref(edge.project_id)} scroll={false}>
                    <span className="flex items-center justify-between">
                      <span className="w-44 truncate text-gray-300 hover:text-white">{edge.label}</span>
                      <span className="rounded bg-[#333] px-1.5 py-0.5 text-xs text-gray-500">{edge.type}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4">
          <Link
            href={repoUrl}
            target="_blank"
            className="block w-full rounded bg-blue-600 py-2 text-center text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            View on GitHub
          </Link>
        </div>
      </div>
    </div>
  );
}
