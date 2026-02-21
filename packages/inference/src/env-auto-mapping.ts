import type { Octokit } from 'octokit';
import { getOctokit, type RepoInfo } from '@archi-navi/config';
import { extractSignalsWithPlugins } from './plugins';
import type { AstRelationType, EvidenceRecord, ReviewLane } from './plugins/types';
import {
    combineConfidence,
    CONFIDENCE_SCORE_VERSION,
    deriveReviewLane,
    makeEvidenceRecord,
    stringifyEvidenceRecord,
} from './plugins/utils';

export interface MappingCandidate {
    fromId: string;
    toId: string;
    type: AstRelationType;
    source: 'inference';
    confidence: number;
    evidence: string;
    scoreVersion: string;
    reviewLane: ReviewLane;
    tags: string[];
    evidences: EvidenceRecord[];
}

export type InferenceMode = 'full' | 'fallback' | 'disabled';

export interface InferenceOptions {
    astPluginsEnabled?: boolean;
    fallbackEnabled?: boolean;
}

export interface InferenceMetrics {
    mode: InferenceMode;
    repoCount: number;
    configFilesScanned: number;
    sourceFilesScanned: number;
    candidateCount: number;
    lowConfidenceCount: number;
    avgConfidence: number;
    failures: number;
    durationMs: number;
    throughputPerSec: number;
}

export interface InferenceResult {
    candidates: MappingCandidate[];
    metrics: InferenceMetrics;
}

interface PatternRow {
    pattern: string;
    target_object_urn: string;
    dependency_type: string;
    enabled: boolean;
}

interface GitTreeNode {
    type?: string;
    path?: string;
}

const CONFIG_FILE_REGEX = /(^|\/)application(?:-[^./]+)?\.(?:properties|ya?ml|json)$/i;
const SOURCE_FILE_REGEX = /\.(?:java|kt|kts|ts|tsx|js|jsx|py)$/i;
const MAX_CONFIG_FILES = 20;
const MAX_SOURCE_FILES = 30;
const MAX_BLOB_SIZE = 200_000;

const GENERIC_TOKENS = new Set([
    'service', 'services', 'app', 'application', 'config', 'url', 'uri', 'host', 'hostname',
    'port', 'base', 'endpoint', 'api', 'http', 'https', 'grpc', 'client', 'server',
    'prod', 'stage', 'staging', 'dev', 'local', 'internal', 'external', 'main', 'spring',
    'datasource', 'username', 'password', 'read', 'write', 'enabled'
]);

