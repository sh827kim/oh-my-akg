import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { applyChangeRequest } from '@/packages/core/src/change-requests';

interface ParamsContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, context: ParamsContext) {
  try {
    const { id } = await context.params;
    const body = await req.json();
    const nextStatus = body?.status as 'APPROVED' | 'REJECTED';

    if (!['APPROVED', 'REJECTED'].includes(nextStatus)) {
      return NextResponse.json({ error: 'status must be APPROVED or REJECTED' }, { status: 400 });
    }

    const db = await getDb();
    const item = await applyChangeRequest(db, Number(id), nextStatus);
    return NextResponse.json({ item });
  } catch (error) {
    if (error instanceof Error && error.message === 'CHANGE_REQUEST_NOT_FOUND') {
      return NextResponse.json({ error: 'change request not found' }, { status: 404 });
    }
    if (error instanceof Error && error.message === 'CHANGE_REQUEST_ALREADY_PROCESSED') {
      return NextResponse.json({ error: 'change request is already processed' }, { status: 409 });
    }

    console.error('Failed to process change request:', error);
    return NextResponse.json({ error: 'Failed to process change request' }, { status: 500 });
  }
}
