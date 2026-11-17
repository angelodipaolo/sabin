import chalk from 'chalk';
import {
  listTasks,
  listWorkspaces,
  readAgentSessions,
  sessionsByTask,
  isTaskStatus,
  parseProjectSlug,
  AgentSession,
  Workspace
} from '@sabin/core';
import { loadHome, fail, printJson, elapsed, colorStatus, VALID_STATUSES } from '../cli';

export interface LsOptions {
  project?: string;
  status?: string;
  all?: boolean;
  json?: boolean;
}

const ACTIVITY_RANK: Record<string, number> = { waiting: 0, busy: 1, idle: 2, ended: 3 };

/** Live sessions first, the one that most needs you first */
function byUrgency(a: AgentSession, b: AgentSession): number {
  const rank = (ACTIVITY_RANK[a.activity] ?? 9) - (ACTIVITY_RANK[b.activity] ?? 9);
  if (rank !== 0) return rank;
  // Waiting longest first; otherwise most recent first
  return a.activity === 'waiting' ? a.since.localeCompare(b.since) : b.since.localeCompare(a.since);
}

/** `codex waiting 6m`, plus `+1` for other live sessions; empty when nothing is live */
export function agentSummary(sessions: AgentSession[], now = Date.now()): string {
  const live = sessions.filter(session => session.activity !== 'ended').sort(byUrgency);
  if (live.length === 0) return '';
  const top = live[0];
  const age = elapsed(top.since, now);
  return `${top.agent} ${top.activity}${age ? ` ${age}` : ''}${live.length > 1 ? ` +${live.length - 1}` : ''}`;
}

function paintAgent(text: string, activity: string | undefined): string {
  switch (activity) {
    case 'waiting': return chalk.yellow(text);
    case 'busy': return chalk.cyan(text);
    default: return chalk.gray(text);
  }
}

/** Truncate to `width` columns with an ellipsis */
function fit(text: string, width: number): string {
  return text.length > width ? `${text.slice(0, width - 1)}…` : text;
}

const TITLE_WIDTH = 48;

/**
 * Every task across every repo, one aligned line each: ID, status, project,
 * title, the repos it has a worktree in, and what its agents are doing.
 * Completed tasks are hidden unless `--all` or `--status completed`.
 */
export async function ls(options: LsOptions = {}): Promise<void> {
  if (options.status && !isTaskStatus(options.status)) {
    fail(`Unknown status "${options.status}". Valid: ${VALID_STATUSES}`);
  }
  let project: string | null = null;
  if (options.project !== undefined) {
    project = parseProjectSlug(options.project);
    if (!project) fail(`Invalid project: "${options.project}". Use letters, digits and hyphens.`);
  }

  const { home, config } = await loadHome();
  let tasks = await listTasks(home);
  if (options.status) tasks = tasks.filter(task => task.status === options.status);
  else if (!options.all) tasks = tasks.filter(task => task.status !== 'completed');
  if (project) tasks = tasks.filter(task => task.project === project);

  const [workspaces, sessions] = await Promise.all([
    listWorkspaces(config, tasks),
    readAgentSessions(home)
  ]);
  const grouped = sessionsByTask(sessions, workspaces);
  const workspacesOf = (id: string): Workspace[] => workspaces.filter(workspace => workspace.taskId === id);

  if (options.json) {
    printJson(tasks.map(task => ({
      id: task.id,
      title: task.title,
      status: task.status,
      project: task.project ?? null,
      created: task.created ?? null,
      taskDir: task.dir,
      workspaces: workspacesOf(task.id).map(w => ({ repo: w.repo, path: w.path, branch: w.branch })),
      agents: (grouped.get(task.id) ?? []).map(session => ({
        sessionId: session.sessionId,
        agent: session.agent,
        activity: session.activity,
        since: session.since,
        cwd: session.cwd
      }))
    })));
    return;
  }

  if (tasks.length === 0) {
    const filters = [
      options.status ? `status ${options.status}` : options.all ? null : 'completed hidden',
      project ? `project ${project}` : null
    ].filter(Boolean);
    console.log(`No tasks${filters.length ? ` (${filters.join(', ')})` : ''}.`);
    console.log(chalk.gray('Create one with: sabin new "<title>"'));
    return;
  }

  const now = Date.now();
  const rows = tasks.map(task => {
    const taskSessions = grouped.get(task.id) ?? [];
    const top = taskSessions.filter(session => session.activity !== 'ended').sort(byUrgency)[0];
    const repos = [...new Set(workspacesOf(task.id).map(workspace => workspace.repo))];
    return {
      id: task.id,
      status: task.status,
      project: task.project ?? '-',
      title: fit(task.title, TITLE_WIDTH),
      repos: repos.length > 0 ? repos.join(',') : '-',
      agent: agentSummary(taskSessions, now),
      activity: top?.activity
    };
  });

  const width = (key: 'id' | 'status' | 'project' | 'title' | 'repos', header: string) =>
    Math.max(header.length, ...rows.map(row => row[key].length));
  const widths = {
    id: width('id', 'ID'),
    status: width('status', 'STATUS'),
    project: width('project', 'PROJECT'),
    title: width('title', 'TITLE'),
    repos: width('repos', 'REPOS')
  };

  console.log(chalk.gray([
    'ID'.padEnd(widths.id),
    'STATUS'.padEnd(widths.status),
    'PROJECT'.padEnd(widths.project),
    'TITLE'.padEnd(widths.title),
    'REPOS'.padEnd(widths.repos),
    'AGENT'
  ].join('  ').trimEnd()));

  for (const row of rows) {
    console.log([
      chalk.bold(row.id.padEnd(widths.id)),
      colorStatus(row.status, widths.status),
      (row.project === '-' ? chalk.gray : (text: string) => text)(row.project.padEnd(widths.project)),
      row.title.padEnd(widths.title),
      (row.repos === '-' ? chalk.gray : chalk.cyan)(row.repos.padEnd(widths.repos)),
      paintAgent(row.agent, row.activity)
    ].join('  ').trimEnd());
  }

  const hidden = options.all || options.status ? '' : '  (completed hidden; --all to show)';
  console.log(chalk.gray(`${rows.length} task${rows.length === 1 ? '' : 's'}${hidden}`));
}
