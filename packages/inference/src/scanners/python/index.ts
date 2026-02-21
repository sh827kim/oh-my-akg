// Python 파일에서 api_endpoint, db_table, topic을 추론하는 스캐너
// web-tree-sitter(Python grammar) 기반 AST 파싱 + 정규식 보완
import type { Scanner, ScanResult, ScanContext, SourceFile, DiscoveredObject, DiscoveredRelation } from '../types';
import { makeEvidenceRecord, combineConfidence } from '../../utils';
import { getLoadedParser } from '../../parsers/tree-sitter-loader';
import type Parser from 'web-tree-sitter';

// FastAPI/Flask HTTP 메서드 데코레이터 패턴
// @app.get("/path") → GET:/path
// @router.post("/path") → POST:/path
const ROUTE_DECORATOR_REGEX = /@(?:\w+)\.(?:(get|post|put|patch|delete|options|head))\s*\(\s*["']([^"']+)["']/gi;

// SQLAlchemy 모델 클래스 패턴
// class Order(Base): 또는 class Order(db.Model):
const SA_MODEL_CLASS_REGEX = /^class\s+(\w+)\s*\(\s*(?:\w+\.)?(?:Base|Model|DeclarativeBase)\s*\)/gm;

// SQLAlchemy __tablename__ 추출
const SA_TABLENAME_REGEX = /__tablename__\s*=\s*['"]([^'"]+)['"]/;

// Kafka/Confluent producer 패턴
// producer.produce("topic-name", ...) 또는 producer.send("topic-name", ...)
const KAFKA_PRODUCE_REGEX = /(?:producer|kafka)\s*\.\s*(?:produce|send)\s*\(\s*["']([^"']+)["']/g;

// Kafka consumer subscribe 패턴
// consumer.subscribe(["topic-name"])
const KAFKA_CONSUME_REGEX = /consumer\s*\.\s*subscribe\s*\(\s*\[["']([^"']+)["']/g;

// HTTP 클라이언트 패턴 (requests, httpx)
const HTTP_CLIENT_URL_REGEX = /(?:requests|httpx|client)\s*\.\s*(?:get|post|put|patch|delete)\s*\(\s*f?["']([^"']+)["']/g;

// 단수형 클래스명 → 복수형 테이블명 변환
function pluralize(name: string): string {
    const lower = name.toLowerCase();
    if (lower.endsWith('s') || lower.endsWith('x') || lower.endsWith('z') ||
        lower.endsWith('ch') || lower.endsWith('sh')) return `${lower}es`;
    if (lower.endsWith('y') && !/[aeiou]y$/i.test(lower)) return `${lower.slice(0, -1)}ies`;
    return `${lower}s`;
}

// 호스트명 → 서비스명 추론
function hostToServiceName(url: string): string | null {
    const match = /https?:\/\/([^/:?#\s{]+)/.exec(url);
    if (!match) return null;
    const host = match[1] ?? '';
    // 환경변수 참조 패턴 제외: ${SERVICE_URL}, {SERVICE_URL}
    if (/[{}$]/.test(host)) return null;
    if (host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
    const base = host.split('.')[0] ?? host;
    const name = base.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    return name.length >= 2 ? name : null;
}

// ===== tree-sitter 기반 Python AST 분석 =====

interface RouteInfo {
    method: string;
    path: string;
    line: number;
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

// Python AST에서 FastAPI/Flask 라우트 데코레이터 추출
// decorated_definition → decorator(s) + function_definition
function extractRoutesFromAst(tree: Parser.Tree): RouteInfo[] {
    const routes: RouteInfo[] = [];

    for (const node of walkNodes(tree.rootNode)) {
        if (node.type !== 'decorated_definition') continue;

        // decorated_definition의 decorator 자식 노드들 수집
        for (const child of node.children) {
            if (child.type !== 'decorator') continue;

            // decorator 텍스트에서 HTTP 메서드와 경로 추출
            // @app.get("/path") 또는 @router.post("/path")
            const decText = child.text;
            const match = /\.\s*(get|post|put|patch|delete|options|head)\s*\(\s*["']([^"']+)["']/i.exec(decText);
            if (match) {
                routes.push({
                    method: match[1]?.toUpperCase() ?? 'GET',
                    path: match[2] ?? '/',
                    line: child.startPosition.row + 1,
                });
            }
        }
    }

    return routes;
}

// Python AST에서 SQLAlchemy 모델 클래스 추출
function extractSaModelsFromAst(tree: Parser.Tree, content: string): Array<{ tableName: string; className: string; line: number }> {
    const models: Array<{ tableName: string; className: string; line: number }> = [];

    for (const node of walkNodes(tree.rootNode)) {
        if (node.type !== 'class_definition') continue;

        // 부모 클래스 확인: Base, db.Model, DeclarativeBase
        const argsNode = node.children.find(c => c.type === 'argument_list');
        if (!argsNode) continue;
        const argsText = argsNode.text;
        if (!/(Base|Model|DeclarativeBase)/.test(argsText)) continue;

        const nameNode = node.childForFieldName('name');
        if (!nameNode) continue;
        const className = nameNode.text;

        // __tablename__ 추출 (클래스 body에서)
        const bodyNode = node.childForFieldName('body');
        const bodyText = bodyNode?.text ?? '';
        const tableNameMatch = SA_TABLENAME_REGEX.exec(bodyText);
        const tableName = tableNameMatch?.[1] ?? pluralize(className);

        models.push({
            tableName,
            className,
            line: node.startPosition.row + 1,
        });
    }

    return models;
}

export const pythonScanner: Scanner = {
    id: 'python',
    supports: (filePath) => /\.py$/i.test(filePath),

    scan(file: SourceFile, context: ScanContext): ScanResult {
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

        const emitDbTable = (tableName: string, className: string, line: number) => {
            const urn = `${urnBase}:db_table:${tableName}`;
            const ev = makeEvidenceRecord({
                kind: 'annotation', file: file.path, line,
                symbol: className, detail: `SQLAlchemy model ${className} → db_table:${tableName}`,
            });
            objects.push({
                urn, objectType: 'db_table', name: tableName,
                displayName: className, parentUrn: serviceUrn, granularity: 'ATOMIC',
                metadata: { sa_model: className, source_file: file.path },
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

        // tree-sitter로 AST 파싱 시도
        const parser = getLoadedParser('python');
        if (parser) {
            try {
                const tree = parser.parse(file.content);

                // FastAPI/Flask 라우트 추출
                for (const route of extractRoutesFromAst(tree)) {
                    emitEndpoint(route.method, route.path, route.line);
                }

                // SQLAlchemy 모델 추출
                for (const model of extractSaModelsFromAst(tree, file.content)) {
                    emitDbTable(model.tableName, model.className, model.line);
                }
            } catch {
                // AST 파싱 실패 시 정규식 fallback으로 진행
            }
        }

        // 정규식 기반 fallback (tree-sitter 미초기화 또는 실패 시)
        // AST 결과와 중복될 수 있으나 URN 기반 dedup은 pipeline에서 처리
        if (!parser) {
            const content = file.content;
            for (const m of content.matchAll(ROUTE_DECORATOR_REGEX)) {
                const method = (m[1] ?? 'GET').toUpperCase();
                const path = m[2] ?? '/';
                const line = content.slice(0, m.index).split('\n').length;
                emitEndpoint(method, path, line);
            }

            for (const m of content.matchAll(SA_MODEL_CLASS_REGEX)) {
                const className = m[1] ?? '';
                if (!className) continue;
                const line = content.slice(0, m.index).split('\n').length;
                // 클래스 이후 20줄에서 __tablename__ 탐색
                const classBody = content.slice(m.index ?? 0, (m.index ?? 0) + 800);
                const tableNameMatch = SA_TABLENAME_REGEX.exec(classBody);
                const tableName = tableNameMatch?.[1] ?? pluralize(className);
                emitDbTable(tableName, className, line);
            }
        }

        // Kafka 패턴은 정규식으로 항상 탐지 (tree-sitter와 무관)
        const content = file.content;
        for (const m of content.matchAll(KAFKA_PRODUCE_REGEX)) {
            const topicName = m[1];
            if (topicName) {
                const line = content.slice(0, m.index).split('\n').length;
                emitTopic(topicName, 'produce', line);
            }
        }
        for (const m of content.matchAll(KAFKA_CONSUME_REGEX)) {
            const topicName = m[1];
            if (topicName) {
                const line = content.slice(0, m.index).split('\n').length;
                emitTopic(topicName, 'consume', line);
            }
        }
        for (const m of content.matchAll(HTTP_CLIENT_URL_REGEX)) {
            const url = m[1];
            if (url) {
                const line = content.slice(0, m.index).split('\n').length;
                emitHttpCall(url, line);
            }
        }

        return { objects, relations };
    },
};
