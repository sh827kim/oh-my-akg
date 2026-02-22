import { randomUUID } from 'node:crypto';

export type ChangeRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type ChangeRequestType = 'RELATION_UPSERT' | 'RELATION_DELETE' | 'OBJECT_PATCH' | 'OBJECT_CREATE';

import {
  parseDependencyUpsertPayload,
  parseObjectCreatePayload,
  type DependencyUpsertPayload,
  type ObjectCreatePayload,
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

interface WorkspaceScopedOptions {
  workspaceId?: string | null;
}

const CHANGE_REQUEST_TYPES: ChangeRequestType[] = ['RELATION_UPSERT', 'RELATION_DELETE', 'OBJECT_PATCH', 'OBJECT_CREATE'];
const CHANGE_REQUEST_STATUSES: ChangeRequestStatus[] = ['PENDING', 'APPROVED', 'REJECTED'];
const CHANGE_REQUEST_SOURCES: RelationSource[] = ['manual', 'scan', 'inference'];

function asDependencyPayload(payload: unknown, defaultSource: RelationSource = 'manual'): DependencyUpsertPayload | null {
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

function normalizeWorkspaceId(input: string | null | undefined): string {
  const value = (input || '').trim();
  return value.length > 0 ? value : 'default';
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

function buildEvidenceEnvelope(payload: DependencyUpsertPayload): Array<Record<string, unknown>> {
  if (!payload.evidence) return [];

  if (payload.evidence.startsWith('v1|')) {
    const [schemaVersion, kind, file, lineRaw, symbol, snippetHash, detail] = payload.evidence.split('|');
    const line = Number(lineRaw);

    return [{
      schemaVersion,
      kind: kind || payload.source,
      file: file || '',
      ...(Number.isFinite(line) ? { line } : {}),
      ...(symbol ? { symbol } : {}),
      ...(snippetHash ? { snippetHash } : {}),
      ...(detail ? { detail } : {}),
      ...(payload.scoreVersion ? { scoreVersion: payload.scoreVersion } : {}),
      ...(payload.reviewTag ? { reviewTag: payload.reviewTag } : {}),
      ...(payload.tags ? { tags: payload.tags } : {}),
      source: payload.source,
    }];
  }

  return [{
    schemaVersion: 'legacy',
    kind: payload.source,
    value: payload.evidence,
    ...(payload.scoreVersion ? { scoreVersion: payload.scoreVersion } : {}),
    ...(payload.reviewTag ? { reviewTag: payload.reviewTag } : {}),
    ...(payload.tags ? { tags: payload.tags } : {}),
  }];
}

async function resolveServiceObjectId(db: DbLike, workspaceId: string, urn: string): Promise<string | null> {
  const result = await db.query<{ id: string }>(
    `SELECT id
     FROM objects
     WHERE workspace_id = $1
       AND object_type = 'service'
       AND urn = $2
     LIMIT 1`,
    [workspaceId, urn],
  );
  return result.rows[0]?.id ?? null;
}

// object_type 무관하게 URN으로 Object 조회 (OBJECT_CREATE 승인 시 parentUrn 해결에 사용)
async function resolveObjectByUrn(db: DbLike, workspaceId: string, urn: string): Promise<string | null> {
  const result = await db.query<{ id: string }>(
    `SELECT id FROM objects WHERE workspace_id = $1 AND urn = $2 LIMIT 1`,
    [workspaceId, urn],
  );
  return result.rows[0]?.id ?? null;
}

export async function listChangeRequests(
  db: DbLike,
  status: ChangeRequestStatus = 'PENDING',
  limit = 200,
  options: WorkspaceScopedOptions = {},
): Promise<ChangeRequestRow[]> {
  const normalizedStatus = parseChangeRequestStatus(status);
  const workspaceId = normalizeWorkspaceId(options.workspaceId);
  const result = await db.query<ChangeRequestRow>(
    `SELECT id, request_type, payload, status, requested_by, reviewed_by, created_at, reviewed_at
     FROM change_requests
     WHERE workspace_id = $1
       AND status = $2
     ORDER BY created_at ASC, id ASC
     LIMIT $3`,
    [workspaceId, normalizedStatus, limit],
  );

  return result.rows;
}

export async function createChangeRequest(
  db: DbLike,
  input: {
    requestType: ChangeRequestType | string;
    payload: unknown;
    requestedBy?: string | null;
    workspaceId?: string | null;
  },
): Promise<ChangeRequestRow> {
  const requestType = parseChangeRequestType(input.requestType);
  const requestedBy = normalizeActor(input.requestedBy, 'system');
  const workspaceId = normalizeWorkspaceId(input.workspaceId);

  let payload = input.payload;
  if (requestType === 'RELATION_UPSERT' || requestType === 'RELATION_DELETE') {
    const parsed = asDependencyPayload(input.payload, 'manual');
    if (!parsed) {
      throw new Error('INVALID_RELATION_PAYLOAD');
    }
    assertAllowedChangeRequestSource(parsed.source);
    payload = parsed;
  } else if (requestType === 'OBJECT_CREATE') {
    try {
      payload = parseObjectCreatePayload(input.payload);
    } catch {
      throw new Error('INVALID_OBJECT_CREATE_PAYLOAD');
    }
  }

  const result = await db.query<ChangeRequestRow>(
    `INSERT INTO change_requests (workspace_id, request_type, payload, status, requested_by)
     VALUES ($1, $2, $3::jsonb, 'PENDING', $4)
     RETURNING id, request_type, payload, status, requested_by, reviewed_by, created_at, reviewed_at`,
    [workspaceId, requestType, JSON.stringify(payload), requestedBy],
  );

  return result.rows[0];
}

export async function applyChangeRequest(
  db: DbLike,
  id: number,
  nextStatus: Extract<ChangeRequestStatus, 'APPROVED' | 'REJECTED'>,
  options: { reviewedBy?: string | null; workspaceId?: string | null } = {},
): Promise<{ id: number; status: ChangeRequestStatus }> {
  const reviewedBy = normalizeActor(options.reviewedBy, 'system');
  const workspaceId = normalizeWorkspaceId(options.workspaceId);
  const crResult = await db.query<ChangeRequestRow>(
    `SELECT id, request_type, payload, status, requested_by, reviewed_by
     FROM change_requests
     WHERE id = $1
       AND workspace_id = $2`,
    [id, workspaceId],
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

      // OBJECT_CREATE 승인: objects 테이블에 새 Object INSERT
    if (cr.request_type === 'OBJECT_CREATE') {
      let objPayload: ObjectCreatePayload;
      try {
        objPayload = parseObjectCreatePayload(cr.payload);
      } catch {
        throw new Error('INVALID_OBJECT_CREATE_PAYLOAD');
      }
      const parentId = objPayload.parentUrn
        ? await resolveObjectByUrn(db, workspaceId, objPayload.parentUrn)
        : null;
      await db.query(
        `INSERT INTO objects
         (id, workspace_id, object_type, name, display_name, urn, parent_id, visibility, granularity, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'VISIBLE', $8, $9::jsonb)
         ON CONFLICT (workspace_id, urn) WHERE urn IS NOT NULL DO NOTHING`,
        [
          randomUUID(), workspaceId,
          objPayload.objectType, objPayload.name,
          objPayload.displayName ?? null,
          objPayload.urn, parentId,
          objPayload.granularity,
          JSON.stringify(objPayload.metadata ?? {}),
        ],
      );
    }

    if (dependencyPayload) {
        assertAllowedChangeRequestSource(dependencyPayload.source);

        const fromUrn = dependencyPayload.fromId;
        const toUrn = dependencyPayload.toId;
        const relationType = dependencyPayload.type;
        const [subjectObjectId, targetObjectId] = await Promise.all([
          resolveServiceObjectId(db, workspaceId, fromUrn),
          resolveServiceObjectId(db, workspaceId, toUrn),
        ]);

        if (!subjectObjectId || !targetObjectId) {
          throw new Error('REQUEST_OBJECT_NOT_FOUND');
        }

        if (cr.request_type === 'RELATION_UPSERT') {
          const evidenceJson = JSON.stringify(buildEvidenceEnvelope(dependencyPayload));

          await db.query(
            `INSERT INTO object_relations
             (id, workspace_id, subject_object_id, relation_type, target_object_id, approved, is_derived, source, confidence, evidence)
             VALUES ($1, $2, $3, $4, $5, TRUE, FALSE, $6, $7, $8::jsonb)
             ON CONFLICT (workspace_id, subject_object_id, relation_type, target_object_id, is_derived)
             DO UPDATE SET approved = TRUE,
                           is_derived = FALSE,
                           source = EXCLUDED.source,
                           confidence = EXCLUDED.confidence,
                           evidence = EXCLUDED.evidence,
                           updated_at = CURRENT_TIMESTAMP`,
            [
              randomUUID(),
              workspaceId,
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
             WHERE workspace_id = $1
               AND subject_object_id = $2
               AND target_object_id = $3
               AND relation_type = $4
               AND is_derived = FALSE`,
            [workspaceId, subjectObjectId, targetObjectId, relationType],
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
         AND workspace_id = $4
       RETURNING id, status`,
      [id, nextStatus, reviewedBy, workspaceId],
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
  options: { reviewedBy?: string | null; workspaceId?: string | null } = {},
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
  options: WorkspaceScopedOptions = {},
): Promise<number[]> {
  const workspaceId = normalizeWorkspaceId(options.workspaceId);
  if (excludeIds.length === 0) {
    const result = await db.query<{ id: number }>(
      `SELECT id FROM change_requests
       WHERE workspace_id = $1
         AND status = 'PENDING'
       ORDER BY id ASC`,
      [workspaceId],
    );
    return result.rows.map((row) => row.id);
  }

  const placeholders = excludeIds.map((_, idx) => `$${idx + 2}`).join(', ');
  const result = await db.query<{ id: number }>(
    `SELECT id FROM change_requests
     WHERE workspace_id = $1
       AND status = 'PENDING'
       AND id NOT IN (${placeholders})
     ORDER BY id ASC`,
    [workspaceId, ...excludeIds],
  );
  return result.rows.map((row) => row.id);
}
