import { randomUUID } from 'node:crypto';
import { buildServiceMetadata } from '../packages/core/src/project-model';
import { getDb } from '../packages/core/src/db';

interface CountRow {
  count: number | string;
}

interface UpdatedObjectRow {
  visibility: string;
  display_name: string | null;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function toNumber(value: number | string): number {
  return typeof value === 'number' ? value : Number(value);
}

async function main() {
  const db = await getDb();
  const runId = Date.now();
  const workspaceId = 'default';

  const objectId = randomUUID();
  const urn = `smoke-task1-5-${runId}`;
  const repoName = `smoke-task1-5-repo-${runId}`;
  const alias = `smoke-alias-${runId}`;
  const tagName = `smoke-task1-5-tag-${runId}`;
  const tagColor = '#22c55e';

  let tagId: number | null = null;

  try {
    const metadata = buildServiceMetadata({
      repoUrl: '#',
      description: 'task1-5 smoke test object',
      projectType: 'backend',
      status: 'ACTIVE',
      lastSeenAt: new Date().toISOString(),
    });

    await db.query(
      `INSERT INTO objects
       (id, workspace_id, object_type, name, display_name, urn, visibility, granularity, metadata)
       VALUES ($1, $2, 'service', $3, NULL, $4, 'VISIBLE', 'COMPOUND', $5::jsonb)`,
      [objectId, workspaceId, repoName, urn, JSON.stringify(metadata)],
    );

    const listCountResult = await db.query<CountRow>(
      `SELECT COUNT(*)::int AS count
       FROM objects
       WHERE workspace_id = $1
         AND object_type = 'service'
         AND urn = $2`,
      [workspaceId, urn],
    );
    assert(toNumber(listCountResult.rows[0].count) === 1, '조회(목록) 검증 실패: 생성 object를 찾을 수 없습니다.');

    const updateResult = await db.query<UpdatedObjectRow>(
      `UPDATE objects
       SET display_name = $2,
           visibility = 'HIDDEN',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING visibility, display_name`,
      [objectId, alias],
    );
    const updated = updateResult.rows[0];
    assert(updated.visibility === 'HIDDEN', '가시성 수정 검증 실패: visibility=HIDDEN이 아닙니다.');
    assert(updated.display_name === alias, '수정 검증 실패: display_name 반영이 누락되었습니다.');

    const tagResult = await db.query<{ id: number | string }>(
      `INSERT INTO tags (workspace_id, name, color_hex)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [workspaceId, tagName, tagColor],
    );
    tagId = Number(tagResult.rows[0].id);

    await db.query(
      `INSERT INTO object_tags (workspace_id, object_id, tag_id)
       VALUES ($1, $2, $3)`,
      [workspaceId, objectId, tagId],
    );

    const taggedCountResult = await db.query<CountRow>(
      `SELECT COUNT(*)::int AS count
       FROM object_tags
       WHERE workspace_id = $1
         AND object_id = $2
         AND tag_id = $3`,
      [workspaceId, objectId, tagId],
    );
    assert(toNumber(taggedCountResult.rows[0].count) === 1, '태그 추가 검증 실패: object_tags에 반영되지 않았습니다.');

    await db.query(
      `DELETE FROM object_tags
       WHERE workspace_id = $1
         AND object_id = $2
         AND tag_id = $3`,
      [workspaceId, objectId, tagId],
    );

    const removedTagCountResult = await db.query<CountRow>(
      `SELECT COUNT(*)::int AS count
       FROM object_tags
       WHERE workspace_id = $1
         AND object_id = $2
         AND tag_id = $3`,
      [workspaceId, objectId, tagId],
    );
    assert(toNumber(removedTagCountResult.rows[0].count) === 0, '태그 삭제 검증 실패: object_tags 레코드가 남아있습니다.');

    console.log('OK: task1-5 smoke test passed (조회/수정/태그/가시성).');
  } finally {
    await db.query(
      `DELETE FROM object_relations
       WHERE workspace_id = $1
         AND (subject_object_id = $2 OR target_object_id = $2)`,
      [workspaceId, objectId],
    );
    await db.query(
      `DELETE FROM object_tags
       WHERE workspace_id = $1
         AND object_id = $2`,
      [workspaceId, objectId],
    );
    if (tagId !== null) {
      await db.query(
        `DELETE FROM tags
         WHERE workspace_id = $1
           AND id = $2`,
        [workspaceId, tagId],
      );
    }
    await db.query(
      `DELETE FROM objects
       WHERE workspace_id = $1
         AND id = $2`,
      [workspaceId, objectId],
    );
  }
}

main().catch((error) => {
  console.error('task1-5 smoke test failed:', error);
  process.exit(1);
});
