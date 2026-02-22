/**
 * Evidence 테이블 스키마
 * evidences, relation_evidences, relation_candidate_evidences
 */
import { index, jsonb, pgTable, text, timestamp, uuid, integer } from 'drizzle-orm/pg-core';
import { workspaces } from './core';
import { objectRelations, relationCandidates } from './core';

// 근거 원본 (코드 위치, URI 등)
export const evidences = pgTable('evidences', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),

  evidenceType: text('evidence_type').notNull(), // FILE, CONFIG, API_SPEC, SCHEMA, MANUAL
  filePath: text('file_path'),
  lineStart: integer('line_start'),
  lineEnd: integer('line_end'),
  excerpt: text('excerpt'), // 근거 발췌문
  uri: text('uri'), // 외부 참조 URI

  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// 확정 관계 - 근거 연결 (N:M)
export const relationEvidences = pgTable(
  'relation_evidences',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    relationId: uuid('relation_id')
      .notNull()
      .references(() => objectRelations.id, { onDelete: 'cascade' }),
    evidenceId: uuid('evidence_id')
      .notNull()
      .references(() => evidences.id, { onDelete: 'cascade' }),
  },
  (table) => [
    {
      pk: { columns: [table.workspaceId, table.relationId, table.evidenceId] },
    },
    index('ix_rel_ev_relation').on(table.workspaceId, table.relationId),
  ],
);

// 추론 후보 - 근거 연결 (N:M)
export const relationCandidateEvidences = pgTable(
  'relation_candidate_evidences',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    candidateId: uuid('candidate_id')
      .notNull()
      .references(() => relationCandidates.id, { onDelete: 'cascade' }),
    evidenceId: uuid('evidence_id')
      .notNull()
      .references(() => evidences.id, { onDelete: 'cascade' }),
  },
  (table) => [
    {
      pk: { columns: [table.workspaceId, table.candidateId, table.evidenceId] },
    },
  ],
);
