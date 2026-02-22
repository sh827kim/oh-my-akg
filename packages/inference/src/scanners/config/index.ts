// 설정 파일(application.yml, .properties, docker-compose, .env)에서
// database, message_broker, cache_instance, service 의존성을 추론하는 스캐너
import type { Scanner, ScanResult, ScanContext, SourceFile, DiscoveredObject, DiscoveredRelation } from '../types';
import { makeEvidenceRecord, combineConfidence } from '../../utils';

// JDBC URL: jdbc:postgresql://hostname:5432/dbname
const JDBC_URL_REGEX = /(?:url|datasource[._]url)\s*[=:]\s*jdbc:(\w+):\/\/([^/:?\s\n${}]+)/gi;

// Kafka bootstrap servers: kafka.bootstrap-servers=kafka-broker:9092
const KAFKA_BOOTSTRAP_REGEX = /(?:bootstrap[._-]servers?|kafka[._-](?:url|host|bootstrap))\s*[=:]\s*([^\n${}]{3,80})/gi;

// Redis: spring.redis.host=redis-master
const REDIS_REGEX = /(?:redis[._-](?:host|url|uri))\s*[=:]\s*([^\n${}]{2,80})/gi;

// MongoDB: spring.data.mongodb.uri=mongodb://host:27017/dbname
const MONGO_REGEX = /mongodb(?:\+srv)?:\/\/([^/:?@\s${}]+)/gi;

// HTTP 서비스 URL: ORDER_SERVICE_URL=http://order-service
const SERVICE_URL_REGEX = /(?:[\w.]+[._-](?:url|host|endpoint|base[._-]url|service[._-]url))\s*[=:]\s*(https?:\/\/[^\n\s${}]+)/gi;

// Spring Cloud service discovery: spring.application.name
const APP_NAME_REGEX = /(?:spring\.application\.name|service\.name|app\.name)\s*[=:]\s*([^\n\s${}]+)/gi;

