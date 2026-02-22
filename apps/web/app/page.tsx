import { getDb } from '@archi-navi/core';
import { ServiceListManager } from '@/components/service-list-manager';
import { getObjectStatusFromMetadata, getServiceTypeFromMetadata } from '@archi-navi/core';

interface Tag {
  id: string;
  name: string;
  color: string;
}

interface ServiceType {
  id: number;
  name: string;
  color: string;
  sortOrder: number;
  enabled: boolean;
}

interface ProjectRow {
  object_id: string;
  urn: string | null;
  name: string;
  display_name: string | null;
  metadata: unknown;
  visibility: string;
  updated_at: Date;
  inbound_count: number | string;
  outbound_count: number | string;
}

interface ProjectTagRow {
  project_id: string;
  tag_id: number;
  name: string;
  color_hex: string;
}

export const dynamic = 'force-dynamic';

async function getProjects() {
  const db = await getDb();

  try {
    const [projectsResult, tagsResult] = await Promise.all([
      db.query<ProjectRow>(`
        SELECT
          o.id AS object_id,
          o.urn,
          o.name,
          o.display_name,
          o.metadata,
          o.visibility,
          o.updated_at,
          (
            SELECT COUNT(*)::int
            FROM approved_object_relations r
            WHERE r.workspace_id = 'default'
              AND r.target_object_id = o.id
          ) AS inbound_count,
          (
            SELECT COUNT(*)::int
            FROM approved_object_relations r
            WHERE r.workspace_id = 'default'
              AND r.subject_object_id = o.id
          ) AS outbound_count
        FROM objects o
        WHERE o.workspace_id = 'default'
          AND o.object_type = 'service'
          AND o.urn IS NOT NULL
        ORDER BY o.updated_at DESC
      `),
      db.query<ProjectTagRow>(`
        SELECT
          o.urn AS project_id,
          t.id AS tag_id,
          t.name,
          t.color_hex
        FROM object_tags ot
        JOIN tags t ON t.id = ot.tag_id
        JOIN objects o ON o.id = ot.object_id
        WHERE ot.workspace_id = 'default'
          AND o.object_type = 'service'
          AND o.urn IS NOT NULL
      `),
    ]);

    const tagMap = new Map<string, Tag[]>();
    for (const row of tagsResult.rows) {
      const list = tagMap.get(row.project_id) ?? [];
      list.push({
        id: String(row.tag_id),
        name: row.name,
        color: row.color_hex,
      });
      tagMap.set(row.project_id, list);
    }

    return projectsResult.rows.map((p) => {
      const projectId = p.urn || p.object_id;
      const metadata = (p.metadata && typeof p.metadata === 'object')
        ? (p.metadata as Record<string, unknown>)
        : {};

      return {
        id: projectId,
        repo_name: p.name,
        alias: p.display_name,
        description: typeof metadata.description === 'string' ? metadata.description : null,
        type: getServiceTypeFromMetadata(metadata), // Renamed from serviceType to type
        visibility: p.visibility,
        status: getObjectStatusFromMetadata(metadata),
        updated_at: p.updated_at.toISOString(),
        last_seen_at: typeof metadata.last_seen_at === 'string' ? metadata.last_seen_at : null,
        inbound_count: Number(p.inbound_count ?? 0),
        outbound_count: Number(p.outbound_count ?? 0),
        tags: tagMap.get(projectId) ?? [],
      };
    });
  } catch (error) {
    console.error('Failed to fetch services:', error);
    return [];
  }
}

async function getSettingsData() {
  const db = await getDb();

  const [typesResult, tagsResult] = await Promise.all([
    db.query<{ id: number; name: string; color_hex: string; sort_order: number; enabled: boolean }>(`
      SELECT id, name, color_hex, sort_order, enabled
      FROM project_types
      ORDER BY sort_order ASC, id ASC
    `),
    db.query<{ id: number; name: string; color_hex: string }>(`
      SELECT id, name, color_hex
      FROM tags
      WHERE workspace_id = 'default'
      ORDER BY name ASC
    `),
  ]);

  const serviceTypes: ServiceType[] = typesResult.rows.map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color_hex,
    sortOrder: row.sort_order,
    enabled: row.enabled,
  }));

  const availableTags: Tag[] = tagsResult.rows.map((row) => ({
    id: String(row.id),
    name: row.name,
    color: row.color_hex,
  }));

  return { serviceTypes, availableTags };
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const [projects, settings] = await Promise.all([getProjects(), getSettingsData()]);
  const params = await searchParams;
  const viewMode = (params.view as 'card' | 'list') || 'card';

  return (
    <div className="flex-1 overflow-auto p-8">
      <div className="mx-auto max-w-7xl">
        <ServiceListManager
          initialServices={projects}
          availableTags={settings.availableTags}
          serviceTypes={settings.serviceTypes}
          viewMode={viewMode}
        />
      </div>
    </div>
  );
}
