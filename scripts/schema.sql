-- Enable pgvector extension
-- CREATE EXTENSION IF NOT EXISTS vector;

-- Projects Table
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, -- owner/repo_name
  repo_name TEXT NOT NULL,
  repo_url TEXT NOT NULL,
  type TEXT NOT NULL, -- 'backend', 'frontend', 'library', 'unknown'
  visibility TEXT NOT NULL DEFAULT 'VISIBLE', -- 'VISIBLE', 'HIDDEN'
  alias TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'ARCHIVED', 'DELETED'
  last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Configurable Project Types (used for project classification + architecture layers)
CREATE TABLE IF NOT EXISTS project_types (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL, -- e.g. frontend, backend, middleware
  color_hex TEXT NOT NULL DEFAULT '#6b7280',
  sort_order INTEGER NOT NULL DEFAULT 0, -- bottom-up order
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO project_types (name, color_hex, sort_order, enabled)
VALUES
  ('frontend', '#3b82f6', 10, TRUE),
  ('backend', '#10b981', 20, TRUE),
  ('middleware', '#f59e0b', 30, TRUE),
  ('database', '#ef4444', 40, TRUE),
  ('unknown', '#6b7280', 999, TRUE)
ON CONFLICT (name) DO NOTHING;

-- Tags Table
CREATE TABLE IF NOT EXISTS tags (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  color_hex TEXT NOT NULL DEFAULT '#808080'
);

-- Project Tags Junction Table
CREATE TABLE IF NOT EXISTS project_tags (
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, tag_id)
);

-- Middlewares Table (Kafka, DB, etc.)
CREATE TABLE IF NOT EXISTS middlewares (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL, -- e.g., 'kafka-main', 'postgres-core'
  type TEXT NOT NULL, -- 'kafka', 'database', 'redis', 'elasticsearch', 'other'
  description TEXT
);

-- Edges Table (Dependency Graph)
CREATE TABLE IF NOT EXISTS edges (
  id SERIAL PRIMARY KEY,
  from_id TEXT NOT NULL, -- project_id or middleware_name (if we treat MW as nodes in same ID space, might need adjustments. For now, let's assume from_id is always project_id or we use a unified node table. Simplest: from_id REFERENCES projects(id))
  to_id TEXT NOT NULL, -- project_id or middleware_name (polymorphic relationship is hard in SQL. Let's make edges strictly Project->Project and use a separate table for Project->MW)
  type TEXT NOT NULL, -- 'API', 'LIBRARY', 'RPC'
  filled_manually BOOLEAN DEFAULT FALSE,
  approved BOOLEAN DEFAULT FALSE,
  evidence TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Project <-> Middleware Dependencies
CREATE TABLE IF NOT EXISTS project_middlewares (
  id SERIAL PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  middleware_id INTEGER REFERENCES middlewares(id) ON DELETE CASCADE,
  usage_type TEXT, -- 'producer', 'consumer', 'read', 'write'
  approved BOOLEAN DEFAULT FALSE,
  evidence TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Kafka Topics Table
CREATE TABLE IF NOT EXISTS kafka_topics (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);

-- Project <-> Kafka Topic (Produce/Consume)
CREATE TABLE IF NOT EXISTS project_topics (
  id SERIAL PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  topic_id INTEGER REFERENCES kafka_topics(id) ON DELETE CASCADE,
  role TEXT NOT NULL, -- 'PRODUCER', 'CONSUMER'
  approved BOOLEAN DEFAULT FALSE,
  evidence TEXT
);

-- Embeddings for RAG
-- CREATE TABLE IF NOT EXISTS embeddings (
--   id SERIAL PRIMARY KEY,
--   entity_type TEXT NOT NULL, -- 'project', 'topic', 'middleware'
--   entity_id TEXT NOT NULL,
--   content TEXT NOT NULL,
--   embedding vector(1536), -- OpenAI embedding size
--   created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
-- );

-- Change Requests queue for Approval
CREATE TABLE IF NOT EXISTS change_requests (
  id SERIAL PRIMARY KEY,
  project_id TEXT,
  change_type TEXT NOT NULL, -- 'NEW_DEPENDENCY', 'NEW_PROJECT', 'TAG_CHANGE'
  payload JSONB NOT NULL,
  status TEXT DEFAULT 'PENDING', -- 'PENDING', 'APPROVED', 'REJECTED'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS auto_mapping_patterns (
  id SERIAL PRIMARY KEY,
  pattern TEXT NOT NULL,
  target_project_id TEXT NOT NULL,
  dependency_type TEXT NOT NULL DEFAULT 'unknown',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (pattern, target_project_id)
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM schema_migrations
    WHERE id = '2026-02-20-backfill-edge-approvals'
  ) THEN
    UPDATE edges
    SET approved = TRUE
    WHERE approved = FALSE;

    INSERT INTO schema_migrations (id)
    VALUES ('2026-02-20-backfill-edge-approvals');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS edges_unique_triplet_idx
  ON edges (from_id, to_id, type);
