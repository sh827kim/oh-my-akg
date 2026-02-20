import { PGlite } from '@electric-sql/pglite';
import path from 'path';
import fs from 'fs';

// Add global type definition to avoid TS errors
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

export const getDb = async () => {
  // 1. Return existing instance if available (Singleton for Dev Mode)
  if (globalForDb.dbInstance) {
    return globalForDb.dbInstance;
  }

  const dataDir = path.join(process.cwd(), 'data', 'akg-db');

  try {
    // Ensure data directory exists
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // 2. Manual Load WASM & Data Bundle (Most robust for Next.js)
    const wasmPath = path.join(process.cwd(), 'node_modules/@electric-sql/pglite/dist/pglite.wasm');
    const dataBundlePath = path.join(process.cwd(), 'node_modules/@electric-sql/pglite/dist/pglite.data');

    // Check if assets exist
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

    // 3. Wait for Ready
    await db.waitReady;
    console.log('[DB] PGlite Ready');

    // 4. Initialize Schema Automatically
    try {
      const schemaPath = path.join(process.cwd(), 'scripts', 'schema.sql');
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

    // 5. Store in Global for Singleton
    if (process.env.NODE_ENV !== 'production') {
      globalForDb.dbInstance = db;
    }

    return db;
  } catch (error) {
    console.error('[DB] Failed to initialize PGlite with filesystem:', error);

    // Fallback: In-Memory
    console.warn('[DB] Falling back to IN-MEMORY mode.');
    try {
      const wasmPath = path.join(process.cwd(), 'node_modules/@electric-sql/pglite/dist/pglite.wasm');
      const dataBundlePath = path.join(process.cwd(), 'node_modules/@electric-sql/pglite/dist/pglite.data');
      const wasmBuffer = fs.readFileSync(wasmPath);
      const wasmModule = await WebAssembly.compile(wasmBuffer);
      const dataBundleBuffer = fs.readFileSync(dataBundlePath);
      const dataBundleBlob = new Blob([dataBundleBuffer]);

      const memDb = new PGliteWithAssets('memory://', {
        wasmModule: wasmModule,
        fsBundle: dataBundleBlob,
      });
      await memDb.waitReady;

      // Also apply schema to memory DB
      const schemaPath = path.join(process.cwd(), 'scripts', 'schema.sql');
      if (fs.existsSync(schemaPath)) {
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');
        await memDb.exec(schemaSql);
      }

      if (process.env.NODE_ENV !== 'production') {
        globalForDb.dbInstance = memDb;
      }
      return memDb;
    } catch (e) {
      console.error('[DB] Fallback failed:', e);
      throw e;
    }
  }
};

export const initSchema = async () => {
  // This function is kept for backward compatibility but getDb does it automatically now
  await getDb();
};
