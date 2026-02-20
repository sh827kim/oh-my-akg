import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { fetchRepos } from '../utils/github';
import { getDb } from '../../../core/src/db';
import { buildDependencyUpsertPayload } from '../../../core/src/change-request-payloads';
import { inferProjectType } from '../../../core/src/project-model';
import { inferEnvMappingCandidates } from '../../../inference/src/env-auto-mapping';

export const syncCommand = new Command('sync')
  .description('Synchronize repositories and dependencies from GitHub')
  .argument('[org]', 'GitHub Organization name')
  .option('-o, --org <org>', 'GitHub Organization name (optional)')
  .option('--deps-file <path>', 'JSON file of dependency candidates to enqueue')
  .action(async (orgArg, options) => {
    const org = orgArg || options.org || process.env.GITHUB_ORG;
    if (!org) {
      console.error('Error: Organization must be specified via -o or GITHUB_ORG.');
      process.exit(1);
    }

    console.log(`Starting synchronization for organization: ${org}...`);

    try {
      const repos = await fetchRepos(org);
      const db = await getDb();

      console.log('Updating database...');
      let newCount = 0;
      let updatedCount = 0;
      let queuedCount = 0;
      let autoQueuedCount = 0;

      for (const repo of repos) {
        const existing = await db.query('SELECT id FROM projects WHERE id = $1', [repo.id]);

        if (existing.rows.length === 0) {
          await db.query(
            `INSERT INTO projects (id, repo_name, repo_url, type, visibility, description, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [repo.id, repo.name, repo.url, inferProjectType(repo.name, repo.language), 'VISIBLE', repo.description, repo.updated_at]
          );
          newCount++;
        } else {
          await db.query(
            `UPDATE projects SET
             repo_name = $2, repo_url = $3, description = $4, type = COALESCE(NULLIF(type, ''), $5), updated_at = $6, last_seen_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [repo.id, repo.name, repo.url, repo.description, inferProjectType(repo.name, repo.language), repo.updated_at]
          );
          updatedCount++;
        }
      }

      const mappingPatternsResult = await db.query<{
        pattern: string;
        target_project_id: string;
        dependency_type: string;
        enabled: boolean;
      }>(
        `SELECT pattern, target_project_id, dependency_type, enabled
         FROM auto_mapping_patterns
         WHERE enabled = TRUE`
      );

      const envMappingCandidates = await inferEnvMappingCandidates(
        repos,
        mappingPatternsResult.rows,
      );

      for (const candidate of envMappingCandidates) {
        const payload = buildDependencyUpsertPayload({
          fromId: candidate.fromId,
          toId: candidate.toId,
          type: candidate.type,
          evidence: candidate.evidence,
        });

        const dedupe = await db.query(
          `SELECT id FROM change_requests
           WHERE status = 'PENDING'
             AND change_type = 'DEPENDENCY_UPSERT'
             AND payload @> $1::jsonb
           LIMIT 1`,
          [JSON.stringify({ fromId: payload.fromId, toId: payload.toId, type: payload.type })]
        );

        if (dedupe.rows.length > 0) continue;

        const edgeExists = await db.query(
          `SELECT id FROM edges
           WHERE from_id = $1
             AND to_id = $2
             AND type = $3
           LIMIT 1`,
          [payload.fromId, payload.toId, payload.type]
        );

        if (edgeExists.rows.length > 0) continue;

        await db.query(
          `INSERT INTO change_requests (project_id, change_type, payload, status)
           VALUES ($1, 'DEPENDENCY_UPSERT', $2::jsonb, 'PENDING')`,
          [payload.fromId, JSON.stringify(payload)]
        );
        autoQueuedCount++;
      }

      if (options.depsFile) {
        const raw = await readFile(options.depsFile, 'utf8');
        const candidates = JSON.parse(raw);

        if (Array.isArray(candidates)) {
          for (const candidate of candidates) {
            const fromId = typeof candidate?.fromId === 'string' ? candidate.fromId : null;
            const toId = typeof candidate?.toId === 'string' ? candidate.toId : null;
            if (!fromId || !toId) continue;
            const payload = buildDependencyUpsertPayload({
              fromId,
              toId,
              type: typeof candidate?.type === 'string' ? candidate.type : undefined,
              evidence: typeof candidate?.evidence === 'string' ? candidate.evidence : undefined,
            });

            const dedupe = await db.query(
              `SELECT id FROM change_requests
               WHERE status = 'PENDING'
                 AND change_type = 'DEPENDENCY_UPSERT'
                 AND payload @> $1::jsonb
               LIMIT 1`,
              [JSON.stringify({ fromId: payload.fromId, toId: payload.toId, type: payload.type })]
            );

            if (dedupe.rows.length > 0) continue;

            await db.query(
              `INSERT INTO change_requests (project_id, change_type, payload, status)
               VALUES ($1, 'DEPENDENCY_UPSERT', $2::jsonb, 'PENDING')`,
              [payload.fromId, JSON.stringify(payload)]
            );
            queuedCount++;
          }
        }
      }

      console.log(`Sync complete. New: ${newCount}, Updated: ${updatedCount}, AutoQueued: ${autoQueuedCount}, Queued: ${queuedCount}`);
    } catch (error) {
      console.error('Sync failed:', error);
      process.exit(1);
    }
  });
