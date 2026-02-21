import type { AstExtractedSignal, AstInferenceSignal, AstParseResult, AstPlugin } from './types';
import {
  combineConfidence,
  CONFIDENCE_SCORE_VERSION,
  deriveReviewLane,
  makeEvidenceRecord,
  normalizeSymbol,
} from './utils';

const IMPORT_REGEX = /^(?:from\s+([A-Za-z0-9_.]+)\s+import|import\s+([A-Za-z0-9_.,\s]+))/gm;
const ENV_REF_REGEX = /(?:os\.getenv|environ\.get)\(\s*["']([A-Za-z0-9_.-]+)["']/g;
const ROUTE_REGEX = /@(app|router)\.(get|post|put|patch|delete)\(/g;
const SQL_READ_REGEX = /\b(session\.query|select\(|scalars\(|fetchall\(|fetchone\()\b/g;
const SQL_WRITE_REGEX = /\b(session\.(add|add_all|delete|execute|commit)|insert\(|update\(|delete\()\b/g;
const PRODUCE_REGEX = /\b(kafka_producer\.send|producer\.send|redis\.publish|celery\.send_task|send_message)\b/g;
const CONSUME_REGEX = /\b(@app\.task|KafkaConsumer|consumer\.poll|consumer\.subscribe|redis\.subscribe)\b/g;

function normalizeHints(raw: string): string[] {
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

function unique(signals: AstInferenceSignal[]): AstInferenceSignal[] {
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

export const pythonAstPlugin: AstPlugin = {
  id: 'python',
  supports: (path) => /\.py$/i.test(path),
  parse: ({ path, content }): AstParseResult => ({
    ast: undefined,
    diagnostics: [],
    metadata: {
      parser: 'python-regex-v1',
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
      for (const hint of normalizeHints(input.hintSource)) {
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
      const fromImport = (match[1] || '').trim();
      const plainImport = (match[2] || '').trim();
      const tokenSource = fromImport || plainImport;
      if (!tokenSource) continue;
      push({
        hintSource: tokenSource,
        relationTypeHint: 'depend_on',
        kind: 'import',
        line: lineAt(content, match.index ?? 0),
        symbol: tokenSource,
        detail: tokenSource,
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

    for (const match of content.matchAll(ROUTE_REGEX)) {
      const idx = match.index ?? 0;
      const line = lineText(content, idx);
      push({
        hintSource: line,
        relationTypeHint: 'expose',
        kind: 'route',
        line: lineAt(content, idx),
        symbol: `${match[1]}.${match[2]}`,
        detail: line.trim().slice(0, 240),
      });
    }

    for (const match of content.matchAll(SQL_READ_REGEX)) {
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

    for (const match of content.matchAll(SQL_WRITE_REGEX)) {
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
        tags: Array.from(new Set(['python', signal.relationTypeHint ?? 'depend_on', reviewLane])),
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
    const extracted = pythonAstPlugin.extract?.({ path, content }, { diagnostics: [], metadata: {} });
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
    return unique(signals);
  },
};
