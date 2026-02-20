import type { Octokit } from 'octokit';
import { getOctokit, type RepoInfo } from '@/cli/utils/github';

export interface MappingCandidate {
    fromId: string;
    toId: string;
    type: string;
    evidence: string;
}

interface PatternRow {
    pattern: string;
    target_project_id: string;
    dependency_type: string;
    enabled: boolean;
}

const CONFIG_FILE_REGEX = /(^|\/)application(?:-[^./]+)?\.(?:properties|ya?ml|json)$/i;
const MAX_CONFIG_FILES = 20;
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

async function getConfigFilePaths(
    octokit: Octokit,
    owner: string,
    repo: string,
    defaultBranch: string,
): Promise<string[]> {
    const branch = await octokit.rest.repos.getBranch({ owner, repo, branch: defaultBranch });
    const treeSha = branch.data.commit.commit.tree.sha;

    const tree = await octokit.rest.git.getTree({
        owner,
        repo,
        tree_sha: treeSha,
        recursive: '1',
    });

    return (tree.data.tree || [])
        .filter((node) => node.type === 'blob' && typeof node.path === 'string' && CONFIG_FILE_REGEX.test(node.path))
        .map((node) => node.path as string)
        .slice(0, MAX_CONFIG_FILES);
}

async function getBlobContent(octokit: Octokit, owner: string, repo: string, path: string): Promise<string | null> {
    try {
        const res = await octokit.rest.repos.getContent({ owner, repo, path });
        const content = Array.isArray(res.data) ? null : res.data;
        if (!content || content.type !== 'file' || !content.content || content.size > MAX_BLOB_SIZE) {
            return null;
        }

        return Buffer.from(content.content, 'base64').toString('utf8');
    } catch {
        return null;
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
    const octokit = getOctokit();
    const repoTokens = repos.map((repo) => ({
        id: repo.id,
        tokens: new Set([...tokenize(repo.name), ...tokenize(repo.id)]),
    }));

    const candidates = new Map<string, MappingCandidate>();

    for (const repoInfo of repos) {
        const [owner, repo] = repoInfo.id.split('/');
        if (!owner || !repo) continue;

        const configPaths = await getConfigFilePaths(octokit, owner, repo, repoInfo.default_branch || 'main');
        for (const configPath of configPaths) {
            const content = await getBlobContent(octokit, owner, repo, configPath);
            if (!content) continue;

            const envHints = extractEnvHints(content);
            for (const hint of envHints) {
                const toId = inferTargetProjectId(hint, repoTokens, repoInfo.id);
                if (!toId) continue;

                const dedupeKey = `${repoInfo.id}|${toId}|unknown`;
                if (!candidates.has(dedupeKey)) {
                    candidates.set(dedupeKey, {
                        fromId: repoInfo.id,
                        toId,
                        type: 'unknown',
                        evidence: `${configPath}:${hint}`,
                    });
                }
            }

            for (const pattern of patterns) {
                if (!pattern.enabled || !pattern.pattern || !pattern.target_project_id) continue;
                if (!content.includes(pattern.pattern)) continue;

                const dedupeKey = `${repoInfo.id}|${pattern.target_project_id}|${pattern.dependency_type}`;
                if (!candidates.has(dedupeKey)) {
                    candidates.set(dedupeKey, {
                        fromId: repoInfo.id,
                        toId: pattern.target_project_id,
                        type: pattern.dependency_type || 'unknown',
                        evidence: `${configPath}:pattern:${pattern.pattern}`,
                    });
                }
            }
        }
    }

    return [...candidates.values()];
}
