import { Command } from 'commander';
import { spawn } from 'node:child_process';
import path from 'node:path';

function getWorkspaceRoot(): string {
  return path.resolve(__dirname, '../../../../');
}

function getWebRoot(): string {
  return path.join(getWorkspaceRoot(), 'apps', 'web');
}

function resolveNextBin(): string {
  const workspaceRoot = getWorkspaceRoot();
  return require.resolve('next/dist/bin/next', { paths: [workspaceRoot] });
}

function runNext(args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  const webRoot = getWebRoot();
  const nextBin = resolveNextBin();

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [nextBin, ...args], {
      cwd: webRoot,
      stdio: 'inherit',
      env,
    });

    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 0));
  });
}

export const upCommand = new Command('up')
  .description('Run Archi.Navi web UI')
  .option('--host <host>', 'Host for web server', '127.0.0.1')
  .option('--port <port>', 'Port for web server', '3000')
  .option('--db-path <path>', 'Database path (ARCHI_NAVI_DB_PATH)')
  .option('--prod', 'Run production mode (build + start)', false)
  .action(async (options) => {
    const host = String(options.host || '127.0.0.1');
    const port = Number(options.port || 3000);

    if (!Number.isFinite(port) || port <= 0 || port > 65535) {
      console.error('Invalid --port value');
      process.exit(1);
    }

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOSTNAME: host,
      PORT: String(port),
      ARCHI_NAVI_DB_PATH: options.dbPath || process.env.ARCHI_NAVI_DB_PATH || process.env.AKG_DB_PATH,
      AKG_DB_PATH: options.dbPath || process.env.AKG_DB_PATH || process.env.ARCHI_NAVI_DB_PATH,
    };

    const mode = options.prod ? 'production' : 'development';
    console.log(`Starting Archi.Navi web UI (${mode})`);
    console.log(`URL: http://${host}:${port}`);
    if (env.ARCHI_NAVI_DB_PATH) {
      console.log(`DB Path: ${env.ARCHI_NAVI_DB_PATH}`);
    }

    if (options.prod) {
      const buildCode = await runNext(['build', '--webpack'], env);
      if (buildCode !== 0) {
        process.exit(buildCode);
      }
      const startCode = await runNext(['start', '--hostname', host, '--port', String(port)], env);
      process.exit(startCode);
    }

    const devCode = await runNext(['dev', '--hostname', host, '--port', String(port)], env);
    process.exit(devCode);
  });
