import { Command } from 'commander';
import { getDb } from '@archi-navi/core';
import {
  applyBulkChangeRequests,
  listChangeRequests,
  listPendingIds,
  type ChangeRequestStatus,
} from '@archi-navi/core';

function parseIdList(raw: string | undefined): number[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

export const approvalsCommand = new Command('approvals')
  .description('List and process approval queue')
  .addCommand(
    new Command('list')
      .description('List change requests')
      .option('--status <status>', 'PENDING|APPROVED|REJECTED', 'PENDING')
      .option('--limit <limit>', 'max rows', '100')
      .option('-w, --workspace <workspaceId>', 'workspace id (default: default)')
      .action(async (options) => {
        const db = await getDb();
        const status = (options.status || 'PENDING').toUpperCase() as ChangeRequestStatus;
        const limit = Number(options.limit || '100');
        const workspaceId = typeof options.workspace === 'string' ? options.workspace : undefined;
        const rows = await listChangeRequests(db, status, Number.isFinite(limit) ? limit : 100, { workspaceId });

        if (rows.length === 0) {
          console.log('No change requests found.');
          return;
        }

        for (const row of rows) {
          console.log(`#${row.id} ${row.status} ${row.request_type} by=${row.requested_by ?? '-'} payload=${JSON.stringify(row.payload)}`);
        }
      })
  )
  .addCommand(
    new Command('apply')
      .description('Bulk approve/reject selected requests')
      .option('--status <status>', 'APPROVED|REJECTED', 'APPROVED')
      .option('--ids <ids>', 'comma-separated request ids, e.g. 1,2,3')
      .option('--all', 'target all pending requests', false)
      .option('--exclude <ids>', 'exclude ids when used with --all')
      .option('--reviewed-by <actor>', 'review actor for audit fields', 'cli')
      .option('--dry-run', 'preview only, do not apply', false)
      .option('-w, --workspace <workspaceId>', 'workspace id (default: default)')
      .action(async (options) => {
        const db = await getDb();
        const nextStatus = (options.status || 'APPROVED').toUpperCase() as 'APPROVED' | 'REJECTED';
        const reviewedBy = typeof options.reviewedBy === 'string' ? options.reviewedBy : 'cli';
        if (!['APPROVED', 'REJECTED'].includes(nextStatus)) {
          console.error('status must be APPROVED or REJECTED');
          process.exit(1);
        }

        const workspaceId = typeof options.workspace === 'string' ? options.workspace : undefined;

        let ids = parseIdList(options.ids);
        if (options.all) {
          const exclude = parseIdList(options.exclude);
          ids = await listPendingIds(db, exclude, { workspaceId });
        }

        if (ids.length === 0) {
          if (options.all) {
            console.log('No pending change requests to process.');
            return;
          }
          console.error('No target ids. Use --ids or --all.');
          process.exit(1);
        }

        if (options.dryRun) {
          console.log(`[DRY-RUN] action=${nextStatus} target_count=${ids.length} ids=${ids.join(',')}`);
          return;
        }

        const summary = await applyBulkChangeRequests(db, ids, nextStatus, { reviewedBy, workspaceId });
        console.log(`Processed=${summary.processed} Succeeded=${summary.succeeded} Failed=${summary.failed.length}`);
        for (const fail of summary.failed) {
          console.log(`  - id=${fail.id} reason=${fail.reason}`);
        }
      })
  );
