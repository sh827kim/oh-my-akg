/**
 * Track A: Seed 기반 Domain 추론
 * 신호(Code/DB/Message)를 조합하여 도메인 Affinity 분포를 계산하고
 * domain_candidates에 PENDING 상태로 저장
 */
import { eq, and } from 'drizzle-orm';
import type { DbClient } from '@archi-navi/db';
import { domainCandidates, domainInferenceProfiles, objects } from '@archi-navi/db';
import { normalizeAffinity, calculatePurity, getPrimaryDomain, getSecondaryDomains, generateId } from '@archi-navi/shared';

interface SeedInferenceOptions {
  workspaceId: string;
  profileId?: string;
}

/**
 * Seed 기반 도메인 추론 실행
 * 1. 설정 프로필 조회
 * 2. 도메인 seed 목록 조회
 * 3. 서비스별 신호 계산
 * 4. Affinity 정규화 + domain_candidates 저장
 */
export async function runSeedBasedInference(
  db: DbClient,
  options: SeedInferenceOptions,
): Promise<{ candidateCount: number }> {
  const { workspaceId, profileId } = options;

  // 프로필 조회 (없으면 기본값 사용)
  let profile = profileId
    ? await db
        .select()
        .from(domainInferenceProfiles)
        .where(
          and(
            eq(domainInferenceProfiles.id, profileId),
            eq(domainInferenceProfiles.workspaceId, workspaceId),
          ),
        )
        .limit(1)
        .then((r: { id: string; wCode: number | null; wDb: number | null; wMsg: number | null; secondaryThreshold: number | null }[]) => r[0])
    : null;

  const weights = {
    code: profile?.wCode ?? 0.5,
    db: profile?.wDb ?? 0.3,
    msg: profile?.wMsg ?? 0.2,
    secondaryThreshold: profile?.secondaryThreshold ?? 0.25,
  };

  // 워크스페이스의 domain objects (Seed) 조회
  const domains = await db
    .select({ id: objects.id, name: objects.name })
    .from(objects)
    .where(
      and(eq(objects.workspaceId, workspaceId), eq(objects.objectType, 'domain')),
    );

  if (domains.length === 0) return { candidateCount: 0 };

  // 서비스 목록 조회
  const services = await db
    .select({ id: objects.id, name: objects.name, metadata: objects.metadata })
    .from(objects)
    .where(
      and(eq(objects.workspaceId, workspaceId), eq(objects.objectType, 'service')),
    );

  let candidateCount = 0;

  for (const service of services) {
    // 신호 계산 (각 도메인에 대한 점수)
    const rawScores: Record<string, number> = {};

    for (const domain of domains) {
      // Code 신호: 서비스 이름에 도메인 키워드가 포함되는지 (휴리스틱)
      const codeScore = service.name.toLowerCase().includes(domain.name.toLowerCase())
        ? Math.min(0.3, weights.code) // heuristic_domain_cap 적용
        : 0;

      // DB/Message 신호: 추후 확장 (현재는 0)
      const dbScore = 0;
      const msgScore = 0;

      const totalScore =
        weights.code * codeScore + weights.db * dbScore + weights.msg * msgScore;

      if (totalScore > 0) {
        rawScores[domain.id] = totalScore;
      }
    }

    if (Object.keys(rawScores).length === 0) continue;

    // Affinity 정규화
    const affinity = normalizeAffinity(rawScores);
    const purity = calculatePurity(affinity);
    const primaryDomainId = getPrimaryDomain(affinity);
    const secondaryDomainIds = getSecondaryDomains(affinity, weights.secondaryThreshold);

    // domain_candidates에 저장
    await db.insert(domainCandidates).values({
      id: generateId(),
      workspaceId,
      objectId: service.id,
      affinityMap: affinity,
      purity,
      primaryDomainId: primaryDomainId ?? undefined,
      secondaryDomainIds,
      signals: { code: rawScores },
      status: 'PENDING',
    });

    candidateCount++;
  }

  return { candidateCount };
}
