export * from './env-auto-mapping';
export * from './plugins';

import type { AstRelationType, EvidenceRecord, ReviewLane } from './plugins/types';

export interface InferenceCandidate {
  subjectObjectId: string;
  relationType: AstRelationType;
  targetObjectId: string;
  confidence: number;
  evidence: string;
  evidences: EvidenceRecord[];
  scoreVersion: string;
  reviewLane: ReviewLane;
  tags: string[];
}
