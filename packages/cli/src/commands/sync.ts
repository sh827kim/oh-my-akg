import { Command } from 'commander';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fetchRepos } from '../utils/github';
import { getDb } from '@archi-navi/core';
import { buildDependencyUpsertPayload } from '@archi-navi/core';
import { buildServiceMetadata, inferProjectType } from '@archi-navi/core';
import { inferEnvMappingCandidates } from '@archi-navi/inference';

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

      const validTypesRes = await db.query<{ name: string }>('SELECT name FROM project_types');
      const validTypes = new Set(validTypesRes.rows.map((row) => row.name));
      const normalizeType = (typeName: string) => (validTypes.has(typeName) ? typeName : 'unknown');

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
          newCount++;
        } else {
          const metadata = buildServiceMetadata({
            existing: existing.rows[0].metadata,
            repoUrl: repo.url,
            description: repo.description,
            projectType,
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
          evidence: candidate.evidence,
        });

        const dedupe = await db.query(
          `SELECT id FROM change_requests
           WHERE workspace_id = 'default'
             AND status = 'PENDING'
             AND request_type = 'RELATION_UPSERT'
             AND payload @> $1::jsonb
           LIMIT 1`,
          [JSON.stringify({ fromId: payload.fromId, toId: payload.toId, type: payload.type })],
        );

        if (dedupe.rows.length > 0) continue;

        const relationExists = await db.query(
          `SELECT r.id
           FROM object_relations r
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
