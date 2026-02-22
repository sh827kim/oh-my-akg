/**
 * GET  /api/workspaces — 전체 워크스페이스 목록
 * POST /api/workspaces — 새 워크스페이스 생성
 */
import { type NextRequest, NextResponse } from 'next/server';
import { getDb, workspaces } from '@archi-navi/db';
import { asc } from 'drizzle-orm';
import { generateId } from '@archi-navi/shared';

export async function GET() {
  try {
    const db = await getDb();
    const rows = await db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        createdAt: workspaces.createdAt,
      })
      .from(workspaces)
      .orderBy(asc(workspaces.createdAt));

    return NextResponse.json(rows);
  } catch (error) {
    console.error('[GET /api/workspaces]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { name: string };

    if (!body.name?.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    const id = generateId();
    const db = await getDb();

    await db.insert(workspaces).values({
      id,
      name: body.name.trim(),
    });

    return NextResponse.json({ id, name: body.name.trim() }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/workspaces]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
