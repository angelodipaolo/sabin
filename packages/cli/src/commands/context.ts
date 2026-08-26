import fs from 'fs/promises';
import chalk from 'chalk';
import { parseTask } from '@sabin/core';
import { getWorkspace } from '../workspace-context';

interface ContextOptions {
  json?: boolean;
  ticket?: string;
}

/**
 * Report everything about the current workspace.
 *
 * This is the agent's orienting call, so the JSON stays small and flat -
 * a verbose dump gets skimmed and the paths get ignored.
 */
export async function showContext(options: ContextOptions): Promise<void> {
  const { workspace } = await getWorkspace(options.ticket);

  const task = workspace.taskFile ? await parseTask(workspace.taskFile) : null;
  const notes = await listNotes(workspace.notesDir);
  const worktreeExists = await exists(workspace.worktreeDir);

  if (options.json) {
    console.log(JSON.stringify({
      ticket: workspace.ticket,
      name: workspace.name,
      slug: workspace.slug,
      title: task?.title ?? null,
      status: task?.status ?? null,
      branch: workspace.branch,
      worktree: worktreeExists ? workspace.worktreeDir : null,
      sabinDir: workspace.sabinDir,
      notesDir: workspace.notesDir,
      promptFile: workspace.promptFile,
      taskFile: workspace.taskFile,
      notes
    }, null, 2));
    return;
  }

  console.log(`\n${chalk.bold(workspace.name)}${task ? ` ${chalk.gray('·')} ${task.title}` : ''}`);
  if (task) console.log(`  ${chalk.gray('Status:')}   ${task.status}`);
  console.log(`  ${chalk.gray('Branch:')}   ${workspace.branch ?? chalk.yellow('(detached)')}`);
  console.log(`  ${chalk.gray('Worktree:')} ${worktreeExists ? workspace.worktreeDir : chalk.yellow('(not created)')}`);
  console.log(`  ${chalk.gray('Task:')}     ${workspace.taskFile ?? chalk.yellow('(no task file)')}`);
  console.log(`  ${chalk.gray('Notes:')}    ${chalk.cyan(workspace.notesDir)}`);
  console.log(`  ${chalk.gray('Prompt:')}   ${workspace.promptFile}`);

  if (notes.length > 0) {
    console.log(`\n  ${chalk.gray('Notes files:')}`);
    for (const note of notes) console.log(`    ${note}`);
  }
  console.log();
}

async function listNotes(notesDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(notesDir, { withFileTypes: true });
    return entries.filter(e => e.isFile() && !e.name.startsWith('.')).map(e => e.name).sort();
  } catch {
    return [];
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

