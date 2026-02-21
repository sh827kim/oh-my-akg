import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@archi-navi/core';

interface TagRow {
  id: number;
  name: string;
  color_hex: string;
}

interface ParamsContext {
  params: Promise<{ id: string }>;
}

async function resolveServiceObjectId(projectUrn: string): Promise<string | null> {
  const db = await getDb();
  const result = await db.query<{ id: string }>(
    `SELECT id
     FROM objects
     WHERE workspace_id = 'default'
       AND object_type = 'service'
       AND urn = $1`,
    [projectUrn],
  );
  return result.rows[0]?.id ?? null;
}

export async function GET(_: NextRequest, context: ParamsContext) {
  try {
    const { id: projectUrn } = await context.params;
    const db = await getDb();
    const objectId = await resolveServiceObjectId(projectUrn);

    if (!objectId) return NextResponse.json([]);

    const result = await db.query<TagRow>(
      `SELECT t.id, t.name, t.color_hex
       FROM object_tags ot
       JOIN tags t ON t.id = ot.tag_id
       WHERE ot.workspace_id = 'default'
         AND ot.object_id = $1
       ORDER BY t.name ASC`,
      [objectId],
    );

    return NextResponse.json(
      result.rows.map((row) => ({
        id: String(row.id),
        name: row.name,
        color: row.color_hex,
      })),
    );
  } catch (error) {
    console.error('Failed to fetch tags:', error);
    return NextResponse.json({ error: 'Failed to fetch tags' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, context: ParamsContext) {
  try {
    const { id: projectUrn } = await context.params;
    const body = await req.json();
    const db = await getDb();

    const objectId = await resolveServiceObjectId(projectUrn);
    if (!objectId) {
      return NextResponse.json({ error: 'project not found' }, { status: 404 });
    }

    const tagIdRaw = body.tagId;
    const parsedTagId = Number(tagIdRaw);
    if (!Number.isFinite(parsedTagId)) {
      return NextResponse.json({ error: 'tagId is required' }, { status: 400 });
    }

    const tagRes = await db.query<TagRow>(
      `SELECT id, name, color_hex
       FROM tags
       WHERE workspace_id = 'default'
         AND id = $1`,
      [parsedTagId],
    );

    const tag = tagRes.rows[0];
    if (!tag) {
      return NextResponse.json({ error: 'tag not found' }, { status: 404 });
    }

    await db.query(
      `INSERT INTO object_tags (workspace_id, object_id, tag_id)
       VALUES ('default', $1, $2)
       ON CONFLICT (workspace_id, object_id, tag_id) DO NOTHING`,
      [objectId, parsedTagId],
    );

    return NextResponse.json({
      id: String(tag.id),
      name: tag.name,
      color: tag.color_hex,
    });
  } catch (error) {
    console.error('Failed to add tag:', error);
    return NextResponse.json({ error: 'Failed to add tag' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, context: ParamsContext) {
  try {
    const { id: projectUrn } = await context.params;
    const body = await req.json();
    const db = await getDb();

    const objectId = await resolveServiceObjectId(projectUrn);
    if (!objectId) {
      return NextResponse.json({ error: 'project not found' }, { status: 404 });
    }

    const tagIdRaw = body.tagId;
    const tagId = Number(tagIdRaw);

    if (!Number.isFinite(tagId)) {
      return NextResponse.json({ error: 'tagId is required' }, { status: 400 });
    }

    await db.query(
      `DELETE FROM object_tags
       WHERE workspace_id = 'default'
         AND object_id = $1
         AND tag_id = $2`,
      [objectId, tagId],
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to remove tag:', error);
    return NextResponse.json({ error: 'Failed to remove tag' }, { status: 500 });
  }
}
