/**
 * Code 분석 테이블 스키마
 * code_artifacts, code_import_edges, code_call_edges
 */
import { index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { workspaces, objects } from './core';
import { evidences } from './evidence';

// 코드 파일/모듈 메타 (AST 분석 대상)
export const codeArtifacts = pgTable(
  'code_artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),

    language: text('language').notNull(), // java, kotlin, typescript, javascript, python
    repoRoot: text('repo_root'), // 로컬 경로 또는 workspace 상대 경로
    filePath: text('file_path').notNull(), // 상대 경로
    packageName: text('package_name'), // Java/Kotlin 패키지명
    moduleName: text('module_name'), // 모노레포 패키지명 등

    ownerObjectId: uuid('owner_object_id').references(() => objects.id, {
      onDelete: 'set null',
    }), // 보통 service 또는 function
    sha256: text('sha256'), // 파일 해시 (변경 감지용)

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('uq_code_artifacts_ws_path').on(table.workspaceId, table.filePath),
    index('ix_code_artifacts_ws_owner').on(table.workspaceId, table.ownerObjectId),
    index('ix_code_artifacts_ws_lang').on(table.workspaceId, table.language),
  ],
);

// Import 그래프 (어떤 모듈/패키지를 참조하는지)
export const codeImportEdges = pgTable(
  'code_import_edges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),

    fromArtifactId: uuid('from_artifact_id')
      .notNull()
      .references(() => codeArtifacts.id, { onDelete: 'cascade' }),

    toModule: text('to_module'), // import 대상 모듈명
    toArtifactId: uuid('to_artifact_id').references(() => codeArtifacts.id, {
      onDelete: 'set null',
    }),

    weight: integer('weight').notNull().default(1),
    evidenceId: uuid('evidence_id').references(() => evidences.id, { onDelete: 'set null' }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('ix_import_edges_ws_from').on(table.workspaceId, table.fromArtifactId),
    index('ix_import_edges_ws_to').on(table.workspaceId, table.toArtifactId),
  ],
);

// Call 그래프 (어떤 심볼을 호출하는지)
export const codeCallEdges = pgTable(
  'code_call_edges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),

    callerArtifactId: uuid('caller_artifact_id')
      .notNull()
      .references(() => codeArtifacts.id, { onDelete: 'cascade' }),
    calleeSymbol: text('callee_symbol').notNull(), // 호출 대상 심볼명
    calleeOwnerObjectId: uuid('callee_owner_object_id').references(() => objects.id, {
      onDelete: 'set null',
    }),

    weight: integer('weight').notNull().default(1),
    evidenceId: uuid('evidence_id').references(() => evidences.id, { onDelete: 'set null' }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('ix_call_edges_ws_caller').on(table.workspaceId, table.callerArtifactId),
    index('ix_call_edges_ws_callee').on(table.workspaceId, table.calleeOwnerObjectId),
  ],
);
