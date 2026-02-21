import { PGlite } from '@electric-sql/pglite';
import path from 'path';
import fs from 'fs';

const globalForDb = globalThis as unknown as {
  dbInstance: PGlite | undefined;
};

const PGliteWithAssets = PGlite as unknown as new (
  dataDir: string,
  options: {
    wasmModule: WebAssembly.Module;
    fsBundle: Blob;
  },
) => PGlite;

const LEGACY_TABLE_PATTERNS: ReadonlyArray<{ table: string; regex: RegExp }> = [
  { table: 'projects', regex: /\b(?:from|join|update|into|delete\s+from)\s+projects\b/i },
  { table: 'edges', regex: /\b(?:from|join|update|into|delete\s+from)\s+edges\b/i },
  { table: 'project_tags', regex: /\b(?:from|join|update|into|delete\s+from)\s+project_tags\b/i },
];

function assertNoLegacyTableAccess(sql: string): void {
  const matches = LEGACY_TABLE_PATTERNS
    .filter(({ regex }) => regex.test(sql))
    .map(({ table }) => table);

  if (matches.length === 0) return;

  const message = `[DB] Legacy table access detected (${matches.join(', ')}). Use objects/object_relations/object_tags only.`;
  throw new Error(message);
}

function withLegacyTableGuard(db: PGlite): PGlite {
  const guarded = db as PGlite & { __legacyGuardInstalled?: boolean };

  if (guarded.__legacyGuardInstalled) {
    return db;
  }

  const rawQuery = (db as any).query.bind(db);
  const rawExec = (db as any).exec.bind(db);

  (db as any).query = async (...args: any[]) => {
    assertNoLegacyTableAccess(String(args[0] ?? ''));
    return rawQuery(...args);
  };

  (db as any).exec = async (...args: any[]) => {
    assertNoLegacyTableAccess(String(args[0] ?? ''));
    return rawExec(...args);
  };

  guarded.__legacyGuardInstalled = true;
  return db;
}

function resolveWorkspaceRoot(startDir: string): string {
  let current = startDir;

  while (true) {
    const workspaceFile = path.join(current, 'pnpm-workspace.yaml');
    const schemaFile = path.join(current, 'scripts', 'schema.sql');
    if (fs.existsSync(workspaceFile) && fs.existsSync(schemaFile)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return startDir;
    }
    current = parent;
  }
}

function resolveDbDataDir(): string {
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());
  const configured = process.env.ARCHI_NAVI_DB_PATH || process.env.AKG_DB_PATH;
  if (configured && configured.trim().length > 0) {
    return path.isAbsolute(configured)
      ? configured
      : path.join(workspaceRoot, configured);
  }

  return path.join(workspaceRoot, 'data', 'akg-db');
}

export const getDb = async () => {
  if (globalForDb.dbInstance) {
    return globalForDb.dbInstance;
  }

  const dataDir = resolveDbDataDir();
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());

  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const wasmPath = path.join(workspaceRoot, 'node_modules/@electric-sql/pglite/dist/pglite.wasm');
    const dataBundlePath = path.join(workspaceRoot, 'node_modules/@electric-sql/pglite/dist/pglite.data');

    if (!fs.existsSync(wasmPath)) {
      console.warn(`[DB] WASM not found at ${wasmPath}`);
    }
    if (!fs.existsSync(dataBundlePath)) {
      console.warn(`[DB] Data Bundle not found at ${dataBundlePath}`);
    }

    const wasmBuffer = fs.readFileSync(wasmPath);
    const wasmModule = await WebAssembly.compile(wasmBuffer);

    const dataBundleBuffer = fs.readFileSync(dataBundlePath);
    const dataBundleBlob = new Blob([dataBundleBuffer]);

    console.log(`[DB] Initializing PGlite at ${dataDir} (Manual Load)...`);

    const db = new PGliteWithAssets(dataDir, {
      wasmModule: wasmModule,
      fsBundle: dataBundleBlob,
    });

    await db.waitReady;
    console.log('[DB] PGlite Ready');

    try {
      const schemaPath = path.join(workspaceRoot, 'scripts', 'schema.sql');
      if (fs.existsSync(schemaPath)) {
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');
        await db.exec(schemaSql);
        console.log('[DB] Schema verified/applied automatically.');
      } else {
        console.warn('[DB] Schema file not found, tables might be missing.');
      }
    } catch (schemaErr) {
      console.error('[DB] Schema application failed (non-fatal if tables exist):', schemaErr);
    }

    if (process.env.NODE_ENV !== 'production') {
      globalForDb.dbInstance = db;
    }

    return withLegacyTableGuard(db);
  } catch (error) {
    console.error('[DB] Failed to initialize PGlite with filesystem:', error);
    console.warn('[DB] Falling back to IN-MEMORY mode.');

    const wasmPath = path.join(workspaceRoot, 'node_modules/@electric-sql/pglite/dist/pglite.wasm');
    const dataBundlePath = path.join(workspaceRoot, 'node_modules/@electric-sql/pglite/dist/pglite.data');
    const wasmBuffer = fs.readFileSync(wasmPath);
    const wasmModule = await WebAssembly.compile(wasmBuffer);
    const dataBundleBuffer = fs.readFileSync(dataBundlePath);
    const dataBundleBlob = new Blob([dataBundleBuffer]);

    const memDb = new PGliteWithAssets('memory://', {
      wasmModule: wasmModule,
      fsBundle: dataBundleBlob,
    });
    await memDb.waitReady;

    const schemaPath = path.join(workspaceRoot, 'scripts', 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');
      await memDb.exec(schemaSql);
    }

    if (process.env.NODE_ENV !== 'production') {
      globalForDb.dbInstance = memDb;
    }

    return withLegacyTableGuard(memDb);
  }
};

export const initSchema = async () => {
  await getDb();
};
