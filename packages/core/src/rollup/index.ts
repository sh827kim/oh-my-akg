/**
 * Rollup Engine - Materialized Roll-up 계산 및 Generation 관리
 * 원자 관계(object_relations)로부터 상위 레벨 의존성을 계산해 저장
 */
export { rebuildRollups } from './builder';
export { getActiveGeneration } from './generationManager';
