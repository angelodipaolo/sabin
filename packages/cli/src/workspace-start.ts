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
  addWorktree,
  listWorktrees,
  writeSabinLink,
  withLock,
  SabinConfig,
  Workspace
} from '@sabin/core';
import { fail } from './workspace-context';
import { ensureWorkspaceFiles, createTaskFile, exists } from './workspace-scaffold';

const execFileAsync = promisify(execFile);

export interface EnsureWorkspaceOptions {
  /** Task title, used when the task has to be created */
  title?: string;
  /** Skip worktree and branch creation */
  noWorktree?: boolean;
  /**
   * Create the task when no file exists for the ticket. `start` does;
   * `run` does not, because an invented task is nothing to prompt with.
   */
  createTask?: boolean;
}

export interface StartedWorkspace {
  workspace: Workspace;
  config: SabinConfig;
  sabinDir: string;
  taskFile: string;
  branch: string;
  worktreeDir: string | null;
  /** Paths this call brought into being, as opposed to found */
  created: string[];
}

/**
 * Bring a ticket's workspace into existence: worktree, branch, notes
 * directory, prompt scratchpad, and the task marked in_progress.
 *
 * Idempotent - everything that already exists is left alone - which is what
 * lets both `sabin start` and `sabin run` call it without coordinating.
 */
export async function ensureWorkspace(
  ticketArg: string,
  options: EnsureWorkspaceOptions = {}
): Promise<StartedWorkspace> {
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
    if (!options.createTask) {
      fail(
        `No task found for ${parsed.ticket}.\n` +
        `Create it first:  sabin task create -n ${parsed.ticket} -t "<title>"`
      );
    }
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

  // Notes directory and prompt scratchpad, if drafting did not make them
  await ensureWorkspaceFiles(paths, task.title, created);

  // Task state
  await withLock(sabinDir, async () => {
    const current = await parseTask(taskFile!);
    current.status = 'in_progress';
    current.branch = branch;
    if (slug) current.slug = slug;
    if (worktreeDir) current.worktree = worktreeDir;
    await writeTask(current);
  });

  return {
    workspace: { ...workspace, ...paths, taskFile },
    config,
    sabinDir,
    taskFile,
    branch,
    worktreeDir,
    created
  };
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
