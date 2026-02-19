import { initSchema } from './db';

async function main() {
    try {
        console.log('Initializing database schema...');
        await initSchema();
        console.log('Database schema initialized.');
    } catch (error) {
        console.error('Failed to initialize database:', error);
        process.exit(1);
    }
}

main();
