import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  AgentSession,
  SabinConfig,
  Task,
  Workspace,
  defaultConfig,
  homePaths,
  listProjects,
  listRepos,
  listTasks,
  listWorkspaces,
  nextTaskId,
  parseTaskId,
  readAgentSessions,
  readConfig,
  sessionsByTask,
  workspaceGitStatus
} from '@sabin/core';
import type { ProjectInfo, RepoInfo, SessionInfo, Snapshot, TaskSummary, WorkspaceInfo } from '../shared/types';

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The empty snapshot shown before the home exists */
export function emptySnapshot(home: string, version: number, marginAvailable: boolean): Snapshot {
  return {
    home,
    userHome: os.homedir(),
    homeExists: false,
    version,
    takenAt: new Date().toISOString(),
    tasks: [],
    projects: [],
    repos: [],
    unassigned: [],
    hooksSeen: false,
    warnings: [],
    nextId: null,
    marginAvailable
  };
}

/**
 * Task directories that exist but did not parse. `listTasks` skips them on
 * purpose so one broken file never blanks the list; the app says so instead
 * of hiding them silently.
 */
async function brokenTaskWarnings(home: string, tasks: Task[]): Promise<string[]> {
  const parsed = new Set(tasks.map(task => task.id));
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(homePaths(home).tasksDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(entry => entry.isDirectory() && parseTaskId(entry.name) === entry.name && !parsed.has(entry.name))
    .map(entry => `tasks/${entry.name}: task.md is missing or could not be read, so the task is hidden.`);
}

/**
 * Match sessions to workspaces on real paths. Git reports real paths, while a
 * hook records whatever cwd the agent had - /tmp versus /private/tmp on macOS.
 */
async function canonicalSessions(sessions: AgentSession[]): Promise<AgentSession[]> {
  const cache = new Map<string, Promise<string>>();
  const real = (cwd: string) => {
    if (!cache.has(cwd)) cache.set(cwd, fs.realpath(cwd).catch(() => path.resolve(cwd)));
    return cache.get(cwd)!;
  };
  return Promise.all(sessions.map(async session => ({ ...session, cwd: await real(session.cwd) })));
}

function toSessionInfo(session: AgentSession): SessionInfo {
  const info: SessionInfo = {
    sessionId: session.sessionId,
    agent: session.agent || 'agent',
    activity: session.activity,
    since: session.since,
    cwd: session.cwd
  };
  for (const key of ['pid', 'termSessionId', 'lastPrompt', 'lastPromptAt', 'lastMessage', 'lastMessageAt'] as const) {
    if (session[key] !== undefined) (info as unknown as Record<string, unknown>)[key] = session[key];
  }
  return info;
}

export interface SnapshotParts {
  config: SabinConfig;
  tasks: Task[];
  workspaces: Workspace[];
}

/** Config, tasks and workspaces - the inputs every terminal and review action re-derives */
export async function loadParts(home: string): Promise<SnapshotParts> {
  const config = await readConfig(home);
  const tasks = await listTasks(home);
  const workspaces = await listWorkspaces(config, tasks);
  return { config, tasks, workspaces };
}

/**
 * Everything the UI shows, in one pass. Every part is allowed to fail on its
 * own: an unparsable config, a missing repo or a broken task becomes a
 * warning, and the rest of the snapshot is still shown.
 *
 * Git calls run concurrently: one `git worktree list` per repo, then one
 * `git status` per workspace.
 */
export async function takeSnapshot(home: string, version: number, marginAvailable: boolean): Promise<Snapshot> {
  if (!(await isDirectory(home))) return emptySnapshot(home, version, marginAvailable);
  const warnings: string[] = [];

  let config: SabinConfig;
  try {
    config = await readConfig(home);
  } catch (error) {
    warnings.push(`${message(error)} Using defaults until it is fixed.`);
    config = defaultConfig();
  }

  const tasks = await listTasks(home).catch(error => {
    warnings.push(`Could not list tasks: ${message(error)}`);
    return [] as Task[];
  });

  const repos = listRepos(config);
  const [broken, projects, repoInfos, workspaces, rawSessions, sessionFiles, nextId] = await Promise.all([
    brokenTaskWarnings(home, tasks),
    listProjects(home, tasks).catch(error => {
      warnings.push(`Could not list projects: ${message(error)}`);
      return [];
    }),
    Promise.all(repos.map(async (repo): Promise<RepoInfo> => ({ name: repo.name, path: repo.path, exists: await isDirectory(repo.path) }))),
    listWorkspaces(config, tasks).catch(error => {
      warnings.push(`Could not list worktrees: ${message(error)}`);
      return [] as Workspace[];
    }),
    readAgentSessions(home).catch(error => {
      warnings.push(`Could not read agent sessions: ${message(error)}`);
      return [] as AgentSession[];
    }),
    fs.readdir(homePaths(home).sessionsDir).catch(() => [] as string[]),
    nextTaskId(home, config).catch(() => null)
  ]);
  warnings.push(...broken);
  for (const repo of repoInfos) {
    if (!repo.exists) warnings.push(`Repo "${repo.name}" is registered at ${repo.path}, which no longer exists.`);
  }

  const gitStates = await Promise.all(workspaces.map(workspace => workspaceGitStatus(workspace.path).catch(() => null)));
  const workspaceInfos: WorkspaceInfo[] = workspaces.map((workspace, index) => ({
    taskId: workspace.taskId,
    repo: workspace.repo,
    repoPath: workspace.repoPath,
    path: workspace.path,
    branch: workspace.branch,
    main: workspace.main,
    git: gitStates[index]
  }));

  const sessions = await canonicalSessions(rawSessions);
  const canonicalWorkspaces = await Promise.all(workspaces.map(async workspace => ({
    ...workspace,
    path: await fs.realpath(workspace.path).catch(() => workspace.path)
  })));
  const grouped = sessionsByTask(sessions, canonicalWorkspaces);
  const assigned = new Set<string>();
  for (const list of grouped.values()) for (const session of list) assigned.add(session.sessionId);

  const summaries: TaskSummary[] = tasks.map(task => ({
    id: task.id,
    title: task.title,
    status: task.status,
    project: task.project ?? null,
    created: task.created ?? null,
    workspaces: workspaceInfos.filter(workspace => workspace.taskId === task.id),
    sessions: (grouped.get(task.id) ?? []).map(toSessionInfo)
  }));

  const projectInfos: ProjectInfo[] = projects.map(project => ({
    slug: project.slug,
    title: project.title,
    open: project.total - project.counts.completed,
    total: project.total,
    hasFile: project.file !== null
  }));

  return {
    home,
    userHome: os.homedir(),
    homeExists: true,
    version,
    takenAt: new Date().toISOString(),
    tasks: summaries,
    projects: projectInfos,
    repos: repoInfos,
    unassigned: sessions.filter(session => !assigned.has(session.sessionId)).map(toSessionInfo),
    hooksSeen: sessionFiles.some(name => name.endsWith('.json')),
    warnings,
    nextId,
    marginAvailable
  };
}
