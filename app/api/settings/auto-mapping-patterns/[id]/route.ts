import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

interface ParamsContext {
    params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, context: ParamsContext) {
    try {
        const { id } = await context.params;
        const body = await req.json().catch(() => ({}));
        const fields: string[] = [];
        const values: Array<string | boolean> = [];

        if (typeof body.pattern === 'string') {
            fields.push(`pattern = $${fields.length + 1}`);
            values.push(body.pattern.trim());
        }
        if (typeof body.target_project_id === 'string') {
            fields.push(`target_project_id = $${fields.length + 1}`);
            values.push(body.target_project_id.trim());
        }
        if (typeof body.dependency_type === 'string') {
            fields.push(`dependency_type = $${fields.length + 1}`);
            values.push(body.dependency_type.trim() || 'unknown');
        }
        if (typeof body.enabled === 'boolean') {
            fields.push(`enabled = $${fields.length + 1}`);
            values.push(body.enabled);
        }

        if (fields.length === 0) {
            return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
        }

        fields.push('updated_at = CURRENT_TIMESTAMP');

        const db = await getDb();
        const result = await db.query(
            `UPDATE auto_mapping_patterns
             SET ${fields.join(', ')}
             WHERE id = $${fields.length}
             RETURNING id, pattern, target_project_id, dependency_type, enabled, created_at, updated_at`,
            [...values, id]
        );

        const item = result.rows[0];
        if (!item) {
            return NextResponse.json({ error: 'pattern not found' }, { status: 404 });
        }

        return NextResponse.json({ item });
    } catch (error) {
        console.error('Failed to update auto mapping pattern:', error);
        return NextResponse.json({ error: 'Failed to update auto mapping pattern' }, { status: 500 });
    }
}

export async function DELETE(_: NextRequest, context: ParamsContext) {
    try {
        const { id } = await context.params;
        const db = await getDb();
        const result = await db.query(
            `DELETE FROM auto_mapping_patterns
             WHERE id = $1
             RETURNING id`,
            [id]
        );

        if (result.rows.length === 0) {
            return NextResponse.json({ error: 'pattern not found' }, { status: 404 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Failed to delete auto mapping pattern:', error);
        return NextResponse.json({ error: 'Failed to delete auto mapping pattern' }, { status: 500 });
    }
}
