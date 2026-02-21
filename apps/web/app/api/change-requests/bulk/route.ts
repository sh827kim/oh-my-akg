import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@archi-navi/core';
import { applyBulkChangeRequests, listPendingIds } from '@archi-navi/core';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const status = (body?.status || 'APPROVED') as 'APPROVED' | 'REJECTED';
    const reviewedBy = typeof body?.reviewedBy === 'string' ? body.reviewedBy.trim() : '';
    const all = Boolean(body?.all);
    const workspaceId = typeof body?.workspaceId === 'string' ? body.workspaceId : undefined;
    const ids = Array.isArray(body?.ids)
      ? body.ids.map((id: unknown) => Number(id)).filter((id: number) => Number.isInteger(id) && id > 0)
      : [];
    const excludeIds = Array.isArray(body?.excludeIds)
      ? body.excludeIds.map((id: unknown) => Number(id)).filter((id: number) => Number.isInteger(id) && id > 0)
      : [];

    if (!['APPROVED', 'REJECTED'].includes(status)) {
      return NextResponse.json({ error: 'status must be APPROVED or REJECTED' }, { status: 400 });
    }

    const db = await getDb();
    const targetIds = all ? await listPendingIds(db, excludeIds, { workspaceId }) : ids;

    if (targetIds.length === 0) {
      return NextResponse.json({ error: 'No target ids' }, { status: 400 });
    }

    const summary = await applyBulkChangeRequests(db, targetIds, status, { reviewedBy, workspaceId });
    return NextResponse.json(summary);
  } catch (error) {
    console.error('Failed to process bulk change requests:', error);
    return NextResponse.json({ error: 'Failed to process bulk change requests' }, { status: 500 });
  }
}
