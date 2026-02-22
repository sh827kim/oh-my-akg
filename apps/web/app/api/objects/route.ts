import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getDb } from '@archi-navi/core';
import { buildServiceMetadata, getObjectStatusFromMetadata } from '@archi-navi/core';

interface ProjectRow {
  id: string;
  repo_name: string;
  alias: string | null;
  type: string;
  visibility: string;
  status: string;
  updated_at: string;
}

interface ServiceObjectRow {
  object_id: string;
  urn: string | null;
  name: string;
  display_name: string | null;
  visibility: string;
  metadata: unknown;
  updated_at: string;
}

function normalizeRepoId(repoName: string) {
  const normalized = repoName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, '-')
    .replace(/\/+/g, '/')
    .replace(/^-+|-+$/g, '');
  return normalized || `service-${Date.now()}`;
}

function toProjectRow(row: ServiceObjectRow): ProjectRow {
  const metadata = (row.metadata && typeof row.metadata === 'object')
    ? (row.metadata as Record<string, unknown>)
    : {};

  const type = typeof metadata.project_type === 'string' ? metadata.project_type : 'unknown';
  const status = getObjectStatusFromMetadata(metadata);

  return {
    id: row.urn || row.object_id,
    repo_name: row.name,
    alias: row.display_name,
    type,
    visibility: row.visibility,
    status,
    updated_at: row.updated_at,
  };
}

