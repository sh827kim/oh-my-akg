import { PGlite } from '@electric-sql/pglite';
import path from 'path';
import fs from 'fs';

let dbInstance: PGlite | null = null;

export const getDb = async () => {
  if (dbInstance) {
    return dbInstance;
  }

  const dataDir = path.join(process.cwd(), 'data', 'pglite');

  // Ensure data directory exists
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Initialize PGlite with local file persistence
  dbInstance = await PGlite.create({
    dataDir: dataDir,
  });

  // Enable vector extension if not enabled (Checking is complex, just try creating extension)
  try {
    await dbInstance.exec('CREATE EXTENSION IF NOT EXISTS vector;');
  } catch (e) {
    console.warn('Failed to create vector extension, it might be unavailable in this build:', e);
  }

  return dbInstance;
};

export const initSchema = async () => {
  const db = await getDb();
  const schemaPath = path.join(__dirname, 'schema.sql');

  if (fs.existsSync(schemaPath)) {
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    try {
      await db.exec(schemaSql);
      console.log('Schema initialized successfully.');
    } catch (e) {
      console.error('Failed to initialize schema:', e);
      throw e;
    }
  } else {
    console.warn('schema.sql not found at', schemaPath);
  }
};
