/**
 * POST /api/query — 결정론적 쿼리 엔진 실행
 * IMPACT_ANALYSIS, PATH_DISCOVERY, USAGE_DISCOVERY, DOMAIN_SUMMARY
 */
import { type NextRequest, NextResponse } from 'next/server';
import { getDb } from '@archi-navi/db';
import { executeQuery } from '@archi-navi/core';
import type { QueryRequest } from '@archi-navi/shared';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as QueryRequest;

    if (!body.queryType || !body.workspaceId) {
      return NextResponse.json(
        { error: 'queryType, workspaceId는 필수입니다' },
        { status: 400 },
      );
    }

    const db = await getDb();
    const result = await executeQuery(db, body);

    return NextResponse.json(result);
  } catch (error) {
    console.error('[POST /api/query]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
