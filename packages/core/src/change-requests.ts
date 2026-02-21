import { randomUUID } from 'node:crypto';

export type ChangeRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type ChangeRequestType = 'RELATION_UPSERT' | 'RELATION_DELETE' | 'OBJECT_PATCH';

import {
  parseDependencyUpsertPayload,
  isDependencyUpsertPayload,
  type DependencyUpsertPayload,
  type RelationSource,
} from './change-request-payloads';

interface ChangeRequestRow {
  id: number;
  request_type: ChangeRequestType;
  payload: unknown;
  status: ChangeRequestStatus;
  requested_by: string | null;
  reviewed_by: string | null;
  created_at?: string;
  reviewed_at?: string | null;
}

interface DbLike {
  query: <T = unknown>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
}

const CHANGE_REQUEST_TYPES: ChangeRequestType[] = ['RELATION_UPSERT', 'RELATION_DELETE', 'OBJECT_PATCH'];
const CHANGE_REQUEST_STATUSES: ChangeRequestStatus[] = ['PENDING', 'APPROVED', 'REJECTED'];
const CHANGE_REQUEST_SOURCES: RelationSource[] = ['manual', 'scan', 'inference'];

function asDependencyPayload(payload: unknown, defaultSource: RelationSource = 'manual'): DependencyUpsertPayload | null {
  if (isDependencyUpsertPayload(payload)) return payload;

  try {
    return parseDependencyUpsertPayload(payload, { defaultSource });
  } catch {
    return null;
  }
}

function normalizeActor(input: string | null | undefined, fallback: string): string {
  const value = (input || '').trim();
  return value.length > 0 ? value : fallback;
}

function parseChangeRequestType(input: unknown): ChangeRequestType {
  const value = typeof input === 'string' ? input.trim().toUpperCase() : '';
  if (CHANGE_REQUEST_TYPES.includes(value as ChangeRequestType)) {
    return value as ChangeRequestType;
  }
  throw new Error('INVALID_CHANGE_REQUEST_TYPE');
}

function parseChangeRequestStatus(input: unknown): ChangeRequestStatus {
  const value = typeof input === 'string' ? input.trim().toUpperCase() : '';
  if (CHANGE_REQUEST_STATUSES.includes(value as ChangeRequestStatus)) {
    return value as ChangeRequestStatus;
  }
  throw new Error('INVALID_CHANGE_REQUEST_STATUS');
}

function assertAllowedChangeRequestSource(source: RelationSource): void {
  if (!CHANGE_REQUEST_SOURCES.includes(source)) {
    throw new Error('INVALID_RELATION_SOURCE');
  }
}

async function resolveServiceObjectId(db: DbLike, urn: string): Promise<string | null> {
  const result = await db.query<{ id: string }>(
    `SELECT id
     FROM objects
     WHERE workspace_id = 'default'
       AND object_type = 'service'
       AND urn = $1
     LIMIT 1`,
    [urn],
  );
  return result.rows[0]?.id ?? null;
}

export async function listChangeRequests(
  db: DbLike,
  status: ChangeRequestStatus = 'PENDING',
  limit = 200,
): Promise<ChangeRequestRow[]> {
  const normalizedStatus = parseChangeRequestStatus(status);
  const result = await db.query<ChangeRequestRow>(
    `SELECT id, request_type, payload, status, requested_by, reviewed_by, created_at, reviewed_at
     FROM change_requests
     WHERE workspace_id = 'default'
       AND status = $1
     ORDER BY created_at ASC, id ASC
     LIMIT $2`,
    [normalizedStatus, limit],
  );

  return result.rows;
}

export async function createChangeRequest(
  db: DbLike,
  input: {
    requestType: ChangeRequestType | string;
    payload: unknown;
    requestedBy?: string | null;
  },
): Promise<ChangeRequestRow> {
  const requestType = parseChangeRequestType(input.requestType);
  const requestedBy = normalizeActor(input.requestedBy, 'system');

  let payload = input.payload;
  if (requestType === 'RELATION_UPSERT' || requestType === 'RELATION_DELETE') {
    const parsed = asDependencyPayload(input.payload, 'manual');
    if (!parsed) {
      throw new Error('INVALID_RELATION_PAYLOAD');
    }
    assertAllowedChangeRequestSource(parsed.source);
    payload = parsed;
  }

  const result = await db.query<ChangeRequestRow>(
    `INSERT INTO change_requests (workspace_id, request_type, payload, status, requested_by)
     VALUES ('default', $1, $2::jsonb, 'PENDING', $3)
     RETURNING id, request_type, payload, status, requested_by, reviewed_by, created_at, reviewed_at`,
    [requestType, JSON.stringify(payload), requestedBy],
  );

  return result.rows[0];
}

