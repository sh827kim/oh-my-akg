/**
 * 설정 파일 기반 Relation 추론 (스텁 - 추후 확장)
 * application.yml, kafka 설정 등에서 신호 추출
 */
import type { DbClient } from '@archi-navi/db';

interface ConfigInferenceOptions {
  workspaceId: string;
  configFilePath: string;
}

/**
 * 설정 파일에서 관계 추론 (추후 구현)
 * 현재는 스텁 구현 - 실제 파싱 로직 추가 예정
 */
export async function inferRelationsFromConfig(
  _db: DbClient,
  _options: ConfigInferenceOptions,
): Promise<{ candidateCount: number }> {
  // TODO: application.yml, docker-compose.yml 등 파싱
  // TODO: spring.datasource.url → DB 연결 관계 추론
  // TODO: spring.kafka.bootstrap-servers → Broker 연결 추론
  return { candidateCount: 0 };
}
