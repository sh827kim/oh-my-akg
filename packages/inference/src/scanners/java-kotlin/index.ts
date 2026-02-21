// Java/Kotlin 파일에서 api_endpoint, db_table, topic을 추론하는 스캐너
// Java: web-tree-sitter로 실제 AST 파싱
// Kotlin: tree-sitter-kotlin 미설치로 정규식 기반 파싱 (구조는 Java와 동일)
import type { Scanner, ScanResult, ScanContext, SourceFile, DiscoveredObject, DiscoveredRelation } from '../types';
import { makeEvidenceRecord, combineConfidence } from '../../utils';
import { getLoadedParser } from '../../parsers/tree-sitter-loader';
import type Parser from 'web-tree-sitter';

// Spring HTTP 메서드 데코레이터 → HTTP method 매핑
const SPRING_HTTP_ANNOTATIONS = new Map([
    ['GetMapping', 'GET'],
    ['PostMapping', 'POST'],
    ['PutMapping', 'PUT'],
    ['PatchMapping', 'PATCH'],
    ['DeleteMapping', 'DELETE'],
]);

// Spring 컨트롤러 어노테이션
const SPRING_CONTROLLER_ANNOTATIONS = new Set(['RestController', 'Controller']);

// @RequestMapping method 속성 → HTTP method 매핑
const REQUEST_METHOD_MAP: Record<string, string> = {
    GET: 'GET', POST: 'POST', PUT: 'PUT', PATCH: 'PATCH', DELETE: 'DELETE',
};

// Kafka producer 메서드 패턴
const KAFKA_SEND_REGEX = /(?:kafkaTemplate|producer)\s*\.\s*send\s*\(\s*(?:new\s+\w+\s*<[^>]*>\s*\(\s*)?"([^"]+)"/g;

// HTTP 클라이언트 URL 패턴
const HTTP_CLIENT_URL_REGEX = /(?:restTemplate|webClient|feign)\s*\.\s*\w+\s*\([^)]*"(https?:\/\/[^"]+)"/g;

// 단수형 클래스명 → 복수형 테이블명 변환
function pluralize(name: string): string {
    const lower = name.toLowerCase();
    if (lower.endsWith('s') || lower.endsWith('x') || lower.endsWith('z') ||
        lower.endsWith('ch') || lower.endsWith('sh')) return `${lower}es`;
    if (lower.endsWith('y') && !/[aeiou]y$/i.test(lower)) return `${lower.slice(0, -1)}ies`;
    return `${lower}s`;
}

// 경로 prefix + suffix 결합
function joinPaths(prefix: string, suffix: string): string {
    const p = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
    const s = suffix.startsWith('/') ? suffix : `/${suffix}`;
    return `${p}${s}` || '/';
}

// 어노테이션 텍스트에서 경로 값 추출
// @GetMapping("/{id}") → "/{id}"
// @RequestMapping(value = "/path") → "/path"
// @RequestMapping(path = "/path") → "/path"
function extractAnnotationPath(annotationText: string): string | null {
    // 단일 문자열 인수: @GetMapping("/{id}")
    const directMatch = /@\w+\(\s*"([^"]+)"\s*\)/.exec(annotationText);
    if (directMatch) return directMatch[1] ?? null;

    // value = "/path" 또는 path = "/path"
    const namedMatch = /@\w+\([^)]*(?:value|path)\s*=\s*\{?\s*"([^"]+)"/.exec(annotationText);
    if (namedMatch) return namedMatch[1] ?? null;

    // @Controller 또는 @RequestMapping() 인수 없음 → 루트 경로
    if (/@\w+\(\s*\)/.test(annotationText) || /@\w+$/.test(annotationText.trim())) return '';

    return null;
}

// @RequestMapping의 method 속성 추출
// @RequestMapping(method = RequestMethod.GET) → "GET"
function extractRequestMethod(annotationText: string): string {
    const match = /method\s*=\s*(?:RequestMethod\s*\.\s*)?(\w+)/.exec(annotationText);
    return REQUEST_METHOD_MAP[match?.[1]?.toUpperCase() ?? ''] ?? 'ALL';
}

// @KafkaListener topics 추출
// topics = {"order.created", "order.updated"} 또는 topics = "single-topic"
function extractKafkaTopics(annotationText: string): string[] {
    const topics: string[] = [];
    const arrayMatch = /topics\s*=\s*\{([^}]+)\}/.exec(annotationText);
    if (arrayMatch) {
        for (const m of (arrayMatch[1] ?? '').matchAll(/"([^"]+)"/g)) {
            if (m[1]) topics.push(m[1]);
        }
        return topics;
    }
    const singleMatch = /topics\s*=\s*"([^"]+)"/.exec(annotationText);
    if (singleMatch?.[1]) topics.push(singleMatch[1]);
    return topics;
}

