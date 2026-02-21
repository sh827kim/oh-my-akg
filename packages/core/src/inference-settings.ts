export interface WorkspaceInferenceSettings {
  workspaceId: string;
  astPluginsEnabled: boolean;
  shadowModeEnabled: boolean;
  fallbackEnabled: boolean;
}

export interface InferenceRunMetricsInput {
  workspaceId: string;
  mode: 'full' | 'fallback' | 'disabled';
  shadowMode: boolean;
  astPluginsEnabled: boolean;
  fallbackEnabled: boolean;
  repoCount: number;
  configFilesScanned: number;
  sourceFilesScanned: number;
  candidateCount: number;
  lowConfidenceCount: number;
  avgConfidence: number;
  failures: number;
  durationMs: number;
  throughputPerSec: number;
}

interface DbLike {
  query: <T = unknown>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    if (['true', 't', '1', 'yes', 'y', 'on'].includes(lower)) return true;
    if (['false', 'f', '0', 'no', 'n', 'off'].includes(lower)) return false;
  }
  return fallback;
}

function normalizeWorkspaceId(workspaceId?: string | null): string {
  const value = (workspaceId || '').trim();
  return value.length > 0 ? value : 'default';
}

export async function getWorkspaceInferenceSettings(
  db: DbLike,
  workspaceId?: string | null,
): Promise<WorkspaceInferenceSettings> {
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  await db.query(
    `INSERT INTO workspace_inference_settings
     (workspace_id, ast_plugins_enabled, shadow_mode_enabled, fallback_enabled)
     VALUES ($1, TRUE, FALSE, TRUE)
     ON CONFLICT (workspace_id) DO NOTHING`,
    [normalizedWorkspaceId],
  );

  const result = await db.query<{
    workspace_id: string;
    ast_plugins_enabled: unknown;
    shadow_mode_enabled: unknown;
    fallback_enabled: unknown;
  }>(
    `SELECT workspace_id, ast_plugins_enabled, shadow_mode_enabled, fallback_enabled
     FROM workspace_inference_settings
     WHERE workspace_id = $1
     LIMIT 1`,
    [normalizedWorkspaceId],
  );

  const row = result.rows[0];
  return {
    workspaceId: normalizedWorkspaceId,
    astPluginsEnabled: toBoolean(row?.ast_plugins_enabled, true),
    shadowModeEnabled: toBoolean(row?.shadow_mode_enabled, false),
    fallbackEnabled: toBoolean(row?.fallback_enabled, true),
  };
}

export async function recordInferenceRunMetrics(
  db: DbLike,
  input: InferenceRunMetricsInput,
): Promise<void> {
  await db.query(
    `INSERT INTO inference_run_metrics
     (workspace_id, mode, shadow_mode, ast_plugins_enabled, fallback_enabled,
      repo_count, config_files_scanned, source_files_scanned,
      candidate_count, low_confidence_count, avg_confidence,
      failures, duration_ms, throughput_per_sec)
     VALUES
     ($1, $2, $3, $4, $5,
      $6, $7, $8,
      $9, $10, $11,
      $12, $13, $14)`,
    [
      normalizeWorkspaceId(input.workspaceId),
      input.mode,
      input.shadowMode,
      input.astPluginsEnabled,
      input.fallbackEnabled,
      input.repoCount,
      input.configFilesScanned,
      input.sourceFilesScanned,
      input.candidateCount,
      input.lowConfidenceCount,
      Number(input.avgConfidence.toFixed(3)),
      input.failures,
      input.durationMs,
      Number(input.throughputPerSec.toFixed(3)),
    ],
  );
}

