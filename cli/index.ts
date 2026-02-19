import { Command } from 'commander';
import { syncCommand } from './commands/sync';
import { statusCommand } from './commands/status';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env.local or .env
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const program = new Command();

program
    .name('akg-cli')
    .description('CLI for Module Health Radar + Architecture Knowledge Graph')
    .version('0.1.0');

program.addCommand(syncCommand);
program.addCommand(statusCommand);

program.parse(process.argv);
