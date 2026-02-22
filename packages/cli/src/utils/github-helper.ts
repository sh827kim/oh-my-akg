/**
 * GitHub CLI (gh) 래퍼 유틸리티
 * gh CLI가 설치 및 로그인되어 있어야 동작
 * execFileSync 사용으로 커맨드 인젝션 방지
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/** gh CLI 레포 정보 */
interface GhRepo {
  name: string;
  url: string;
}

/**
 * gh CLI 인증 상태 확인
 * @throws gh CLI 미설치 또는 미로그인 시 에러
 */
export function checkGhAuth(): void {
  try {
    execFileSync('gh', ['auth', 'status'], { stdio: 'pipe' });
  } catch {
    throw new Error(
      'gh CLI 인증이 필요합니다.\n' +
      '  1. gh CLI 설치: https://cli.github.com/\n' +
      '  2. 로그인: gh auth login',
    );
  }
}

/**
 * GitHub Org의 레포 목록 조회
 * @param org GitHub Organization 이름
 * @returns 레포 이름+URL 배열
 */
export function listOrgRepos(org: string): GhRepo[] {
  checkGhAuth();
  try {
    const stdout = execFileSync(
      'gh',
      ['repo', 'list', org, '--json', 'name,url', '--limit', '200'],
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    return JSON.parse(stdout) as GhRepo[];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Org '${org}' 레포 목록 조회 실패: ${msg}`);
  }
}

/**
 * 단일 레포 shallow clone
 * @param nwo owner/repo 형식 (예: "my-org/my-repo")
 * @param targetDir 클론 대상 디렉토리
 */
export function cloneRepo(nwo: string, targetDir: string): void {
  checkGhAuth();
  try {
    execFileSync('gh', ['repo', 'clone', nwo, targetDir, '--', '--depth', '1'], {
      stdio: 'pipe',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`'${nwo}' 클론 실패: ${msg}`);
  }
}

/**
 * 클론된 디렉토리 정리 (삭제)
 */
export function cleanupClone(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // 삭제 실패해도 치명적이지 않으므로 무시
  }
}

/**
 * 임시 디렉토리 생성 (스캔용)
 * @returns 생성된 임시 디렉토리 경로
 */
export function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `archi-navi-${prefix}-`));
}
