/**
 * DELETE /api/relations/[id] — 관계 삭제
 */
import { type NextRequest, NextResponse } from 'next/server';
import { getDb, objectRelations } from '@archi-navi/db';
import { eq } from 'drizzle-orm';

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
        const db = await getDb();
        await db.delete(objectRelations).where(eq(objectRelations.id, id));
        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error('[DELETE /api/relations/[id]]', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
