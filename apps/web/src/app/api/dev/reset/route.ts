/**
 * POST /api/dev/reset — 워크스페이스 데이터 초기화
 * objects, object_relations, relation_candidates, architecture_layers, object_layer_assignments 삭제
 * workspaces 레코드 자체는 보존
 */
import { type NextRequest, NextResponse } from 'next/server';
import {
  getDb,
  objects,
  objectRelations,
  relationCandidates,
  architectureLayers,
  tags,
} from '@archi-navi/db';
import { eq } from 'drizzle-orm';
import { DEFAULT_WORKSPACE_ID } from '@archi-navi/shared';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { workspaceId?: string };
    const workspaceId = body.workspaceId ?? DEFAULT_WORKSPACE_ID;

    const db = await getDb();

    // CASCADE FK에 의해 하위 테이블도 자동 삭제됨
    // object_layer_assignments → FK on objectId (CASCADE)
    // object_tags → FK on objectId (CASCADE)

    // 1. 관계 후보 삭제
    await db
      .delete(relationCandidates)
      .where(eq(relationCandidates.workspaceId, workspaceId));

    // 2. 확정 관계 삭제
    await db
      .delete(objectRelations)
      .where(eq(objectRelations.workspaceId, workspaceId));

    // 3. 오브젝트 삭제 (object_layer_assignments, object_tags CASCADE)
    await db
      .delete(objects)
      .where(eq(objects.workspaceId, workspaceId));

    // 4. 레이어 삭제 (object_layer_assignments CASCADE)
    await db
      .delete(architectureLayers)
      .where(eq(architectureLayers.workspaceId, workspaceId));

    // 5. 태그 삭제 (object_tags는 objects 삭제 시 이미 CASCADE 처리됨)
    await db
      .delete(tags)
      .where(eq(tags.workspaceId, workspaceId));

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[POST /api/dev/reset]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