export async function GET(req: NextRequest) {
  try {
    const db = await getDb();
    const url = new URL(req.url);
    const includeHidden = url.searchParams.get('include_hidden') === 'true';
    const includeDeleted = url.searchParams.get('include_deleted') === 'true';

    const filters: string[] = [
      `workspace_id = 'default'`,
      `object_type = 'service'`,
      `urn IS NOT NULL`,
    ];
    if (!includeHidden) filters.push(`visibility = 'VISIBLE'`);
    if (!includeDeleted) filters.push(`COALESCE(metadata->>'status', 'ACTIVE') = 'ACTIVE'`);

    const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

    const result = await db.query<ServiceObjectRow>(`
      SELECT
        id AS object_id,
        urn,
        name,
        display_name,
        visibility,
        metadata,
        updated_at
      FROM objects
      ${where}
      ORDER BY name ASC
    `);

    return NextResponse.json(result.rows.map(toProjectRow));
  } catch (error) {
    console.error('Failed to fetch services:', error);
    return NextResponse.json([], { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = await getDb();
    const body = await req.json();

    const repoName = typeof body.repo_name === 'string' ? body.repo_name.trim() : '';
    const type = typeof body.type === 'string' ? body.type.trim() : 'unknown';
    const visibility = typeof body.visibility === 'string' ? body.visibility.trim() : 'VISIBLE';
    const alias = typeof body.alias === 'string' ? body.alias.trim() : null;
    const description = typeof body.description === 'string' ? body.description.trim() : null;

    if (!repoName) {
      return NextResponse.json({ error: 'repo_name is required' }, { status: 400 });
    }

    const typeCheckRes = await db.query<{ name: string }>(
      `SELECT name FROM project_types WHERE name = $1`,
      [type || 'unknown'],
    );
    if (typeCheckRes.rows.length === 0) {
      return NextResponse.json({ error: 'invalid type' }, { status: 400 });
    }

    if (!['VISIBLE', 'HIDDEN'].includes(visibility)) {
      return NextResponse.json({ error: 'invalid visibility' }, { status: 400 });
    }

    const urn = `${normalizeRepoId(repoName)}-${Date.now()}`;
    const metadata = buildServiceMetadata({
      repoUrl: '#',
      description,
      serviceType: type || 'unknown',
      status: 'ACTIVE',
      lastSeenAt: new Date().toISOString(),
    });

    const result = await db.query<ServiceObjectRow>(
      `INSERT INTO objects
       (id, workspace_id, object_type, name, display_name, urn, visibility, granularity, metadata)
       VALUES ($1, 'default', 'service', $2, $3, $4, $5, 'COMPOUND', $6::jsonb)
       RETURNING id AS object_id, urn, name, display_name, visibility, metadata, updated_at`,
      [randomUUID(), repoName, alias || null, urn, visibility, JSON.stringify(metadata)],
    );

    return NextResponse.json(toProjectRow(result.rows[0]), { status: 201 });
  } catch (error) {
    console.error('Failed to create service:', error);
    return NextResponse.json({ error: 'Failed to create service' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const db = await getDb();
    const body = await req.json();

    const urn = typeof body.id === 'string' ? body.id : '';
    const visibility = typeof body.visibility === 'string' ? body.visibility : undefined;
    const type = typeof body.type === 'string' ? body.type : undefined;
    const alias = typeof body.alias === 'string' ? body.alias : undefined;
    const status = typeof body.status === 'string' ? body.status : undefined;

    if (!urn) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const existingRes = await db.query<ServiceObjectRow>(
      `SELECT id AS object_id, urn, name, display_name, visibility, metadata, updated_at
       FROM objects
       WHERE workspace_id = 'default'
         AND object_type = 'service'
         AND urn = $1`,
      [urn],
    );

    if (existingRes.rows.length === 0) {
      return NextResponse.json({ error: 'service not found' }, { status: 404 });
    }

    const existing = existingRes.rows[0];
    const metadata = (existing.metadata && typeof existing.metadata === 'object')
      ? ({ ...(existing.metadata as Record<string, unknown>) } as Record<string, unknown>)
      : {};

    if (visibility !== undefined && !['VISIBLE', 'HIDDEN'].includes(visibility)) {
      return NextResponse.json({ error: 'invalid visibility' }, { status: 400 });
    }

    if (type !== undefined) {
      const typeCheckRes = await db.query<{ name: string }>(
        `SELECT name FROM project_types WHERE name = $1`,
        [type],
      );
      if (typeCheckRes.rows.length === 0) {
        return NextResponse.json({ error: 'invalid type' }, { status: 400 });
      }
      metadata.project_type = type;
    }

    if (status !== undefined) {
      if (!['ACTIVE', 'DELETED', 'ARCHIVED'].includes(status)) {
        return NextResponse.json({ error: 'invalid status' }, { status: 400 });
      }
      metadata.status = status;
    }

    const nextVisibility = visibility ?? existing.visibility;
    const nextAlias = alias !== undefined ? alias : existing.display_name;

    const result = await db.query<ServiceObjectRow>(
      `UPDATE objects
       SET visibility = $2,
           display_name = $3,
           metadata = $4::jsonb,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING id AS object_id, urn, name, display_name, visibility, metadata, updated_at`,
      [existing.object_id, nextVisibility, nextAlias, JSON.stringify(metadata)],
    );

    return NextResponse.json(toProjectRow(result.rows[0]));
  } catch (error) {
    console.error('Failed to update service:', error);
    return NextResponse.json({ error: 'Failed to update service' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const db = await getDb();
    const url = new URL(req.url);
    const urn = url.searchParams.get('id');

    if (!urn) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const existingRes = await db.query<{ id: string; metadata: unknown }>(
      `SELECT id, metadata
       FROM objects
       WHERE workspace_id = 'default'
         AND object_type = 'service'
         AND urn = $1`,
      [urn],
    );

    const existing = existingRes.rows[0];
    if (!existing) {
      return NextResponse.json({ error: 'service not found' }, { status: 404 });
    }

    const metadata = buildServiceMetadata({
      existing: existing.metadata,
      status: 'DELETED',
      lastSeenAt: new Date().toISOString(),
    });

    await db.query(
      `UPDATE objects
       SET visibility = 'HIDDEN',
           metadata = $2::jsonb,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [existing.id, JSON.stringify(metadata)],
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete service:', error);
    return NextResponse.json({ error: 'Failed to delete service' }, { status: 500 });
  }
}
