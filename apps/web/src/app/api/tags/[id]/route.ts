/**
 * PATCH  /api/tags/:id — 태그 이름/색상 수정
 * DELETE /api/tags/:id — 태그 삭제 (objectTags 자동 cascade)
 */
import { type NextRequest, NextResponse } from 'next/server';
import { getDb, tags } from '@archi-navi/db';
import { eq } from 'drizzle-orm';

/* ── PATCH: 태그 수정 ── */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as {
      name?: string;
      color?: string;
    };

    const updates: Record<string, string> = {};
    if (body.name?.trim()) updates.name = body.name.trim();
    if (body.color) updates.color = body.color;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: '수정할 필드가 없습니다' }, { status: 400 });
    }

    const db = await getDb();
    await db.update(tags).set(updates).where(eq(tags.id, id));

    return NextResponse.json({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '';
    if (msg.includes('uq_tags_ws_name') || msg.includes('duplicate key')) {
      return NextResponse.json({ error: '이미 존재하는 태그 이름입니다' }, { status: 409 });
    }
    console.error('[PATCH /api/tags/[id]]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/* ── DELETE: 태그 삭제 (objectTags FK cascade 자동 삭제) ── */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const db = await getDb();
    await db.delete(tags).where(eq(tags.id, id));

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[DELETE /api/tags/[id]]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
