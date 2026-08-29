import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import chalk from 'chalk';
import {
  findTask,
  setTaskStatus,
  resolveWorkspace,
  workspacePaths,
  scaffoldWorkspace,
  branchNameFor,
  parseTicketArg,
  addWorktree,
  listWorktrees,
  writeSabinLink,
  pathExists,
  SabinConfig,
  TASK_STATUSES,
  TaskStatus,
  Workspace
} from '@sabin/core';
import { fail, loadProject } from './workspace-context';

const execFileAsync = promisify(execFile);

export interface EnsureWorkspaceOptions {
  /** Skip worktree and branch creation. Tests only - no command sets it. */
  noWorktree?: boolean;
  /**
   * Status to write, or null to leave the task where it is.
   *
   * Only implementing means "work underway". Planning happens before a task
   * is `ready` and reviewing happens when it is already in `review`, so both
   * pass null - the branch, slug and worktree are still recorded either way.
   */
  status?: TaskStatus | null;
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
 * directory and prompt scratchpad.
 *
 * Idempotent - everything that already exists is left alone - which is what
 * lets `plan`, `implement` and `review` all call it without coordinating.
 * The task itself is never created here: `sabin task create` is the one way
 * a task comes into being, and a ticket with no task file is an error.
 */
export async function ensureWorkspace(
  ticketArg: string,
  options: EnsureWorkspaceOptions = {}
): Promise<StartedWorkspace> {
  const { sabinDir, config } = await loadProject();

  const parsed = parseTicketArg(ticketArg);
  if (!parsed) {
    fail(
      `"${ticketArg}" is not a ticket.\n` +
      `Expected something like SABIN-0004 or JIRA-12345-update-telemetry.`
    );
  }

  const workspace = await resolveWorkspace({ sabinDir, config, ticket: ticketArg });

  const created: string[] = [];
  const task = await findTask(sabinDir, parsed.ticket);

  if (!task) {
    fail(
      `No task found for ${parsed.ticket}.\n` +
      `Create it first:  sabin task create "<title>" -n ${parsed.ticket}`
    );
  }

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

  let worktreeDir: string | null = null;
  if (!options.noWorktree) {
    if (!workspace.mainRoot) {
      fail('Not inside a git repository, so no worktree can be created. Use --no-worktree.');
    }
    worktreeDir = await ensureWorktree(workspace.mainRoot, paths.worktreeDir, branch, created);
    await ensureSabinLink(worktreeDir, sabinDir);
    await runPostCreate(config.worktrees?.postCreate ?? [], worktreeDir, created.includes(worktreeDir));
  }

  await scaffoldWorkspace(paths, task.title, created);

  // A null status still writes the patch - setTaskStatus with the status the
  // task already has records the branch and worktree and moves nothing
  const status = options.status === undefined ? 'in_progress' : options.status;
  const willWrite = stepStatus(task.status, status);

  // Declining the write is right, but doing it in silence is not: the user
  // asked for a step and has every reason to expect the status it names
  if (status !== null && willWrite !== status) {
    console.error(chalk.yellow(
      `${task.id} is ${task.status}; leaving it there rather than writing ${status}.` +
      (task.status === 'review'
        ? ' Addressing review feedback happens in review.'
        : `\nRun: sabin task update ${task.id} ${status}  (to move it back deliberately)`)
    ));
  }

  const updated = await setTaskStatus(sabinDir, task.id, willWrite, {
    branch,
    slug: slug ?? undefined,
    worktree: worktreeDir ?? undefined
  });

  return {
    workspace: { ...workspace, ...paths, taskFile: updated.path },
    config,
    sabinDir,
    taskFile: updated.path,
    branch,
    worktreeDir,
    created
  };
}

/**
 * The status a step should leave the task in, which is never behind where it
 * already is.
 *
 * `implement` asks for `in_progress`, but addressing review feedback is real
 * implementation work that happens while the task sits in `review` - and that
 * is a long-lived state now, not a moment. Writing `in_progress` there would
 * claim the work is unreviewed when a reviewer has already been through it.
 *
 * The invariant is the general one - a step verb never moves a task backwards -
 * so it covers `completed` too: finishing a ticket and then running a step on
 * it does not quietly reopen it. Reopening is a deliberate `task update`, and
 * the caller says so when this declines a write. TASK_STATUSES is in workflow
 * order, so "ahead" is just its index.
 */
function stepStatus(current: TaskStatus, asked: TaskStatus | null): TaskStatus {
  if (asked === null) return current;
  return TASK_STATUSES.indexOf(asked) > TASK_STATUSES.indexOf(current) ? asked : current;
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
 * Drop a .sabin link into the worktree so commands resolve there directly
 */
async function ensureSabinLink(worktreeDir: string, sabinDir: string): Promise<void> {
  if (sabinDir.startsWith(worktreeDir + path.sep)) return;
  if (await pathExists(path.join(worktreeDir, '.sabin'))) return;
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
