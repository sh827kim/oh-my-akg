import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

interface ParamsContext {
    params: Promise<{ id: string }>;
}

interface ProjectTypeRow {
    id: number;
    name: string;
    color_hex: string;
    sort_order: number;
    enabled: boolean;
}

export async function PATCH(req: NextRequest, context: ParamsContext) {
    try {
        const { id } = await context.params;
        const typeId = Number(id);
        if (!Number.isFinite(typeId)) {
            return NextResponse.json({ error: 'invalid id' }, { status: 400 });
        }

        const body = await req.json();
        const db = await getDb();

        const updates: string[] = [];
        const values: Array<string | number | boolean> = [typeId];

        if (typeof body.name === 'string') {
            const name = body.name.trim().toLowerCase();
            if (!name) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 });
            values.push(name);
            updates.push(`name = $${values.length}`);
        }
        if (typeof body.color === 'string') {
            values.push(body.color.trim() || '#6b7280');
            updates.push(`color_hex = $${values.length}`);
        }
        if (typeof body.enabled === 'boolean') {
            values.push(body.enabled);
            updates.push(`enabled = $${values.length}`);
        }
        if (typeof body.sortOrder === 'number' && Number.isFinite(body.sortOrder)) {
            values.push(body.sortOrder);
            updates.push(`sort_order = $${values.length}`);
        }

        if (updates.length === 0) {
            return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
        }
        updates.push('updated_at = CURRENT_TIMESTAMP');

        const result = await db.query<ProjectTypeRow>(
            `
              UPDATE project_types
              SET ${updates.join(', ')}
              WHERE id = $1
              RETURNING id, name, color_hex, sort_order, enabled
            `,
            values
        );

        if (result.rows.length === 0) {
            return NextResponse.json({ error: 'project type not found' }, { status: 404 });
        }

        const row = result.rows[0];
        return NextResponse.json({
            id: row.id,
            name: row.name,
            color: row.color_hex,
            sortOrder: row.sort_order,
            enabled: row.enabled,
        });
    } catch (error) {
        console.error('Failed to update project type:', error);
        return NextResponse.json({ error: 'Failed to update project type' }, { status: 500 });
    }
}

export async function DELETE(_: NextRequest, context: ParamsContext) {
    try {
        const { id } = await context.params;
        const typeId = Number(id);
        if (!Number.isFinite(typeId)) {
            return NextResponse.json({ error: 'invalid id' }, { status: 400 });
        }

        const db = await getDb();

        const typeRes = await db.query<{ name: string }>(
            `SELECT name FROM project_types WHERE id = $1`,
            [typeId]
        );
        if (typeRes.rows.length === 0) {
            return NextResponse.json({ error: 'project type not found' }, { status: 404 });
        }

        const typeName = typeRes.rows[0].name;
        if (typeName === 'unknown') {
            return NextResponse.json({ error: 'unknown type cannot be deleted' }, { status: 400 });
        }

        await db.query(`UPDATE projects SET type = 'unknown' WHERE type = $1`, [typeName]);
        await db.query(`DELETE FROM project_types WHERE id = $1`, [typeId]);

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Failed to delete project type:', error);
        return NextResponse.json({ error: 'Failed to delete project type' }, { status: 500 });
    }
}
