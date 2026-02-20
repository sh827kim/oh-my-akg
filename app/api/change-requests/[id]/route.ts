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
    const db = await getDb();

    try {
        const { id } = await context.params;
        const body = await req.json();
        const nextStatus = body?.status as string;

        if (!['APPROVED', 'REJECTED'].includes(nextStatus)) {
            return NextResponse.json({ error: 'status must be APPROVED or REJECTED' }, { status: 400 });
        }

        await db.query('BEGIN');

        const transitioned = await db.query<ChangeRequestRow>(
            `UPDATE change_requests
             SET status = $2
             WHERE id = $1 AND status = 'PENDING'
             RETURNING id, project_id, change_type, payload, status`,
            [id, nextStatus]
        );

        const cr = transitioned.rows[0];

        if (!cr) {
            const exists = await db.query('SELECT 1 FROM change_requests WHERE id = $1', [id]);
            await db.query('ROLLBACK');

            if (exists.rowCount === 0) {
                return NextResponse.json({ error: 'change request not found' }, { status: 404 });
            }

            return NextResponse.json({ error: 'change request is already processed' }, { status: 409 });
        }

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

        await db.query('COMMIT');

        return NextResponse.json({ item: { id: cr.id, status: cr.status } });
    } catch (error) {
        await db.query('ROLLBACK').catch(() => undefined);
        console.error('Failed to process change request:', error);
        return NextResponse.json({ error: 'Failed to process change request' }, { status: 500 });
    }
}
