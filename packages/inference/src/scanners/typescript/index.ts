// TypeScript/JavaScript 파일에서 api_endpoint, topic, db_table 관계를 추론하는 스캐너
// @babel/parser + @babel/traverse를 사용해 실제 AST 파싱 수행
import * as babelParser from '@babel/parser';
import traverseModule from '@babel/traverse';
import * as t from '@babel/types';
import type { Scanner, ScanResult, ScanContext, SourceFile, DiscoveredObject, DiscoveredRelation } from '../types';
import { makeEvidenceRecord, combineConfidence } from '../../utils';

// CJS/ESM 호환 처리 (빌드 환경에 따라 .default 여부 다름)
const traverse = (
    typeof (traverseModule as unknown as { default?: unknown }).default === 'function'
        ? (traverseModule as unknown as { default: typeof traverseModule }).default
        : traverseModule
);

// NestJS HTTP 메서드 데코레이터 → HTTP method 매핑
const NESTJS_HTTP_METHODS = new Map([
    ['Get', 'GET'], ['Post', 'POST'], ['Put', 'PUT'], ['Patch', 'PATCH'],
    ['Delete', 'DELETE'], ['Options', 'OPTIONS'], ['Head', 'HEAD'],
]);

// Express/Fastify HTTP 메서드 (use 제외 - 미들웨어 마운팅은 라우트가 아님)
const EXPRESS_HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'all']);

// Prisma 읽기/쓰기 메서드
const PRISMA_READ_METHODS = new Set([
    'findMany', 'findUnique', 'findFirst', 'findFirstOrThrow', 'findUniqueOrThrow',
    'aggregate', 'groupBy', 'count',
]);
const PRISMA_WRITE_METHODS = new Set([
    'create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany',
]);

// Prisma 클라이언트로 자주 사용되는 변수명
const PRISMA_VARIABLE_NAMES = new Set(['prisma', 'db', 'prismaClient']);

// Kafka producer 메서드
const KAFKA_PRODUCE_METHODS = new Set(['send', 'sendBatch']);

// 단수형 모델명 → 복수형 테이블명 변환 (sql-ddl-scanner와 동일 로직)
function pluralize(name: string): string {
    const lower = name.toLowerCase();
    if (lower.endsWith('s') || lower.endsWith('x') || lower.endsWith('z') ||
        lower.endsWith('ch') || lower.endsWith('sh')) {
        return `${lower}es`;
    }
    if (lower.endsWith('y') && !/[aeiou]y$/i.test(lower)) {
        return `${lower.slice(0, -1)}ies`;
    }
    return `${lower}s`;
}

// 경로 prefix + suffix 결합 (중복 슬래시 정규화)
function joinPaths(prefix: string, suffix: string): string {
    const p = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
    const s = suffix.startsWith('/') ? suffix : `/${suffix}`;
    return `${p}${s}` || '/';
}

// StringLiteral 또는 정적 TemplateLiteral에서 문자열 추출
function extractStringValue(node: t.Node | null | undefined): string | null {
    if (!node) return null;
    if (t.isStringLiteral(node)) return node.value;
    // 표현식이 없는 순수 정적 템플릿 리터럴만 처리
    if (t.isTemplateLiteral(node) && node.expressions.length === 0 && node.quasis.length === 1) {
        return node.quasis[0]?.value.raw ?? null;
    }
    return null;
}

// 데코레이터 배열에서 특정 이름의 데코레이터 첫 번째 인수 추출
// - 데코레이터 없음: null 반환
// - @Controller() 인수 없음: '' 반환 (루트 경로)
function extractDecoratorFirstArg(decorators: t.Decorator[], name: string): string | null {
    for (const dec of decorators) {
        if (!t.isCallExpression(dec.expression)) continue;
        const callee = dec.expression.callee;
        const decName = t.isIdentifier(callee) ? callee.name
            : t.isMemberExpression(callee) && t.isIdentifier(callee.property) ? callee.property.name
            : null;
        if (decName !== name) continue;
        const firstArg = dec.expression.arguments[0];
        if (!firstArg) return '';
        return extractStringValue(firstArg as t.Node);
    }
    return null;
}

// ObjectExpression에서 특정 키의 값 노드 반환
function getObjectPropValue(obj: t.ObjectExpression, key: string): t.Node | null {
    for (const prop of obj.properties) {
        if (!t.isObjectProperty(prop)) continue;
        const propKey = t.isIdentifier(prop.key) ? prop.key.name
            : t.isStringLiteral(prop.key) ? prop.key.value : null;
        if (propKey === key) return prop.value as t.Node;
    }
    return null;
}

