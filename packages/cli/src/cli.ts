import os from 'os';
import chalk from 'chalk';
import {
  readConfig,
  resolveHome,
  workspaceForPath,
  isTaskId,
  realpathOr,
  isWithin,
  SabinConfig,
  Task,
  Workspace,
  TASK_STATUSES
} from '@sabin/core';

/**
 * An error meant for the person at the terminal: printed as one line on
 * stderr, exit code 1, no stack. Every SabinError from core is treated the
 * same way by `reportError`.
 */
export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliError';
  }
}

export function fail(message: string): never {
  throw new CliError(message);
}

/** One line for stderr, whatever was thrown */
export function errorLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split('\n')[0].trim() || 'Unknown error';
}

export interface Home {
  home: string;
  config: SabinConfig;
}

/** The Sabin home and its config. A missing config is defaults; a broken one is an error. */
export async function loadHome(): Promise<Home> {
  const home = resolveHome();
  return { home, config: await readConfig(home) };
}

/**
 * The user's home directory: $HOME, else what the OS says. Read from the
 * environment on purpose - `os.homedir()` alone cannot be redirected by a
 * test, and setup writes into this directory.
 */
export function userHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.HOME?.trim() || os.homedir();
}

export const VALID_STATUSES = TASK_STATUSES.join(', ');

/**
 * The task a command acts on: the ID given, else the one whose workspace
 * holds the cwd. Fails rather than guessing - acting on the wrong task is
 * worse than asking.
 */
export async function resolveTaskId(
  config: SabinConfig,
  tasks: Task[],
  given: string | undefined,
  usage: string
): Promise<string> {
  if (given) {
    if (!isTaskId(given)) fail(`Invalid task ID: "${given}". Expected something like TASK-12.`);
    const id = given.trim().toUpperCase();
    if (!tasks.some(task => task.id === id)) fail(`Task not found: ${id}. See \`sabin ls --all\`.`);
    return id;
  }

  const here = await workspaceForPath(config, tasks, process.cwd());
  if (!here) {
    fail(`No task here: ${process.cwd()} is not inside a task's worktree. Pass the ID: ${usage}`);
  }
  return here.taskId;
}

/** The workspace among `workspaces` that contains `dir`, deepest first */
export async function containingWorkspace(workspaces: Workspace[], dir: string): Promise<Workspace | null> {
  const target = await realpathOr(dir);
  let best: { workspace: Workspace; root: string } | null = null;
  for (const workspace of workspaces) {
    const root = await realpathOr(workspace.path);
    if (isWithin(target, root) && (!best || root.length > best.root.length)) best = { workspace, root };
  }
  return best?.workspace ?? null;
}

/** "14s", "6m", "2h", "3d" since an ISO time */
export function elapsed(since: string | null | undefined, now = Date.now()): string {
  if (!since) return '';
  const ms = now - Date.parse(since);
  if (!Number.isFinite(ms) || ms < 0) return '';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

/** `label:` padded so a block of fields lines up */
export function field(label: string, value: string, width = 10): string {
  return `  ${chalk.gray(`${label}:`.padEnd(width))} ${value}`;
}

export function colorStatus(status: string, pad = 0): string {
  const label = pad ? status.padEnd(pad) : status;
  switch (status) {
    case 'open': return chalk.yellow(label);
    case 'ready': return chalk.blue(label);
    case 'in_progress': return chalk.cyan(label);
    case 'review': return chalk.magenta(label);
    case 'completed': return chalk.green(label);
    default: return label;
  }
}
