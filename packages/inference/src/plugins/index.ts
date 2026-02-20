import { javaKotlinAstPlugin } from './java-kotlin';
import { pythonAstPlugin } from './python';
import { typescriptAstPlugin } from './typescript';
import type { AstInferenceSignal, AstPlugin, SourceFile } from './types';

export * from './types';
export { javaKotlinAstPlugin } from './java-kotlin';
export { pythonAstPlugin } from './python';
export { typescriptAstPlugin } from './typescript';

export const defaultAstPlugins: AstPlugin[] = [
  javaKotlinAstPlugin,
  typescriptAstPlugin,
  pythonAstPlugin,
];

export function extractSignalsWithPlugins(
  file: SourceFile,
  plugins: AstPlugin[] = defaultAstPlugins,
): AstInferenceSignal[] {
  const signals: AstInferenceSignal[] = [];

  for (const plugin of plugins) {
    if (!plugin.supports(file.path)) continue;
    signals.push(...plugin.extractSignals(file));
  }

  return signals;
}
