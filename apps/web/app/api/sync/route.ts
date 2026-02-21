import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getDb } from '@archi-navi/core';
import { fetchRepos } from '@archi-navi/config';
import { buildDependencyUpsertPayload } from '@archi-navi/core';
import { buildServiceMetadata, inferProjectType } from '@archi-navi/core';
import { getWorkspaceInferenceSettings, recordInferenceRunMetrics } from '@archi-navi/core';
import { runInferencePipeline } from '@archi-navi/inference';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const org = (typeof body.org === 'string' ? body.org : process.env.GITHUB_ORG)?.trim();
    const requestedWorkspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : undefined;
    const dependencyCandidates = Array.isArray(body.dependency_candidates) ? body.dependency_candidates : [];

    if (!org) {
      return NextResponse.json(
        { error: 'org is required (body.org or GITHUB_ORG)' },
        { status: 400 },
      );
    }

    const repos = await fetchRepos(org);
    const db = await getDb();
    const inferenceSettings = await getWorkspaceInferenceSettings(db, requestedWorkspaceId);
    const workspaceId = inferenceSettings.workspaceId;
    const astPluginsEnabled =
      typeof body.astPluginsEnabled === 'boolean'
        ? body.astPluginsEnabled
        : inferenceSettings.astPluginsEnabled;
    const shadowMode =
      typeof body.shadowMode === 'boolean'
        ? body.shadowMode
        : inferenceSettings.shadowModeEnabled;
    const fallbackEnabled =
      typeof body.fallbackEnabled === 'boolean'
        ? body.fallbackEnabled
        : inferenceSettings.fallbackEnabled;

    const validTypesRes = await db.query<{ name: string }>('SELECT name FROM project_types');
    const validTypes = new Set(validTypesRes.rows.map((row) => row.name));
    const normalizeType = (typeName: string) => (validTypes.has(typeName) ? typeName : 'unknown');

    let created = 0;
    let updated = 0;
    let deleted = 0;
    let changeRequestsCreated = 0;
    let autoMappingApprovalsCreated = 0;
    let shadowAutoMappingCandidates = 0;
    let shadowManualCandidates = 0;

    const seenUrns = new Set<string>();

    for (const repo of repos) {
      seenUrns.add(repo.id);

      const existing = await db.query<{ id: string; metadata: unknown }>(
        `SELECT id, metadata
         FROM objects
         WHERE workspace_id = $1
           AND object_type = 'service'
           AND urn = $2`,
        [workspaceId, repo.id],
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
           VALUES ($1, $2, 'service', $3, NULL, $4, 'VISIBLE', 'COMPOUND', $5::jsonb)`,
          [randomUUID(), workspaceId, repo.name, repo.id, JSON.stringify(metadata)],
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
       WHERE workspace_id = $1
         AND object_type = 'service'
         AND COALESCE(metadata->>'status', 'ACTIVE') = 'ACTIVE'
         AND urn LIKE $2`,
      [workspaceId, `${org}/%`],
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

    // 새 2-pass 추론 파이프라인 실행
    const inferenceResult = await runInferencePipeline(repos, { astPluginsEnabled, fallbackEnabled });
    const { objectCandidates, relationCandidates, metrics } = inferenceResult;

    await recordInferenceRunMetrics(db, {
      workspaceId,
      mode: metrics.mode,
      shadowMode,
      astPluginsEnabled,
      fallbackEnabled,
      repoCount: metrics.repoCount,
      configFilesScanned: metrics.configFilesScanned,
      sourceFilesScanned: metrics.sourceFilesScanned,
      candidateCount: objectCandidates.length + relationCandidates.length,
      lowConfidenceCount: metrics.lowConfidenceCount,
      avgConfidence: metrics.avgConfidence,
      failures: metrics.failures,
      durationMs: metrics.durationMs,
      throughputPerSec: metrics.throughputPerSec,
    });

    // OBJECT_CREATE 먼저 적재
    for (const obj of objectCandidates) {
      if (shadowMode) { shadowAutoMappingCandidates++; continue; }

      const objectExists = await db.query<{ id: string }>(
        `SELECT id FROM objects WHERE workspace_id = $1 AND urn = $2 LIMIT 1`,
        [workspaceId, obj.urn],
      );
      if (objectExists.rows.length > 0) continue;

      const dupObj = await db.query<{ id: number }>(
        `SELECT id FROM change_requests
         WHERE workspace_id = $1 AND status = 'PENDING'
           AND request_type = 'OBJECT_CREATE'
           AND payload @> $2::jsonb LIMIT 1`,
        [workspaceId, JSON.stringify({ urn: obj.urn })],
      );
      if (dupObj.rows.length > 0) continue;

      await db.query(
        `INSERT INTO change_requests (workspace_id, request_type, payload, status, requested_by)
         VALUES ($1, 'OBJECT_CREATE', $2::jsonb, 'PENDING', $3)`,
        [workspaceId, JSON.stringify(obj), `inference:${obj.objectType}`],
      );
      autoMappingApprovalsCreated++;
    }

    // RELATION_UPSERT 적재
    for (const candidate of relationCandidates) {
      const payload = buildDependencyUpsertPayload({
        fromId: candidate.fromId,
        toId: candidate.toId,
        type: candidate.type,
        source: candidate.source,
        confidence: candidate.confidence,
        evidence: candidate.evidence,
        scoreVersion: candidate.scoreVersion,
        reviewTag: candidate.reviewTag,
        tags: candidate.tags,
      });

      if (shadowMode) { shadowAutoMappingCandidates++; continue; }

      const dedupe = await db.query<{ id: number }>(
        `SELECT id FROM change_requests
         WHERE workspace_id = $1
           AND status = 'PENDING'
           AND request_type = 'RELATION_UPSERT'
           AND payload @> $2::jsonb
         LIMIT 1`,
        [workspaceId, JSON.stringify({ fromId: payload.fromId, toId: payload.toId, type: payload.type })],
      );
      if (dedupe.rows.length > 0) continue;

      const relationExists = await db.query<{ id: string }>(
        `SELECT r.id
         FROM approved_object_relations r
         JOIN objects s ON s.id = r.subject_object_id
         JOIN objects t ON t.id = r.target_object_id
         WHERE r.workspace_id = $1
           AND r.is_derived = FALSE
           AND s.urn = $2
           AND t.urn = $3
           AND r.relation_type = $4
         LIMIT 1`,
        [workspaceId, payload.fromId, payload.toId, payload.type],
      );
      if (relationExists.rows.length > 0) continue;

      const requestedBy = candidate.reviewLane === 'low_confidence'
        ? `${payload.fromId}:low-confidence`
        : payload.fromId;

      await db.query(
        `INSERT INTO change_requests (workspace_id, request_type, payload, status, requested_by)
         VALUES ($1, 'RELATION_UPSERT', $2::jsonb, 'PENDING', $3)`,
        [workspaceId, JSON.stringify(payload), requestedBy],
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
          scoreVersion: typeof candidate?.scoreVersion === 'string' ? candidate.scoreVersion : 'v1.0',
          reviewTag:
            typeof candidate?.reviewTag === 'string'
              ? candidate.reviewTag
              : Number(candidate?.confidence) < 0.65
                ? 'LOW_CONFIDENCE'
                : 'NORMAL',
          tags: Array.isArray(candidate?.tags) ? candidate.tags : undefined,
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

      if (shadowMode) {
        shadowManualCandidates++;
        continue;
      }

      const dedupe = await db.query<{ id: number }>(
        `SELECT id FROM change_requests
         WHERE workspace_id = $1
           AND status = 'PENDING'
           AND request_type = 'RELATION_UPSERT'
           AND payload @> $2::jsonb
         LIMIT 1`,
        [workspaceId, JSON.stringify({ fromId: payload.fromId, toId: payload.toId, type: payload.type })],
      );

      if (dedupe.rows.length > 0) continue;

      const requestedBy = payload.reviewTag === 'LOW_CONFIDENCE'
        ? `${payload.fromId}:low-confidence`
        : payload.fromId;

      await db.query(
        `INSERT INTO change_requests (workspace_id, request_type, payload, status, requested_by)
         VALUES ($1, 'RELATION_UPSERT', $2::jsonb, 'PENDING', $3)`,
        [workspaceId, JSON.stringify(payload), requestedBy],
      );
      changeRequestsCreated++;
    }

    return NextResponse.json({
      success: true,
      org,
      workspaceId,
      created,
      updated,
      deleted,
      changeRequestsCreated,
      autoMappingApprovalsCreated,
      shadowMode,
      shadowAutoMappingCandidates,
      shadowManualCandidates,
      inference: {
        mode: inferenceResult.metrics.mode,
        astPluginsEnabled,
        fallbackEnabled,
        metrics: inferenceResult.metrics,
      },
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
