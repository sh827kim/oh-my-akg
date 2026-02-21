import { getDb } from '../packages/core/src/db';

interface CountRow {
  count: number | string;
}

interface CheckResult {
  key: string;
  description: string;
  value: number;
  severity: 'critical' | 'warning' | 'info';
}

function toNumber(value: number | string): number {
  return typeof value === 'number' ? value : Number(value);
}

async function selectCount(sql: string, params: unknown[] = []): Promise<number> {
  const db = await getDb();
  const result = await db.query<CountRow>(sql, params);
  return toNumber(result.rows[0]?.count ?? 0);
}

async function run() {
  const workspaceId = 'default';

  const checks: CheckResult[] = [
    {
      key: 'objects_total',
      description: 'objects 전체 건수',
      value: await selectCount(
        `SELECT COUNT(*)::int AS count
         FROM objects
         WHERE workspace_id = $1`,
        [workspaceId],
      ),
      severity: 'info',
    },
    {
      key: 'relations_total',
      description: 'object_relations 전체 건수',
      value: await selectCount(
        `SELECT COUNT(*)::int AS count
         FROM object_relations
         WHERE workspace_id = $1`,
        [workspaceId],
      ),
      severity: 'info',
    },
    {
      key: 'orphan_relations',
      description: '고아 relation 건수(subject/target object 누락)',
      value: await selectCount(
        `SELECT COUNT(*)::int AS count
         FROM object_relations r
         LEFT JOIN objects s ON s.id = r.subject_object_id
         LEFT JOIN objects t ON t.id = r.target_object_id
         WHERE r.workspace_id = $1
           AND (s.id IS NULL OR t.id IS NULL)`,
        [workspaceId],
      ),
      severity: 'critical',
    },
    {
      key: 'orphan_object_tags',
      description: '고아 object_tags 건수(object/tag 누락)',
      value: await selectCount(
        `SELECT COUNT(*)::int AS count
         FROM object_tags ot
         LEFT JOIN objects o ON o.id = ot.object_id
         LEFT JOIN tags t ON t.id = ot.tag_id
         WHERE ot.workspace_id = $1
           AND (o.id IS NULL OR t.id IS NULL)`,
        [workspaceId],
      ),
      severity: 'critical',
    },
    {
      key: 'duplicate_service_urn',
      description: 'service URN 중복 건수',
      value: await selectCount(
        `SELECT COUNT(*)::int AS count
         FROM (
           SELECT urn
           FROM objects
           WHERE workspace_id = $1
             AND object_type = 'service'
             AND urn IS NOT NULL
           GROUP BY urn
           HAVING COUNT(*) > 1
         ) dup`,
        [workspaceId],
      ),
      severity: 'critical',
    },
    {
      key: 'service_without_urn',
      description: 'URN 없는 service 건수',
      value: await selectCount(
        `SELECT COUNT(*)::int AS count
         FROM objects
         WHERE workspace_id = $1
           AND object_type = 'service'
           AND urn IS NULL`,
        [workspaceId],
      ),
      severity: 'warning',
    },
    {
      key: 'derived_relation_orphan_parent',
      description: 'derived relation의 부모 relation 누락 건수',
      value: await selectCount(
        `SELECT COUNT(*)::int AS count
         FROM object_relations r
         LEFT JOIN object_relations p ON p.id = r.derived_from_relation_id
         WHERE r.workspace_id = $1
           AND r.derived_from_relation_id IS NOT NULL
           AND p.id IS NULL`,
        [workspaceId],
      ),
      severity: 'critical',
    },
    {
      key: 'deleted_but_visible',
      description: 'status=DELETED인데 visibility=VISIBLE인 service 건수',
      value: await selectCount(
        `SELECT COUNT(*)::int AS count
         FROM objects
         WHERE workspace_id = $1
           AND object_type = 'service'
           AND COALESCE(metadata->>'status', 'ACTIVE') = 'DELETED'
           AND visibility = 'VISIBLE'`,
        [workspaceId],
      ),
      severity: 'warning',
    },
  ];

  console.log('Object Model Integrity Report');
  for (const check of checks) {
    console.log(`- [${check.severity.toUpperCase()}] ${check.key}: ${check.value} (${check.description})`);
  }

  const criticalFailures = checks.filter((item) => item.severity === 'critical' && item.value > 0);
  if (criticalFailures.length > 0) {
    console.error('\nIntegrity check failed due to critical violations.');
    process.exit(1);
  }

  console.log('\nOK: integrity check passed (no critical violations).');
}

run().catch((error) => {
  console.error('Failed to run object model integrity check:', error);
  process.exit(1);
});
