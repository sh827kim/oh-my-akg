export type ChangeRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

import {
  isDependencyUpsertPayload,
  type DependencyUpsertPayload,
} from './change-request-payloads';

interface ChangeRequestRow {
  id: number;
  project_id: string | null;
  change_type: string;
  payload: unknown;
  status: ChangeRequestStatus;
  created_at?: string;
}

interface DbLike {
  query: <T = unknown>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
}

function asDependencyPayload(payload: unknown): DependencyUpsertPayload | null {
  return isDependencyUpsertPayload(payload) ? payload : null;
}

export async function listChangeRequests(
  db: DbLike,
  status: ChangeRequestStatus = 'PENDING',
  limit = 200,
): Promise<ChangeRequestRow[]> {
  const result = await db.query<ChangeRequestRow>(
    `SELECT id, project_id, change_type, payload, status, created_at
     FROM change_requests
     WHERE status = $1
     ORDER BY created_at ASC, id ASC
     LIMIT $2`,
    [status, limit]
  );

  return result.rows;
}

export async function applyChangeRequest(
  db: DbLike,
  id: number,
  nextStatus: Extract<ChangeRequestStatus, 'APPROVED' | 'REJECTED'>,
): Promise<{ id: number; status: ChangeRequestStatus }> {
  const crResult = await db.query<ChangeRequestRow>(
    `SELECT id, project_id, change_type, payload, status
     FROM change_requests
     WHERE id = $1`,
    [id]
  );

  const cr = crResult.rows[0];
  if (!cr) {
    throw new Error('CHANGE_REQUEST_NOT_FOUND');
  }
  if (cr.status !== 'PENDING') {
    throw new Error('CHANGE_REQUEST_ALREADY_PROCESSED');
  }

  await db.query('BEGIN');

  try {
    if (nextStatus === 'APPROVED') {
      const dependencyPayload = asDependencyPayload(cr.payload);
      const fromId = dependencyPayload?.fromId;
      const toId = dependencyPayload?.toId;
      const edgeType = dependencyPayload?.type ?? 'unknown';

      if (cr.change_type === 'DEPENDENCY_UPSERT' && fromId && toId) {
        await db.query(
          `INSERT INTO edges (from_id, to_id, type, approved, is_derived)
           VALUES ($1, $2, $3, TRUE, FALSE)
           ON CONFLICT (from_id, to_id, type)
           DO UPDATE SET approved = TRUE, is_derived = FALSE`,
          [fromId, toId, edgeType]
        );
      }

      if (cr.change_type === 'DEPENDENCY_DELETE' && fromId && toId) {
        await db.query(
          `DELETE FROM edges
           WHERE from_id = $1 AND to_id = $2 AND type = $3`,
          [fromId, toId, edgeType]
        );
      }
    }

    const updated = await db.query<{ id: number; status: ChangeRequestStatus }>(
      `UPDATE change_requests
       SET status = $2
       WHERE id = $1
       RETURNING id, status`,
      [id, nextStatus]
    );

    await db.query('COMMIT');

    return updated.rows[0];
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

export async function applyBulkChangeRequests(
  db: DbLike,
  ids: number[],
  nextStatus: Extract<ChangeRequestStatus, 'APPROVED' | 'REJECTED'>,
): Promise<{ processed: number; succeeded: number; failed: Array<{ id: number; reason: string }> }> {
  const failed: Array<{ id: number; reason: string }> = [];
  let succeeded = 0;

  for (const id of ids) {
    try {
      await applyChangeRequest(db, id, nextStatus);
      succeeded += 1;
    } catch (error) {
      failed.push({ id, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    processed: ids.length,
    succeeded,
    failed,
  };
}

export async function listPendingIds(
  db: DbLike,
  excludeIds: number[] = [],
): Promise<number[]> {
  if (excludeIds.length === 0) {
    const result = await db.query<{ id: number }>(
      `SELECT id FROM change_requests WHERE status = 'PENDING' ORDER BY id ASC`
    );
    return result.rows.map((row) => row.id);
  }

  const placeholders = excludeIds.map((_, idx) => `$${idx + 1}`).join(', ');
  const result = await db.query<{ id: number }>(
    `SELECT id FROM change_requests
     WHERE status = 'PENDING'
       AND id NOT IN (${placeholders})
     ORDER BY id ASC`,
    excludeIds,
  );
  return result.rows.map((row) => row.id);
}
