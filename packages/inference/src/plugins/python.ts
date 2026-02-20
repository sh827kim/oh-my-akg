import type { AstInferenceSignal, AstPlugin } from './types';

const IMPORT_REGEX = /^(?:from\s+([A-Za-z0-9_.]+)\s+import|import\s+([A-Za-z0-9_.,\s]+))/gm;
const ENV_REF_REGEX = /(?:os\.getenv|environ\.get)\(\s*["']([A-Za-z0-9_.-]+)["']/g;

function normalizeHints(raw: string): string[] {
  return raw
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
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
  extractSignals: ({ path, content }) => {
    const signals: AstInferenceSignal[] = [];

    for (const match of content.matchAll(IMPORT_REGEX)) {
      const fromImport = (match[1] || '').trim();
      const plainImport = (match[2] || '').trim();
      const tokenSource = fromImport || plainImport;
      if (!tokenSource) continue;

      for (const hint of normalizeHints(tokenSource)) {
        signals.push({ hint, evidence: `${path}:import:${tokenSource}` });
      }
    }

    for (const match of content.matchAll(ENV_REF_REGEX)) {
      const envName = (match[1] || '').trim();
      if (!envName) continue;
      signals.push({ hint: envName, evidence: `${path}:env:${envName}` });
    }

    return unique(signals);
  },
};
