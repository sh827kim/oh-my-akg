import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { fetchRepos, type RepoInfo } from '@/cli/utils/github';

function inferType(repo: RepoInfo) {
    const name = repo.name.toLowerCase();
    const language = (repo.language || '').toLowerCase();

    if (/frontend|web|ui|portal|bff|dashboard|mobile|ios|android/.test(name)) {
        return 'frontend';
    }
    if (/gateway|api|service|backend|server|worker|batch/.test(name)) {
        return 'backend';
    }
    if (/kafka|redis|postgres|mysql|mongo|elastic|infra|middleware/.test(name)) {
        return 'middleware';
    }
    if (['typescript', 'javascript', 'tsx', 'jsx'].includes(language)) {
        return 'frontend';
    }
    if (['go', 'java', 'kotlin', 'python', 'rust', 'c#'].includes(language)) {
        return 'backend';
    }
    return 'unknown';
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json().catch(() => ({}));
        const org = (typeof body.org === 'string' ? body.org : process.env.GITHUB_ORG)?.trim();

        if (!org) {
            return NextResponse.json(
                { error: 'org is required (body.org or GITHUB_ORG)' },
                { status: 400 }
            );
        }

        const repos = await fetchRepos(org);
        const db = await getDb();
        const validTypesRes = await db.query<{ name: string }>(
            `SELECT name FROM project_types`
        );
        const validTypes = new Set(validTypesRes.rows.map((row) => row.name));
        const normalizeType = (typeName: string) =>
            validTypes.has(typeName) ? typeName : 'unknown';

        let created = 0;
        let updated = 0;
        let deleted = 0;

        const seenIds = new Set<string>();
        for (const repo of repos) {
            seenIds.add(repo.id);

            const existing = await db.query<{ id: string }>(
                'SELECT id FROM projects WHERE id = $1',
                [repo.id]
            );

            if (existing.rows.length === 0) {
                const inferredType = normalizeType(inferType(repo));
                await db.query(
                    `
                      INSERT INTO projects
                        (id, repo_name, repo_url, type, visibility, description, status, updated_at, last_seen_at)
                      VALUES
                        ($1, $2, $3, $4, 'VISIBLE', $5, 'ACTIVE', $6, CURRENT_TIMESTAMP)
                    `,
                    [repo.id, repo.name, repo.url, inferredType, repo.description, repo.updated_at]
                );
                created++;
            } else {
                const inferredType = normalizeType(inferType(repo));
                await db.query(
                    `
                      UPDATE projects
                      SET repo_name = $2,
                          repo_url = $3,
                          description = $4,
                          type = COALESCE(NULLIF(type, ''), $5),
                          status = 'ACTIVE',
                          updated_at = $6,
                          last_seen_at = CURRENT_TIMESTAMP
                      WHERE id = $1
                    `,
                    [repo.id, repo.name, repo.url, repo.description, inferredType, repo.updated_at]
                );
                updated++;
            }
        }

        const existingActive = await db.query<{ id: string }>(
            `
              SELECT id
              FROM projects
              WHERE status = 'ACTIVE'
                AND id LIKE $1
            `,
            [`${org}/%`]
        );

        for (const row of existingActive.rows) {
            if (seenIds.has(row.id)) continue;
            await db.query(
                `
                  UPDATE projects
                  SET status = 'DELETED',
                      visibility = 'HIDDEN',
                      updated_at = CURRENT_TIMESTAMP
                  WHERE id = $1
                `,
                [row.id]
            );
            deleted++;
        }

        return NextResponse.json({
            success: true,
            org,
            created,
            updated,
            deleted,
            total: repos.length,
        });
    } catch (error) {
        console.error('Sync API failed:', error);
        return NextResponse.json(
            { error: 'Sync failed', details: error instanceof Error ? error.message : String(error) },
            { status: 500 }
        );
    }
}
