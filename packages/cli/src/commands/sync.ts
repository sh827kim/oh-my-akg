import { Command } from 'commander';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fetchRepos } from '../utils/github';
import { getDb } from '@archi-navi/core';
import { buildDependencyUpsertPayload } from '@archi-navi/core';
import { buildServiceMetadata, inferProjectType } from '@archi-navi/core';
import { getWorkspaceInferenceSettings, recordInferenceRunMetrics } from '@archi-navi/core';
import { inferEnvMappingCandidatesWithMetrics } from '@archi-navi/inference';

export const syncCommand = new Command('sync')
  .description('Synchronize repositories and dependencies from GitHub')
  .argument('[org]', 'GitHub Organization name')
  .option('-o, --org <org>', 'GitHub Organization name (optional)')
  .option('-w, --workspace <workspaceId>', 'Workspace ID (default: workspace setting/default)')
  .option('--shadow-mode', 'Run inference in shadow mode (do not enqueue change requests)')
  .option('--no-ast-plugins', 'Disable AST plugin inference stage')
  .option('--no-fallback', 'Disable fallback heuristic inference stage')
  .option('--deps-file <path>', 'JSON file of dependency candidates to enqueue')
  .action(async (orgArg, options) => {
    const org = orgArg || options.org || process.env.GITHUB_ORG;
    if (!org) {
      console.error('Error: Organization must be specified via -o or GITHUB_ORG.');
      process.exit(1);
    }

    const rawArgv = process.argv.slice(2);
    const shadowModeOverride = rawArgv.includes('--shadow-mode') ? true : undefined;
    const astPluginsOverride = rawArgv.includes('--no-ast-plugins') ? false : undefined;
    const fallbackOverride = rawArgv.includes('--no-fallback') ? false : undefined;

    console.log(`Starting synchronization for organization: ${org}...`);

    try {
      const repos = await fetchRepos(org);
      const db = await getDb();
      const inferenceSettings = await getWorkspaceInferenceSettings(
        db,
        typeof options.workspace === 'string' ? options.workspace : undefined,
      );
      const workspaceId = inferenceSettings.workspaceId;
      const shadowMode = shadowModeOverride ?? inferenceSettings.shadowModeEnabled;
      const astPluginsEnabled = astPluginsOverride ?? inferenceSettings.astPluginsEnabled;
      const fallbackEnabled = fallbackOverride ?? inferenceSettings.fallbackEnabled;

      console.log(
        `Workspace: ${workspaceId} | inference mode: ${astPluginsEnabled ? 'full' : fallbackEnabled ? 'fallback' : 'disabled'} | shadow: ${shadowMode}`,
      );

      console.log('Updating database...');
      let newCount = 0;
      let updatedCount = 0;
      let queuedCount = 0;
      let autoQueuedCount = 0;
      let shadowAutoCandidates = 0;
      let shadowManualCandidates = 0;

      const validTypesRes = await db.query<{ name: string }>('SELECT name FROM project_types');
      const validTypes = new Set(validTypesRes.rows.map((row) => row.name));
      const normalizeType = (typeName: string) => (validTypes.has(typeName) ? typeName : 'unknown');

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
          newCount++;
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
          updatedCount++;
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

      const inferenceResult = await inferEnvMappingCandidatesWithMetrics(
        repos,
        mappingPatternsResult.rows,
        {
          astPluginsEnabled,
          fallbackEnabled,
        },
      );
      const envMappingCandidates = inferenceResult.candidates;

      await recordInferenceRunMetrics(db, {
        workspaceId,
        mode: inferenceResult.metrics.mode,
        shadowMode,
        astPluginsEnabled,
        fallbackEnabled,
        repoCount: inferenceResult.metrics.repoCount,
        configFilesScanned: inferenceResult.metrics.configFilesScanned,
        sourceFilesScanned: inferenceResult.metrics.sourceFilesScanned,
        candidateCount: inferenceResult.metrics.candidateCount,
        lowConfidenceCount: inferenceResult.metrics.lowConfidenceCount,
        avgConfidence: inferenceResult.metrics.avgConfidence,
        failures: inferenceResult.metrics.failures,
        durationMs: inferenceResult.metrics.durationMs,
        throughputPerSec: inferenceResult.metrics.throughputPerSec,
      });

      for (const candidate of envMappingCandidates) {
        const payload = buildDependencyUpsertPayload({
          fromId: candidate.fromId,
          toId: candidate.toId,
          type: candidate.type,
          source: candidate.source,
          confidence: candidate.confidence,
          evidence: candidate.evidence,
          scoreVersion: candidate.scoreVersion,
          reviewTag: candidate.reviewLane === 'low_confidence' ? 'LOW_CONFIDENCE' : 'NORMAL',
          tags: candidate.tags,
        });

        if (shadowMode) {
          shadowAutoCandidates++;
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
        autoQueuedCount++;
      }

      if (options.depsFile) {
        const raw = await readFile(options.depsFile, 'utf8');
        const candidates = JSON.parse(raw);

        if (Array.isArray(candidates)) {
          for (const [index, candidate] of candidates.entries()) {
            const fromId = typeof candidate?.fromId === 'string' ? candidate.fromId : null;
            const toId = typeof candidate?.toId === 'string' ? candidate.toId : null;
            if (!fromId || !toId) {
              throw new Error(`dependency candidate[${index}] must include fromId/toId`);
            }

            const payload = buildDependencyUpsertPayload({
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
            queuedCount++;
          }
        }
      }

      console.log(
        [
          'Sync complete.',
          `Workspace: ${workspaceId}`,
          `New: ${newCount}`,
          `Updated: ${updatedCount}`,
          `AutoQueued: ${autoQueuedCount}`,
          `Queued: ${queuedCount}`,
          `ShadowAutoCandidates: ${shadowAutoCandidates}`,
          `ShadowManualCandidates: ${shadowManualCandidates}`,
          `InferenceMode: ${inferenceResult.metrics.mode}`,
          `Candidates: ${inferenceResult.metrics.candidateCount}`,
          `AvgConfidence: ${inferenceResult.metrics.avgConfidence.toFixed(3)}`,
          `Failures: ${inferenceResult.metrics.failures}`,
        ].join(' '),
      );
    } catch (error) {
      console.error('Sync failed:', error);
      process.exit(1);
    }
  });