const ENV_PLACEHOLDER_REGEXES = [
    /\$\{([A-Za-z0-9_.-]+)(?::[^}]*)?\}/g,
    /\{\{\s*env\s+"([A-Za-z0-9_.-]+)"\s*\}\}/g,
    /process\.env\.([A-Za-z0-9_]+)/g,
    /System\.getenv\(["']([A-Za-z0-9_.-]+)["']\)/g,
    /@Value\(["']\$\{([A-Za-z0-9_.-]+)(?::[^}]*)?\}["']\)/g,
];

const RELATION_TYPES: AstRelationType[] = ['call', 'expose', 'read', 'write', 'produce', 'consume', 'depend_on'];

function normalizeRelationType(input?: string | null): AstRelationType {
    const value = (input || '').trim().toLowerCase() as AstRelationType;
    if (RELATION_TYPES.includes(value)) return value;
    return 'depend_on';
}

function tokenize(raw: string): string[] {
    return raw
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2 && !GENERIC_TOKENS.has(token));
}

function normalizeHint(hint: string): string[] {
    const normalized = hint
        .replace(/([a-z])([A-Z])/g, '$1_$2')
        .replace(/\./g, '_')
        .replace(/-/g, '_')
        .toLowerCase();

    return tokenize(normalized);
}

function inferTargetProjectId(
    hint: string,
    repoTokens: Array<{ id: string; tokens: Set<string> }>,
    currentRepoId: string,
): string | null {
    const tokens = normalizeHint(hint);
    if (tokens.length === 0) return null;

    let best: { id: string; score: number } | null = null;

    for (const candidate of repoTokens) {
        if (candidate.id === currentRepoId) continue;

        let score = 0;
        for (const token of tokens) {
            if (candidate.tokens.has(token)) score += 1;
        }

        if (score === 0) continue;
        if (!best || score > best.score) {
            best = { id: candidate.id, score };
        }
    }

    return best ? best.id : null;
}

function resolveInferenceMode(options: Required<InferenceOptions>): InferenceMode {
    if (options.astPluginsEnabled) return 'full';
    if (options.fallbackEnabled) return 'fallback';
    return 'disabled';
}

async function getRepoFilePaths(
    octokit: Octokit,
    owner: string,
    repo: string,
    defaultBranch: string,
): Promise<{ configPaths: string[]; sourcePaths: string[] }> {
    const branch = await octokit.rest.repos.getBranch({ owner, repo, branch: defaultBranch });
    const treeSha = branch.data.commit.commit.tree.sha;

    const tree = await octokit.rest.git.getTree({
        owner,
        repo,
        tree_sha: treeSha,
        recursive: '1',
    });

    const files = ((tree.data.tree || []) as GitTreeNode[])
        .filter((node) => node.type === 'blob' && typeof node.path === 'string')
        .map((node) => node.path as string);

    const configPaths = files
        .filter((filePath) => CONFIG_FILE_REGEX.test(filePath))
        .slice(0, MAX_CONFIG_FILES);
    const sourcePaths = files
        .filter((filePath) => SOURCE_FILE_REGEX.test(filePath))
        .slice(0, MAX_SOURCE_FILES);

    return { configPaths, sourcePaths };
}

async function getBlobContent(
    octokit: Octokit,
    owner: string,
    repo: string,
    path: string,
): Promise<{ content: string | null; failed: boolean }> {
    try {
        const res = await octokit.rest.repos.getContent({ owner, repo, path });
        const content = Array.isArray(res.data) ? null : res.data;
        if (!content || content.type !== 'file' || !content.content || content.size > MAX_BLOB_SIZE) {
            return { content: null, failed: false };
        }

        return { content: Buffer.from(content.content, 'base64').toString('utf8'), failed: false };
    } catch {
        return { content: null, failed: true };
    }
}

function extractEnvHints(raw: string): string[] {
    const hints = new Set<string>();

    for (const regex of ENV_PLACEHOLDER_REGEXES) {
        for (const match of raw.matchAll(regex)) {
            const token = (match[1] || '').trim();
            if (token.length > 1) hints.add(token);
        }
    }

    for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        if (!trimmed.includes('${') && !trimmed.includes('process.env.')) continue;

        const left = trimmed.split(/[:=]/, 1)[0] || '';
        if (left) hints.add(left);
    }

    return [...hints];
}

export async function inferEnvMappingCandidates(
    repos: RepoInfo[],
    patterns: PatternRow[],
): Promise<MappingCandidate[]> {
    const result = await inferEnvMappingCandidatesWithMetrics(repos, patterns);
    return result.candidates;
}

export async function inferEnvMappingCandidatesWithMetrics(
    repos: RepoInfo[],
    patterns: PatternRow[],
    options: InferenceOptions = {},
): Promise<InferenceResult> {
    const startedAt = Date.now();
    const normalizedOptions: Required<InferenceOptions> = {
        astPluginsEnabled: options.astPluginsEnabled ?? true,
        fallbackEnabled: options.fallbackEnabled ?? true,
    };
    const mode = resolveInferenceMode(normalizedOptions);

    if (mode === 'disabled') {
        const durationMs = Date.now() - startedAt;
        return {
            candidates: [],
            metrics: {
                mode,
                repoCount: repos.length,
                configFilesScanned: 0,
                sourceFilesScanned: 0,
                candidateCount: 0,
                lowConfidenceCount: 0,
                avgConfidence: 0,
                failures: 0,
                durationMs,
                throughputPerSec: 0,
            },
        };
    }

    const octokit = getOctokit();
    const repoTokens = repos.map((repo) => ({
        id: repo.id,
        tokens: new Set([...tokenize(repo.name), ...tokenize(repo.id)]),
    }));
    let configFilesScanned = 0;
    let sourceFilesScanned = 0;
    let failures = 0;

    const candidates = new Map<string, MappingCandidate>();

    const upsertCandidate = (input: {
        fromId: string;
        toId: string;
        type?: string | null;
        evidence: EvidenceRecord;
        tags?: string[];
    }) => {
        const relationType = normalizeRelationType(input.type);
        const key = `${input.fromId}|${input.toId}|${relationType}`;
        const existing = candidates.get(key);

        if (!existing) {
            const confidence = combineConfidence([input.evidence], relationType);
            const reviewLane = deriveReviewLane(confidence);
            candidates.set(key, {
                fromId: input.fromId,
                toId: input.toId,
                type: relationType,
                source: 'inference',
                confidence,
                evidence: stringifyEvidenceRecord(input.evidence),
                scoreVersion: CONFIDENCE_SCORE_VERSION,
                reviewLane,
                tags: Array.from(new Set([
                    ...(input.tags ?? []),
                    relationType,
                    reviewLane,
                    ...(reviewLane === 'low_confidence' ? ['needs-review'] : []),
                ])),
                evidences: [input.evidence],
            });
            return;
        }

        const mergedEvidences = [...existing.evidences, input.evidence];
        const confidence = combineConfidence(mergedEvidences, relationType);
        const reviewLane = deriveReviewLane(confidence);
        existing.confidence = confidence;
        existing.reviewLane = reviewLane;
        existing.scoreVersion = CONFIDENCE_SCORE_VERSION;
        existing.evidences = mergedEvidences;
        existing.evidence = stringifyEvidenceRecord(mergedEvidences[0]);
        existing.tags = Array.from(new Set([
            ...existing.tags,
            ...(input.tags ?? []),
            relationType,
            reviewLane,
            ...(reviewLane === 'low_confidence' ? ['needs-review'] : []),
        ]));
    };

    for (const repoInfo of repos) {
        try {
            const [owner, repo] = repoInfo.id.split('/');
            if (!owner || !repo) continue;

            const { configPaths, sourcePaths } = await getRepoFilePaths(
                octokit,
                owner,
                repo,
                repoInfo.default_branch || 'main',
            );

            if (normalizedOptions.fallbackEnabled) {
                for (const configPath of configPaths) {
                    const blob = await getBlobContent(octokit, owner, repo, configPath);
                    if (blob.failed) failures += 1;
                    if (!blob.content) continue;
                    configFilesScanned += 1;

                    const envHints = extractEnvHints(blob.content);
                    for (const hint of envHints) {
                        const toId = inferTargetProjectId(hint, repoTokens, repoInfo.id);
                        if (!toId) continue;
                        upsertCandidate({
                            fromId: repoInfo.id,
                            toId,
                            type: 'depend_on',
                            evidence: makeEvidenceRecord({
                                kind: 'env',
                                file: configPath,
                                symbol: hint,
                                detail: `env:${hint}`,
                            }),
                            tags: ['config'],
                        });
                    }

                    for (const pattern of patterns) {
                        if (!pattern.enabled || !pattern.pattern || !pattern.target_object_urn) continue;
                        if (!blob.content.includes(pattern.pattern)) continue;
                        upsertCandidate({
                            fromId: repoInfo.id,
                            toId: pattern.target_object_urn,
                            type: pattern.dependency_type || 'depend_on',
                            evidence: makeEvidenceRecord({
                                kind: 'value',
                                file: configPath,
                                detail: `pattern:${pattern.pattern}`,
                            }),
                            tags: ['pattern'],
                        });
                    }
                }
            }

            if (normalizedOptions.astPluginsEnabled) {
                for (const sourcePath of sourcePaths) {
                    const blob = await getBlobContent(octokit, owner, repo, sourcePath);
                    if (blob.failed) failures += 1;
                    if (!blob.content) continue;
                    sourceFilesScanned += 1;

                    const signals = (() => {
                        try {
                            return extractSignalsWithPlugins({ path: sourcePath, content: blob.content });
                        } catch {
                            failures += 1;
                            return [];
                        }
                    })();

                    for (const signal of signals) {
                        const toId = inferTargetProjectId(signal.hint, repoTokens, repoInfo.id);
                        if (!toId) continue;
                        const evidences = signal.evidences && signal.evidences.length > 0
                            ? signal.evidences
                            : [makeEvidenceRecord({ kind: 'unknown', file: sourcePath, detail: signal.evidence })];
                        const primaryEvidence = evidences[0];
                        upsertCandidate({
                            fromId: repoInfo.id,
                            toId,
                            type: signal.relationType || signal.relationTypeHint || 'depend_on',
                            evidence: primaryEvidence,
                            tags: signal.tags,
                        });
                    }
                }
            }
        } catch {
            failures += 1;
        }
    }

    const resolvedCandidates = [...candidates.values()];
    const lowConfidenceCount = resolvedCandidates.filter((candidate) => candidate.reviewLane === 'low_confidence').length;
    const avgConfidence = resolvedCandidates.length === 0
        ? 0
        : Number(
            (
                resolvedCandidates.reduce((sum, candidate) => sum + candidate.confidence, 0)
                / resolvedCandidates.length
            ).toFixed(3),
        );
    const durationMs = Date.now() - startedAt;
    const throughputPerSec = durationMs > 0
        ? Number(((resolvedCandidates.length * 1000) / durationMs).toFixed(3))
        : resolvedCandidates.length;

    return {
        candidates: resolvedCandidates,
        metrics: {
            mode,
            repoCount: repos.length,
            configFilesScanned,
            sourceFilesScanned,
            candidateCount: resolvedCandidates.length,
            lowConfidenceCount,
            avgConfidence,
            failures,
            durationMs,
            throughputPerSec,
        },
    };
}
