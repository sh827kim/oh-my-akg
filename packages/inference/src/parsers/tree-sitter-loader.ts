// web-tree-sitter WASM 파서 초기화 및 싱글톤 관리
// pipeline.ts의 runInferencePipeline()에서 await initTreeSitterParsers() 호출 후
// 각 스캐너에서 getLoadedParser()로 동기 접근
import path from 'node:path';
import Parser from 'web-tree-sitter';

type SupportedLanguage = 'java' | 'python';

interface ParserEntry {
    parser: Parser;
    language: Parser.Language;
}

const cache = new Map<SupportedLanguage, ParserEntry>();
let initialized = false;

// require.resolve로 WASM 파일 경로 탐색 (monorepo 구조 대응)
function resolveWasmPath(packageName: string, wasmFile: string): string {
    try {
        const pkgJson = require.resolve(`${packageName}/package.json`);
        return path.join(path.dirname(pkgJson), wasmFile);
    } catch {
        // pnpm hoisting 실패 시 상위 node_modules 탐색
        const fallback = path.join(__dirname, '..', '..', '..', 'node_modules', packageName, wasmFile);
        return fallback;
    }
}

// web-tree-sitter 런타임 초기화 (tree-sitter.wasm 경로 명시)
async function ensureParserInit(): Promise<void> {
    if (initialized) return;
    const wasmDir = path.dirname(require.resolve('web-tree-sitter/package.json'));
    await Parser.init({
        locateFile: (scriptName: string) => {
            if (scriptName === 'tree-sitter.wasm') {
                return path.join(wasmDir, 'tree-sitter.wasm');
            }
            return scriptName;
        },
    });
    initialized = true;
}

async function loadLanguage(lang: SupportedLanguage, wasmPath: string): Promise<void> {
    if (cache.has(lang)) return;
    const language = await Parser.Language.load(wasmPath);
    const parser = new Parser();
    parser.setLanguage(language);
    cache.set(lang, { parser, language });
}

// pipeline.ts에서 스캔 시작 전 호출
export async function initTreeSitterParsers(): Promise<void> {
    await ensureParserInit();
    await Promise.allSettled([
        loadLanguage('java', resolveWasmPath('tree-sitter-java', 'tree-sitter-java.wasm')),
        loadLanguage('python', resolveWasmPath('tree-sitter-python', 'tree-sitter-python.wasm')),
    ]);
}

// 스캐너에서 동기적으로 파서 획득 (초기화 미완료 시 null 반환)
export function getLoadedParser(lang: SupportedLanguage): Parser | null {
    return cache.get(lang)?.parser ?? null;
}

export function getLoadedLanguage(lang: SupportedLanguage): Parser.Language | null {
    return cache.get(lang)?.language ?? null;
}
