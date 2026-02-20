import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

interface ParamsContext {
    params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, context: ParamsContext) {
    try {
        const { id } = await context.params;
        const tagId = Number(id);
        if (!Number.isFinite(tagId)) {
            return NextResponse.json({ error: 'invalid id' }, { status: 400 });
        }

        const body = await req.json();
        const db = await getDb();

        const updates: string[] = [];
        const values: Array<string | number> = [tagId];

        if (typeof body.name === 'string') {
            const name = body.name.trim();
            if (!name) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 });
            values.push(name);
            updates.push(`name = $${values.length}`);
        }
        if (typeof body.color === 'string') {
            values.push(body.color.trim() || '#6b7280');
            updates.push(`color_hex = $${values.length}`);
        }

        if (updates.length === 0) {
            return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
        }

        const result = await db.query(
            `
              UPDATE tags
              SET ${updates.join(', ')}
              WHERE id = $1
              RETURNING id, name, color_hex
            `,
            values
        );

        if (result.rows.length === 0) {
            return NextResponse.json({ error: 'tag not found' }, { status: 404 });
        }

        const row = result.rows[0] as { id: number; name: string; color_hex: string };
        return NextResponse.json({ id: String(row.id), name: row.name, color: row.color_hex });
    } catch (error) {
        console.error('Failed to update tag:', error);
        return NextResponse.json({ error: 'Failed to update tag' }, { status: 500 });
    }
}

export async function DELETE(_: NextRequest, context: ParamsContext) {
    try {
        const { id } = await context.params;
        const tagId = Number(id);
        if (!Number.isFinite(tagId)) {
            return NextResponse.json({ error: 'invalid id' }, { status: 400 });
        }

        const db = await getDb();
        await db.query(`DELETE FROM project_tags WHERE tag_id = $1`, [tagId]);
        await db.query(`DELETE FROM tags WHERE id = $1`, [tagId]);

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Failed to delete tag:', error);
        return NextResponse.json({ error: 'Failed to delete tag' }, { status: 500 });
    }
}
