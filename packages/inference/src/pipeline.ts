// 2-pass 추론 파이프라인
// Pass 1: Object Discovery (api_endpoint, db_table, topic 등 원자 Object 발견)
// Pass 2: Relation Discovery (Object Registry 참조해 관계 추론)
import type { Octokit } from 'octokit';
import { getOctokit, type RepoInfo } from '@archi-navi/config';
import type { Scanner, ScanContext, SourceFile, DiscoveredObject, DiscoveredRelation, InferenceOptions, InferencePipelineResult, ObjectCreateCandidate, RelationCreateCandidate } from './scanners/types';
import { CONFIDENCE_SCORE_VERSION, deriveReviewLane, stringifyEvidenceRecord } from './utils';
import { buildObjectRegistry, deduplicateRelations } from './resolvers';
import { initTreeSitterParsers } from './parsers/tree-sitter-loader';

// 스캐너 임포트
import { sqlDdlScanner } from './scanners/schema/sql-ddl-scanner';
import { prismaScanner } from './scanners/schema/prisma-scanner';
import { typescriptScanner } from './scanners/typescript';
import { javaKotlinScanner } from './scanners/java-kotlin';
import { pythonScanner } from './scanners/python';
import { configScanner } from './scanners/config';

// 파일 유형별 우선순위 + 최대 개수 규칙 (PRD File Selection)
const FILE_SELECTION_RULES: Array<{ regex: RegExp; max: number; priority: number }> = [
    { regex: /schema\.prisma$/i,                                              max: 3,  priority: 100 },
    { regex: /\.(sql)$/i,                                                     max: 10, priority: 90  },
    { regex: /Entity\.(java|kt)$/i,                                           max: 20, priority: 85  },
    { regex: /models?\.py$/i,                                                 max: 10, priority: 85  },
    { regex: /Controller\.(java|kt)$/i,                                       max: 20, priority: 80  },
    { regex: /router?\.(ts|tsx|js)$/i,                                        max: 10, priority: 75  },
    { regex: /application(?:-\w+)?\.(?:ya?ml|properties|json)$/i,            max: 5,  priority: 70  },
    { regex: /(kafka|consumer|producer|listener)\.(java|kt|ts|py)$/i,        max: 10, priority: 65  },
    { regex: /\.(java|kt|kts)$/i,                                             max: 30, priority: 40  },
    { regex: /\.(ts|tsx|js|jsx)$/i,                                           max: 30, priority: 35  },
    { regex: /\.py$/i,                                                        max: 20, priority: 30  },
];

// 파일 경로 → 우선순위 반환 (매칭되지 않는 파일은 낮은 우선순위)
function getFilePriority(filePath: string): number {
    for (const rule of FILE_SELECTION_RULES) {
        if (rule.regex.test(filePath)) return rule.priority;
    }
    return 0;
}

// 파일 목록에서 우선순위 기반으로 선택 (각 규칙 max 제한 적용)
function selectPrioritizedFiles(allPaths: string[]): string[] {
    // 우선순위 높은 순으로 정렬
    const sorted = [...allPaths].sort((a, b) => getFilePriority(b) - getFilePriority(a));

    const countPerRule = new Map<number, number>(); // rule index → count
    const selected: string[] = [];

    for (const filePath of sorted) {
        let added = false;
        for (let i = 0; i < FILE_SELECTION_RULES.length; i++) {
            const rule = FILE_SELECTION_RULES[i]!;
            if (!rule.regex.test(filePath)) continue;
            const current = countPerRule.get(i) ?? 0;
            if (current >= rule.max) break;
            countPerRule.set(i, current + 1);
            selected.push(filePath);
            added = true;
            break;
        }
        // 어느 규칙에도 해당 안 되는 파일도 포함 (기타)
        if (!added && getFilePriority(filePath) === 0) {
            selected.push(filePath);
        }
    }

    return selected;
}

// repo URN 생성: urn:{org}:{repo-name}:service
function toServiceUrn(repo: RepoInfo): string {
    const [owner, repoName] = repo.id.split('/');
    const orgName = owner ?? 'unknown';
    const serviceName = (repoName ?? repo.name).toLowerCase().replace(/[^a-z0-9-]/g, '-');
    return `urn:${orgName}:${serviceName}:service`;
}