export async function applyChangeRequest(
  db: DbLike,
  id: number,
  nextStatus: Extract<ChangeRequestStatus, 'APPROVED' | 'REJECTED'>,
  options: { reviewedBy?: string | null } = {},
): Promise<{ id: number; status: ChangeRequestStatus }> {
  const reviewedBy = normalizeActor(options.reviewedBy, 'system');
  const crResult = await db.query<ChangeRequestRow>(
    `SELECT id, request_type, payload, status, requested_by, reviewed_by
     FROM change_requests
     WHERE id = $1
       AND workspace_id = 'default'`,
    [id],
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
      const dependencyPayload = asDependencyPayload(cr.payload, 'manual');
      if ((cr.request_type === 'RELATION_UPSERT' || cr.request_type === 'RELATION_DELETE') && !dependencyPayload) {
        throw new Error('INVALID_RELATION_PAYLOAD');
      }

      if (dependencyPayload) {
        assertAllowedChangeRequestSource(dependencyPayload.source);

        const fromUrn = dependencyPayload.fromId;
        const toUrn = dependencyPayload.toId;
        const relationType = dependencyPayload.type;
        const [subjectObjectId, targetObjectId] = await Promise.all([
          resolveServiceObjectId(db, fromUrn),
          resolveServiceObjectId(db, toUrn),
        ]);

        if (!subjectObjectId || !targetObjectId) {
          throw new Error('REQUEST_OBJECT_NOT_FOUND');
        }

        if (cr.request_type === 'RELATION_UPSERT') {
          const evidenceJson = JSON.stringify(
            dependencyPayload?.evidence
              ? [{ kind: dependencyPayload.source, value: dependencyPayload.evidence }]
              : [],
          );

          await db.query(
            `INSERT INTO object_relations
             (id, workspace_id, subject_object_id, relation_type, target_object_id, approved, is_derived, source, confidence, evidence)
             VALUES ($1, 'default', $2, $3, $4, TRUE, FALSE, $5, $6, $7::jsonb)
             ON CONFLICT (workspace_id, subject_object_id, relation_type, target_object_id, is_derived)
             DO UPDATE SET approved = TRUE,
                           is_derived = FALSE,
                           source = EXCLUDED.source,
                           confidence = EXCLUDED.confidence,
                           evidence = EXCLUDED.evidence,
                           updated_at = CURRENT_TIMESTAMP`,
            [
              randomUUID(),
              subjectObjectId,
              relationType,
              targetObjectId,
              dependencyPayload.source,
              dependencyPayload.confidence ?? null,
              evidenceJson,
            ],
          );
        }

        if (cr.request_type === 'RELATION_DELETE') {
          await db.query(
            `DELETE FROM object_relations
             WHERE workspace_id = 'default'
               AND subject_object_id = $1
               AND target_object_id = $2
               AND relation_type = $3
               AND is_derived = FALSE`,
            [subjectObjectId, targetObjectId, relationType],
          );
        }
      }
    }

    const updated = await db.query<{ id: number; status: ChangeRequestStatus }>(
      `UPDATE change_requests
       SET status = $2,
           reviewed_by = $3,
           reviewed_at = CURRENT_TIMESTAMP
       WHERE id = $1
         AND workspace_id = 'default'
       RETURNING id, status`,
      [id, nextStatus, reviewedBy],
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
  options: { reviewedBy?: string | null } = {},
): Promise<{ processed: number; succeeded: number; failed: Array<{ id: number; reason: string }> }> {
  const failed: Array<{ id: number; reason: string }> = [];
  let succeeded = 0;

  for (const id of ids) {
    try {
      await applyChangeRequest(db, id, nextStatus, options);
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
      `SELECT id FROM change_requests
       WHERE workspace_id = 'default'
         AND status = 'PENDING'
       ORDER BY id ASC`,
    );
    return result.rows.map((row) => row.id);
  }

  const placeholders = excludeIds.map((_, idx) => `$${idx + 1}`).join(', ');
  const result = await db.query<{ id: number }>(
    `SELECT id FROM change_requests
     WHERE workspace_id = 'default'
       AND status = 'PENDING'
       AND id NOT IN (${placeholders})
     ORDER BY id ASC`,
    excludeIds,
  );
  return result.rows.map((row) => row.id);
}
