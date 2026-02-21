import { randomUUID } from 'node:crypto';
import { getDb } from '../packages/core/src/db';
import { buildServiceMetadata } from '../packages/core/src/project-model';
import { buildDependencyUpsertPayload } from '../packages/core/src/change-request-payloads';
import { applyChangeRequest, createChangeRequest } from '../packages/core/src/change-requests';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function expectError(action: () => Promise<unknown>, expectedMessage: string): Promise<void> {
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === expectedMessage || message.includes(expectedMessage)) {
      return;
    }
    throw new Error(`Expected error "${expectedMessage}" but received "${message}"`);
  }

  throw new Error(`Expected error "${expectedMessage}" but action succeeded`);
}

async function main() {
  const db = await getDb();
  const workspaceId = 'default';
  const runId = Date.now();
  const reviewer = `task2-reviewer-${runId}`;
  const requestedBy = `task2-requester-${runId}`;

  const objectA = randomUUID();
  const objectB = randomUUID();
  const objectC = randomUUID();
  const urnA = `task2/${runId}/a`;
  const urnB = `task2/${runId}/b`;
  const urnC = `task2/${runId}/c`;
  const requestIds: number[] = [];

  const metadata = buildServiceMetadata({
    repoUrl: '#',
    description: 'task2 approval test object',
    projectType: 'backend',
    status: 'ACTIVE',
    lastSeenAt: new Date().toISOString(),
  });

  try {
    await db.query(
      `INSERT INTO objects
       (id, workspace_id, object_type, name, urn, visibility, granularity, metadata)
       VALUES
       ($1, $4, 'service', $5, $6, 'VISIBLE', 'COMPOUND', $7::jsonb),
       ($2, $4, 'service', $8, $9, 'VISIBLE', 'COMPOUND', $7::jsonb),
       ($3, $4, 'service', $10, $11, 'VISIBLE', 'COMPOUND', $7::jsonb)`,
      [
        objectA,
        objectB,
        objectC,
        workspaceId,
        `task2-a-${runId}`,
        urnA,
        JSON.stringify(metadata),
        `task2-b-${runId}`,
        urnB,
        `task2-c-${runId}`,
        urnC,
      ],
    );

    const validPayload = buildDependencyUpsertPayload({
      fromId: urnA,
      toId: urnB,
      type: 'call',
      source: 'inference',
      confidence: 0.91,
      evidence: 'src/app.ts:call:service-b',
    });
    assert(validPayload.confidence === 0.91, 'confidence normalization failed');
    assert(validPayload.evidence === 'src/app.ts:call:service-b', 'evidence normalization failed');

    await expectError(
      async () => {
        buildDependencyUpsertPayload({
          fromId: urnA,
          toId: urnB,
          type: 'call',
          source: 'inference',
          evidence: 'missing-confidence',
        });
      },
      'DEP_PAYLOAD_CONFIDENCE_REQUIRED',
    );

    await expectError(
      async () => {
        buildDependencyUpsertPayload({
          fromId: urnA,
          toId: urnB,
          type: 'call',
          source: 'inference',
          confidence: 0.4,
        });
      },
      'DEP_PAYLOAD_EVIDENCE_REQUIRED',
    );

    await expectError(
      async () => {
        await createChangeRequest(db, {
          requestType: 'RELATION_UPSERT',
          payload: {
            fromId: urnA,
            toId: urnB,
            type: 'call',
            source: 'rollup',
            evidence: 'derived',
          },
          requestedBy,
        });
      },
      'INVALID_RELATION_SOURCE',
    );

    await expectError(
      async () => {
        await db.query(
          `INSERT INTO object_relations
           (id, workspace_id, subject_object_id, relation_type, target_object_id, approved, is_derived, source, confidence, evidence)
           VALUES ($1, $2, $3, 'call', $4, TRUE, FALSE, 'invalid', 0.7, '[]'::jsonb)`,
          [randomUUID(), workspaceId, objectA, objectB],
        );
      },
      'object_relations_source_check',
    );

    await expectError(
      async () => {
        await createChangeRequest(db, {
          requestType: 'RELATION_UPSERT',
          payload: {
            fromId: urnA,
            toId: urnB,
            type: 'call',
            source: 'inference',
            confidence: 0.66,
          },
          requestedBy,
        });
      },
      'INVALID_RELATION_PAYLOAD',
    );

    const approveRequest = await createChangeRequest(db, {
      requestType: 'RELATION_UPSERT',
      payload: validPayload,
      requestedBy,
    });
    requestIds.push(approveRequest.id);

    const beforeApprove = await db.query<{ count: number | string }>(
      `SELECT COUNT(*)::int AS count
       FROM approved_object_relations r
       JOIN objects s ON s.id = r.subject_object_id
       JOIN objects t ON t.id = r.target_object_id
       WHERE r.workspace_id = $1
         AND r.is_derived = FALSE
         AND s.urn = $2
         AND t.urn = $3
         AND r.relation_type = 'call'`,
      [workspaceId, urnA, urnB],
    );
    assert(Number(beforeApprove.rows[0].count) === 0, 'unapproved relation was visible before approval');

    await applyChangeRequest(db, approveRequest.id, 'APPROVED', { reviewedBy: reviewer });

    const relationRow = await db.query<{
      source: string;
      confidence: number | string | null;
      evidence: unknown;
      approved: boolean;
      is_derived: boolean;
    }>(
      `SELECT r.source, r.confidence, r.evidence, r.approved, r.is_derived
       FROM object_relations r
       JOIN objects s ON s.id = r.subject_object_id
       JOIN objects t ON t.id = r.target_object_id
       WHERE r.workspace_id = $1
         AND r.is_derived = FALSE
         AND s.urn = $2
         AND t.urn = $3
         AND r.relation_type = 'call'
       LIMIT 1`,
      [workspaceId, urnA, urnB],
    );

    const approvedRelation = relationRow.rows[0];
    assert(!!approvedRelation, 'approved relation was not materialized');
    assert(approvedRelation.approved === true, 'approved flag was not set');
    assert(approvedRelation.is_derived === false, 'approved relation must stay non-derived');
    assert(approvedRelation.source === 'inference', 'relation source mismatch');
    assert(Number(approvedRelation.confidence) === 0.91, 'relation confidence mismatch');
    assert(Array.isArray(approvedRelation.evidence), 'relation evidence must be stored as JSON array');
    assert((approvedRelation.evidence as unknown[]).length > 0, 'relation evidence array is empty');

    const approveAudit = await db.query<{
      status: string;
      reviewed_by: string | null;
      reviewed_at: string | null;
    }>(
      `SELECT status, reviewed_by, reviewed_at
       FROM change_requests
       WHERE id = $1`,
      [approveRequest.id],
    );
    assert(approveAudit.rows[0]?.status === 'APPROVED', 'approved request status mismatch');
    assert(approveAudit.rows[0]?.reviewed_by === reviewer, 'reviewed_by was not persisted');
    assert(!!approveAudit.rows[0]?.reviewed_at, 'reviewed_at was not persisted');

    const rejectRequest = await createChangeRequest(db, {
      requestType: 'RELATION_UPSERT',
      payload: buildDependencyUpsertPayload({
        fromId: urnA,
        toId: urnC,
        type: 'depend_on',
        source: 'inference',
        confidence: 0.73,
        evidence: 'src/env.ts:ENV_TARGET_C',
      }),
      requestedBy,
    });
    requestIds.push(rejectRequest.id);

    await applyChangeRequest(db, rejectRequest.id, 'REJECTED', { reviewedBy: reviewer });

    const rejectedVisible = await db.query<{ count: number | string }>(
      `SELECT COUNT(*)::int AS count
       FROM approved_object_relations r
       JOIN objects s ON s.id = r.subject_object_id
       JOIN objects t ON t.id = r.target_object_id
       WHERE r.workspace_id = $1
         AND r.is_derived = FALSE
         AND s.urn = $2
         AND t.urn = $3`,
      [workspaceId, urnA, urnC],
    );
    assert(Number(rejectedVisible.rows[0].count) === 0, 'rejected relation must not be visible');

    const rejectAudit = await db.query<{ status: string; reviewed_by: string | null }>(
      `SELECT status, reviewed_by
       FROM change_requests
       WHERE id = $1`,
      [rejectRequest.id],
    );
    assert(rejectAudit.rows[0]?.status === 'REJECTED', 'rejected request status mismatch');
    assert(rejectAudit.rows[0]?.reviewed_by === reviewer, 'rejected request reviewer mismatch');

    console.log('OK: task2-4 verification passed (validation/constraints/approval gate).');
  } finally {
    if (requestIds.length > 0) {
      const placeholders = requestIds.map((_, index) => `$${index + 1}`).join(', ');
      await db.query(`DELETE FROM change_requests WHERE id IN (${placeholders})`, requestIds);
    }

    await db.query(
      `DELETE FROM object_relations
       WHERE workspace_id = $1
         AND (subject_object_id = $2 OR subject_object_id = $3 OR subject_object_id = $4
              OR target_object_id = $2 OR target_object_id = $3 OR target_object_id = $4)`,
      [workspaceId, objectA, objectB, objectC],
    );

    await db.query(
      `DELETE FROM objects
       WHERE workspace_id = $1
         AND id IN ($2, $3, $4)`,
      [workspaceId, objectA, objectB, objectC],
    );
  }
}

main().catch((error) => {
  console.error('task2-4 verification failed:', error);
  process.exit(1);
});
