import type { AstInferenceSignal, AstPlugin } from './types';

const IMPORT_FROM_REGEX = /from\s+['"]([^'"]+)['"]/g;
const ENV_REF_REGEX = /process\.env\.([A-Za-z0-9_]+)/g;

function tokenHints(raw: string): string[] {
  return raw
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
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
  extractSignals: ({ path, content }) => {
    const signals: AstInferenceSignal[] = [];

    for (const match of content.matchAll(IMPORT_FROM_REGEX)) {
      const importPath = (match[1] || '').trim();
      if (!importPath || importPath.startsWith('.')) continue;
      for (const hint of tokenHints(importPath)) {
        signals.push({ hint, evidence: `${path}:import:${importPath}` });
      }
    }

    for (const match of content.matchAll(ENV_REF_REGEX)) {
      const envName = (match[1] || '').trim();
      if (!envName) continue;
      signals.push({ hint: envName, evidence: `${path}:env:${envName}` });
    }

    return uniqueSignals(signals);
  },
};
