import type { AstExtractedSignal, AstInferenceSignal, AstParseResult, AstPlugin } from './types';
import {
  combineConfidence,
  CONFIDENCE_SCORE_VERSION,
  deriveReviewLane,
  makeEvidenceRecord,
  normalizeSymbol,
} from './utils';

const IMPORT_FROM_REGEX = /from\s+['"]([^'"]+)['"]/g;
const ENV_REF_REGEX = /process\.env\.([A-Za-z0-9_]+)/g;
const FETCH_REGEX = /\b(fetch|axios\.(?:get|post|put|patch|delete)|client\.(?:get|post|put|patch|delete))\b/g;
const ORM_READ_REGEX = /\b(prisma\.[A-Za-z0-9_]+\.(?:findMany|findUnique|findFirst)|knex\([^)]+\)\.(?:select|first)|repository\.find)\b/g;
const ORM_WRITE_REGEX = /\b(prisma\.[A-Za-z0-9_]+\.(?:create|update|upsert|delete)|knex\([^)]+\)\.(?:insert|update|delete)|repository\.(?:save|update|delete))\b/g;
const MESSAGE_PRODUCE_REGEX = /\b(kafka\.producer|producer\.send|sqs\.sendMessage|redis\.publish|channel\.publish)\b/g;
const MESSAGE_CONSUME_REGEX = /\b(kafka\.consumer|consumer\.run|consumer\.subscribe|sqs\.receiveMessage|redis\.subscribe)\b/g;
const URL_HOST_REGEX = /https?:\/\/([A-Za-z0-9.-]+)/g;

