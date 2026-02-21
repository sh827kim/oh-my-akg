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
import {
  combineConfidence,
  CONFIDENCE_SCORE_VERSION,
  deriveReviewLane,
  normalizeSymbol,
  parseLegacyEvidenceRecord,
  stringifyEvidenceRecord,
} from './utils';

export * from './types';
export * from './utils';
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
    const key = `${signal.hint}|${signal.relationType || ''}|${signal.evidence}`;
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
    relationTypeHint: signal.relationTypeHint,
    symbol: signal.symbol,
    ...(signal.evidences ? { evidences: signal.evidences } : {}),
    ...(signal.relationType ? { relationType: signal.relationType } : {}),
    ...(typeof signal.confidence === 'number' ? { confidence: signal.confidence } : {}),
  }));
}

function defaultNormalize(file: SourceFile, extracted: AstExtractedSignal[]): AstNormalizedSignal[] {
  return extracted.map((signal) => {
    const relationTypeHint = signal.relationTypeHint ?? signal.relationType ?? 'depend_on';
    const evidences =
      signal.evidences && signal.evidences.length > 0
        ? signal.evidences
        : [parseLegacyEvidenceRecord(signal.evidence, file.path)];

    const confidence =
      typeof signal.confidence === 'number'
        ? signal.confidence
        : combineConfidence(evidences, relationTypeHint);
    const reviewLane = deriveReviewLane(confidence);
    const normalizedSymbol = normalizeSymbol(signal.symbol, file.path);
    const tags = [
      ...(signal.tags ?? []),
      ...(reviewLane === 'low_confidence' ? ['low-confidence'] : []),
    ];

    return {
      ...signal,
      relationTypeHint,
      ...(normalizedSymbol ? { symbol: normalizedSymbol } : {}),
      confidence,
      scoreVersion: CONFIDENCE_SCORE_VERSION,
      reviewLane,
      evidences,
      ...(tags.length > 0 ? { tags: Array.from(new Set(tags)) } : {}),
    };
  });
}

function defaultEmit(normalized: AstNormalizedSignal[], pluginId: string): AstEmittedSignal[] {
  return normalized.map((signal) => ({
    hint: signal.hint,
    evidence: stringifyEvidenceRecord(signal.evidences[0]),
    evidences: signal.evidences,
    relationType: signal.relationTypeHint,
    confidence: signal.confidence,
    reviewLane: signal.reviewLane,
    scoreVersion: signal.scoreVersion,
    ...(signal.tags ? { tags: signal.tags } : {}),
    ...(signal.symbol ? { symbol: signal.symbol } : {}),
    pluginId,
  }));
}

function runPluginPipeline(file: SourceFile, plugin: AstPlugin): AstPluginRunResult {
  const hasPipelineStages = !!(plugin.parse || plugin.extract || plugin.normalize || plugin.emit);
  const parsed = plugin.parse ? plugin.parse(file) : defaultParse(file);
  const extracted = plugin.extract ? plugin.extract(file, parsed) : defaultExtract(file, plugin);
  const normalized = plugin.normalize ? plugin.normalize(file, parsed, extracted) : defaultNormalize(file, extracted);
  const emitted = plugin.emit ? plugin.emit(file, parsed, normalized) : defaultEmit(normalized, plugin.id);

  return {
    pluginId: plugin.id,
    signals: dedupeSignals(emitted),
    diagnostics: parsed.diagnostics || [],
    mode: hasPipelineStages ? 'pipeline' : 'legacy',
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
    ...(signal.evidences ? { evidences: signal.evidences } : {}),
    ...(signal.relationType ? { relationType: signal.relationType } : {}),
    ...(signal.reviewLane ? { reviewLane: signal.reviewLane } : {}),
    ...(signal.tags ? { tags: signal.tags } : {}),
    ...(signal.symbol ? { symbol: signal.symbol } : {}),
    ...(signal.scoreVersion ? { scoreVersion: signal.scoreVersion } : {}),
    ...(typeof signal.confidence === 'number' ? { confidence: signal.confidence } : {}),
  }));
}
