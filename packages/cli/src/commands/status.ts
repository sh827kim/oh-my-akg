import { Command } from 'commander';
import { getDb } from '@archi-navi/core';

export const statusCommand = new Command('status')
  .description('Show current system status')
  .action(async () => {
    console.log('Checking system status...');
    try {
      const db = await getDb();
      const projectCount = await db.query<{ count: number }>(`
        SELECT COUNT(*) as count
        FROM objects
        WHERE workspace_id = 'default'
          AND object_type = 'service'
      `);
      console.log(`Database connected. Projects: ${projectCount.rows[0].count}`);
    } catch (error) {
      console.error('Failed to connect to database:', error);
    }
  });