function tokenHints(raw: string): string[] {
  return raw
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function lineAt(content: string, index: number): number {
  return content.slice(0, index).split('\n').length;
}

function lineText(content: string, index: number): string {
  const lines = content.split('\n');
  return lines[Math.max(0, lineAt(content, index) - 1)] || '';
}

function hostHints(raw: string): string[] {
  const hints: string[] = [];
  for (const match of raw.matchAll(URL_HOST_REGEX)) {
    const host = (match[1] || '').trim();
    if (!host) continue;
    hints.push(...tokenHints(host));
  }
  return hints;
}

function uniqueSignals(signals: AstInferenceSignal[]): AstInferenceSignal[] {
  const seen = new Set<string>();
  const result: AstInferenceSignal[] = [];

  for (const signal of signals) {
    const key = `${signal.hint}|${signal.evidence}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(signal);
  }

  return result;
}

export const typescriptAstPlugin: AstPlugin = {
  id: 'typescript',
  supports: (path) => /\.(?:ts|tsx|js|jsx|mjs|cjs)$/i.test(path),
  parse: ({ path, content }): AstParseResult => ({
    ast: undefined,
    diagnostics: [],
    metadata: {
      parser: 'typescript-regex-v1',
      path,
      lineCount: String(content.split('\n').length),
    },
  }),
  extract: ({ path, content }): AstExtractedSignal[] => {
    const extracted: AstExtractedSignal[] = [];

    const push = (input: {
      hintSource: string;
      relationTypeHint: AstExtractedSignal['relationTypeHint'];
      kind: Parameters<typeof makeEvidenceRecord>[0]['kind'];
      line: number;
      symbol?: string;
      detail?: string;
    }) => {
      for (const hint of tokenHints(input.hintSource)) {
        extracted.push({
          hint,
          evidence: `${path}:${input.kind}:${input.detail ?? input.hintSource}`,
          relationTypeHint: input.relationTypeHint,
          ...(input.symbol ? { symbol: input.symbol } : {}),
          evidences: [
            makeEvidenceRecord({
              kind: input.kind,
              file: path,
              line: input.line,
              symbol: input.symbol,
              detail: input.detail ?? input.hintSource,
            }),
          ],
        });
      }
    };

    for (const match of content.matchAll(IMPORT_FROM_REGEX)) {
      const importPath = (match[1] || '').trim();
      if (!importPath || importPath.startsWith('.')) continue;
      push({
        hintSource: importPath,
        relationTypeHint: 'depend_on',
        kind: 'import',
        line: lineAt(content, match.index ?? 0),
        symbol: importPath,
        detail: importPath,
      });
    }

    for (const match of content.matchAll(ENV_REF_REGEX)) {
      const envName = (match[1] || '').trim();
      if (!envName) continue;
      push({
        hintSource: envName,
        relationTypeHint: 'depend_on',
        kind: 'env',
        line: lineAt(content, match.index ?? 0),
        symbol: envName,
        detail: envName,
      });
    }

    for (const match of content.matchAll(FETCH_REGEX)) {
      const idx = match.index ?? 0;
      const line = lineText(content, idx);
      push({
        hintSource: hostHints(line).join(' ') || line,
        relationTypeHint: 'call',
        kind: 'call',
        line: lineAt(content, idx),
        symbol: (match[1] || 'http-client').trim(),
        detail: line.trim().slice(0, 240),
      });
    }

    for (const match of content.matchAll(ORM_READ_REGEX)) {
      const idx = match.index ?? 0;
      const line = lineText(content, idx);
      push({
        hintSource: line,
        relationTypeHint: 'read',
        kind: 'query',
        line: lineAt(content, idx),
        symbol: (match[1] || '').trim(),
        detail: line.trim().slice(0, 240),
      });
    }

    for (const match of content.matchAll(ORM_WRITE_REGEX)) {
      const idx = match.index ?? 0;
      const line = lineText(content, idx);
      push({
        hintSource: line,
        relationTypeHint: 'write',
        kind: 'query',
        line: lineAt(content, idx),
        symbol: (match[1] || '').trim(),
        detail: line.trim().slice(0, 240),
      });
    }

    for (const match of content.matchAll(MESSAGE_PRODUCE_REGEX)) {
      const idx = match.index ?? 0;
      const line = lineText(content, idx);
      push({
        hintSource: line,
        relationTypeHint: 'produce',
        kind: 'message',
        line: lineAt(content, idx),
        symbol: (match[1] || '').trim(),
        detail: line.trim().slice(0, 240),
      });
    }

    for (const match of content.matchAll(MESSAGE_CONSUME_REGEX)) {
      const idx = match.index ?? 0;
      const line = lineText(content, idx);
      push({
        hintSource: line,
        relationTypeHint: 'consume',
        kind: 'message',
        line: lineAt(content, idx),
        symbol: (match[1] || '').trim(),
        detail: line.trim().slice(0, 240),
      });
    }

    return extracted;
  },
  normalize: (file, _parsed, extracted) =>
    extracted.map((signal) => {
      const evidences = signal.evidences && signal.evidences.length > 0
        ? signal.evidences
        : [makeEvidenceRecord({ kind: 'unknown', file: file.path, detail: signal.evidence })];
      const confidence = combineConfidence(evidences, signal.relationTypeHint ?? 'depend_on');
      const reviewLane = deriveReviewLane(confidence);

      return {
        ...signal,
        ...(signal.symbol ? { symbol: normalizeSymbol(signal.symbol, file.path) } : {}),
        confidence,
        scoreVersion: CONFIDENCE_SCORE_VERSION,
        reviewLane,
        evidences,
        tags: Array.from(new Set(['typescript', signal.relationTypeHint ?? 'depend_on', reviewLane])),
      };
    }),
  emit: (_file, _parsed, normalized) =>
    normalized.map((signal) => ({
      hint: signal.hint,
      evidence: signal.evidence,
      relationType: signal.relationTypeHint,
      confidence: signal.confidence,
      scoreVersion: signal.scoreVersion,
      reviewLane: signal.reviewLane,
      ...(signal.symbol ? { symbol: signal.symbol } : {}),
      ...(signal.evidences ? { evidences: signal.evidences } : {}),
      tags: Array.from(new Set([...(signal.tags ?? []), signal.relationTypeHint || 'depend_on'])),
    })),
  extractSignals: ({ path, content }) => {
    const extracted = typescriptAstPlugin.extract?.({ path, content }, { diagnostics: [], metadata: {} });
    if (!extracted) return [];
    const signals: AstInferenceSignal[] = [];
    for (const signal of extracted) {
      signals.push({
        hint: signal.hint,
        evidence: signal.evidence,
        relationTypeHint: signal.relationTypeHint,
        ...(signal.symbol ? { symbol: signal.symbol } : {}),
      });
    }
    return uniqueSignals(signals);
  },
};
