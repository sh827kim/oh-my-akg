import { Command } from 'commander';
import { fetchRepos } from '../utils/github';
import { getDb } from '../../lib/db';

export const syncCommand = new Command('sync')
    .description('Synchronize repositories and dependencies from GitHub')
    .argument('[org]', 'GitHub Organization name')
    .option('-o, --org <org>', 'GitHub Organization name (optional)')
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

            for (const repo of repos) {
                // Simple UPSERT for projects
                // Check if exists
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

            console.log(`Sync complete. New: ${newCount}, Updated: ${updatedCount}`);

        } catch (error) {
            console.error('Sync failed:', error);
            process.exit(1);
        }
    });
