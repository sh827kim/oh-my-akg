export * from './env-auto-mapping';
export * from './plugins';

export interface InferenceCandidate {
  subjectObjectId: string;
  relationType: string;
  targetObjectId: string;
  confidence: number;
  evidence: string[];
}
