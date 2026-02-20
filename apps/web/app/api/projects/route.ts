import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

interface ProjectRow {
    id: string;
    repo_name: string;
    alias: string | null;
    type: string;
    visibility: string;
    status: string;
    updated_at: string;
}

function normalizeRepoId(repoName: string) {
    const normalized = repoName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._/-]+/g, '-')
        .replace(/\/+/g, '/')
        .replace(/^-+|-+$/g, '');
    return normalized || `project-${Date.now()}`;
}

export async function GET(req: NextRequest) {
    try {
        const db = await getDb();
        const url = new URL(req.url);
        const includeHidden = url.searchParams.get('include_hidden') === 'true';
        const includeDeleted = url.searchParams.get('include_deleted') === 'true';

        const filters: string[] = [];
        if (!includeHidden) filters.push(`visibility = 'VISIBLE'`);
        if (!includeDeleted) filters.push(`status = 'ACTIVE'`);

        const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

        const result = await db.query<ProjectRow>(`
          SELECT id, repo_name, alias, type, visibility, status, updated_at
          FROM projects
          ${where}
          ORDER BY repo_name ASC
        `);

        return NextResponse.json(result.rows);
    } catch (error) {
        console.error('Failed to fetch projects:', error);
        return NextResponse.json([], { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const db = await getDb();
        const body = await req.json();

        const repoName = typeof body.repo_name === 'string' ? body.repo_name.trim() : '';
        const type = typeof body.type === 'string' ? body.type.trim() : 'unknown';
        const visibility = typeof body.visibility === 'string' ? body.visibility.trim() : 'VISIBLE';
        const alias = typeof body.alias === 'string' ? body.alias.trim() : null;
        const description = typeof body.description === 'string' ? body.description.trim() : null;

        if (!repoName) {
            return NextResponse.json({ error: 'repo_name is required' }, { status: 400 });
        }

        const typeCheckRes = await db.query<{ name: string }>(
            `SELECT name FROM project_types WHERE name = $1`,
            [type || 'unknown']
        );
        if (typeCheckRes.rows.length === 0) {
            return NextResponse.json({ error: 'invalid type' }, { status: 400 });
        }

        const id = `${normalizeRepoId(repoName)}-${Date.now()}`;

        const result = await db.query<ProjectRow>(
            `
              INSERT INTO projects (id, repo_name, repo_url, type, visibility, alias, description, status, updated_at)
              VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', CURRENT_TIMESTAMP)
              RETURNING id, repo_name, alias, type, visibility, status, updated_at
            `,
            [id, repoName, '#', type || 'unknown', visibility, alias || null, description || null]
        );

        return NextResponse.json(result.rows[0], { status: 201 });
    } catch (error) {
        console.error('Failed to create project:', error);
        return NextResponse.json({ error: 'Failed to create project' }, { status: 500 });
    }
}

export async function PATCH(req: NextRequest) {
    try {
        const db = await getDb();
        const body = await req.json();

        const id = typeof body.id === 'string' ? body.id : '';
        const visibility = typeof body.visibility === 'string' ? body.visibility : undefined;
        const type = typeof body.type === 'string' ? body.type : undefined;
        const alias = typeof body.alias === 'string' ? body.alias : undefined;
        const status = typeof body.status === 'string' ? body.status : undefined;

        if (!id) {
            return NextResponse.json({ error: 'id is required' }, { status: 400 });
        }

        const updates: string[] = [];
        const values: string[] = [id];

        if (visibility !== undefined) {
            if (!['VISIBLE', 'HIDDEN'].includes(visibility)) {
                return NextResponse.json({ error: 'invalid visibility' }, { status: 400 });
            }
            values.push(visibility);
            updates.push(`visibility = $${values.length}`);
        }

        if (type !== undefined) {
            const typeCheckRes = await db.query<{ name: string }>(
                `SELECT name FROM project_types WHERE name = $1`,
                [type]
            );
            if (typeCheckRes.rows.length === 0) {
                return NextResponse.json({ error: 'invalid type' }, { status: 400 });
            }
            values.push(type);
            updates.push(`type = $${values.length}`);
        }

        if (alias !== undefined) {
            values.push(alias);
            updates.push(`alias = $${values.length}`);
        }

        if (status !== undefined) {
            if (!['ACTIVE', 'DELETED', 'ARCHIVED'].includes(status)) {
                return NextResponse.json({ error: 'invalid status' }, { status: 400 });
            }
            values.push(status);
            updates.push(`status = $${values.length}`);
        }

        if (updates.length === 0) {
            return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
        }

        updates.push('updated_at = CURRENT_TIMESTAMP');

        const result = await db.query<ProjectRow>(
            `
              UPDATE projects
              SET ${updates.join(', ')}
              WHERE id = $1
              RETURNING id, repo_name, alias, type, visibility, status, updated_at
            `,
            values
        );

        if (result.rows.length === 0) {
            return NextResponse.json({ error: 'project not found' }, { status: 404 });
        }

        return NextResponse.json(result.rows[0]);
    } catch (error) {
        console.error('Failed to update project:', error);
        return NextResponse.json({ error: 'Failed to update project' }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const db = await getDb();
        const url = new URL(req.url);
        const id = url.searchParams.get('id');

        if (!id) {
            return NextResponse.json({ error: 'id is required' }, { status: 400 });
        }

        const result = await db.query(
            `
              UPDATE projects
              SET status = 'DELETED',
                  visibility = 'HIDDEN',
                  updated_at = CURRENT_TIMESTAMP
              WHERE id = $1
              RETURNING id
            `,
            [id]
        );

        if (result.rows.length === 0) {
            return NextResponse.json({ error: 'project not found' }, { status: 404 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Failed to delete project:', error);
        return NextResponse.json({ error: 'Failed to delete project' }, { status: 500 });
    }
}
