import { spawnSync } from 'node:child_process';

const result = spawnSync('npx', ['ts-node', '-P', 'tsconfig.scripts.json', 'scripts/init-db.ts'], {
    stdio: 'inherit',
});

if (result.status !== 0) {
    process.exit(result.status ?? 1);
}
