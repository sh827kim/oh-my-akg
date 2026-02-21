import { javaKotlinAstPlugin } from './java-kotlin';
import { pythonAstPlugin } from './python';
import { typescriptAstPlugin } from './typescript';
import type {
  AstEmittedSignal,
  AstExtractedSignal,
  AstInferenceSignal,
  AstNormalizedSignal,
  AstParseResult,
  AstPlugin,
  AstPluginCapability,
  SourceFile,
} from './types';

export * from './types';
export { javaKotlinAstPlugin } from './java-kotlin';
export { pythonAstPlugin } from './python';
export { typescriptAstPlugin } from './typescript';

export const defaultAstPlugins: AstPlugin[] = [
  javaKotlinAstPlugin,
  typescriptAstPlugin,
  pythonAstPlugin,
];

export interface AstPluginRunResult {
  pluginId: string;
  signals: AstEmittedSignal[];
  diagnostics: string[];
  mode: 'pipeline' | 'legacy';
}

export interface AstPipelineResult {
  file: string;
  runs: AstPluginRunResult[];
  signals: AstEmittedSignal[];
}

function dedupeSignals(signals: AstEmittedSignal[]): AstEmittedSignal[] {
  const seen = new Set<string>();
  const result: AstEmittedSignal[] = [];

  for (const signal of signals) {
    const key = `${signal.hint}|${signal.evidence}|${signal.relationType || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(signal);
  }

  return result;
}

function defaultParse(file: SourceFile): AstParseResult {
  return {
    ast: undefined,
    diagnostics: [],
    metadata: { path: file.path, parser: 'legacy-regex' },
  };
}

function defaultExtract(file: SourceFile, plugin: AstPlugin): AstExtractedSignal[] {
  return plugin.extractSignals(file).map((signal) => ({
    hint: signal.hint,
    evidence: signal.evidence,
  }));
}

function scoreFromEvidence(evidence: string): number {
  if (evidence.includes(':env:')) return 0.82;
  if (evidence.includes(':import:')) return 0.68;
  if (evidence.includes(':value:')) return 0.74;
  return 0.6;
}

function defaultNormalize(extracted: AstExtractedSignal[]): AstNormalizedSignal[] {
  return extracted.map((signal) => ({
    ...signal,
    confidence: scoreFromEvidence(signal.evidence),
  }));
}

function defaultEmit(normalized: AstNormalizedSignal[], pluginId: string): AstEmittedSignal[] {
  return normalized.map((signal) => ({
    hint: signal.hint,
    evidence: signal.evidence,
    relationType: signal.relationTypeHint,
    confidence: signal.confidence,
    pluginId,
  }));
}

function runPluginPipeline(file: SourceFile, plugin: AstPlugin): AstPluginRunResult {
  const hasPipelineStages = !!(plugin.parse || plugin.extract || plugin.normalize || plugin.emit);
  if (!hasPipelineStages) {
    const signals = plugin.extractSignals(file).map((signal) => ({
      ...signal,
      pluginId: plugin.id,
    }));
    return { pluginId: plugin.id, signals, diagnostics: [], mode: 'legacy' };
  }

  const parsed = plugin.parse ? plugin.parse(file) : defaultParse(file);
  const extracted = plugin.extract ? plugin.extract(file, parsed) : defaultExtract(file, plugin);
  const normalized = plugin.normalize ? plugin.normalize(file, parsed, extracted) : defaultNormalize(extracted);
  const emitted = plugin.emit ? plugin.emit(file, parsed, normalized) : defaultEmit(normalized, plugin.id);

  return {
    pluginId: plugin.id,
    signals: dedupeSignals(emitted),
    diagnostics: parsed.diagnostics || [],
    mode: 'pipeline',
  };
}

export function inspectAstPluginCapabilities(plugins: AstPlugin[] = defaultAstPlugins): AstPluginCapability[] {
  return plugins.map((plugin) => ({
    id: plugin.id,
    supportsPath: plugin.supports,
    hasLegacyExtractor: typeof plugin.extractSignals === 'function',
    hasParseStage: typeof plugin.parse === 'function',
    hasExtractStage: typeof plugin.extract === 'function',
    hasNormalizeStage: typeof plugin.normalize === 'function',
    hasEmitStage: typeof plugin.emit === 'function',
  }));
}

export function runAstPipelineWithPlugins(
  file: SourceFile,
  plugins: AstPlugin[] = defaultAstPlugins,
): AstPipelineResult {
  const runs: AstPluginRunResult[] = [];
  const allSignals: AstEmittedSignal[] = [];

  for (const plugin of plugins) {
    if (!plugin.supports(file.path)) continue;
    const run = runPluginPipeline(file, plugin);
    runs.push(run);
    allSignals.push(...run.signals);
  }

  return {
    file: file.path,
    runs,
    signals: dedupeSignals(allSignals),
  };
}

export function extractSignalsWithPlugins(
  file: SourceFile,
  plugins: AstPlugin[] = defaultAstPlugins,
): AstInferenceSignal[] {
  return runAstPipelineWithPlugins(file, plugins).signals.map((signal) => ({
    hint: signal.hint,
    evidence: signal.evidence,
    ...(typeof signal.confidence === 'number' ? { confidence: signal.confidence } : {}),
  }));
}
