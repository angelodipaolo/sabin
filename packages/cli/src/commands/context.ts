import fs from 'fs/promises';
import chalk from 'chalk';
import { parseTask, pathExists, findPlan, ticketFromBranch } from '@sabin/core';
import { getWorkspace } from '../workspace-context';

interface ContextOptions {
  json?: boolean;
  ticket?: string;
}

/**
 * Report everything about the current workspace.
 *
 * This is the agent's orienting call, so the JSON stays small and flat - a
 * verbose dump gets skimmed and the paths get ignored. It also omits the
 * prompt scratchpad: handing an agent the path to the file it is told to
 * ignore undercuts the whole arrangement. The human-readable form still shows
 * it, since that is for you.
 */
export async function showContext(options: ContextOptions): Promise<void> {
  const { workspace, config } = await getWorkspace(options.ticket);

  const task = workspace.taskFile ? await parseTask(workspace.taskFile) : null;

  // The checked-out branch only counts when it is this ticket's - with an
  // explicit ticket, the current branch may belong to something else
  const onTicketBranch = workspace.branch !== null && ticketFromBranch(workspace.branch, config) === workspace.ticket;
  const branch = task?.branch ?? (onTicketBranch ? workspace.branch : null);
  const notes = await listNotes(workspace.notesDir);
  const worktreeExists = await pathExists(workspace.worktreeDir);
  const plan = await findPlan(workspace.notesDir);

  if (options.json) {
    console.log(JSON.stringify({
      ticket: workspace.ticket,
      name: workspace.name,
      slug: workspace.slug,
      title: task?.title ?? null,
      status: task?.status ?? null,
      branch,
      worktree: worktreeExists ? workspace.worktreeDir : null,
      sabinDir: workspace.sabinDir,
      notesDir: workspace.notesDir,
      taskFile: workspace.taskFile,
      plan,
      notes
    }, null, 2));
    return;
  }

  console.log(`\n${chalk.bold(workspace.name)}${task ? ` ${chalk.gray('·')} ${task.title}` : ''}`);
  if (task) console.log(`  ${chalk.gray('Status:')}   ${task.status}`);
  console.log(`  ${chalk.gray('Branch:')}   ${branch ?? chalk.yellow('(none yet)')}`);
  console.log(`  ${chalk.gray('Worktree:')} ${worktreeExists ? workspace.worktreeDir : chalk.yellow('(not created)')}`);
  console.log(`  ${chalk.gray('Task:')}     ${workspace.taskFile ?? chalk.yellow('(no task file)')}`);
  console.log(`  ${chalk.gray('Notes:')}    ${chalk.cyan(workspace.notesDir)}`);
  console.log(`  ${chalk.gray('Plan:')}     ${plan ?? chalk.yellow('(none)')}`);
  console.log(`  ${chalk.gray('Prompt:')}   ${workspace.promptFile}`);

  if (notes.length > 0) {
    console.log(`\n  ${chalk.gray('Notes files:')}`);
    for (const note of notes) console.log(`    ${note}`);
  }
  console.log();
}

/**
 * Notes are any context the agent might read - JSON, YAML, CSV, logs - so
 * nothing is filtered by extension. Directories carry a trailing slash.
 */
async function listNotes(notesDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(notesDir, { withFileTypes: true });
    return entries
      .filter(entry => !entry.name.startsWith('.'))
      .map(entry => entry.isDirectory() ? `${entry.name}/` : entry.name)
      .sort();
  } catch {
    return [];
  }
}


