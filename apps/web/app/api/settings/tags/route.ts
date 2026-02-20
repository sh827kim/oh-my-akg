import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@archi-navi/core';

interface TagRow {
    id: number;
    name: string;
    color_hex: string;
}

export async function GET() {
    try {
        const db = await getDb();
        const result = await db.query<TagRow>(
            `
              SELECT id, name, color_hex
              FROM tags
              WHERE workspace_id = 'default'
              ORDER BY name ASC
            `
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

export async function POST(req: NextRequest) {
    try {
        const db = await getDb();
        const body = await req.json();

        const name = typeof body.name === 'string' ? body.name.trim() : '';
        const color = typeof body.color === 'string' ? body.color.trim() : '#6b7280';

        if (!name) {
            return NextResponse.json({ error: 'name is required' }, { status: 400 });
        }

        const result = await db.query<TagRow>(
            `
              INSERT INTO tags (workspace_id, name, color_hex)
              VALUES ('default', $1, $2)
              ON CONFLICT (workspace_id, name)
              DO UPDATE SET color_hex = EXCLUDED.color_hex, updated_at = CURRENT_TIMESTAMP
              RETURNING id, name, color_hex
            `,
            [name, color]
        );

        const row = result.rows[0];
        return NextResponse.json(
            {
                id: String(row.id),
                name: row.name,
                color: row.color_hex,
            },
            { status: 201 }
        );
    } catch (error) {
        console.error('Failed to upsert tag:', error);
        return NextResponse.json({ error: 'Failed to save tag' }, { status: 500 });
    }
}
