import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

interface TagRow {
    id: number;
    name: string;
    color_hex: string;
}

interface ParamsContext {
    params: Promise<{ id: string }>;
}

export async function GET(_: NextRequest, context: ParamsContext) {
    try {
        const { id: projectId } = await context.params;
        const db = await getDb();

        const result = await db.query<TagRow>(
            `
              SELECT t.id, t.name, t.color_hex
              FROM project_tags pt
              JOIN tags t ON t.id = pt.tag_id
              WHERE pt.project_id = $1
              ORDER BY t.name ASC
            `,
            [projectId]
        );

        return NextResponse.json(
            result.rows.map((row) => ({
                id: String(row.id),
                name: row.name,
                color: row.color_hex,
            }))
        );
    } catch (error) {
        console.error('Failed to fetch tags:', error);
        return NextResponse.json({ error: 'Failed to fetch tags' }, { status: 500 });
    }
}

export async function POST(req: NextRequest, context: ParamsContext) {
    try {
        const { id: projectId } = await context.params;
        const body = await req.json();
        const db = await getDb();

        const tagIdRaw = body.tagId;
        const parsedTagId = Number(tagIdRaw);
        if (!Number.isFinite(parsedTagId)) {
            return NextResponse.json({ error: 'tagId is required' }, { status: 400 });
        }

        const tagRes = await db.query<TagRow>(
            `
              SELECT id, name, color_hex
              FROM tags
              WHERE id = $1
            `,
            [parsedTagId]
        );
        const tag = tagRes.rows[0];
        if (!tag) {
            return NextResponse.json({ error: 'tag not found' }, { status: 404 });
        }

        await db.query(
            `
              INSERT INTO project_tags (project_id, tag_id)
              VALUES ($1, $2)
              ON CONFLICT (project_id, tag_id) DO NOTHING
            `,
            [projectId, parsedTagId]
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
        const { id: projectId } = await context.params;
        const body = await req.json();
        const db = await getDb();

        const tagIdRaw = body.tagId;
        const tagId = Number(tagIdRaw);

        if (!Number.isFinite(tagId)) {
            return NextResponse.json({ error: 'tagId is required' }, { status: 400 });
        }

        await db.query(
            `
              DELETE FROM project_tags
              WHERE project_id = $1 AND tag_id = $2
            `,
            [projectId, tagId]
        );

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Failed to remove tag:', error);
        return NextResponse.json({ error: 'Failed to remove tag' }, { status: 500 });
    }
}
