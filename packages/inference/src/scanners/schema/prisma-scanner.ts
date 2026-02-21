// schema.prisma 파일에서 db_table Object와 FK 관계를 추론하는 스캐너
// 외부 파서 없이 정규식 기반으로 Prisma SDL 파싱 수행
import type { Scanner, ScanResult, ScanContext, SourceFile, DiscoveredObject, DiscoveredRelation } from '../types';
import { makeEvidenceRecord, combineConfidence } from '../../utils';

// Prisma 스칼라 타입 (FK 추론 시 제외)
const PRISMA_SCALAR_TYPES = new Set([
    'String', 'Boolean', 'Int', 'BigInt', 'Float', 'Decimal',
    'DateTime', 'Json', 'Bytes', 'Unsupported',
]);

// 감사성 필드 제외 (sql-ddl-scanner와 동일 기준)
const EXCLUDED_FIELDS = new Set([
    'createdAt', 'updatedAt', 'deletedAt',
    'createdBy', 'updatedBy', 'deletedBy',
    'created_at', 'updated_at', 'deleted_at',
    'created_by', 'updated_by', 'deleted_by',
]);

// 단수형 모델명 → 복수형 테이블명 변환
function toTableName(name: string): string {
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

// @@map("actual_table_name") 추출
function extractMapDirective(modelBody: string): string | null {
    const match = /@@map\(\s*["']([^"']+)["']\s*\)/.exec(modelBody);
    return match?.[1] ?? null;
}

// @relation 어노테이션이 있는 필드에서 참조 모델 추출
// 예: orders  Order[] 또는 user  User @relation(fields: [userId], references: [id])
function extractRelationFields(modelBody: string): Array<{ fieldName: string; refModel: string; line: number }> {
    const relations: Array<{ fieldName: string; refModel: string; line: number }> = [];
    const lines = modelBody.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        // @relation 어노테이션이 있는 필드
        const relMatch = /^\s*(\w+)\s+(\w+)(?:\[\])?\s+(?:@relation|@db\.)?.*@relation/.exec(line);
        if (relMatch) {
            const refModel = relMatch[2];
            if (refModel && !PRISMA_SCALAR_TYPES.has(refModel)) {
                relations.push({ fieldName: relMatch[1] ?? '', refModel, line: i + 1 });
            }
            continue;
        }
        // 모델 타입 참조 필드 (Scalar가 아닌 타입, @relation 없어도 관계 필드)
        // 예: user  User  (단수, 직접 참조)
        const refFieldMatch = /^\s*(\w+)\s+([A-Z]\w+)(?!\??\s*\[)(\?)?\s*$/.exec(line);
        if (refFieldMatch) {
            const refModel = refFieldMatch[2];
            if (refModel && !PRISMA_SCALAR_TYPES.has(refModel)) {
                relations.push({ fieldName: refFieldMatch[1] ?? '', refModel, line: i + 1 });
            }
        }
    }
    return relations;
}

// _id, _no 접미사 패턴으로 암묵적 FK 추론 (sql-ddl-scanner PRD 7.5 기준과 동일)
const FK_SUFFIX_REGEX = /(_id|_no|_uid|_key|_code)$/i;

function extractImplicitFkTarget(fieldName: string): string | null {
    if (EXCLUDED_FIELDS.has(fieldName)) return null;
    const snakeField = fieldName.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
    if (!FK_SUFFIX_REGEX.test(snakeField)) return null;
    const baseName = snakeField.replace(FK_SUFFIX_REGEX, '');
    if (!baseName || baseName.length < 2) return null;
    return baseName;
}

export const prismaScanner: Scanner = {
    id: 'prisma',
    supports: (filePath) => /schema\.prisma$/i.test(filePath),

    scan(file: SourceFile, context: ScanContext): ScanResult {
        const objects: DiscoveredObject[] = [];
        const relations: DiscoveredRelation[] = [];

        const serviceUrn = context.currentServiceUrn;
        const urnBase = serviceUrn.replace(/:service$/, '');

        // model 블록 파싱: model ModelName { ... }
        const modelBlockRegex = /^model\s+(\w+)\s*\{([^}]*)\}/gms;
        let match: RegExpExecArray | null;

        while ((match = modelBlockRegex.exec(file.content)) !== null) {
            const modelName = match[1];
            if (!modelName) continue;
            const modelBody = match[2] ?? '';

            // @@map이 있으면 실제 테이블명, 없으면 소문자 변환
            const mappedTable = extractMapDirective(modelBody);
            const tableName = mappedTable ?? toTableName(modelName);

            const tableUrn = `${urnBase}:db_table:${tableName}`;
            const startLine = file.content.slice(0, match.index).split('\n').length;

            const tableEvidence = makeEvidenceRecord({
                kind: 'annotation',
                file: file.path,
                line: startLine,
                symbol: modelName,
                detail: `Prisma model ${modelName} → db_table:${tableName}`,
            });

            objects.push({
                urn: tableUrn,
                objectType: 'db_table',
                name: tableName,
                displayName: modelName,
                parentUrn: serviceUrn,
                granularity: 'ATOMIC',
                metadata: { prisma_model: modelName, source_file: file.path },
                evidence: tableEvidence,
                confidence: combineConfidence([tableEvidence], 'depend_on'),
            });

            // @relation 어노테이션 기반 FK 관계 추론
            const relationFields = extractRelationFields(modelBody);
            for (const rel of relationFields) {
                if (!rel.refModel || PRISMA_SCALAR_TYPES.has(rel.refModel)) continue;
                const refTable = toTableName(rel.refModel);
                const refUrn = `${urnBase}:db_table:${refTable}`;
                if (refUrn === tableUrn) continue; // 자기 참조 방지

                const relEvidence = makeEvidenceRecord({
                    kind: 'annotation',
                    file: file.path,
                    line: startLine + rel.line,
                    symbol: `${modelName}.${rel.fieldName}`,
                    detail: `@relation → ${rel.refModel} (db_table:${refTable})`,
                });
                relations.push({
                    subjectUrn: tableUrn,
                    relationType: 'depend_on',
                    targetUrn: refUrn,
                    evidence: relEvidence,
                    confidence: combineConfidence([relEvidence], 'depend_on'),
                });
            }

            // 필드명 접미사 패턴으로 암묵적 FK 추론 (낮은 confidence)
            const fieldLineRegex = /^\s*(\w+)\s+/gm;
            let fieldMatch: RegExpExecArray | null;
            while ((fieldMatch = fieldLineRegex.exec(modelBody)) !== null) {
                const fieldName = fieldMatch[1];
                if (!fieldName) continue;
                const baseName = extractImplicitFkTarget(fieldName);
                if (!baseName) continue;

                const inferredTable = toTableName(baseName);
                const inferredUrn = `${urnBase}:db_table:${inferredTable}`;
                if (inferredUrn === tableUrn) continue;

                const suffixEvidence = makeEvidenceRecord({
                    kind: 'value',
                    file: file.path,
                    line: startLine,
                    symbol: fieldName,
                    detail: `Field suffix pattern: ${fieldName} → db_table:${inferredTable}`,
                });
                relations.push({
                    subjectUrn: tableUrn,
                    relationType: 'depend_on',
                    targetUrn: inferredUrn,
                    evidence: suffixEvidence,
                    confidence: combineConfidence([suffixEvidence], 'depend_on') * 0.65,
                });
            }
        }

        return { objects, relations };
    },
};
