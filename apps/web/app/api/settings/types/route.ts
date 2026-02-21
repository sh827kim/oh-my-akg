import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@archi-navi/core';

interface ProjectTypeRow {
    id: number;
    name: string;
    color_hex: string;
    sort_order: number;
    enabled: boolean;
}

export async function GET() {
    try {
        const db = await getDb();
        const result = await db.query<ProjectTypeRow>(
            `
              SELECT id, name, color_hex, sort_order, enabled
              FROM project_types
              ORDER BY sort_order ASC, id ASC
            `
        );

        return NextResponse.json(
            result.rows.map((row) => ({
                id: row.id,
                name: row.name,
                color: row.color_hex,
                sortOrder: row.sort_order,
                enabled: row.enabled,
            }))
        );
    } catch (error) {
        console.error('Failed to fetch service types:', error);
        return NextResponse.json({ error: 'Failed to fetch service types' }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const db = await getDb();
        const body = await req.json();

        const name = typeof body.name === 'string' ? body.name.trim().toLowerCase() : '';
        const color = typeof body.color === 'string' ? body.color.trim() : '#6b7280';

        if (!name) {
            return NextResponse.json({ error: 'name is required' }, { status: 400 });
        }

        const maxOrderRes = await db.query<{ max_order: number | null }>(
            `SELECT MAX(sort_order)::int AS max_order FROM project_types`
        );
        const nextOrder = (maxOrderRes.rows[0]?.max_order ?? 0) + 10;

        const result = await db.query<ProjectTypeRow>(
            `
              INSERT INTO project_types (name, color_hex, sort_order, enabled, updated_at)
              VALUES ($1, $2, $3, TRUE, CURRENT_TIMESTAMP)
              RETURNING id, name, color_hex, sort_order, enabled
            `,
            [name, color, nextOrder]
        );

        const row = result.rows[0];
        return NextResponse.json(
            {
                id: row.id,
                name: row.name,
                color: row.color_hex,
                sortOrder: row.sort_order,
                enabled: row.enabled,
            },
            { status: 201 }
        );
    } catch (error) {
        console.error('Failed to create service type:', error);
        return NextResponse.json({ error: 'Failed to create service type' }, { status: 500 });
    }
}
