/**
 * Evidence 데이터 조회
 * 관계의 근거(코드 위치, 설정 파일 등)를 DB에서 가져온다
 */
import { eq } from 'drizzle-orm';
import type { DbClient } from '@archi-navi/db';
import { evidences, relationEvidences } from '@archi-navi/db';

/**
 * 특정 relation의 evidence 목록 조회
 */
export async function getEvidences(db: DbClient, relationId: string) {
  return db
    .select({ evidence: evidences })
    .from(relationEvidences)
    .innerJoin(evidences, eq(relationEvidences.evidenceId, evidences.id))
    .where(eq(relationEvidences.relationId, relationId));
}