// 호스트명 → 서비스명 추론
function hostToServiceName(host: string): string | null {
    if (!host || host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
    // kafka:9092 → kafka, redis-master:6379 → redis-master
    const base = host.split(':')[0]?.split('.')[0] ?? host;
    const name = base.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    return name.length >= 2 ? name : null;
}

// JDBC dialect → 데이터베이스 타입
const JDBC_TYPE_MAP: Record<string, string> = {
    postgresql: 'postgresql', mysql: 'mysql', mariadb: 'mariadb',
    oracle: 'oracle', sqlserver: 'sqlserver', h2: 'h2',
};

export const configScanner: Scanner = {
    id: 'config',
    supports: (filePath) => {
        return (
            /application(?:-[^./]+)?\.(?:properties|ya?ml|json)$/i.test(filePath) ||
            /docker-compose(?:-[^./]+)?\.ya?ml$/i.test(filePath) ||
            /^\.env(?:\.\w+)?$/.test(filePath.split('/').pop() ?? '') ||
            /bootstrap\.(?:properties|ya?ml)$/i.test(filePath)
        );
    },

    scan(file: SourceFile, context: ScanContext): ScanResult {
        const objects: DiscoveredObject[] = [];
        const relations: DiscoveredRelation[] = [];

        const serviceUrn = context.currentServiceUrn;
        const urnBase = serviceUrn.replace(/:service$/, '');
        const content = file.content;

        const lineOf = (index: number) => content.slice(0, index).split('\n').length;

        // JDBC URL → database Object + depend_on Relation
        for (const m of content.matchAll(JDBC_URL_REGEX)) {
            const dialect = m[1]?.toLowerCase() ?? 'sql';
            const host = m[2] ?? '';
            const dbType = JDBC_TYPE_MAP[dialect] ?? dialect;
            const line = lineOf(m.index ?? 0);

            // DB name은 URL path에서 추출 (optional)
            const dbNameMatch = /\/([^/?]+)/.exec(content.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 100));
            const dbName = dbNameMatch?.[1] ?? host.replace(/[^a-z0-9-]/gi, '-');

            const dbUrn = `${urnBase}:database:${dbName}`;
            const ev = makeEvidenceRecord({
                kind: 'env', file: file.path, line,
                symbol: host, detail: `JDBC ${dbType} → database:${dbName}`,
            });

            if (!context.knownUrns.has(dbUrn)) {
                objects.push({
                    urn: dbUrn, objectType: 'database', name: dbName,
                    parentUrn: serviceUrn, granularity: 'ATOMIC',
                    metadata: { db_type: dbType, host, source_file: file.path },
                    evidence: ev, confidence: combineConfidence([ev], 'depend_on'),
                });
            }
            relations.push({
                subjectUrn: serviceUrn, relationType: 'depend_on',
                targetUrn: dbUrn, evidence: ev,
                confidence: combineConfidence([ev], 'depend_on'),
            });
        }

        // Kafka bootstrap-servers → message_broker Object + depend_on Relation
        for (const m of content.matchAll(KAFKA_BOOTSTRAP_REGEX)) {
            const raw = (m[1] ?? '').trim();
            // "kafka-broker:9092,kafka-broker2:9092" 에서 첫 번째 호스트 추출
            const firstHost = raw.split(',')[0]?.split(':')[0]?.trim() ?? '';
            const serviceName = hostToServiceName(firstHost) ?? 'kafka';
            const brokerUrn = `urn:${context.orgName}::message_broker:${serviceName}`;
            const line = lineOf(m.index ?? 0);

            const ev = makeEvidenceRecord({
                kind: 'env', file: file.path, line,
                symbol: raw.slice(0, 80), detail: `Kafka bootstrap: ${raw.slice(0, 80)}`,
            });

            if (!context.knownUrns.has(brokerUrn)) {
                objects.push({
                    urn: brokerUrn, objectType: 'message_broker', name: serviceName,
                    granularity: 'ATOMIC',
                    metadata: { bootstrap_servers: raw, source_file: file.path },
                    evidence: ev, confidence: combineConfidence([ev], 'depend_on'),
                });
            }
            relations.push({
                subjectUrn: serviceUrn, relationType: 'depend_on',
                targetUrn: brokerUrn, evidence: ev,
                confidence: combineConfidence([ev], 'depend_on'),
            });
        }

        // Redis → cache_instance Object + depend_on Relation
        for (const m of content.matchAll(REDIS_REGEX)) {
            const raw = (m[1] ?? '').trim();
            const host = raw.replace(/^redis:\/\//, '').split(':')[0]?.trim() ?? raw;
            const cacheName = hostToServiceName(host) ?? 'redis';
            const cacheUrn = `urn:${context.orgName}::cache_instance:${cacheName}`;
            const line = lineOf(m.index ?? 0);

            const ev = makeEvidenceRecord({
                kind: 'env', file: file.path, line,
                symbol: host, detail: `Redis host: ${host}`,
            });

            if (!context.knownUrns.has(cacheUrn)) {
                objects.push({
                    urn: cacheUrn, objectType: 'cache_instance', name: cacheName,
                    granularity: 'ATOMIC',
                    metadata: { host, source_file: file.path },
                    evidence: ev, confidence: combineConfidence([ev], 'depend_on'),
                });
            }
            relations.push({
                subjectUrn: serviceUrn, relationType: 'depend_on',
                targetUrn: cacheUrn, evidence: ev,
                confidence: combineConfidence([ev], 'depend_on'),
            });
        }

        // MongoDB → database Object
        for (const m of content.matchAll(MONGO_REGEX)) {
            const host = m[1] ?? 'mongodb';
            const dbName = hostToServiceName(host) ?? 'mongodb';
            const dbUrn = `${urnBase}:database:${dbName}`;
            const line = lineOf(m.index ?? 0);

            const ev = makeEvidenceRecord({
                kind: 'env', file: file.path, line,
                symbol: host, detail: `MongoDB host: ${host}`,
            });

            if (!context.knownUrns.has(dbUrn)) {
                objects.push({
                    urn: dbUrn, objectType: 'database', name: dbName,
                    parentUrn: serviceUrn, granularity: 'ATOMIC',
                    metadata: { db_type: 'mongodb', host, source_file: file.path },
                    evidence: ev, confidence: combineConfidence([ev], 'depend_on'),
                });
            }
            relations.push({
                subjectUrn: serviceUrn, relationType: 'depend_on',
                targetUrn: dbUrn, evidence: ev,
                confidence: combineConfidence([ev], 'depend_on'),
            });
        }

        // HTTP 서비스 URL → service depend_on Relation
        for (const m of content.matchAll(SERVICE_URL_REGEX)) {
            const url = m[1] ?? '';
            const hostMatch = /https?:\/\/([^/:?#\s${}]+)/.exec(url);
            if (!hostMatch) continue;
            const host = hostMatch[1] ?? '';
            const serviceName = hostToServiceName(host);
            if (!serviceName) continue;

            const targetUrn = `urn:${context.orgName}:${serviceName}:service`;
            if (targetUrn === serviceUrn) continue;

            const line = lineOf(m.index ?? 0);
            const ev = makeEvidenceRecord({
                kind: 'env', file: file.path, line,
                symbol: url.slice(0, 80), detail: `Service URL: ${url.slice(0, 80)}`,
            });
            relations.push({
                subjectUrn: serviceUrn, relationType: 'depend_on',
                targetUrn, evidence: ev,
                // 설정 파일 URL은 중간 confidence (호스트명 기반 추론)
                confidence: combineConfidence([ev], 'depend_on') * 0.85,
            });
        }

        return { objects, relations };
    },
};
