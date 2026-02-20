import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

interface ParamsContext {
    params: Promise<{ id: string }>;
}

interface DependencyRow {
    project_id: string;
    label: string;
    type: string;
}

export async function GET(_: NextRequest, context: ParamsContext) {
    try {
        const { id: projectId } = await context.params;
        const db = await getDb();

        const [inboundResult, outboundResult] = await Promise.all([
            db.query<DependencyRow>(
                `
                  SELECT
                    e.from_id AS project_id,
                    COALESCE(NULLIF(p.alias, ''), p.repo_name) AS label,
                    e.type
                  FROM edges e
                  JOIN projects p ON p.id = e.from_id
                  WHERE e.to_id = $1
                    AND p.status = 'ACTIVE'
                    AND e.approved = TRUE
                  ORDER BY p.repo_name ASC
                `,
                [projectId]
            ),
            db.query<DependencyRow>(
                `
                  SELECT
                    e.to_id AS project_id,
                    COALESCE(NULLIF(p.alias, ''), p.repo_name) AS label,
                    e.type
                  FROM edges e
                  JOIN projects p ON p.id = e.to_id
                  WHERE e.from_id = $1
                    AND p.status = 'ACTIVE'
                    AND e.approved = TRUE
                  ORDER BY p.repo_name ASC
                `,
                [projectId]
            ),
        ]);

        return NextResponse.json({
            inbound: inboundResult.rows,
            outbound: outboundResult.rows,
        });
    } catch (error) {
        console.error('Failed to fetch project dependencies:', error);
        return NextResponse.json(
            { error: 'Failed to fetch project dependencies' },
            { status: 500 }
        );
    }
}
