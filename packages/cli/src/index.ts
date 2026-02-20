import { Command } from 'commander';
import { syncCommand } from './commands/sync';
import { statusCommand } from './commands/status';
import { approvalsCommand } from './commands/approvals';
import { upCommand } from './commands/up';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const program = new Command();

program
  .name('archi-navi')
  .description('CLI for Archi.Navi')
  .version('0.1.0');

program.addCommand(syncCommand);
program.addCommand(statusCommand);
program.addCommand(approvalsCommand);
program.addCommand(upCommand);

program.parse(process.argv);
