import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@archi-navi/core';

export async function GET() {
  try {
    const db = await getDb();
    const result = await db.query(
      `SELECT id, pattern, target_object_urn, dependency_type, enabled, created_at, updated_at
       FROM auto_mapping_patterns
       ORDER BY created_at DESC, id DESC`,
    );

    return NextResponse.json(result.rows);
  } catch (error) {
    console.error('Failed to fetch auto mapping patterns:', error);
    return NextResponse.json({ error: 'Failed to fetch auto mapping patterns' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const db = await getDb();

    const pattern = typeof body.pattern === 'string' ? body.pattern.trim() : '';
    const targetObjectUrn = typeof body.target_object_urn === 'string' ? body.target_object_urn.trim() : '';
    const dependencyType = typeof body.dependency_type === 'string' ? body.dependency_type.trim() : 'depend_on';
    const enabled = typeof body.enabled === 'boolean' ? body.enabled : true;

    if (!pattern || !targetObjectUrn) {
      return NextResponse.json({ error: 'pattern and target_object_urn are required' }, { status: 400 });
    }

    const result = await db.query(
      `INSERT INTO auto_mapping_patterns (pattern, target_object_urn, dependency_type, enabled)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (pattern, target_object_urn)
       DO UPDATE SET dependency_type = EXCLUDED.dependency_type,
                     enabled = EXCLUDED.enabled,
                     updated_at = CURRENT_TIMESTAMP
       RETURNING id, pattern, target_object_urn, dependency_type, enabled, created_at, updated_at`,
      [pattern, targetObjectUrn, dependencyType || 'depend_on', enabled],
    );

    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (error) {
    console.error('Failed to create auto mapping pattern:', error);
    return NextResponse.json({ error: 'Failed to create auto mapping pattern' }, { status: 500 });
  }
}
