import { getDb } from '@/lib/db';
import { ProjectListManager } from '@/components/project-list-manager';

interface Tag {
  id: string;
  name: string;
  color: string;
}

interface ProjectType {
  id: number;
  name: string;
  color: string;
  sortOrder: number;
  enabled: boolean;
}

interface ProjectRow {
  id: string;
  repo_name: string;
  alias: string | null;
  description: string | null;
  type: string;
  visibility: string;
  status: string;
  updated_at: Date;
  last_seen_at: Date | null;
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
          p.id,
          p.repo_name,
          p.alias,
          p.description,
          p.type,
          p.visibility,
          p.status,
          p.updated_at,
          p.last_seen_at,
          (
            SELECT COUNT(*)::int
            FROM edges e
            WHERE e.to_id = p.id
              AND e.approved = TRUE
          ) AS inbound_count,
          (
            SELECT COUNT(*)::int
            FROM edges e
            WHERE e.from_id = p.id
              AND e.approved = TRUE
          ) AS outbound_count
        FROM projects p
        ORDER BY p.updated_at DESC
      `),
      db.query<ProjectTagRow>(`
        SELECT
          pt.project_id,
          t.id AS tag_id,
          t.name,
          t.color_hex
        FROM project_tags pt
        JOIN tags t ON t.id = pt.tag_id
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

    return projectsResult.rows.map((p) => ({
      id: p.id,
      repo_name: p.repo_name,
      alias: p.alias,
      description: p.description,
      type: p.type,
      visibility: p.visibility,
      status: p.status,
      updated_at: p.updated_at.toISOString(),
      last_seen_at: p.last_seen_at ? p.last_seen_at.toISOString() : null,
      inbound_count: Number(p.inbound_count ?? 0),
      outbound_count: Number(p.outbound_count ?? 0),
      tags: tagMap.get(p.id) ?? [],
    }));
  } catch (error) {
    console.error('Failed to fetch projects:', error);
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
      ORDER BY name ASC
    `),
  ]);

  const projectTypes: ProjectType[] = typesResult.rows.map((row) => ({
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

  return { projectTypes, availableTags };
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
        <ProjectListManager
          initialProjects={projects}
          availableTags={settings.availableTags}
          projectTypes={settings.projectTypes}
          viewMode={viewMode}
        />
      </div>
    </div>
  );
}
