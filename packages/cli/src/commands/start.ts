import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import chalk from 'chalk';
import {
  parseTask,
  writeTask,
  readConfig,
  resolveSabinDir,
  resolveWorkspace,
  workspacePaths,
  branchNameFor,
  parseTicketArg,
  slugify,
  Task,
  addWorktree,
  listWorktrees,
  writeSabinLink,
  withLock,
  Workspace
} from '@sabin/core';
import { fail } from '../workspace-context';

const execFileAsync = promisify(execFile);

interface StartOptions {
  json?: boolean;
  noWorktree?: boolean;
  title?: string;
}

/**
 * Turn "update-telemetry" back into "Update telemetry" for a task title
 */
function titleFromSlug(slug: string): string {
  const words = slug.replace(/-/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const PROMPT_TEMPLATE = (name: string, title: string) =>
  `# ${name} - ${title}\n\n` +
  `Scratchpad for prompts. Not visible to the agent.\n\n---\n\n`;

/**
 * Create everything a ticket needs to be worked on: worktree, branch, notes
 * directory and prompt scratchpad.
 *
 * Idempotent - every path derives from the ticket ID, so running this twice
 * returns the existing workspace instead of erroring or creating a second one.
 */
export async function startTask(ticketArg: string, options: StartOptions): Promise<void> {
  const { sabinDir } = await resolveSabinDir();
  const config = await readConfig(sabinDir);

  const parsed = parseTicketArg(ticketArg);
  if (!parsed) {
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

  // A descriptive suffix or an explicit title is enough to create the task
  if (!taskFile) {
    if (!parsed.slug && !options.title) {
      fail(
        `No task found for ${parsed.ticket}.\n` +
        `Add a description to create it:  sabin start ${parsed.ticket}-<description>\n` +
        `Or create it first:              sabin task create -n ${parsed.ticket} -t "<title>"`
      );
    }
    taskFile = await createTaskFile(sabinDir, parsed.ticket, workspace.slug, options.title);
    created.push(taskFile);
  }

  const task = await parseTask(taskFile);

  // The recorded suffix wins, so a workspace keeps its paths for life
  if (parsed.slug && task.slug && parsed.slug !== task.slug) {
    console.error(chalk.yellow(
      `${parsed.ticket} is already named "${task.slug}"; keeping it. ` +
      `Rename the notes and worktree directories by hand if you really want "${parsed.slug}".`
    ));
  }

  // One slug drives the branch, worktree, notes and prompt names alike
  const slug = task.slug ?? workspace.slug;
  const branch = task.branch ?? branchNameFor(parsed.ticket, slug, config);
  const paths = workspacePaths({ ticket: parsed.ticket, slug }, sabinDir, workspace.mainRoot, config);

  // Worktree and branch
  let worktreeDir: string | null = null;
  if (!options.noWorktree) {
    if (!workspace.mainRoot) {
      fail('Not inside a git repository, so no worktree can be created. Use --no-worktree.');
    }
    worktreeDir = await ensureWorktree(workspace.mainRoot, paths.worktreeDir, branch, created);
    await ensureSabinLink(worktreeDir, sabinDir);
    await runPostCreate(config.worktrees?.postCreate ?? [], worktreeDir, created.includes(worktreeDir));
  }

  // Notes directory
  if (!(await exists(paths.notesDir))) {
    await fs.mkdir(paths.notesDir, { recursive: true });
    created.push(paths.notesDir);
  }

  // Prompt scratchpad
  if (!(await exists(paths.promptFile))) {
    await fs.mkdir(path.dirname(paths.promptFile), { recursive: true });
    await fs.writeFile(paths.promptFile, PROMPT_TEMPLATE(paths.name, task.title));
    created.push(paths.promptFile);
  }

  // Task state
  await withLock(sabinDir, async () => {
    const current = await parseTask(taskFile!);
    current.status = 'in_progress';
    current.branch = branch;
    if (slug) current.slug = slug;
    if (worktreeDir) current.worktree = worktreeDir;
    await writeTask(current);
  });

  report({ ...workspace, ...paths, taskFile, branch }, worktreeDir, created, options.json === true);
}

/**
 * Create the task file for a ticket that does not have one yet
 */
async function createTaskFile(
  sabinDir: string,
  ticket: string,
  slug: string | null,
  title?: string
): Promise<string> {
  const tasksDir = path.join(sabinDir, 'tasks');
  const openDir = path.join(tasksDir, 'open');
  await fs.mkdir(openDir, { recursive: true });

  const task: Task = {
    status: 'open',
    title: title ?? (slug ? titleFromSlug(slug) : ticket),
    content: '',
    path: path.join(openDir, `${ticket}.md`)
  };
  if (slug) task.slug = slug;

  await withLock(sabinDir, () => writeTask(task));
  return task.path;
}

async function ensureWorktree(
  mainRoot: string,
  worktreeDir: string,
  branch: string,
  created: string[]
): Promise<string> {
  // An existing worktree for this branch wins, wherever it lives
  const existing = (await listWorktrees(mainRoot)).find(
    wt => wt.branch === branch || path.resolve(wt.path) === path.resolve(worktreeDir)
  );
  if (existing) return path.resolve(existing.path);

  await fs.mkdir(path.dirname(worktreeDir), { recursive: true });
  await addWorktree(mainRoot, worktreeDir, branch);
  created.push(worktreeDir);
  return worktreeDir;
}

/**
 * Drop a .sabin link into the worktree so commands resolve there directly,
 * unless the shared directory already lives inside it.
 */
async function ensureSabinLink(worktreeDir: string, sabinDir: string): Promise<void> {
  if (sabinDir.startsWith(worktreeDir + path.sep)) return;
  if (await exists(path.join(worktreeDir, '.sabin'))) return;
  await writeSabinLink(worktreeDir, sabinDir);
}

async function runPostCreate(commands: string[], cwd: string, isNew: boolean): Promise<void> {
  if (!isNew || commands.length === 0) return;

  for (const command of commands) {
    console.error(chalk.gray(`  $ ${command}`));
    try {
      await execFileAsync('sh', ['-c', command], { cwd });
    } catch (error: any) {
      console.error(chalk.yellow(`  postCreate failed: ${error.message}`));
    }
  }
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

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
