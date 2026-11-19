import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { Repo, SabinConfig, Task } from './types';
import { DEFAULT_BRANCH_TEMPLATE, listRepos, repoForPath } from './config';
import { git, listWorktrees, addWorktree, WorktreeInfo } from './git';
import { taskIdFromBranch, parseTaskId, compareTaskIds } from './ids';
import { slugFromTitle } from './slug';
import { pathExists, realpathOr, isWithin } from './fs';
import { WorkspacePathTakenError } from './errors';

const execFileAsync = promisify(execFile);

/**
 * One git worktree, in one registered repo, whose branch names a known task.
 * Derived from git every time; nothing about it is recorded.
 */
export interface Workspace {
  taskId: string;
  /** Registered repo name */
  repo: string;
  /** The repo's main clone */
  repoPath: string;
  /** Worktree root, as git reports it (a real path) */
  path: string;
  branch: string;
  /** Commit at HEAD, when git reported one */
  head: string | null;
  /** True when this is the main clone itself checked out on a task branch */
  main: boolean;
}

/** Task IDs, or anything carrying one, such as a `Task` */
export type TaskIds = Iterable<string | Pick<Task, 'id'>>;

function idsOf(known: TaskIds): string[] {
  const ids: string[] = [];
  for (const item of known) {
    const id = parseTaskId(typeof item === 'string' ? item : item.id);
    if (id) ids.push(id);
  }
  return ids;
}

function toWorkspace(repo: Repo, worktree: WorktreeInfo, ids: string[], index: number): Workspace | null {
  if (!worktree.branch || worktree.bare || worktree.prunable) return null;
  const taskId = taskIdFromBranch(worktree.branch, ids);
  if (!taskId) return null;
  return {
    taskId,
    repo: repo.name,
    repoPath: repo.path,
    path: worktree.path,
    branch: worktree.branch,
    head: worktree.head ?? null,
    // git always lists the main worktree first
    main: index === 0
  };
}

async function repoWorkspaces(repo: Repo, ids: string[]): Promise<Workspace[]> {
  const worktrees = await listWorktrees(repo.path);
  return worktrees
    .map((worktree, index) => toWorkspace(repo, worktree, ids, index))
    .filter((workspace): workspace is Workspace => workspace !== null);
}

/**
 * Every workspace for the given tasks across every registered repo, sorted
 * by task then repo. One `git worktree list` per repo, run in parallel; a
 * repo whose path has gone simply contributes nothing.
 */
export async function listWorkspaces(config: SabinConfig, known: TaskIds): Promise<Workspace[]> {
  const ids = idsOf(known);
  if (ids.length === 0) return [];

  const perRepo = await Promise.all(listRepos(config).map(repo => repoWorkspaces(repo, ids)));
  return perRepo.flat().sort((a, b) => compareTaskIds(a.taskId, b.taskId) || a.repo.localeCompare(b.repo));
}

/** Every workspace of one task, across all registered repos */
export async function workspacesForTask(config: SabinConfig, taskId: string): Promise<Workspace[]> {
  return listWorkspaces(config, [taskId]);
}

/**
 * The workspace containing `dir`, or null - when `dir` is outside every
 * registered repo, in a worktree whose branch names no known task, or in the
 * main clone on an ordinary branch. The deepest worktree wins, for a
 * worktrees root nested inside the clone.
 */
export async function workspaceForPath(config: SabinConfig, known: TaskIds, dir: string): Promise<Workspace | null> {
  const repo = await repoForPath(config, dir);
  if (!repo) return null;

  const target = await realpathOr(dir);
  const worktrees = await listWorktrees(repo.path);

  let best: { worktree: WorktreeInfo; index: number; root: string } | null = null;
  for (const [index, worktree] of worktrees.entries()) {
    const root = await realpathOr(worktree.path);
    if (!isWithin(target, root)) continue;
    if (!best || root.length > best.root.length) best = { worktree, index, root };
  }

  return best ? toWorkspace(repo, best.worktree, idsOf(known), best.index) : null;
}