// URL 문자열에서 호스트명 추출
function extractHost(url: string): string | null {
    const match = /https?:\/\/([^/:?#\s]+)/.exec(url);
    return match?.[1] ?? null;
}

// 호스트명 → 서비스명 추론 (Kubernetes 스타일 포함)
function hostToServiceName(host: string): string | null {
    // localhost, IP 주소 제외
    if (host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
    // order-service.default.svc.cluster.local → order-service
    const base = host.split('.')[0] ?? host;
    const name = base.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    return name.length >= 2 ? name : null;
}

export const typescriptScanner: Scanner = {
    id: 'typescript',
    supports: (filePath) => /\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(filePath),

    scan(file: SourceFile, context: ScanContext): ScanResult {
        const objects: DiscoveredObject[] = [];
        const relations: DiscoveredRelation[] = [];

        const serviceUrn = context.currentServiceUrn;
        // 'urn:org:service:service' → 'urn:org:service' (Object URN prefix 추출)
        const urnBase = serviceUrn.replace(/:service$/, '');

        let ast: ReturnType<typeof babelParser.parse>;
        try {
            ast = babelParser.parse(file.content, {
                sourceType: 'unambiguous',
                allowImportExportEverywhere: true,
                allowReturnOutsideFunction: true,
                errorRecovery: true,
                plugins: ['typescript', 'jsx', 'decorators-legacy', 'classProperties'],
            });
        } catch {
            return { objects, relations };
        }

        // NestJS @Controller prefix 스택 (중첩 클래스 대응)
        // null = 비컨트롤러 클래스, string = 컨트롤러 경로 prefix
        const prefixStack: (string | null)[] = [];

        // api_endpoint Object + expose Relation 생성
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
            relations.push({
                subjectUrn: serviceUrn, relationType: 'expose',
                targetUrn: urn, evidence: ev, confidence,
            });
        };

        // topic Object + produce/consume Relation 생성
        const emitTopic = (topicName: string, type: 'produce' | 'consume', line: number) => {
            const topicUrn = `urn:${context.orgName}::topic:${topicName}`;
            const ev = makeEvidenceRecord({
                kind: 'message', file: file.path, line,
                symbol: topicName, detail: `${type} topic: ${topicName}`,
            });
            const confidence = combineConfidence([ev], type);
            // Pass 1에서만 Object 등록 (Pass 2의 knownUrns에 이미 있으면 스킵)
            if (!context.knownUrns.has(topicUrn)) {
                objects.push({
                    urn: topicUrn, objectType: 'topic', name: topicName,
                    granularity: 'ATOMIC',
                    metadata: { source_file: file.path },
                    evidence: ev, confidence: confidence * 0.9,
                });
            }
            relations.push({
                subjectUrn: serviceUrn, relationType: type,
                targetUrn: topicUrn, evidence: ev, confidence,
            });
        };

        // ORM read/write → db_table Relation 생성
        const emitOrm = (modelName: string, type: 'read' | 'write', line: number) => {
            const table = pluralize(modelName);
            const targetUrn = `${urnBase}:db_table:${table}`;
            const ev = makeEvidenceRecord({
                kind: 'query', file: file.path, line,
                symbol: modelName, detail: `${type} via ORM: ${modelName} → db_table:${table}`,
            });
            relations.push({
                subjectUrn: serviceUrn, relationType: type,
                targetUrn, evidence: ev,
                confidence: combineConfidence([ev], type),
            });
        };

        // HTTP call → service Relation 생성 (URL 기반)
        const emitHttpCall = (url: string, line: number) => {
            const host = extractHost(url);
            if (!host) return;
            const serviceName = hostToServiceName(host);
            if (!serviceName) return;
            const targetUrn = `urn:${context.orgName}:${serviceName}:service`;
            if (targetUrn === serviceUrn) return;
            const ev = makeEvidenceRecord({
                kind: 'call', file: file.path, line,
                symbol: url, detail: `HTTP call → ${host}`,
            });
            relations.push({
                subjectUrn: serviceUrn, relationType: 'call',
                targetUrn, evidence: ev,
                // URL 호스트 기반 추론은 낮은 confidence 적용
                confidence: combineConfidence([ev], 'call') * 0.75,
            });
        };

        try {
            traverse(ast, {
                // NestJS @Controller 클래스: prefix 스택에 push
                ClassDeclaration: {
                    enter(p) {
                        prefixStack.push(extractDecoratorFirstArg(p.node.decorators ?? [], 'Controller'));
                    },
                    exit() { prefixStack.pop(); },
                },
                ClassExpression: {
                    enter(p) {
                        prefixStack.push(extractDecoratorFirstArg(p.node.decorators ?? [], 'Controller'));
                    },
                    exit() { prefixStack.pop(); },
                },

                // ClassMethod: NestJS @Get, @Post 등 HTTP 데코레이터 탐지
                ClassMethod(p) {
                    const prefix = prefixStack[prefixStack.length - 1];
                    if (prefix === null) return; // 비컨트롤러 클래스 → 스킵

                    for (const dec of p.node.decorators ?? []) {
                        if (!t.isCallExpression(dec.expression)) continue;
                        const callee = dec.expression.callee;
                        const decName = t.isIdentifier(callee) ? callee.name
                            : t.isMemberExpression(callee) && t.isIdentifier(callee.property)
                                ? callee.property.name : null;

                        const httpMethod = decName ? NESTJS_HTTP_METHODS.get(decName) : undefined;
                        if (!httpMethod) continue;

                        const firstArg = dec.expression.arguments[0];
                        const methodPath = firstArg ? (extractStringValue(firstArg as t.Node) ?? '/') : '/';
                        const fullPath = joinPaths(prefix ?? '', methodPath);
                        emitEndpoint(httpMethod, fullPath, dec.expression.loc?.start.line ?? 0);
                    }
                },

                // CallExpression: Express, Prisma ORM, Kafka, fetch/axios HTTP 클라이언트
                CallExpression(p) {
                    const node = p.node;
                    const callee = node.callee;
                    const line = node.loc?.start.line ?? 0;

                    // fetch('https://...') 직접 호출
                    if (t.isIdentifier(callee) && callee.name === 'fetch') {
                        const url = extractStringValue(node.arguments[0] as t.Node | undefined);
                        if (url) emitHttpCall(url, line);
                        return;
                    }

                    if (!t.isMemberExpression(callee) || !t.isIdentifier(callee.property)) return;
                    const methodName = callee.property.name;

                    // Express/Fastify: app.METHOD('/path', handler)
                    // 조건: 경로가 /로 시작하고 두 번째 인수(핸들러)가 있어야 라우트로 판단
                    if (EXPRESS_HTTP_METHODS.has(methodName)) {
                        const routePath = extractStringValue(node.arguments[0] as t.Node | undefined);
                        if (routePath?.startsWith('/') && node.arguments.length >= 2) {
                            emitEndpoint(methodName.toUpperCase(), routePath, line);
                            return;
                        }
                    }

                    // Prisma: prisma.modelName.readMethod() 또는 writeMethod()
                    if (PRISMA_READ_METHODS.has(methodName) || PRISMA_WRITE_METHODS.has(methodName)) {
                        if (t.isMemberExpression(callee.object) &&
                            t.isIdentifier(callee.object.object) &&
                            PRISMA_VARIABLE_NAMES.has(callee.object.object.name) &&
                            t.isIdentifier(callee.object.property)) {
                            const modelName = callee.object.property.name;
                            emitOrm(modelName, PRISMA_READ_METHODS.has(methodName) ? 'read' : 'write', line);
                            return;
                        }
                    }

                    // Kafka producer.send({ topic: 'name', messages: [...] })
                    if (KAFKA_PRODUCE_METHODS.has(methodName)) {
                        const firstArg = node.arguments[0];
                        if (firstArg && t.isObjectExpression(firstArg)) {
                            const topicNode = getObjectPropValue(firstArg, 'topic');
                            const topicName = topicNode ? extractStringValue(topicNode) : null;
                            if (topicName) emitTopic(topicName, 'produce', line);
                        }
                        return;
                    }

                    // Kafka consumer.subscribe({ topics: ['name'] })
                    if (methodName === 'subscribe') {
                        const firstArg = node.arguments[0];
                        if (firstArg && t.isObjectExpression(firstArg)) {
                            const topicsNode = getObjectPropValue(firstArg, 'topics');
                            if (topicsNode && t.isArrayExpression(topicsNode)) {
                                for (const elem of topicsNode.elements) {
                                    if (!elem) continue;
                                    const topicName = extractStringValue(elem as t.Node);
                                    if (topicName) emitTopic(topicName, 'consume', line);
                                }
                            }
                        }
                        return;
                    }

                    // axios.METHOD('url') 또는 http.METHOD('url')
                    if (t.isIdentifier(callee.object) &&
                        (callee.object.name === 'axios' || callee.object.name === 'http')) {
                        const url = extractStringValue(node.arguments[0] as t.Node | undefined);
                        if (url) emitHttpCall(url, line);
                    }
                },
            });
        } catch {
            // AST 탐색 중 예외 발생 시 이미 수집된 결과 반환
        }

        return { objects, relations };
    },
};
