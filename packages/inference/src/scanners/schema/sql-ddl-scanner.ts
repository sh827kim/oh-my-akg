// SQL DDL 파일에서 db_table Object와 FK 관계를 추론하는 스캐너
// node-sql-parser를 사용해 실제 파싱 수행
import { Parser } from 'node-sql-parser';
import type { Scanner, ScanResult, ScanContext, SourceFile, DiscoveredObject, DiscoveredRelation } from '../types';
import { makeEvidenceRecord, combineConfidence, deriveReviewLane } from '../../utils';

// FK 접미사 패턴 (PRD 7.5 기준)
const FK_SUFFIX_PATTERNS = ['_id', '_no', '_uid', '_key', '_code'];
const FK_SUFFIX_REGEX = new RegExp(`(${FK_SUFFIX_PATTERNS.join('|')})$`, 'i');

// 감사성 컬럼 제외 (PRD 7.5 기준)
const EXCLUDED_COLUMNS = new Set([
    'created_by', 'updated_by', 'deleted_by',
    'created_at', 'updated_at', 'deleted_at',
]);

// DDL 구문에서 column의 FK 참조 테이블명 추출
function extractFkTableFromSuffix(columnName: string): string | null {
    if (EXCLUDED_COLUMNS.has(columnName.toLowerCase())) return null;
    if (!FK_SUFFIX_REGEX.test(columnName)) return null;
    // user_id → users, order_no → orders (복수형 추론)
    const baseName = columnName.toLowerCase().replace(FK_SUFFIX_REGEX, '');
    if (!baseName || baseName.length < 2) return null;
    return baseName;
}

// 테이블명에서 복수형 추론
function toTableName(baseName: string): string {
    if (baseName.endsWith('s')) return baseName;
    if (baseName.endsWith('x') || baseName.endsWith('z') || baseName.endsWith('ch') || baseName.endsWith('sh')) {
        return `${baseName}es`;
    }
    if (baseName.endsWith('y') && !/[aeiou]y$/.test(baseName)) {
        return `${baseName.slice(0, -1)}ies`;
    }
    return `${baseName}s`;
}

interface ColumnDef {
    column?: { column?: string };
    definition?: { dataType?: string };
    constraint_type?: string;
    reference_definition?: {
        table?: Array<{ table?: string }>;
    };
}

interface CreateTableAst {
    type: string;
    keyword?: string;
    table?: Array<{ table?: string; db?: string }>;
    create_definitions?: ColumnDef[];
}

const sqlParser = new Parser();

export const sqlDdlScanner: Scanner = {
    id: 'sql-ddl',
    supports: (filePath) => /\.sql$/i.test(filePath),

    scan(file: SourceFile, context: ScanContext): ScanResult {
        const objects: DiscoveredObject[] = [];
        const relations: DiscoveredRelation[] = [];

        let statements: CreateTableAst[];
        try {
            const result = sqlParser.astify(file.content, { database: 'PostgreSQL' });
            statements = (Array.isArray(result) ? result : [result]) as CreateTableAst[];
        } catch {
            // 파싱 실패 시 빈 결과
            return { objects, relations };
        }

        for (const stmt of statements) {
            if (stmt.type !== 'create' || stmt.keyword !== 'table') continue;
            const tableEntry = stmt.table?.[0];
            if (!tableEntry?.table) continue;

            const tableName = tableEntry.table.toLowerCase();
            const tableUrn = `${context.currentServiceUrn.replace(':service', '')}:db_table:${tableName}`;
            const parentUrn = context.currentServiceUrn;

            // db_table Object 생성
            const tableEvidence = makeEvidenceRecord({
                kind: 'query',
                file: file.path,
                symbol: tableName,
                detail: `CREATE TABLE ${tableName}`,
            });

            objects.push({
                urn: tableUrn,
                objectType: 'db_table',
                name: tableName,
                parentUrn,
                granularity: 'ATOMIC',
                metadata: { source_file: file.path },
                evidence: tableEvidence,
                confidence: combineConfidence([tableEvidence], 'depend_on'),
            });

            // 컬럼 정의에서 FK 관계 추론
            for (const colDef of stmt.create_definitions ?? []) {
                // 명시적 FOREIGN KEY 제약
                if (colDef.constraint_type === 'FOREIGN KEY' && colDef.reference_definition?.table?.[0]?.table) {
                    const refTable = colDef.reference_definition.table[0].table.toLowerCase();
                    const refUrn = tableUrn.replace(`:db_table:${tableName}`, `:db_table:${refTable}`);
                    const fkEvidence = makeEvidenceRecord({
                        kind: 'query',
                        file: file.path,
                        symbol: `${tableName} -> ${refTable}`,
                        detail: `FOREIGN KEY REFERENCES ${refTable}`,
                    });
                    relations.push({
                        subjectUrn: tableUrn,
                        relationType: 'depend_on',
                        targetUrn: refUrn,
                        evidence: fkEvidence,
                        confidence: combineConfidence([fkEvidence], 'depend_on'),
                    });
                    // 참조되는 테이블도 Object로 등록 (다른 서비스일 수 있음)
                    if (!context.knownUrns.has(refUrn)) {
                        const refEvidence = makeEvidenceRecord({
                            kind: 'query',
                            file: file.path,
                            symbol: refTable,
                            detail: `Referenced by ${tableName}`,
                        });
                        objects.push({
                            urn: refUrn,
                            objectType: 'db_table',
                            name: refTable,
                            parentUrn,
                            granularity: 'ATOMIC',
                            metadata: { inferred_from_fk: true },
                            evidence: refEvidence,
                            confidence: combineConfidence([refEvidence], 'depend_on') * 0.7, // FK 추론이므로 낮음
                        });
                    }
                    continue;
                }

                // 컬럼명 접미사 패턴으로 암묵적 FK 추론
                const colName = colDef.column?.column?.toLowerCase();
                if (!colName) continue;
                const baseName = extractFkTableFromSuffix(colName);
                if (!baseName) continue;

                const inferredTable = toTableName(baseName);
                const inferredUrn = tableUrn.replace(`:db_table:${tableName}`, `:db_table:${inferredTable}`);
                if (inferredUrn === tableUrn) continue; // 자기 참조 방지

                const suffixEvidence = makeEvidenceRecord({
                    kind: 'value',
                    file: file.path,
                    symbol: colName,
                    detail: `Column suffix pattern: ${colName} → ${inferredTable}`,
                });
                // 접미사 패턴 추론은 낮은 confidence
                const confidence = combineConfidence([suffixEvidence], 'depend_on') * 0.65;
                relations.push({
                    subjectUrn: tableUrn,
                    relationType: 'depend_on',
                    targetUrn: inferredUrn,
                    evidence: suffixEvidence,
                    confidence,
                });
            }
        }

        return { objects, relations };
    },
};
