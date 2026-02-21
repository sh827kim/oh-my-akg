import type { AstExtractedSignal, AstInferenceSignal, AstParseResult, AstPlugin } from './types';
import {
  combineConfidence,
  CONFIDENCE_SCORE_VERSION,
  deriveReviewLane,
  makeEvidenceRecord,
  normalizeSymbol,
} from './utils';

const IMPORT_REGEX = /import\s+([A-Za-z0-9_.*]+)/g;
const ENV_REF_REGEX = /(?:System\.getenv|environment\.get)\(\s*["']([A-Za-z0-9_.-]+)["']\s*\)/g;
const VALUE_ANNOTATION_REGEX = /@Value\(\s*["']\$\{([A-Za-z0-9_.-]+)(?::[^}]*)?\}["']\s*\)/g;
const HTTP_CLIENT_REGEX = /\b(RestTemplate|WebClient|FeignClient|OpenFeign|\.exchange\(|\.retrieve\(|\.postForObject\()/g;
const QUERY_READ_REGEX = /\b(findAll|findBy[A-Za-z0-9_]*|find[A-Za-z0-9_]*|select\s+|queryForObject|queryForList|jdbcTemplate\.query)\b/gi;
const QUERY_WRITE_REGEX = /\b(save|insert|update|delete|persist|merge|jdbcTemplate\.update)\b/gi;
const PRODUCE_REGEX = /\b(KafkaTemplate|kafkaTemplate\.send|producer\.send|publish\()/g;
const CONSUME_REGEX = /(@KafkaListener|@RabbitListener|consumer\.poll|consumer\.subscribe)/g;
const URL_HOST_REGEX = /https?:\/\/([A-Za-z0-9.-]+)/g;

function splitToHints(raw: string): string[] {
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

function extractHostHints(raw: string): string[] {
  const hints: string[] = [];
  for (const match of raw.matchAll(URL_HOST_REGEX)) {
    const host = (match[1] || '').trim();
    if (!host) continue;
    hints.push(...splitToHints(host));
  }
  return hints;
}

function dedupe(signals: AstInferenceSignal[]): AstInferenceSignal[] {
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

export const javaKotlinAstPlugin: AstPlugin = {
  id: 'java-kotlin',
  supports: (path) => /\.(?:java|kt|kts)$/i.test(path),
  parse: ({ path, content }): AstParseResult => ({
    ast: undefined,
    diagnostics: [],
    metadata: {
      parser: 'java-kotlin-regex-v1',
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
      const hints = splitToHints(input.hintSource);
      for (const hint of hints) {
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

    for (const match of content.matchAll(IMPORT_REGEX)) {
      const importPath = (match[1] || '').trim();
      if (!importPath) continue;
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

    for (const match of content.matchAll(VALUE_ANNOTATION_REGEX)) {
      const configName = (match[1] || '').trim();
      if (!configName) continue;
      push({
        hintSource: configName,
        relationTypeHint: 'depend_on',
        kind: 'value',
        line: lineAt(content, match.index ?? 0),
        symbol: configName,
        detail: configName,
      });
    }

    for (const match of content.matchAll(HTTP_CLIENT_REGEX)) {
      const idx = match.index ?? 0;
      const line = lineText(content, idx);
      const hostHints = extractHostHints(line);
      const hintSource = hostHints.join(' ') || line;
      push({
        hintSource,
        relationTypeHint: 'call',
        kind: 'call',
        line: lineAt(content, idx),
        symbol: (match[1] || 'http-client').trim(),
        detail: line.trim().slice(0, 240),
      });
    }

    for (const match of content.matchAll(QUERY_READ_REGEX)) {
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

    for (const match of content.matchAll(QUERY_WRITE_REGEX)) {
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

    for (const match of content.matchAll(PRODUCE_REGEX)) {
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

    for (const match of content.matchAll(CONSUME_REGEX)) {
      const idx = match.index ?? 0;
      const line = lineText(content, idx);
      push({
        hintSource: line,
        relationTypeHint: 'consume',
        kind: 'annotation',
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
        tags: Array.from(new Set(['java-kotlin', signal.relationTypeHint ?? 'depend_on', reviewLane])),
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
    const extracted = javaKotlinAstPlugin.extract?.({ path, content }, { diagnostics: [], metadata: {} });
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
    return dedupe(signals);
  },
};
