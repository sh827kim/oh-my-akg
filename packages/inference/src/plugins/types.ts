export interface SourceFile {
  path: string;
  content: string;
}

export interface AstInferenceSignal {
  hint: string;
  evidence: string;
  confidence?: number;
}

export interface AstParseResult {
  ast?: unknown;
  diagnostics?: string[];
  metadata?: Record<string, string>;
}

export interface AstExtractedSignal extends AstInferenceSignal {
  relationTypeHint?: string;
  symbol?: string;
}

export interface AstNormalizedSignal extends AstExtractedSignal {
  confidence: number;
  tags?: string[];
}

export interface AstEmittedSignal extends AstInferenceSignal {
  relationType?: string;
  confidence?: number;
  pluginId?: string;
}

export interface AstPluginCapability {
  id: string;
  supportsPath: (path: string) => boolean;
  hasLegacyExtractor: boolean;
  hasParseStage: boolean;
  hasExtractStage: boolean;
  hasNormalizeStage: boolean;
  hasEmitStage: boolean;
}

export interface AstPlugin {
  id: string;
  supports: (path: string) => boolean;
  parse?: (file: SourceFile) => AstParseResult;
  extract?: (file: SourceFile, parsed: AstParseResult) => AstExtractedSignal[];
  normalize?: (
    file: SourceFile,
    parsed: AstParseResult,
    extracted: AstExtractedSignal[],
  ) => AstNormalizedSignal[];
  emit?: (
    file: SourceFile,
    parsed: AstParseResult,
    normalized: AstNormalizedSignal[],
  ) => AstEmittedSignal[];
  // Legacy extractor (temporary compatibility path).
  extractSignals: (file: SourceFile) => AstInferenceSignal[];
}
