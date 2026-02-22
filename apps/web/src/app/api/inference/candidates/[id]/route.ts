/**
 * PATCH /api/inference/candidates/:id — 후보 상태 변경 (승인/거부)
 * 승인 시 → object_relations에 APPROVED 상태로 이동
 */
import { type NextRequest, NextResponse } from 'next/server';
import { getDb } from '@archi-navi/db';
import { relationCandidates, objectRelations } from '@archi-navi/db';
import { eq } from 'drizzle-orm';
import { generateId } from '@archi-navi/shared';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as { status: 'APPROVED' | 'REJECTED' };

    if (!['APPROVED', 'REJECTED'].includes(body.status)) {
      return NextResponse.json(
        { error: 'status는 APPROVED 또는 REJECTED 이어야 합니다' },
        { status: 400 },
      );
    }

    const db = await getDb();

    // 후보 조회
    const [candidate] = await db
      .select()
      .from(relationCandidates)
      .where(eq(relationCandidates.id, id))
      .limit(1);

    if (!candidate) {
      return NextResponse.json({ error: '후보를 찾을 수 없습니다' }, { status: 404 });
    }

    // 상태 업데이트
    await db
      .update(relationCandidates)
      .set({ status: body.status })
      .where(eq(relationCandidates.id, id));

    // 승인 시 → object_relations에 확정 관계 생성
    if (body.status === 'APPROVED') {
      await db.insert(objectRelations).values({
        id: generateId(),
        workspaceId: candidate.workspaceId,
        subjectObjectId: candidate.subjectObjectId,
        relationType: candidate.relationType,
        objectId: candidate.objectId,
        confidence: candidate.confidence,
        status: 'APPROVED',
        metadata: { approvedFromCandidate: id },
      });
    }

    return NextResponse.json({ success: true, status: body.status });
  } catch (error) {
    console.error('[PATCH /api/inference/candidates/:id]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
