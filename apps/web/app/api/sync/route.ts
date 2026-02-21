import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getDb } from '@archi-navi/core';
import { fetchRepos } from '@archi-navi/config';
import { buildDependencyUpsertPayload } from '@archi-navi/core';
import { buildServiceMetadata, inferProjectType } from '@archi-navi/core';
import { inferEnvMappingCandidates } from '@archi-navi/inference';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const org = (typeof body.org === 'string' ? body.org : process.env.GITHUB_ORG)?.trim();
    const dependencyCandidates = Array.isArray(body.dependency_candidates) ? body.dependency_candidates : [];

    if (!org) {
      return NextResponse.json(
        { error: 'org is required (body.org or GITHUB_ORG)' },
        { status: 400 },
      );
    }

    const repos = await fetchRepos(org);
    const db = await getDb();

    const validTypesRes = await db.query<{ name: string }>('SELECT name FROM project_types');
    const validTypes = new Set(validTypesRes.rows.map((row) => row.name));
    const normalizeType = (typeName: string) => (validTypes.has(typeName) ? typeName : 'unknown');

    let created = 0;
    let updated = 0;
    let deleted = 0;
    let changeRequestsCreated = 0;
    let autoMappingApprovalsCreated = 0;

    const seenUrns = new Set<string>();

    for (const repo of repos) {
      seenUrns.add(repo.id);

      const existing = await db.query<{ id: string; metadata: unknown }>(
        `SELECT id, metadata
         FROM objects
         WHERE workspace_id = 'default'
           AND object_type = 'service'
           AND urn = $1`,
        [repo.id],
      );

      const projectType = normalizeType(inferProjectType(repo.name, repo.language));

      if (existing.rows.length === 0) {
        const metadata = buildServiceMetadata({
          repoUrl: repo.url,
          description: repo.description,
          projectType,
          status: 'ACTIVE',
          lastSeenAt: new Date().toISOString(),
        });

        await db.query(
          `INSERT INTO objects
           (id, workspace_id, object_type, name, display_name, urn, visibility, granularity, metadata)
           VALUES ($1, 'default', 'service', $2, NULL, $3, 'VISIBLE', 'COMPOUND', $4::jsonb)`,
          [randomUUID(), repo.name, repo.id, JSON.stringify(metadata)],
        );
        created++;
      } else {
        const existingMetadata = existing.rows[0].metadata;
        const hasProjectType =
          !!existingMetadata &&
          typeof existingMetadata === 'object' &&
          typeof (existingMetadata as { project_type?: unknown }).project_type === 'string' &&
          !!(existingMetadata as { project_type: string }).project_type.trim();

        const metadata = buildServiceMetadata({
          existing: existingMetadata,
          repoUrl: repo.url,
          description: repo.description,
          ...(hasProjectType ? {} : { projectType }),
          status: 'ACTIVE',
          lastSeenAt: new Date().toISOString(),
        });

        await db.query(
          `UPDATE objects
           SET name = $2,
               metadata = $3::jsonb,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [existing.rows[0].id, repo.name, JSON.stringify(metadata)],
        );
        updated++;
      }
    }

    const existingActive = await db.query<{ id: string; metadata: unknown; urn: string }>(
      `SELECT id, metadata, urn
       FROM objects
       WHERE workspace_id = 'default'
         AND object_type = 'service'
         AND COALESCE(metadata->>'status', 'ACTIVE') = 'ACTIVE'
         AND urn LIKE $1`,
      [`${org}/%`],
    );

    for (const row of existingActive.rows) {
      if (seenUrns.has(row.urn)) continue;

      const metadata = buildServiceMetadata({
        existing: row.metadata,
        status: 'DELETED',
        lastSeenAt: new Date().toISOString(),
      });

      await db.query(
        `UPDATE objects
         SET visibility = 'HIDDEN',
             metadata = $2::jsonb,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [row.id, JSON.stringify(metadata)],
      );
      deleted++;
    }

    const mappingPatternsResult = await db.query<{
      pattern: string;
      target_object_urn: string;
      dependency_type: string;
      enabled: boolean;
    }>(
      `SELECT pattern, target_object_urn, dependency_type, enabled
       FROM auto_mapping_patterns
       WHERE enabled = TRUE`,
    );

    const envMappingCandidates = await inferEnvMappingCandidates(repos, mappingPatternsResult.rows);

    for (const candidate of envMappingCandidates) {
      const payload = buildDependencyUpsertPayload({
        fromId: candidate.fromId,
        toId: candidate.toId,
        type: candidate.type,
        source: candidate.source,
        confidence: candidate.confidence,
        evidence: candidate.evidence,
      });

      const dedupe = await db.query<{ id: number }>(
        `SELECT id FROM change_requests
         WHERE workspace_id = 'default'
           AND status = 'PENDING'
           AND request_type = 'RELATION_UPSERT'
           AND payload @> $1::jsonb
         LIMIT 1`,
        [JSON.stringify({ fromId: payload.fromId, toId: payload.toId, type: payload.type })],
      );

      if (dedupe.rows.length > 0) continue;

      const relationExists = await db.query<{ id: string }>(
        `SELECT r.id
         FROM approved_object_relations r
         JOIN objects s ON s.id = r.subject_object_id
         JOIN objects t ON t.id = r.target_object_id
         WHERE r.workspace_id = 'default'
           AND r.is_derived = FALSE
           AND s.urn = $1
           AND t.urn = $2
           AND r.relation_type = $3
         LIMIT 1`,
        [payload.fromId, payload.toId, payload.type],
      );

      if (relationExists.rows.length > 0) continue;

      await db.query(
        `INSERT INTO change_requests (workspace_id, request_type, payload, status, requested_by)
         VALUES ('default', 'RELATION_UPSERT', $1::jsonb, 'PENDING', $2)`,
        [JSON.stringify(payload), payload.fromId],
      );
      autoMappingApprovalsCreated++;
    }

    for (const [index, candidate] of dependencyCandidates.entries()) {
      const fromId = typeof candidate?.fromId === 'string' ? candidate.fromId : null;
      const toId = typeof candidate?.toId === 'string' ? candidate.toId : null;
      if (!fromId || !toId) {
        return NextResponse.json(
          { error: `dependency_candidates[${index}] must include fromId/toId` },
          { status: 400 },
        );
      }

      let payload: ReturnType<typeof buildDependencyUpsertPayload>;
      try {
        payload = buildDependencyUpsertPayload({
          fromId,
          toId,
          type: typeof candidate?.type === 'string' ? candidate.type : undefined,
          source: typeof candidate?.source === 'string' ? candidate.source : 'inference',
          confidence: candidate?.confidence,
          evidence: candidate?.evidence,
        });
      } catch (error) {
        return NextResponse.json(
          {
            error: `dependency_candidates[${index}] is invalid`,
            details: error instanceof Error ? error.message : String(error),
          },
          { status: 400 },
        );
      }

      const dedupe = await db.query<{ id: number }>(
        `SELECT id FROM change_requests
         WHERE workspace_id = 'default'
           AND status = 'PENDING'
           AND request_type = 'RELATION_UPSERT'
           AND payload @> $1::jsonb
         LIMIT 1`,
        [JSON.stringify({ fromId: payload.fromId, toId: payload.toId, type: payload.type })],
      );

      if (dedupe.rows.length > 0) continue;

      await db.query(
        `INSERT INTO change_requests (workspace_id, request_type, payload, status, requested_by)
         VALUES ('default', 'RELATION_UPSERT', $1::jsonb, 'PENDING', $2)`,
        [JSON.stringify(payload), payload.fromId],
      );
      changeRequestsCreated++;
    }

    return NextResponse.json({
      success: true,
      org,
      created,
      updated,
      deleted,
      changeRequestsCreated,
      autoMappingApprovalsCreated,
      total: repos.length,
    });
  } catch (error) {
    console.error('Sync API failed:', error);
    return NextResponse.json(
      { error: 'Sync failed', details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