// repo ID에서 org 이름 추출
function toOrgName(repo: RepoInfo): string {
    return repo.id.split('/')[0] ?? 'unknown';
}

// GitHub 트리에서 파일 목록 조회
interface GitTreeNode { type?: string; path?: string; }

async function getRepoPaths(octokit: Octokit, owner: string, repo: string, branch: string): Promise<string[]> {
    try {
        const branchData = await octokit.rest.repos.getBranch({ owner, repo, branch });
        const treeSha = branchData.data.commit.commit.tree.sha;
        const tree = await octokit.rest.git.getTree({ owner, repo, tree_sha: treeSha, recursive: '1' });
        return ((tree.data.tree ?? []) as GitTreeNode[])
            .filter(n => n.type === 'blob' && typeof n.path === 'string')
            .map(n => n.path as string);
    } catch {
        return [];
    }
}

const MAX_BLOB_SIZE = 200_000;

async function fetchFileContent(octokit: Octokit, owner: string, repo: string, path: string): Promise<string | null> {
    try {
        const res = await octokit.rest.repos.getContent({ owner, repo, path });
        const content = Array.isArray(res.data) ? null : res.data;
        if (!content || content.type !== 'file' || !content.content || content.size > MAX_BLOB_SIZE) return null;
        return Buffer.from(content.content, 'base64').toString('utf8');
    } catch {
        return null;
    }
}

// 파일 경로에 맞는 스캐너 목록 반환
const ALL_SCANNERS: Scanner[] = [
    prismaScanner,
    sqlDdlScanner,
    javaKotlinScanner,
    pythonScanner,
    typescriptScanner,
    configScanner,
];

function selectScanners(filePath: string): Scanner[] {
    return ALL_SCANNERS.filter(s => s.supports(filePath));
}

// DiscoveredObject[] → ObjectCreateCandidate[]
function toObjectCandidates(objects: DiscoveredObject[]): ObjectCreateCandidate[] {
    return objects.map(obj => ({
        urn: obj.urn,
        objectType: obj.objectType,
        name: obj.name,
        displayName: obj.displayName,
        parentUrn: obj.parentUrn,
        granularity: obj.granularity,
        metadata: obj.metadata,
        source: 'inference' as const,
        confidence: obj.confidence,
        evidence: stringifyEvidenceRecord(obj.evidence),
        scoreVersion: CONFIDENCE_SCORE_VERSION,
        reviewLane: deriveReviewLane(obj.confidence),
        tags: [obj.objectType, deriveReviewLane(obj.confidence)],
    }));
}

// DiscoveredRelation[] → RelationCreateCandidate[]
function toRelationCandidates(relations: DiscoveredRelation[]): RelationCreateCandidate[] {
    return relations.map(rel => {
        const reviewLane = deriveReviewLane(rel.confidence);
        return {
            fromId: rel.subjectUrn,
            toId: rel.targetUrn,
            type: rel.relationType,
            source: 'inference' as const,
            confidence: rel.confidence,
            evidence: stringifyEvidenceRecord(rel.evidence),
            scoreVersion: CONFIDENCE_SCORE_VERSION,
            reviewLane,
            reviewTag: reviewLane === 'low_confidence' ? 'LOW_CONFIDENCE' : 'NORMAL',
            tags: [rel.relationType, reviewLane],
        };
    });
}

