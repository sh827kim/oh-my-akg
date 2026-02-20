import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@archi-navi/core';

interface ChangeRequestRow {
  id: number;
  request_type: string;
  payload: unknown;
  status: string;
  requested_by: string | null;
  reviewed_by: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export async function GET(req: NextRequest) {
  try {
    const status = req.nextUrl.searchParams.get('status') ?? 'PENDING';
    const db = await getDb();
    const result = await db.query<ChangeRequestRow>(
      `SELECT id, request_type, payload, status, requested_by, reviewed_by, created_at, reviewed_at
       FROM change_requests
       WHERE workspace_id = 'default'
         AND status = $1
       ORDER BY created_at ASC, id ASC`,
      [status],
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
    const { requestType, payload, requestedBy } = body ?? {};

    if (!requestType || !payload) {
      return NextResponse.json({ error: 'requestType and payload are required' }, { status: 400 });
    }

    const db = await getDb();
    const result = await db.query<ChangeRequestRow>(
      `INSERT INTO change_requests (workspace_id, request_type, payload, status, requested_by)
       VALUES ('default', $1, $2::jsonb, 'PENDING', $3)
       RETURNING id, request_type, payload, status, requested_by, reviewed_by, created_at, reviewed_at`,
      [requestType, JSON.stringify(payload), requestedBy ?? null],
    );

    return NextResponse.json({ item: result.rows[0] }, { status: 201 });
  } catch (error) {
    console.error('Failed to create change request:', error);
    return NextResponse.json({ error: 'Failed to create change request' }, { status: 500 });
  }
}
