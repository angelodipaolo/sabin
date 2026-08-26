import chalk from 'chalk';
import { Workspace } from '@sabin/core';
import { ensureWorkspace } from '../workspace-start';

interface StartOptions {
  json?: boolean;
  noWorktree?: boolean;
  title?: string;
}

export async function startTask(ticketArg: string, options: StartOptions): Promise<void> {
  const started = await ensureWorkspace(ticketArg, {
    title: options.title,
    noWorktree: options.noWorktree,
    createTask: true
  });

  report(
    { ...started.workspace, branch: started.branch },
    started.worktreeDir,
    started.created,
    options.json === true
  );
}

function report(
  workspace: Workspace & { branch: string },
  worktreeDir: string | null,
  created: string[],
  json: boolean
): void {
  if (json) {
    console.log(JSON.stringify({
      ticket: workspace.ticket,
      name: workspace.name,
      slug: workspace.slug,
      branch: workspace.branch,
      worktree: worktreeDir,
      notesDir: workspace.notesDir,
      promptFile: workspace.promptFile,
      taskFile: workspace.taskFile,
      created
    }, null, 2));
    return;
  }

  const mark = (target: string) => created.includes(target) ? chalk.green('created') : chalk.gray('exists ');

  console.log(`\n${chalk.bold(workspace.name)} ${chalk.gray('·')} in_progress`);
  console.log(`  ${chalk.gray('Branch:')}   ${workspace.branch}`);
  if (worktreeDir) console.log(`  ${mark(worktreeDir)} ${worktreeDir}`);
  console.log(`  ${mark(workspace.notesDir)} ${chalk.cyan(workspace.notesDir)}`);
  console.log(`  ${mark(workspace.promptFile)} ${workspace.promptFile}`);
  console.log();
}