// @Table(name = "actual_name") 추출
function extractTableName(annotationText: string): string | null {
    const match = /@Table\s*\([^)]*(?:name\s*=\s*"([^"]+)")/.exec(annotationText);
    return match?.[1] ?? null;
}

// 호스트명 → 서비스명 추론
function hostToServiceName(url: string): string | null {
    const match = /https?:\/\/([^/:?#\s]+)/.exec(url);
    if (!match) return null;
    const host = match[1] ?? '';
    if (host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
    const base = host.split('.')[0] ?? host;
    const name = base.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    return name.length >= 2 ? name : null;
}

// ===== tree-sitter 기반 Java AST 분석 =====

interface ClassInfo {
    className: string;
    annotations: string[];  // 어노테이션 full text 목록
    startLine: number;
    methods: MethodInfo[];
}

interface MethodInfo {
    annotations: string[];
    startLine: number;
}

// SyntaxNode 순회 (BFS)
function* walkNodes(root: Parser.SyntaxNode): Generator<Parser.SyntaxNode> {
    const queue: Parser.SyntaxNode[] = [root];
    while (queue.length > 0) {
        const node = queue.shift()!;
        yield node;
        queue.push(...node.children);
    }
}

// modifiers 블록에서 어노테이션 텍스트 추출
function extractAnnotationTexts(modifiersNode: Parser.SyntaxNode): string[] {
    return modifiersNode.children
        .filter(c => c.type === 'annotation' || c.type === 'marker_annotation')
        .map(c => c.text);
}

// Java AST에서 클래스 정보 수집
function extractClassInfos(tree: Parser.Tree): ClassInfo[] {
    const infos: ClassInfo[] = [];

    for (const node of walkNodes(tree.rootNode)) {
        if (node.type !== 'class_declaration') continue;

        const classNameNode = node.childForFieldName('name');
        if (!classNameNode) continue;
        const className = classNameNode.text;

        // 클래스 레벨 어노테이션
        const modifiersNode = node.children.find(c => c.type === 'modifiers');
        const classAnnotations = modifiersNode ? extractAnnotationTexts(modifiersNode) : [];

        // 메서드 레벨 어노테이션
        const methods: MethodInfo[] = [];
        const bodyNode = node.childForFieldName('body');
        if (bodyNode) {
            for (const bodyChild of bodyNode.children) {
                if (bodyChild.type !== 'method_declaration') continue;
                const methodMods = bodyChild.children.find(c => c.type === 'modifiers');
                const methodAnnotations = methodMods ? extractAnnotationTexts(methodMods) : [];
                methods.push({
                    annotations: methodAnnotations,
                    startLine: bodyChild.startPosition.row + 1,
                });
            }
        }

        infos.push({
            className,
            annotations: classAnnotations,
            startLine: node.startPosition.row + 1,
            methods,
        });
    }

    return infos;
}

// ===== Kotlin 정규식 기반 분석 =====
// Kotlin은 Java와 Spring 어노테이션 구문이 동일하므로 같은 정규식 재사용 가능

interface KotlinClassBlock {
    className: string;
    classAnnotations: string[];
    methodAnnotations: Array<{ annotations: string[]; line: number }>;
    startLine: number;
}

function extractKotlinClasses(content: string): KotlinClassBlock[] {
    const blocks: KotlinClassBlock[] = [];
    const lines = content.split('\n');
    const classStartRegex = /^(?:@\w[\w()"=,.\s{}]*\s+)*(?:open\s+|abstract\s+|data\s+)?class\s+(\w+)/;

    let i = 0;
    while (i < lines.length) {
        const line = lines[i] ?? '';
        // 클래스 선언 감지 (어노테이션 라인 포함)
        const classMatch = classStartRegex.exec(line);
        if (!classMatch) { i++; continue; }

        // 클래스 이전 어노테이션 수집 (최대 5줄 역추적)
        const classAnnotations: string[] = [];
        for (let j = Math.max(0, i - 5); j < i; j++) {
            const annotLine = (lines[j] ?? '').trim();
            if (/^@\w/.test(annotLine)) classAnnotations.push(annotLine);
        }
        // 클래스 라인 자체의 어노테이션도 추출
        for (const m of line.matchAll(/@\w+(?:\([^)]*\))?/g)) {
            if (m[0]) classAnnotations.push(m[0]);
        }

        const className = classMatch[1] ?? 'Unknown';
        const startLine = i + 1;
        const methodAnnotations: Array<{ annotations: string[]; line: number }> = [];

        // 클래스 body 파싱 (중첩 괄호 추적)
        let depth = 0;
        let foundOpen = false;
        let j = i;
        while (j < lines.length) {
            const bodyLine = lines[j] ?? '';
            for (const ch of bodyLine) {
                if (ch === '{') { depth++; foundOpen = true; }
                else if (ch === '}') { depth--; }
            }
            // 메서드 레벨 어노테이션 감지
            if (foundOpen && depth >= 1) {
                const methodAnns: string[] = [];
                for (const m of bodyLine.matchAll(/@\w+(?:\([^)]*\))?/g)) {
                    if (m[0]) methodAnns.push(m[0]);
                }
                if (methodAnns.length > 0 && /fun\s+\w+/.test(bodyLine)) {
                    methodAnnotations.push({ annotations: methodAnns, line: j + 1 });
                }
            }
            if (foundOpen && depth === 0) break;
            j++;
        }

        blocks.push({ className, classAnnotations, methodAnnotations, startLine });
        i = j + 1;
    }

    return blocks;
}

// ===== 공통 출력 빌더 =====

function buildScanResultFromClasses(
    classInfoList: Array<{ className: string; classAnnotations: string[]; startLine: number; methods: Array<{ annotations: string[]; startLine: number }> }>,
    content: string,
    file: SourceFile,
    context: ScanContext,
): ScanResult {
    const objects: DiscoveredObject[] = [];
    const relations: DiscoveredRelation[] = [];
    const serviceUrn = context.currentServiceUrn;
    const urnBase = serviceUrn.replace(/:service$/, '');

    const emitEndpoint = (method: string, path: string, line: number) => {
        const normalizedPath = path.startsWith('/') ? path : `/${path}`;
        const name = `${method}:${normalizedPath}`;
        const urn = `${urnBase}:api_endpoint:${name}`;
        const ev = makeEvidenceRecord({
            kind: 'route', file: file.path, line,
            symbol: name, detail: `${method} ${normalizedPath}`,
        });
        const confidence = combineConfidence([ev], 'expose');
        objects.push({
            urn, objectType: 'api_endpoint', name,
            displayName: `${method} ${normalizedPath}`,
            parentUrn: serviceUrn, granularity: 'ATOMIC',
            metadata: { method, path: normalizedPath, source_file: file.path },
            evidence: ev, confidence,
        });
        relations.push({ subjectUrn: serviceUrn, relationType: 'expose', targetUrn: urn, evidence: ev, confidence });
    };

    const emitDbTable = (tableName: string, modelName: string, line: number) => {
        const urn = `${urnBase}:db_table:${tableName}`;
        const ev = makeEvidenceRecord({
            kind: 'annotation', file: file.path, line,
            symbol: modelName, detail: `@Entity class ${modelName} → db_table:${tableName}`,
        });
        objects.push({
            urn, objectType: 'db_table', name: tableName,
            displayName: modelName, parentUrn: serviceUrn, granularity: 'ATOMIC',
            metadata: { jpa_entity: modelName, source_file: file.path },
            evidence: ev, confidence: combineConfidence([ev], 'depend_on'),
        });
    };

    const emitTopic = (topicName: string, type: 'produce' | 'consume', line: number) => {
        const topicUrn = `urn:${context.orgName}::topic:${topicName}`;
        const ev = makeEvidenceRecord({
            kind: 'message', file: file.path, line,
            symbol: topicName, detail: `${type} topic: ${topicName}`,
        });
        const confidence = combineConfidence([ev], type);
        if (!context.knownUrns.has(topicUrn)) {
            objects.push({
                urn: topicUrn, objectType: 'topic', name: topicName,
                granularity: 'ATOMIC',
                metadata: { source_file: file.path },
                evidence: ev, confidence: confidence * 0.9,
            });
        }
        relations.push({ subjectUrn: serviceUrn, relationType: type, targetUrn: topicUrn, evidence: ev, confidence });
    };

    const emitHttpCall = (url: string, line: number) => {
        const serviceName = hostToServiceName(url);
        if (!serviceName) return;
        const targetUrn = `urn:${context.orgName}:${serviceName}:service`;
        if (targetUrn === serviceUrn) return;
        const ev = makeEvidenceRecord({ kind: 'call', file: file.path, line, symbol: url, detail: `HTTP call → ${url}` });
        relations.push({
            subjectUrn: serviceUrn, relationType: 'call', targetUrn, evidence: ev,
            confidence: combineConfidence([ev], 'call') * 0.75,
        });
    };

    // 클래스 정보 처리
    for (const cls of classInfoList) {
        const isController = cls.classAnnotations.some(a =>
            SPRING_CONTROLLER_ANNOTATIONS.has(a.replace(/^@/, '').split(/[\s(]/)[0] ?? ''));
        const isEntity = cls.classAnnotations.some(a => /^@Entity/.test(a));

        // Spring Controller → api_endpoint
        if (isController) {
            // 클래스 레벨 @RequestMapping prefix
            const requestMappingText = cls.classAnnotations.find(a => /^@RequestMapping/.test(a));
            const classPrefix = requestMappingText ? (extractAnnotationPath(requestMappingText) ?? '') : '';

            for (const method of cls.methods) {
                for (const ann of method.annotations) {
                    const annName = ann.replace(/^@/, '').split(/[\s(]/)[0] ?? '';

                    // @GetMapping, @PostMapping 등
                    const httpMethod = SPRING_HTTP_ANNOTATIONS.get(annName);
                    if (httpMethod) {
                        const methodPath = extractAnnotationPath(ann) ?? '/';
                        emitEndpoint(httpMethod, joinPaths(classPrefix, methodPath), method.startLine);
                        continue;
                    }

                    // @RequestMapping(method = RequestMethod.GET)
                    if (annName === 'RequestMapping') {
                        const rMethod = extractRequestMethod(ann);
                        const rPath = extractAnnotationPath(ann) ?? '/';
                        emitEndpoint(rMethod, joinPaths(classPrefix, rPath), method.startLine);
                    }

                    // @KafkaListener(topics = {...})
                    if (annName === 'KafkaListener') {
                        const topics = extractKafkaTopics(ann);
                        for (const t of topics) emitTopic(t, 'consume', method.startLine);
                    }
                }
            }
        }

        // JPA @Entity → db_table
        if (isEntity) {
            const tableAnn = cls.classAnnotations.find(a => /^@Table/.test(a));
            const tableName = (tableAnn ? extractTableName(tableAnn) : null) ?? pluralize(cls.className);
            emitDbTable(tableName, cls.className, cls.startLine);
        }

        // 클래스 레벨 @KafkaListener (메서드 레벨 처리는 위에서)
        for (const ann of cls.classAnnotations) {
            if (/^@KafkaListener/.test(ann)) {
                const topics = extractKafkaTopics(ann);
                for (const t of topics) emitTopic(t, 'consume', cls.startLine);
            }
        }
    }

    // kafkaTemplate.send() 패턴 탐지 (파일 전체 스캔)
    for (const m of content.matchAll(KAFKA_SEND_REGEX)) {
        const topicName = m[1];
        if (topicName) {
            const line = content.slice(0, m.index).split('\n').length;
            emitTopic(topicName, 'produce', line);
        }
    }

    // HTTP 클라이언트 호출 탐지
    for (const m of content.matchAll(HTTP_CLIENT_URL_REGEX)) {
        const url = m[1];
        if (url) {
            const line = content.slice(0, m.index).split('\n').length;
            emitHttpCall(url, line);
        }
    }

    return { objects, relations };
}

// ===== Scanner 구현 =====

export const javaKotlinScanner: Scanner = {
    id: 'java-kotlin',
    supports: (filePath) => /\.(java|kt|kts)$/i.test(filePath),

    scan(file: SourceFile, context: ScanContext): ScanResult {
        const isKotlin = /\.(kt|kts)$/i.test(file.path);

        if (isKotlin) {
            // Kotlin: 정규식 기반 클래스 구조 분석
            const blocks = extractKotlinClasses(file.content);
            const classInfoList = blocks.map(b => ({
                className: b.className,
                classAnnotations: b.classAnnotations,
                startLine: b.startLine,
                methods: b.methodAnnotations.map(m => ({ annotations: m.annotations, startLine: m.line })),
            }));
            return buildScanResultFromClasses(classInfoList, file.content, file, context);
        }

        // Java: web-tree-sitter AST 분석
        const parser = getLoadedParser('java');
        if (!parser) {
            // 파서 미초기화 시 빈 결과 (pipeline.ts에서 initTreeSitterParsers 미호출)
            return { objects: [], relations: [] };
        }

        try {
            const tree = parser.parse(file.content);
            const classInfos = extractClassInfos(tree);
            const classInfoList = classInfos.map(c => ({
                className: c.className,
                classAnnotations: c.annotations,
                startLine: c.startLine,
                methods: c.methods,
            }));
            return buildScanResultFromClasses(classInfoList, file.content, file, context);
        } catch {
            return { objects: [], relations: [] };
        }
    },
};
