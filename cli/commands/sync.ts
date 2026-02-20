import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { fetchRepos } from '../utils/github';
import { getDb } from '../../lib/db';
import { inferEnvMappingCandidates } from '../../lib/env-auto-mapping';

export const syncCommand = new Command('sync')
    .description('Synchronize repositories and dependencies from GitHub')
    .argument('[org]', 'GitHub Organization name')
    .option('-o, --org <org>', 'GitHub Organization name (optional)')
    .option('--deps-file <path>', 'JSON file of dependency candidates to enqueue')
    .action(async (orgArg, options) => {
        const org = orgArg || options.org || process.env.GITHUB_ORG;
        if (!org) {
            console.error('Error: Organization must be specified via -o or GITHUB_ORG environment variable.');
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
                        [repo.id, repo.name, repo.url, 'unknown', 'VISIBLE', repo.description, repo.updated_at]
                    );
                    newCount++;
                } else {
                    await db.query(
                        `UPDATE projects SET 
                         repo_name = $2, repo_url = $3, description = $4, updated_at = $5, last_seen_at = CURRENT_TIMESTAMP
                         WHERE id = $1`,
                        [repo.id, repo.name, repo.url, repo.description, repo.updated_at]
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
                const fromId = candidate.fromId;
                const toId = candidate.toId;
                const type = candidate.type || 'unknown';

                const dedupe = await db.query(
                    `SELECT id FROM change_requests
                     WHERE status = 'PENDING'
                       AND change_type = 'DEPENDENCY_UPSERT'
                       AND payload @> $1::jsonb
                     LIMIT 1`,
                    [JSON.stringify({ fromId, toId, type })]
                );

                if (dedupe.rows.length > 0) continue;

                const edgeExists = await db.query(
                    `SELECT id FROM edges
                     WHERE from_id = $1
                       AND to_id = $2
                       AND type = $3
                     LIMIT 1`,
                    [fromId, toId, type]
                );

                if (edgeExists.rows.length > 0) continue;

                await db.query(
                    `INSERT INTO change_requests (project_id, change_type, payload, status)
                     VALUES ($1, 'DEPENDENCY_UPSERT', $2::jsonb, 'PENDING')`,
                    [fromId, JSON.stringify({ fromId, toId, type, evidence: candidate.evidence })]
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
                        const type = typeof candidate?.type === 'string' ? candidate.type : 'unknown';
                        if (!fromId || !toId) continue;

                        const dedupe = await db.query(
                            `SELECT id FROM change_requests
                             WHERE status = 'PENDING'
                               AND change_type = 'DEPENDENCY_UPSERT'
                               AND payload @> $1::jsonb
                             LIMIT 1`,
                            [JSON.stringify({ fromId, toId, type })]
                        );

                        if (dedupe.rows.length > 0) continue;

                        await db.query(
                            `INSERT INTO change_requests (project_id, change_type, payload, status)
                             VALUES ($1, 'DEPENDENCY_UPSERT', $2::jsonb, 'PENDING')`,
                            [fromId, JSON.stringify({ fromId, toId, type })]
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
