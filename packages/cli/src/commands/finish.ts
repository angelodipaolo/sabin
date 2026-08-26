import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import {
  parseTask,
  writeTask,
  removeWorktree,
  listWorktrees,
  repoRoot,
  withLock
} from '@sabin/core';
import { getWorkspace, fail } from '../workspace-context';

interface FinishOptions {
  keepWorktree?: boolean;
  json?: boolean;
}

/**
 * Mark a ticket completed and tear down its worktree
 */
export async function finishTask(ticketArg: string | undefined, options: FinishOptions): Promise<void> {
  const { workspace } = await getWorkspace(ticketArg);

  if (!workspace.taskFile) {
    fail(`No task file found for ${workspace.ticket}`);
  }

  const task = await parseTask(workspace.taskFile);
  const worktreeDir = task.worktree ?? workspace.worktreeDir;

  let removed = false;
  let warning: string | null = null;

  if (!options.keepWorktree && workspace.mainRoot && await exists(worktreeDir)) {
    const here = await repoRoot(process.cwd());
    if (here && path.resolve(here) === path.resolve(worktreeDir)) {
      warning = `Still standing in ${worktreeDir}. Leaving it in place - cd out and rerun, or remove it manually.`;
    } else {
      const known = (await listWorktrees(workspace.mainRoot))
        .some(wt => path.resolve(wt.path) === path.resolve(worktreeDir));
      if (known) {
        try {
          await removeWorktree(workspace.mainRoot, worktreeDir);
          removed = true;
        } catch (error: any) {
          warning = `Could not remove worktree: ${error.message.trim()}`;
        }
      }
    }
  }

  // Status change moves the file, so recompute the path afterwards
  const completedDir = path.join(workspace.sabinDir, 'tasks', 'completed');
  const finalPath = path.join(completedDir, path.basename(workspace.taskFile));

  await withLock(workspace.sabinDir, async () => {
    const current = await parseTask(workspace.taskFile!);
    current.status = 'completed';
    current.path = finalPath;
    await fs.mkdir(completedDir, { recursive: true });
    await writeTask(current);
    if (path.resolve(workspace.taskFile!) !== path.resolve(finalPath)) {
      await fs.unlink(workspace.taskFile!);
    }
  });

  if (options.json) {
    console.log(JSON.stringify({
      ticket: workspace.ticket,
      status: 'completed',
      taskFile: finalPath,
      worktreeRemoved: removed,
      notesDir: workspace.notesDir,
      warning
    }, null, 2));
    return;
  }

  console.log(chalk.green(`\n${workspace.ticket} completed`));
  console.log(`  ${chalk.gray('Task:')}  ${finalPath}`);
  console.log(`  ${chalk.gray('Notes:')} ${chalk.cyan(workspace.notesDir)} ${chalk.gray('(kept)')}`);
  if (removed) console.log(`  ${chalk.gray('Worktree removed:')} ${worktreeDir}`);
  if (warning) console.log(chalk.yellow(`  ${warning}`));
  console.log();
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