export type ProjectSource = 'task' | 'repo';

/** Which project a directory belongs to, and why */
export interface PathProject {
  /** The project slug, or null when nothing names one */
  project: string | null;
  /** `task`: the project of the task whose worktree holds the directory. `repo`: the repo's default. */
  source: ProjectSource | null;
  /** The task whose worktree holds the directory, or null */
  taskId: string | null;
  /** The registered repo holding the directory, or null */
  repo: Repo | null;
  /**
   * Only when `project` is null and the directory is in a registered repo:
   * the projects of tasks with a worktree in that repo, sorted. The choices to
   * offer, never a guess.
   */
  candidates: string[];
}

/**
 * The project for work in `dir`, most specific source first:
 *
 * 1. The task whose worktree holds `dir`, when it names a project. A branch
 *    maps to one task and a task to one project, so this works in a monorepo
 *    shared by many projects.
 * 2. Else the default `project` of the registered repo holding `dir`.
 * 3. Else none, with the candidates to choose from.
 */
export async function projectForPath(config: SabinConfig, tasks: Task[], dir: string): Promise<PathProject> {
  const repo = await repoForPath(config, dir);
  if (!repo) return { project: null, source: null, taskId: null, repo: null, candidates: [] };

  const here = await workspaceForPath(config, tasks, dir);
  const task = here ? tasks.find(candidate => candidate.id === here.taskId) : undefined;
  const taskId = task?.id ?? null;
  if (task?.project) return { project: task.project, source: 'task', taskId, repo, candidates: [] };
  if (repo.project) return { project: repo.project, source: 'repo', taskId, repo, candidates: [] };

  const workspaces = await repoWorkspaces(repo, idsOf(tasks)).catch(() => [] as Workspace[]);
  const inRepo = new Set(workspaces.map(workspace => workspace.taskId));
  const candidates = [...new Set(tasks.filter(t => inRepo.has(t.id) && t.project).map(t => t.project!))].sort();
  return { project: null, source: null, taskId, repo, candidates };
}

/**
 * The repos a project spans, derived: every repo where one of its tasks has a
 * worktree, plus every repo whose default is the project. Sorted by name.
 */
