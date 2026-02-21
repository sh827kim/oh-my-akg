import { createHash } from 'node:crypto';
import path from 'node:path';
import type {
  AstRelationType,
  EvidenceKind,
  EvidenceRecord,
  ReviewLane,
} from './types';

export const CONFIDENCE_SCORE_VERSION = 'v1.0';
export const LOW_CONFIDENCE_THRESHOLD = 0.65;

const EVIDENCE_WEIGHTS: Record<EvidenceKind, number> = {
  call: 0.9,
  message: 0.85,
  query: 0.8,
  route: 0.78,
  annotation: 0.76,
  env: 0.72,
  value: 0.7,
  import: 0.62,
  unknown: 0.55,
};

const RELATION_BONUS: Partial<Record<AstRelationType, number>> = {
  call: 0.03,
  read: 0.02,
  write: 0.02,
  produce: 0.02,
  consume: 0.02,
};

export function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const clamped = Math.min(1, Math.max(0, value));
  return Number(clamped.toFixed(3));
}

export function buildSnippetHash(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 12);
}

export function makeEvidenceRecord(input: {
  kind: EvidenceKind;
  file: string;
  line?: number;
  symbol?: string;
  detail?: string;
}): EvidenceRecord {
  return {
    schemaVersion: 'v1',
    kind: input.kind,
    file: input.file,
    ...(typeof input.line === 'number' ? { line: input.line } : {}),
    ...(input.symbol ? { symbol: input.symbol } : {}),
    ...(input.detail ? { detail: input.detail } : {}),
    snippetHash: buildSnippetHash(
      `${input.kind}|${input.file}|${input.line ?? ''}|${input.symbol ?? ''}|${input.detail ?? ''}`,
    ),
  };
}

export function stringifyEvidenceRecord(evidence: EvidenceRecord): string {
  return [
    evidence.schemaVersion,
    evidence.kind,
    evidence.file,
    evidence.line ?? '',
    evidence.symbol ?? '',
    evidence.snippetHash ?? '',
    evidence.detail ?? '',
  ].join('|');
}

export function parseLegacyEvidenceRecord(raw: string, fallbackFile: string): EvidenceRecord {
  const [fileOrVersion, maybeKind, maybeFile, maybeLine, maybeSymbol, maybeHash, maybeDetail] = raw.split('|');
  if (fileOrVersion === 'v1') {
    const line = Number(maybeLine);
    return {
      schemaVersion: 'v1',
      kind: (maybeKind as EvidenceKind) || 'unknown',
      file: maybeFile || fallbackFile,
      ...(Number.isFinite(line) ? { line } : {}),
      ...(maybeSymbol ? { symbol: maybeSymbol } : {}),
      ...(maybeHash ? { snippetHash: maybeHash } : {}),
      ...(maybeDetail ? { detail: maybeDetail } : {}),
    };
  }

  const legacyParts = raw.split(':');
  const file = legacyParts[0] || fallbackFile;
  const kind = (legacyParts[1] as EvidenceKind) || 'unknown';
  const detail = legacyParts.slice(2).join(':') || raw;
  return makeEvidenceRecord({ kind: kind in EVIDENCE_WEIGHTS ? kind : 'unknown', file, detail });
}

export function normalizeSymbol(raw: string | undefined, filePath: string): string | undefined {
  if (!raw) return undefined;

  const compact = raw
    .trim()
    .replace(/::/g, '.')
    .replace(/#/g, '.')
    .replace(/\s+/g, '')
    .replace(/["'`]/g, '');

  if (!compact) return undefined;
  if (compact.startsWith('.')) {
    const namespace = path.dirname(filePath).replace(/\\/g, '/').replace(/^\.+\//, '');
    return `${namespace}${compact}`;
  }
  return compact.replace(/\.\.+/g, '.');
}

export function deriveReviewLane(confidence: number): ReviewLane {
  return confidence < LOW_CONFIDENCE_THRESHOLD ? 'low_confidence' : 'normal';
}

export function combineConfidence(
  evidences: EvidenceRecord[],
  relationType?: AstRelationType,
): number {
  if (evidences.length === 0) {
    return 0.5;
  }

  const sorted = [...evidences].sort(
    (a, b) => (EVIDENCE_WEIGHTS[b.kind] ?? 0.5) - (EVIDENCE_WEIGHTS[a.kind] ?? 0.5),
  );
  const top = sorted.slice(0, 3);
  const weighted =
    top.reduce((acc, item, index) => {
      const weight = EVIDENCE_WEIGHTS[item.kind] ?? 0.55;
      const decay = 1 - index * 0.18;
      return acc + weight * Math.max(0.5, decay);
    }, 0) / top.length;

  const relationBonus = relationType ? RELATION_BONUS[relationType] ?? 0 : 0;
  return clampConfidence(weighted + relationBonus);
}

