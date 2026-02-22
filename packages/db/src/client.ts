/**
 * DB 클라이언트 팩토리
 * 환경변수에 따라 PGlite(로컬) 또는 PostgreSQL(서버)을 선택
 */
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { PGlite } from '@electric-sql/pglite';
import { mkdirSync } from 'fs';
import * as schema from './schema/index';

/** DB 클라이언트 타입 */
export type DbClient = ReturnType<typeof createPgliteClient>;

let _client: DbClient | null = null;

/**
 * PGlite 로컬 DB 클라이언트 생성
 * @param dataDir - 데이터 저장 경로 (기본: 메모리)
 */
export function createPgliteClient(dataDir?: string) {
  const pg = new PGlite(dataDir ?? 'memory://');
  return drizzlePglite(pg, { schema });
}

/**
 * 싱글턴 DB 클라이언트 반환
 * - PGLITE_DATA_DIR 환경변수로 데이터 경로 설정
 * - 데이터 디렉토리 없으면 자동 생성
 */
export async function getDb(): Promise<DbClient> {
  if (_client) return _client;

  const pgliteDataDir = process.env['PGLITE_DATA_DIR'] ?? '.archi-navi/data';

  // PGlite는 부모 디렉토리가 있어야 함 — 없으면 자동 생성
  try {
    mkdirSync(pgliteDataDir, { recursive: true });
  } catch {
    // 이미 존재하면 무시
  }

  _client = createPgliteClient(pgliteDataDir);
  return _client;
}
