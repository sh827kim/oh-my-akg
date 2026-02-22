import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@archi-navi/core';

interface ParamsContext {
  params: Promise<{ id: string }>;
}

interface DependencyRow {
  service_id: string;
  label: string;
  type: string;
}

export async function GET(_: NextRequest, context: ParamsContext) {
  try {
    const { id: serviceUrn } = await context.params;
    const db = await getDb();

    const objectRes = await db.query<{ id: string }>(
      `SELECT id
       FROM objects
       WHERE workspace_id = 'default'
         AND object_type = 'service'
         AND urn = $1`,
      [serviceUrn],
    );

    const objectId = objectRes.rows[0]?.id;
    if (!objectId) {
      return NextResponse.json({ inbound: [], outbound: [] });
    }

    const [inboundResult, outboundResult] = await Promise.all([
      db.query<DependencyRow>(
        `SELECT
           o_from.urn AS service_id,
           COALESCE(NULLIF(o_from.display_name, ''), o_from.name) AS label,
           r.relation_type AS type
         FROM approved_object_relations r
         JOIN objects o_from ON o_from.id = r.subject_object_id
         WHERE r.workspace_id = 'default'
           AND r.target_object_id = $1
           AND o_from.object_type = 'service'
           AND o_from.visibility = 'VISIBLE'
           AND COALESCE(o_from.metadata->>'status', 'ACTIVE') = 'ACTIVE'
         ORDER BY o_from.name ASC`,
        [objectId],
      ),
      db.query<DependencyRow>(
        `SELECT
           o_to.urn AS service_id,
           COALESCE(NULLIF(o_to.display_name, ''), o_to.name) AS label,
           r.relation_type AS type
         FROM approved_object_relations r
         JOIN objects o_to ON o_to.id = r.target_object_id
         WHERE r.workspace_id = 'default'
           AND r.subject_object_id = $1
           AND o_to.object_type = 'service'
           AND o_to.visibility = 'VISIBLE'
           AND COALESCE(o_to.metadata->>'status', 'ACTIVE') = 'ACTIVE'
         ORDER BY o_to.name ASC`,
        [objectId],
      ),
    ]);

    return NextResponse.json({
      inbound: inboundResult.rows,
      outbound: outboundResult.rows,
    });
  } catch (error) {
    console.error('Failed to fetch service dependencies:', error);
    return NextResponse.json(
      { error: 'Failed to fetch service dependencies' },
      { status: 500 },
    );
  }
}
