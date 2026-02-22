/**
 * POST /api/scan — 프로젝트 스캔 + Object 등록
 * CLI와 동일한 로직을 Web API로 제공
 */
import { type NextRequest, NextResponse } from 'next/server';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { getDb } from '@archi-navi/db';
import { objects } from '@archi-navi/db';
import { eq, and } from 'drizzle-orm';
import {
  generateId,
  buildPath,
  DEFAULT_WORKSPACE_ID,
} from '@archi-navi/shared';
import type {
  ScanMode,
  ScanRequest,
  ScanResult,
  DiscoveredProject,
} from '@archi-navi/shared';

/* ─── 마커 파일 → 언어 매핑 ─── */
const MARKER_MAP: Record<string, string> = {
  'package.json': 'node',
  'pom.xml': 'java',
  'build.gradle': 'java',
  'build.gradle.kts': 'kotlin',
  'pyproject.toml': 'python',
  'setup.py': 'python',
  'go.mod': 'go',
  'Cargo.toml': 'rust',
};

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.svn', 'dist', 'build', 'target',
  '__pycache__', '.next', '.turbo', '.cache', 'vendor',
]);

/* ─── 프로젝트 감지 (CLI project-detector 로직 인라인) ─── */
function detectMarker(dirPath: string): { markerFile: string; language: string } | null {
  try {
    const entries = fs.readdirSync(dirPath);
    for (const [marker, lang] of Object.entries(MARKER_MAP)) {
      if (entries.includes(marker)) {
        return { markerFile: marker, language: lang };
      }
    }
  } catch { /* 디렉토리 읽기 실패 무시 */ }
  return null;
}

function detectProjects(rootDir: string): DiscoveredProject[] {
  const resolved = path.resolve(rootDir);
  const results: DiscoveredProject[] = [];

  // 루트 자체
  const rootMarker = detectMarker(resolved);
  if (rootMarker) {
    results.push({
      name: path.basename(resolved),
      path: resolved,
      language: rootMarker.language,
      markerFile: rootMarker.markerFile,
    });
  }

  // 1-depth 하위
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(resolved, { withFileTypes: true });
  } catch { return results; }

  for (const entry of entries) {
    if (!entry.isDirectory() || IGNORE_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
    const subDir = path.join(resolved, entry.name);
    const marker = detectMarker(subDir);
    if (marker) {
      results.push({ name: entry.name, path: subDir, language: marker.language, markerFile: marker.markerFile });
    }
  }
  return results;
}

function detectSingleProject(dirPath: string): DiscoveredProject | null {
  const resolved = path.resolve(dirPath);
  const marker = detectMarker(resolved);
  if (!marker) return null;
  return { name: path.basename(resolved), path: resolved, language: marker.language, markerFile: marker.markerFile };
}

/* ─── GitHub 헬퍼 ─── */
function checkGhAuth(): void {
  try {
    execFileSync('gh', ['auth', 'status'], { stdio: 'pipe' });
  } catch {
    throw new Error('gh CLI 인증 필요: gh auth login');
  }
}

interface GhRepo { name: string; url: string }

function listOrgRepos(org: string): GhRepo[] {
  const stdout = execFileSync(
    'gh', ['repo', 'list', org, '--json', 'name,url', '--limit', '200'],
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
  );
  return JSON.parse(stdout) as GhRepo[];
}

function cloneRepo(nwo: string, targetDir: string): void {
  execFileSync('gh', ['repo', 'clone', nwo, targetDir, '--', '--depth', '1'], { stdio: 'pipe' });
}

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `archi-scan-${prefix}-`));
}

/* ─── Object 등록 ─── */
async function registerProjects(
  workspaceId: string,
  projects: DiscoveredProject[],
  dryRun: boolean,
): Promise<{ registered: number; skipped: number }> {
  if (dryRun || projects.length === 0) return { registered: 0, skipped: projects.length };

  const db = await getDb();
  let registered = 0;
  let skipped = 0;

  for (const proj of projects) {
    const existing = await db
      .select({ id: objects.id })
      .from(objects)
      .where(and(eq(objects.workspaceId, workspaceId), eq(objects.name, proj.name)))
      .limit(1);

    if (existing.length > 0) { skipped++; continue; }

    const id = generateId();
    await db.insert(objects).values({
      id,
      workspaceId,
      objectType: 'service',
      category: 'COMPUTE',
      granularity: 'COMPOUND',
      name: proj.name,
      displayName: null,
      path: buildPath(null, id),
      depth: 0,
      visibility: 'VISIBLE',
      metadata: { scanPath: proj.path, language: proj.language, markerFile: proj.markerFile },
    });
    registered++;
  }

  return { registered, skipped };
}

/* ─── POST /api/scan ─── */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ScanRequest;
    const workspaceId = body.workspaceId || DEFAULT_WORKSPACE_ID;
    const mode: ScanMode = body.mode || 'local';
    const target = body.target;
    const dryRun = body.dryRun ?? false;

    if (!target) {
      return NextResponse.json({ error: 'target은 필수입니다' }, { status: 400 });
    }

    let projects: DiscoveredProject[] = [];

    switch (mode) {
      case 'local': {
        const single = detectSingleProject(target);
        projects = single ? [single] : detectProjects(target);
        break;
      }
      case 'workspace-dir': {
        projects = detectProjects(target);
        break;
      }
      case 'github-repo': {
        checkGhAuth();
        const tmpDir = createTempDir('repo');
        try {
          cloneRepo(target, path.join(tmpDir, target.split('/').pop() ?? 'repo'));
          projects = detectProjects(tmpDir);
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
        break;
      }
      case 'github-org': {
        checkGhAuth();
        const repos = listOrgRepos(target);
        const tmpDir = createTempDir('org');
        try {
          for (const repo of repos) {
            const repoDir = path.join(tmpDir, repo.name);
            try {
              cloneRepo(`${target}/${repo.name}`, repoDir);
              const detected = detectSingleProject(repoDir);
              if (detected) projects.push(detected);
            } catch { /* 개별 실패 건너뜀 */ }
          }
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
        break;
      }
    }

    // 언어 필터
    if (body.lang) {
      const langs = body.lang.split(',').map((l) => l.trim().toLowerCase());
      projects = projects.filter((p) => langs.includes(p.language));
    }

    // DB 등록
    const { registered, skipped } = await registerProjects(workspaceId, projects, dryRun);

    const result: ScanResult = { mode, target, projects, registered, skipped };
    return NextResponse.json(result);
  } catch (error) {
    console.error('[POST /api/scan]', error);
    const msg = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
