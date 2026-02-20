import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { fetchRepos, type RepoInfo } from '@/cli/utils/github';
import { inferEnvMappingCandidates } from '@/lib/env-auto-mapping';

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
        const dependencyCandidates = Array.isArray(body.dependency_candidates) ? body.dependency_candidates : [];

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
        let changeRequestsCreated = 0;
        let autoMappingApprovalsCreated = 0;

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

            const dedupe = await db.query<{ id: number }>(
                `SELECT id FROM change_requests
                 WHERE status = 'PENDING'
                   AND change_type = 'DEPENDENCY_UPSERT'
                   AND payload @> $1::jsonb
                 LIMIT 1`,
                [JSON.stringify({ fromId, toId, type })]
            );

            if (dedupe.rows.length > 0) continue;

            const edgeExists = await db.query<{ id: number }>(
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
            autoMappingApprovalsCreated++;
        }

        for (const candidate of dependencyCandidates) {
            const fromId = typeof candidate?.fromId === 'string' ? candidate.fromId : null;
            const toId = typeof candidate?.toId === 'string' ? candidate.toId : null;
            const type = typeof candidate?.type === 'string' ? candidate.type : 'unknown';
            if (!fromId || !toId) continue;

            const dedupe = await db.query<{ id: number }>(
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
            { status: 500 }
        );
    }
}
