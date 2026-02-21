import { NextRequest, NextResponse } from 'next/server';
import { createChangeRequest, getDb, listChangeRequests, type ChangeRequestStatus } from '@archi-navi/core';

export async function GET(req: NextRequest) {
  try {
    const status = (req.nextUrl.searchParams.get('status') || 'PENDING').toUpperCase() as ChangeRequestStatus;
    const limitRaw = Number(req.nextUrl.searchParams.get('limit') || '200');
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 1000) : 200;
    const db = await getDb();
    const items = await listChangeRequests(db, status, limit);

    return NextResponse.json({ items });
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_CHANGE_REQUEST_STATUS') {
      return NextResponse.json({ error: 'status must be PENDING, APPROVED, or REJECTED' }, { status: 400 });
    }

    console.error('Failed to list change requests:', error);
    return NextResponse.json({ error: 'Failed to list change requests' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { requestType, payload, requestedBy } = body ?? {};

    if (!requestType || !payload) {
      return NextResponse.json({ error: 'requestType and payload are required' }, { status: 400 });
    }

    const db = await getDb();
    const item = await createChangeRequest(db, {
      requestType,
      payload,
      requestedBy: typeof requestedBy === 'string' ? requestedBy : undefined,
    });

    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    if (
      error instanceof Error &&
      ['INVALID_CHANGE_REQUEST_TYPE', 'INVALID_RELATION_PAYLOAD', 'INVALID_RELATION_SOURCE'].includes(error.message)
    ) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.error('Failed to create change request:', error);
    return NextResponse.json({ error: 'Failed to create change request' }, { status: 500 });
  }
}
