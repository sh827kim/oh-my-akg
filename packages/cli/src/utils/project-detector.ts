/**
 * 프로젝트 감지 유틸리티
 * 지정 디렉토리 하위에서 프로젝트(마커 파일 기반)를 자동 탐색
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DiscoveredProject } from '@archi-navi/shared';

/** 마커 파일 → 언어 매핑 */
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

/** 무시할 디렉토리 이름 */
const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.svn', 'dist', 'build', 'target',
  '__pycache__', '.next', '.turbo', '.cache', 'vendor',
]);

/**
 * 단일 디렉토리에서 마커 파일 탐색
 * @returns 가장 먼저 매칭된 마커 또는 null
 */
function detectMarker(dirPath: string): { markerFile: string; language: string } | null {
  try {
    const entries = fs.readdirSync(dirPath);
    for (const [marker, lang] of Object.entries(MARKER_MAP)) {
      if (entries.includes(marker)) {
        return { markerFile: marker, language: lang };
      }
    }
  } catch {
    // 디렉토리 읽기 권한 없으면 무시
  }
  return null;
}

/**
 * 지정 디렉토리에서 프로젝트 목록 감지 (1-depth 탐색)
 * @param rootDir 탐색할 루트 디렉토리
 * @returns 발견된 프로젝트 배열
 */
export function detectProjects(rootDir: string): DiscoveredProject[] {
  const resolved = path.resolve(rootDir);
  const results: DiscoveredProject[] = [];

  // 루트 자체가 프로젝트인 경우
  const rootMarker = detectMarker(resolved);
  if (rootMarker) {
    results.push({
      name: path.basename(resolved),
      path: resolved,
      language: rootMarker.language,
      markerFile: rootMarker.markerFile,
    });
  }

  // 1-depth 하위 디렉토리 탐색
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(resolved, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || IGNORE_DIRS.has(entry.name) || entry.name.startsWith('.')) {
      continue;
    }
    const subDir = path.join(resolved, entry.name);
    const marker = detectMarker(subDir);
    if (marker) {
      results.push({
        name: entry.name,
        path: subDir,
        language: marker.language,
        markerFile: marker.markerFile,
      });
    }
  }

  return results;
}

/**
 * 단일 프로젝트 경로에서 감지
 * 루트 디렉토리만 확인 (하위 탐색 안 함)
 */
export function detectSingleProject(dirPath: string): DiscoveredProject | null {
  const resolved = path.resolve(dirPath);
  const marker = detectMarker(resolved);
  if (!marker) return null;

  return {
    name: path.basename(resolved),
    path: resolved,
    language: marker.language,
    markerFile: marker.markerFile,
  };
}
