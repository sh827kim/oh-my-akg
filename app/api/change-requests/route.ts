import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

interface ChangeRequestRow {
    id: number;
    project_id: string | null;
    change_type: string;
    payload: unknown;
    status: string;
    created_at: string;
}

export async function GET(req: NextRequest) {
    try {
        const status = req.nextUrl.searchParams.get('status') ?? 'PENDING';
        const db = await getDb();
        const result = await db.query<ChangeRequestRow>(
            `SELECT id, project_id, change_type, payload, status, created_at
             FROM change_requests
             WHERE status = $1
             ORDER BY created_at ASC, id ASC`,
            [status]
        );

        return NextResponse.json({ items: result.rows });
    } catch (error) {
        console.error('Failed to list change requests:', error);
        return NextResponse.json({ error: 'Failed to list change requests' }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { projectId, changeType, payload } = body ?? {};

        if (!changeType || !payload) {
            return NextResponse.json({ error: 'changeType and payload are required' }, { status: 400 });
        }

        const db = await getDb();
        const result = await db.query<ChangeRequestRow>(
            `INSERT INTO change_requests (project_id, change_type, payload, status)
             VALUES ($1, $2, $3::jsonb, 'PENDING')
             RETURNING id, project_id, change_type, payload, status, created_at`,
            [projectId ?? null, changeType, JSON.stringify(payload)]
        );

        return NextResponse.json({ item: result.rows[0] }, { status: 201 });
    } catch (error) {
        console.error('Failed to create change request:', error);
        return NextResponse.json({ error: 'Failed to create change request' }, { status: 500 });
    }
}
