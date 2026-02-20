import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
    try {
        const db = await getDb();
        const result = await db.query(
            `SELECT id, pattern, target_project_id, dependency_type, enabled, created_at, updated_at
             FROM auto_mapping_patterns
             ORDER BY enabled DESC, pattern ASC`
        );
        return NextResponse.json({ items: result.rows });
    } catch (error) {
        console.error('Failed to fetch auto mapping patterns:', error);
        return NextResponse.json({ error: 'Failed to fetch auto mapping patterns' }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json().catch(() => ({}));
        const pattern = typeof body.pattern === 'string' ? body.pattern.trim() : '';
        const targetProjectId = typeof body.target_project_id === 'string' ? body.target_project_id.trim() : '';
        const dependencyType = typeof body.dependency_type === 'string' && body.dependency_type.trim()
            ? body.dependency_type.trim()
            : 'unknown';
        const enabled = body.enabled === undefined ? true : Boolean(body.enabled);

        if (!pattern || !targetProjectId) {
            return NextResponse.json(
                { error: 'pattern and target_project_id are required' },
                { status: 400 }
            );
        }

        const db = await getDb();
        const result = await db.query(
            `INSERT INTO auto_mapping_patterns (pattern, target_project_id, dependency_type, enabled)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (pattern, target_project_id)
             DO UPDATE SET dependency_type = EXCLUDED.dependency_type,
                           enabled = EXCLUDED.enabled,
                           updated_at = CURRENT_TIMESTAMP
             RETURNING id, pattern, target_project_id, dependency_type, enabled, created_at, updated_at`,
            [pattern, targetProjectId, dependencyType, enabled]
        );

        return NextResponse.json({ item: result.rows[0] }, { status: 201 });
    } catch (error) {
        console.error('Failed to create auto mapping pattern:', error);
        return NextResponse.json({ error: 'Failed to create auto mapping pattern' }, { status: 500 });
    }
}