export function reposForProject(project: string, tasks: Task[], workspaces: Workspace[], repos: Repo[]): string[] {
  const ids = new Set(tasks.filter(task => task.project === project).map(task => task.id));
  const names = new Set(workspaces.filter(workspace => ids.has(workspace.taskId)).map(workspace => workspace.repo));
  for (const repo of repos) if (repo.project === project) names.add(repo.name);
  return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * The branch for a task: the configured template with {prefix}, {id} and
 * {slug} filled, tidied of what empty values leave behind.
 */
export function branchNameFor(config: SabinConfig, taskId: string, slug: string | null): string {
  const template = config.branch?.template || DEFAULT_BRANCH_TEMPLATE;
  const name = template
    .replace(/\{prefix\}/g, config.branch?.prefix ?? '')
    .replace(/\{id\}/g, taskId)
    .replace(/\{slug\}/g, slug ?? '');

  return name.replace(/\/{2,}/g, '/').replace(/^[/-]+|[/-]+$/g, '').replace(/-+\//g, '/');
}

/** <worktreesRoot>/<ID>-<slug>, or <worktreesRoot>/<ID> when the title yields no slug */
export function worktreePathFor(repo: Repo, taskId: string, slug: string | null): string {
  return path.join(repo.worktreesRoot, slug ? `${taskId}-${slug}` : taskId);
}

export interface PostCreateResult {
  command: string;
  ok: boolean;
  /** Combined stdout and stderr */
  output: string;
}

export interface CreateWorkspaceResult {
  workspace: Workspace;
  /** False when the task already had a workspace in this repo; nothing was done */
  created: boolean;
  /** One entry per postCreate command run, stopping at the first failure */
  postCreate: PostCreateResult[];
}

export interface CreateWorkspaceOptions {
  /** Run the repo's postCreate commands. Default true. */
  runPostCreate?: boolean;
}

/**
 * Create the worktree for a task in a repo: branch `{prefix}/{id}-{slug}`
 * from the main clone's HEAD (or the existing branch of that name), at
 * `<worktreesRoot>/<ID>-<slug>`, then run postCreate inside it.
 *
 * Idempotent: if the task already has a workspace in this repo - whatever
 * its branch or path - that one is returned and nothing is created.
 */
export async function createWorkspace(
  config: SabinConfig,
  task: Pick<Task, 'id' | 'title'>,
  repo: Repo,
  options: CreateWorkspaceOptions = {}
): Promise<CreateWorkspaceResult> {
  const existing = await repoWorkspaces(repo, [task.id]);
  if (existing.length > 0) return { workspace: existing[0], created: false, postCreate: [] };

  const slug = slugFromTitle(task.title);
  const branch = branchNameFor(config, task.id, slug);
  const target = worktreePathFor(repo, task.id, slug);
  if (await pathExists(target)) throw new WorkspacePathTakenError(target);

  await fs.mkdir(path.dirname(target), { recursive: true });
  await addWorktree(repo.path, target, branch);

  const real = await realpathOr(target);
  const workspace = (await repoWorkspaces(repo, [task.id])).find(found => found.path === real) ?? {
    taskId: task.id,
    repo: repo.name,
    repoPath: repo.path,
    path: real,
    branch,
    head: null,
    main: false
  };

  const postCreate = options.runPostCreate === false ? [] : await runPostCreate(repo.postCreate, workspace.path);
  return { workspace, created: true, postCreate };
}

async function runPostCreate(commands: string[], cwd: string): Promise<PostCreateResult[]> {
  const results: PostCreateResult[] = [];
  for (const command of commands) {
    try {
      const { stdout, stderr } = await execFileAsync('/bin/sh', ['-c', command], { cwd, maxBuffer: 16 * 1024 * 1024 });
      results.push({ command, ok: true, output: `${stdout}${stderr}` });
    } catch (error: any) {
      results.push({ command, ok: false, output: `${error.stdout ?? ''}${error.stderr ?? ''}` || String(error.message) });
      break;
    }
  }
  return results;
}

export interface WorkspaceGitStatus {
  /** Null when HEAD is detached */
  branch: string | null;
  /** Changed, staged, unmerged and untracked entries */
  dirty: number;
  /** The upstream branch, when one is set */
  upstream: string | null;
  /** Commits ahead of / behind the upstream; null without an upstream */
  ahead: number | null;
  behind: number | null;
}

/**
 * Branch, dirty count and ahead/behind from one `git status --porcelain=v2
 * --branch`. Ahead/behind is against the upstream only - comparing with a
 * base branch would cost a second call. Null when `dir` is not a worktree.
 */
export async function workspaceGitStatus(dir: string): Promise<WorkspaceGitStatus | null> {
  let output: string;
  try {
    output = await git(['status', '--porcelain=v2', '--branch'], dir);
  } catch {
    return null;
  }
  return parseGitStatus(output);
}

/** The parser behind `workspaceGitStatus`, exported for tests */
export function parseGitStatus(output: string): WorkspaceGitStatus {
  const status: WorkspaceGitStatus = { branch: null, dirty: 0, upstream: null, ahead: null, behind: null };

  for (const line of output.split('\n')) {
    if (!line) continue;
    if (!line.startsWith('# ')) {
      status.dirty += 1;
      continue;
    }
    const [key, ...rest] = line.slice(2).split(' ');
    const value = rest.join(' ');
    if (key === 'branch.head' && value !== '(detached)') status.branch = value;
    else if (key === 'branch.upstream') status.upstream = value;
    else if (key === 'branch.ab') {
      const match = value.match(/^\+(\d+) -(\d+)$/);
      if (match) {
        status.ahead = Number(match[1]);
        status.behind = Number(match[2]);
      }
    }
  }

  return status;
}
