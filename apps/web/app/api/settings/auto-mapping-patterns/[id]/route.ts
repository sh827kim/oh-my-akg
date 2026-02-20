import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@archi-navi/core';

interface ParamsContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, context: ParamsContext) {
  try {
    const { id } = await context.params;
    const patternId = Number(id);
    if (!Number.isFinite(patternId)) {
      return NextResponse.json({ error: 'invalid id' }, { status: 400 });
    }

    const body = await req.json();
    const db = await getDb();

    const fields: string[] = [];
    const values: Array<string | boolean | number> = [patternId];

    if (typeof body.pattern === 'string') {
      fields.push(`pattern = $${fields.length + 2}`);
      values.push(body.pattern.trim());
    }
    if (typeof body.target_object_urn === 'string') {
      fields.push(`target_object_urn = $${fields.length + 2}`);
      values.push(body.target_object_urn.trim());
    }
    if (typeof body.dependency_type === 'string') {
      fields.push(`dependency_type = $${fields.length + 2}`);
      values.push(body.dependency_type.trim() || 'depend_on');
    }
    if (typeof body.enabled === 'boolean') {
      fields.push(`enabled = $${fields.length + 2}`);
      values.push(body.enabled);
    }

    if (fields.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const result = await db.query(
      `UPDATE auto_mapping_patterns
       SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING id, pattern, target_object_urn, dependency_type, enabled, created_at, updated_at`,
      values,
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'pattern not found' }, { status: 404 });
    }

    return NextResponse.json(result.rows[0]);
  } catch (error) {
    console.error('Failed to update auto mapping pattern:', error);
    return NextResponse.json({ error: 'Failed to update auto mapping pattern' }, { status: 500 });
  }
}

export async function DELETE(_: NextRequest, context: ParamsContext) {
  try {
    const { id } = await context.params;
    const patternId = Number(id);
    if (!Number.isFinite(patternId)) {
      return NextResponse.json({ error: 'invalid id' }, { status: 400 });
    }

    const db = await getDb();
    await db.query(`DELETE FROM auto_mapping_patterns WHERE id = $1`, [patternId]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete auto mapping pattern:', error);
    return NextResponse.json({ error: 'Failed to delete auto mapping pattern' }, { status: 500 });
  }
}
