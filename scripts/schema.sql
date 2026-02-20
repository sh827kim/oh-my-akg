-- ---------------------------------------------------------------------------
-- Archi.Navi Canonical Schema (Object Model First)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS project_types (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  color_hex TEXT NOT NULL DEFAULT '#6b7280',
  sort_order INTEGER NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO project_types (name, color_hex, sort_order, enabled)
VALUES
  ('frontend', '#3b82f6', 10, TRUE),
  ('backend', '#10b981', 20, TRUE),
  ('middleware', '#f59e0b', 30, TRUE),
  ('database', '#ef4444', 40, TRUE),
  ('unknown', '#6b7280', 999, TRUE)
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS tags (
  id SERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  color_hex TEXT NOT NULL DEFAULT '#808080',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS tags_workspace_name_unique_idx
  ON tags (workspace_id, name);

CREATE TABLE IF NOT EXISTS objects (
  id UUID PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  object_type TEXT NOT NULL,
  name TEXT NOT NULL,
  display_name TEXT,
  urn TEXT,
  parent_id UUID REFERENCES objects(id) ON DELETE SET NULL,
  visibility TEXT NOT NULL DEFAULT 'VISIBLE',
  granularity TEXT NOT NULL DEFAULT 'ATOMIC',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT objects_object_type_check CHECK (
    object_type IN (
      'service',
      'api_endpoint',
      'function',
      'database',
      'db_table',
      'db_view',
      'cache_instance',
      'cache_key',
      'message_broker',
      'topic',
      'queue'
    )
  ),
  CONSTRAINT objects_visibility_check CHECK (visibility IN ('VISIBLE', 'HIDDEN')),
  CONSTRAINT objects_granularity_check CHECK (granularity IN ('COMPOUND', 'ATOMIC'))
);

CREATE UNIQUE INDEX IF NOT EXISTS objects_workspace_urn_unique_idx
  ON objects (workspace_id, urn)
  WHERE urn IS NOT NULL;

CREATE INDEX IF NOT EXISTS objects_workspace_type_idx
  ON objects (workspace_id, object_type);
CREATE INDEX IF NOT EXISTS objects_workspace_visibility_idx
  ON objects (workspace_id, visibility);
CREATE INDEX IF NOT EXISTS objects_workspace_parent_idx
  ON objects (workspace_id, parent_id);
CREATE INDEX IF NOT EXISTS objects_workspace_name_idx
  ON objects (workspace_id, name);

CREATE TABLE IF NOT EXISTS object_relations (
  id UUID PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  subject_object_id UUID NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL,
  target_object_id UUID NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  approved BOOLEAN NOT NULL DEFAULT FALSE,
  is_derived BOOLEAN NOT NULL DEFAULT FALSE,
  derived_from_relation_id UUID REFERENCES object_relations(id) ON DELETE SET NULL,
  confidence NUMERIC(4,3),
  source TEXT NOT NULL DEFAULT 'manual',
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT object_relations_relation_type_check CHECK (
    relation_type IN ('call', 'expose', 'read', 'write', 'produce', 'consume', 'depend_on')
  ),
  CONSTRAINT object_relations_source_check CHECK (source IN ('manual', 'scan', 'inference', 'rollup')),
  CONSTRAINT object_relations_unique UNIQUE (
    workspace_id,
    subject_object_id,
    relation_type,
    target_object_id,
    is_derived
  )
);

CREATE INDEX IF NOT EXISTS object_relations_workspace_subject_approved_idx
  ON object_relations (workspace_id, subject_object_id, approved);
CREATE INDEX IF NOT EXISTS object_relations_workspace_target_approved_idx
  ON object_relations (workspace_id, target_object_id, approved);
CREATE INDEX IF NOT EXISTS object_relations_workspace_relation_approved_idx
  ON object_relations (workspace_id, relation_type, approved);
CREATE INDEX IF NOT EXISTS object_relations_workspace_derived_approved_idx
  ON object_relations (workspace_id, is_derived, approved);

CREATE TABLE IF NOT EXISTS object_tags (
  workspace_id TEXT NOT NULL DEFAULT 'default',
  object_id UUID NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (workspace_id, object_id, tag_id)
);

CREATE INDEX IF NOT EXISTS object_tags_workspace_object_idx
  ON object_tags (workspace_id, object_id);
CREATE INDEX IF NOT EXISTS object_tags_workspace_tag_idx
  ON object_tags (workspace_id, tag_id);

CREATE TABLE IF NOT EXISTS change_requests (
  id SERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  request_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  requested_by TEXT,
  reviewed_by TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  CONSTRAINT change_requests_request_type_check CHECK (
    request_type IN ('RELATION_UPSERT', 'RELATION_DELETE', 'OBJECT_PATCH')
  ),
  CONSTRAINT change_requests_status_check CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED'))
);

CREATE INDEX IF NOT EXISTS change_requests_workspace_status_idx
  ON change_requests (workspace_id, status, created_at);
CREATE INDEX IF NOT EXISTS change_requests_workspace_request_type_status_idx
  ON change_requests (workspace_id, request_type, status);

CREATE TABLE IF NOT EXISTS auto_mapping_patterns (
  id SERIAL PRIMARY KEY,
  pattern TEXT NOT NULL,
  target_object_urn TEXT NOT NULL,
  dependency_type TEXT NOT NULL DEFAULT 'depend_on',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (pattern, target_object_urn)
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
