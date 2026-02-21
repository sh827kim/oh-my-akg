import { spawnSync } from 'node:child_process';

const result = spawnSync(
  'rg',
  [
    '-n',
    '--pcre2',
    '(?i)(from|join|update|into|delete\\s+from)\\s+(projects|edges|project_tags)\\b',
    'apps',
    'packages',
    'scripts',
    '--glob',
    '!**/*.md',
    '--glob',
    '!**/node_modules/**',
    '--glob',
    '!packages/core/src/db.ts',
    '--glob',
    '!scripts/check-no-legacy-table-usage.ts',
  ],
  { encoding: 'utf8' },
);

if (result.status === 1) {
  console.log('OK: no direct SQL access to legacy tables (projects/edges/project_tags).');
  process.exit(0);
}

if (result.status === 0) {
  console.error('Legacy SQL table usage detected. Migrate these queries to object model tables:');
  console.error(result.stdout.trim());
  process.exit(1);
}

console.error('Failed to run legacy table scan.');
if (result.stderr) {
  console.error(result.stderr.trim());
}
process.exit(result.status ?? 1);
