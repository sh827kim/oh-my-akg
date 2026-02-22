// Pass 1 결과물(DiscoveredObject[])을 URN 기준으로 정규화/중복 제거하는 리졸버
import type { DiscoveredObject, DiscoveredRelation } from '../scanners/types';
import { clampConfidence } from '../utils';

// URN → 가장 높은 confidence의 Object 유지 (동일 URN 중복 제거)
export function buildObjectRegistry(objects: DiscoveredObject[]): Map<string, DiscoveredObject> {
    const registry = new Map<string, DiscoveredObject>();

    for (const obj of objects) {
        if (!obj.urn) continue;
        const existing = registry.get(obj.urn);
        if (!existing || obj.confidence > existing.confidence) {
            registry.set(obj.urn, obj);
        }
    }

    return registry;
}

// Relation 중복 제거: (subjectUrn, relationType, targetUrn) 동일 시 confidence 합산
export function deduplicateRelations(relations: DiscoveredRelation[]): DiscoveredRelation[] {
    const seen = new Map<string, DiscoveredRelation>();

    for (const rel of relations) {
        const key = `${rel.subjectUrn}|${rel.relationType}|${rel.targetUrn}`;
        const existing = seen.get(key);

        if (!existing) {
            seen.set(key, { ...rel });
            continue;
        }

        // 동일 관계 재발견 시 confidence 증가 (최대 1.0)
        existing.confidence = clampConfidence(
            existing.confidence + rel.confidence * 0.15,
        );
        // 더 신뢰도 높은 evidence로 교체
        if (rel.confidence > existing.confidence) {
            existing.evidence = rel.evidence;
        }
    }

    return [...seen.values()];
}

// Pass 2 완료 후 자기 참조 관계 및 미등록 대상 URN 관계 필터링
export function filterRelations(
    relations: DiscoveredRelation[],
    knownUrns: Set<string>,
    filterUnknownTargets: boolean,
): DiscoveredRelation[] {
    return relations.filter(rel => {
        // 자기 자신으로의 관계 제외
        if (rel.subjectUrn === rel.targetUrn) return false;
        // 대상 URN이 knownUrns에 없는 경우 필터링 (선택적)
        if (filterUnknownTargets && !knownUrns.has(rel.targetUrn)) return false;
        return true;
    });
}
