/**
 * PATCH  /api/layers/:id — 레이어 수정
 * DELETE /api/layers/:id — 레이어 삭제
 */
import { type NextRequest, NextResponse } from 'next/server';
import { getDb, architectureLayers } from '@archi-navi/db';
import { eq } from 'drizzle-orm';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as {
      name?: string;
      displayName?: string;
      color?: string;
      sortOrder?: number;
      isEnabled?: boolean;
    };

    const db = await getDb();

    // 업데이트할 필드만 추출
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) updates['name'] = body.name;
    if (body.displayName !== undefined) updates['displayName'] = body.displayName;
    if (body.color !== undefined) updates['color'] = body.color;
    if (body.sortOrder !== undefined) updates['sortOrder'] = body.sortOrder;
    if (body.isEnabled !== undefined) updates['isEnabled'] = body.isEnabled;

    await db
      .update(architectureLayers)
      .set(updates)
      .where(eq(architectureLayers.id, id));

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[PATCH /api/layers/:id]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const db = await getDb();

    await db
      .delete(architectureLayers)
      .where(eq(architectureLayers.id, id));

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[DELETE /api/layers/:id]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
