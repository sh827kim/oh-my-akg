export interface SourceFile {
  path: string;
  content: string;
}

export interface AstInferenceSignal {
  hint: string;
  evidence: string;
}

export interface AstPlugin {
  id: string;
  supports: (path: string) => boolean;
  extractSignals: (file: SourceFile) => AstInferenceSignal[];
}