export async function runInferencePipeline(
    repos: RepoInfo[],
    options: InferenceOptions = {},
): Promise<InferencePipelineResult> {
    const startedAt = Date.now();
    const { astPluginsEnabled = true, fallbackEnabled = true } = options;

    if (!astPluginsEnabled && !fallbackEnabled) {
        const durationMs = Date.now() - startedAt;
        return {
            objectCandidates: [], relationCandidates: [],
            metrics: { mode: 'disabled', repoCount: repos.length, configFilesScanned: 0, sourceFilesScanned: 0, objectsDiscovered: 0, relationsDiscovered: 0, lowConfidenceCount: 0, avgConfidence: 0, failures: 0, durationMs, throughputPerSec: 0 },
        };
    }

    const mode = astPluginsEnabled ? 'full' : 'fallback';

    // web-tree-sitter WASM 파서 초기화 (Java, Python)
    if (astPluginsEnabled) {
        try { await initTreeSitterParsers(); } catch { /* 파서 없어도 진행 */ }
    }

    const octokit = getOctokit();
    let configFilesScanned = 0;
    let sourceFilesScanned = 0;
    let failures = 0;

    // Pass 1: Object Discovery
    // 각 repo 파일을 스캔해 DiscoveredObject 수집
    const allObjects: DiscoveredObject[] = [];
    const fileCache = new Map<string, SourceFile[]>(); // repo.id → 파일 목록 캐시

    for (const repo of repos) {
        const [owner, repoName] = repo.id.split('/');
        if (!owner || !repoName) continue;

        try {
            const allPaths = await getRepoPaths(octokit, owner, repoName, repo.default_branch || 'main');
            const prioritizedPaths = selectPrioritizedFiles(allPaths);

            const files: SourceFile[] = [];
            for (const filePath of prioritizedPaths) {
                const content = await fetchFileContent(octokit, owner, repoName, filePath);
                if (!content) continue;

                const isConfig = configScanner.supports(filePath);
                if (isConfig) configFilesScanned++;
                else sourceFilesScanned++;

                files.push({ path: filePath, content });
            }
            fileCache.set(repo.id, files);

            // Pass 1 스캔 (knownUrns 없이)
            const pass1Context: ScanContext = {
                currentServiceUrn: toServiceUrn(repo),
                orgName: toOrgName(repo),
                knownUrns: new Set(),
            };

            for (const file of files) {
                for (const scanner of selectScanners(file.path)) {
                    try {
                        const result = scanner.scan(file, pass1Context);
                        allObjects.push(...result.objects);
                    } catch {
                        failures++;
                    }
                }
            }
        } catch {
            failures++;
        }
    }

    // Object Registry 구축 (URN 기준 중복 제거)
    const objectRegistry = buildObjectRegistry(allObjects);
    const knownUrns = new Set(objectRegistry.keys());

    // Pass 2: Relation Discovery
    // Object Registry(knownUrns) 참조해 관계 추론
    const allRelations: DiscoveredRelation[] = [];

    for (const repo of repos) {
        const files = fileCache.get(repo.id) ?? [];
        const pass2Context: ScanContext = {
            currentServiceUrn: toServiceUrn(repo),
            orgName: toOrgName(repo),
            knownUrns,
        };

        for (const file of files) {
            for (const scanner of selectScanners(file.path)) {
                try {
                    const result = scanner.scan(file, pass2Context);
                    allRelations.push(...result.relations);
                } catch {
                    failures++;
                }
            }
        }
    }

    // 중복 제거 및 후처리
    const uniqueObjects = [...objectRegistry.values()];
    const uniqueRelations = deduplicateRelations(allRelations);

    // 메트릭 계산
    const objectCandidates = toObjectCandidates(uniqueObjects);
    const relationCandidates = toRelationCandidates(uniqueRelations);

    const allConfidences = [
        ...objectCandidates.map(o => o.confidence),
        ...relationCandidates.map(r => r.confidence),
    ];
    const avgConfidence = allConfidences.length === 0
        ? 0
        : Number((allConfidences.reduce((s, c) => s + c, 0) / allConfidences.length).toFixed(3));

    const lowConfidenceCount =
        objectCandidates.filter(o => o.reviewLane === 'low_confidence').length +
        relationCandidates.filter(r => r.reviewLane === 'low_confidence').length;

    const durationMs = Date.now() - startedAt;
    const totalCandidates = objectCandidates.length + relationCandidates.length;
    const throughputPerSec = durationMs > 0
        ? Number(((totalCandidates * 1000) / durationMs).toFixed(3))
        : totalCandidates;

    return {
        objectCandidates,
        relationCandidates,
        metrics: {
            mode,
            repoCount: repos.length,
            configFilesScanned,
            sourceFilesScanned,
            objectsDiscovered: uniqueObjects.length,
            relationsDiscovered: uniqueRelations.length,
            lowConfidenceCount,
            avgConfidence,
            failures,
            durationMs,
            throughputPerSec,
        },
    };
}
