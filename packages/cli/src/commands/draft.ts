import chalk from 'chalk';
import {
  parseTask,
  readConfig,
  resolveSabinDir,
  resolveWorkspace,
  workspacePaths,
  parseTicketArg,
  slugify
} from '@sabin/core';
import { fail } from '../workspace-context';
import { ensureWorkspaceFiles, createTaskFile } from '../workspace-scaffold';
import { launchEditor } from '../editor';

interface DraftOptions {
  title?: string;
  open?: boolean;
  editor?: string;
  json?: boolean;
}

/**
 * Prepare a ticket's notes directory and prompt scratchpad, without starting
 * work on it.
 *
 * The scratchpad is where a task gets thought through, which happens before
 * there is anything to check out - so this touches neither status nor the
 * worktree. `sabin start` does those when the thinking is done.
 */
export async function draft(ticketArg: string | undefined, options: DraftOptions): Promise<void> {
  const { sabinDir } = await resolveSabinDir();
  const config = await readConfig(sabinDir);

  const parsed = ticketArg ? parseTicketArg(ticketArg) : null;
  if (ticketArg && !parsed) {
    fail(
      `"${ticketArg}" is not a ticket.\n` +
      `Expected something like SABIN-0004 or JIRA-12345-update-telemetry.`
    );
  }

  const workspace = await resolveWorkspace({
    sabinDir,
    config,
    ticket: ticketArg,
    slug: options.title ? slugify(options.title) : undefined
  });

  let taskFile = workspace.taskFile;
  const created: string[] = [];

  if (!taskFile) {
    if (!parsed?.slug && !options.title) {
      fail(
        `No task found for ${workspace.ticket}.\n` +
        `Add a description to create it:  sabin draft ${workspace.ticket}-<description>\n` +
        `Or give it a title:              sabin draft ${workspace.ticket} -t "<title>"`
      );
    }
    taskFile = await createTaskFile(sabinDir, workspace.ticket, workspace.slug, options.title);
    created.push(taskFile);
  }

  const task = await parseTask(taskFile);
  const slug = task.slug ?? workspace.slug;
  const paths = workspacePaths({ ticket: workspace.ticket, slug }, sabinDir, workspace.mainRoot, config);

  await ensureWorkspaceFiles(paths, task.title, created);

  if (options.json) {
    console.log(JSON.stringify({
      ticket: workspace.ticket,
      name: paths.name,
      status: task.status,
      notesDir: paths.notesDir,
      promptFile: paths.promptFile,
      taskFile,
      created
    }, null, 2));
    return;
  }

  const mark = (target: string) => created.includes(target) ? chalk.green('created') : chalk.gray('exists ');

  console.log(`\n${chalk.bold(paths.name)} ${chalk.gray('·')} ${task.status}`);
  console.log(`  ${mark(taskFile)} ${taskFile}`);
  console.log(`  ${mark(paths.notesDir)} ${chalk.cyan(paths.notesDir)}`);
  console.log(`  ${mark(paths.promptFile)} ${paths.promptFile}`);
  console.log(chalk.gray(`\nWhen you are ready to work:\n  sabin start ${workspace.ticket}\n`));

  if (options.open !== false) {
    await launchEditor(paths.promptFile, { editor: options.editor, quiet: true });
  }
}
