/**
 * 아키텍처 레이어 스키마
 * architecture_layers: 계층 정의 (Presentation, Application, Domain, Infrastructure 등)
 * object_layer_assignments: Object → Layer 배치 (Compound 단위)
 */
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { workspaces } from './core';
import { objects } from './core';

/** 아키텍처 계층 정의 */
export const architectureLayers = pgTable(
  'architecture_layers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    displayName: text('display_name'),
    color: text('color'),            // hex "#8b5cf6"
    sortOrder: integer('sort_order').notNull().default(0),
    isEnabled: boolean('is_enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('uq_layers_ws_name').on(table.workspaceId, table.name),
    index('ix_layers_ws_sort').on(table.workspaceId, table.sortOrder),
  ],
);

/** Object → Layer 배치 (하나의 Object는 하나의 Layer에만 속함) */
export const objectLayerAssignments = pgTable(
  'object_layer_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    objectId: uuid('object_id')
      .notNull()
      .references(() => objects.id, { onDelete: 'cascade' }),
    layerId: uuid('layer_id')
      .notNull()
      .references(() => architectureLayers.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('uq_layer_assign').on(table.workspaceId, table.objectId),
    index('ix_layer_assign_layer').on(table.layerId),
  ],
);
