/**
 * rebuild-rollup 커맨드
 * Roll-up 집계 테이블을 재계산합니다
 * 사용법: archi-navi rebuild-rollup --workspace <id>
 */
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { getDb } from '@archi-navi/db';
import { rebuildRollups } from '@archi-navi/core';

export function createRebuildRollupCommand(): Command {
  return new Command('rebuild-rollup')
    .description('Roll-up 집계 테이블을 재계산합니다')
    .requiredOption('-w, --workspace <id>', '워크스페이스 ID')
    .option('--profile <id>', '워크스페이스 프로필 ID')
    .action(async (options: {
      workspace: string;
      profile?: string;
    }) => {
      const spinner = ora('Roll-up 재계산 중...').start();

      try {
        const db = await getDb();

        const newVersion = await rebuildRollups(db, options.workspace);

        spinner.succeed(chalk.green('Roll-up 재계산 완료'));
        console.log(chalk.dim(`  새 Generation: ${newVersion}`));
        console.log(
          chalk.dim(
            `  레벨: SERVICE_TO_SERVICE, SERVICE_TO_DATABASE, SERVICE_TO_BROKER, DOMAIN_TO_DOMAIN`,
          ),
        );
      } catch (error) {
        spinner.fail(chalk.red('Roll-up 재계산 실패'));
        console.error(error);
        process.exit(1);
      }
    });
}
