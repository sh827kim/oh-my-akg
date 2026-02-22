/**
 * Audit 테이블 스키마
 * change_logs (Append-only 변경 이력)
 */
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { workspaces } from './core';

// Append-only 변경 이력
export const changeLogs = pgTable(
  'change_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),

    entityType: text('entity_type').notNull(), // OBJECT, RELATION, DOMAIN_AFFINITY
    entityId: uuid('entity_id').notNull(),
    action: text('action').notNull(), // CREATE, UPDATE, DELETE, APPROVE, REJECT

    beforeSnapshot: jsonb('before_snapshot'),
    afterSnapshot: jsonb('after_snapshot'),
    changedBy: text('changed_by'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('ix_changelog_ws_entity').on(table.workspaceId, table.entityType, table.entityId),
    index('ix_changelog_ws_time').on(table.workspaceId, table.createdAt),
  ],
);
