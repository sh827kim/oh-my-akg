import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

interface ParamsContext {
    params: Promise<{ id: string }>;
}

interface ChangeRequestRow {
    id: number;
    project_id: string | null;
    change_type: string;
    payload: {
        fromId?: string;
        toId?: string;
        type?: string;
    };
    status: string;
}

export async function PATCH(req: NextRequest, context: ParamsContext) {
    try {
        const { id } = await context.params;
        const body = await req.json();
        const nextStatus = body?.status as string;

        if (!['APPROVED', 'REJECTED'].includes(nextStatus)) {
            return NextResponse.json({ error: 'status must be APPROVED or REJECTED' }, { status: 400 });
        }

        const db = await getDb();
        const crResult = await db.query<ChangeRequestRow>(
            `SELECT id, project_id, change_type, payload, status
             FROM change_requests
             WHERE id = $1`,
            [id]
        );

        const cr = crResult.rows[0];
        if (!cr) {
            return NextResponse.json({ error: 'change request not found' }, { status: 404 });
        }
        if (cr.status !== 'PENDING') {
            return NextResponse.json({ error: 'change request is already processed' }, { status: 409 });
        }

        await db.query('BEGIN');

        if (nextStatus === 'APPROVED') {
            const fromId = cr.payload?.fromId;
            const toId = cr.payload?.toId;
            const edgeType = cr.payload?.type ?? 'unknown';

            if (cr.change_type === 'DEPENDENCY_UPSERT' && fromId && toId) {
                await db.query(
                    `INSERT INTO edges (from_id, to_id, type, approved)
                     VALUES ($1, $2, $3, TRUE)
                     ON CONFLICT (from_id, to_id, type)
                     DO UPDATE SET approved = TRUE`,
                    [fromId, toId, edgeType]
                );
            }

            if (cr.change_type === 'DEPENDENCY_DELETE' && fromId && toId) {
                await db.query(
                    `DELETE FROM edges
                     WHERE from_id = $1 AND to_id = $2 AND type = $3`,
                    [fromId, toId, edgeType]
                );
            }
        }

        const updated = await db.query(
            `UPDATE change_requests
             SET status = $2
             WHERE id = $1
             RETURNING id, status`,
            [id, nextStatus]
        );

        await db.query('COMMIT');

        return NextResponse.json({ item: updated.rows[0] });
    } catch (error) {
        const db = await getDb();
        await db.query('ROLLBACK');
        console.error('Failed to process change request:', error);
        return NextResponse.json({ error: 'Failed to process change request' }, { status: 500 });
    }
}
