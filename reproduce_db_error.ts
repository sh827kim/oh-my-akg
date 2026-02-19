
import { getDb } from './lib/db.js';

async function main() {
    console.log('Starting reproduction script...');
    try {
        const db = await getDb();
        console.log('DB initialized successfully');
    } catch (error) {
        console.error('DB initialization failed:', error);
    }
}

main();
