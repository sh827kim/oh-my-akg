import type { AstInferenceSignal, AstPlugin } from './types';

const IMPORT_REGEX = /import\s+([A-Za-z0-9_.*]+)/g;
const ENV_REF_REGEX = /(?:System\.getenv|environment\.get)\(\s*["']([A-Za-z0-9_.-]+)["']\s*\)/g;
const VALUE_ANNOTATION_REGEX = /@Value\(\s*["']\$\{([A-Za-z0-9_.-]+)(?::[^}]*)?\}["']\s*\)/g;

function splitToHints(raw: string): string[] {
  return raw
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
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
  extractSignals: ({ path, content }) => {
    const signals: AstInferenceSignal[] = [];

    for (const match of content.matchAll(IMPORT_REGEX)) {
      const importPath = (match[1] || '').trim();
      if (!importPath) continue;
      for (const hint of splitToHints(importPath)) {
        signals.push({ hint, evidence: `${path}:import:${importPath}` });
      }
    }

    for (const match of content.matchAll(ENV_REF_REGEX)) {
      const envName = (match[1] || '').trim();
      if (!envName) continue;
      signals.push({ hint: envName, evidence: `${path}:env:${envName}` });
    }

    for (const match of content.matchAll(VALUE_ANNOTATION_REGEX)) {
      const configName = (match[1] || '').trim();
      if (!configName) continue;
      signals.push({ hint: configName, evidence: `${path}:value:${configName}` });
    }

    return dedupe(signals);
  },
};
