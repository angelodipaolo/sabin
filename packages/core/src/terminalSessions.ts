import path from 'path';
import { SabinConfig } from './types';
import { TerminalDriver, TerminalSession } from './terminal/types';
import { ForegroundJob } from './terminal/processes';
import { resolveDriver } from './terminal';
import { AgentSession, KNOWN_AGENTS } from './agentSessions';
import { Workspace, TaskIds, listWorkspaces } from './workspaces';
import { isWithin } from './fs';

/** A live terminal session attributed to a task */
export interface TaskTerminal extends TerminalSession {
  taskId: string;
  /** The workspace the session's working directory is in */
  workspace: Workspace;
  /** The process this session is about - see `chooseJob` */
  job: ForegroundJob | null;
  cwd: string | null;
  /** `claude` or `codex` when the chosen job is an agent; null for a shell */
  agent: string | null;
  /** The recorded agent session running in this terminal, joined on the iTerm2 GUID */
  agentSession: AgentSession | null;
}

function agentName(program: string | null | undefined): string | null {
  return program && (KNOWN_AGENTS as readonly string[]).includes(program) ? program : null;
}

/**
 * The process in the foreground group a session is really about: an agent
 * when one is in the group, else the group leader. Neither leader nor
 * deepest child works alone - a wrapper can parent the agent, while Claude
 * Code parents its own mcpbridge.
 */
export function chooseJob(jobs: ForegroundJob[]): ForegroundJob | null {
  if (jobs.length === 0) return null;
  return jobs.find(job => agentName(job.program)) ?? jobs[0];
}

/**
 * Which task each terminal belongs to, derived from its working directory:
 * a tab you opened by hand and `cd`'d into counts exactly as much as one Sabin
 * opened, and there is no registry to go stale. Sessions in no workspace are
 * dropped. Each task's list is sorted waiting, busy, other agents, shells,
 * then by tab.
 */
export function attributeTerminals(
  sessions: TerminalSession[],
  workspaces: Workspace[],
  agentSessions: AgentSession[] = []
): Map<string, TaskTerminal[]> {
  // Worktrees can nest, so the deepest match has to win
  const roots = workspaces
    .map(workspace => ({ workspace, root: path.resolve(workspace.path) }))
    .sort((a, b) => b.root.length - a.root.length);
  const match = (cwd: string | null) => cwd ? roots.find(entry => isWithin(path.resolve(cwd), entry.root)) : undefined;

  const byTerminal = new Map<string, AgentSession>();
  for (const session of agentSessions) {
    // Most recent first, so a reused tab reports its latest agent
    const previous = session.termSessionId ? byTerminal.get(session.termSessionId) : undefined;
    if (session.termSessionId && (!previous || session.since > previous.since)) {
      byTerminal.set(session.termSessionId, session);
    }
  }

  const grouped = new Map<string, TaskTerminal[]>();
  for (const session of sessions) {
    const job = chooseJob(session.jobs);
    // The chosen job's cwd wins; other members are consulted because the
    // chosen one does not always have a readable cwd
    const found = match(job?.cwd ?? null) ?? session.jobs.map(candidate => match(candidate.cwd)).find(Boolean);
    if (!found) continue;

    const terminal: TaskTerminal = {
      ...session,
      taskId: found.workspace.taskId,
      workspace: found.workspace,
      job,
      cwd: job?.cwd ?? null,
      agent: agentName(job?.program),
      agentSession: byTerminal.get(session.id) ?? null
    };
    grouped.set(terminal.taskId, [...(grouped.get(terminal.taskId) ?? []), terminal]);
  }

  for (const list of grouped.values()) list.sort(compareTerminals);
  return grouped;
}

const ACTIVITY_ORDER: Record<string, number> = { waiting: 0, busy: 1, idle: 2, ended: 3 };

function compareTerminals(a: TaskTerminal, b: TaskTerminal): number {
  if (Boolean(a.agent) !== Boolean(b.agent)) return a.agent ? -1 : 1;
  const rank = (terminal: TaskTerminal) => ACTIVITY_ORDER[terminal.agentSession?.activity ?? 'ended'];
  return rank(a) - rank(b) || a.tabIndex - b.tabIndex;
}

/**
 * The window that is already this task's alone, if it has one.
 *
 * **Exclusive on purpose.** Picking the window that merely holds most of a
 * task's sessions is not enough: on a machine with one big window holding
 * everything, every task's "own" window is that window and the flat tab bar
 * survives for ever. Refusing a window that holds another task's terminal
 * means each task moves out on its next tab, so the layout migrates one task
 * at a time. Terminals attributed to no task do not count against exclusivity.
 */
export function windowForTask(taskId: string, grouped: Map<string, TaskTerminal[]>): string | null {
  const mine = grouped.get(taskId) ?? [];
  if (mine.length === 0) return null;

  const taken = new Set<string>();
  for (const [other, terminals] of grouped) {
    if (other === taskId) continue;
    for (const terminal of terminals) taken.add(terminal.windowId);
  }

  const counts = new Map<string, number>();
  for (const terminal of mine) {
    if (taken.has(terminal.windowId)) continue;
    counts.set(terminal.windowId, (counts.get(terminal.windowId) ?? 0) + 1);
  }

  let best: string | null = null;
  let most = 0;
  for (const [windowId, count] of counts) {
    if (count > most) {
      best = windowId;
      most = count;
    }
  }
  return best;
}

/** A tab title: `SABIN-0017 · codex`. The task first, because that is what you scan for. */
export function terminalTitle(taskId: string, label: string): string {
  return `${taskId} · ${label}`;
}

export interface ListTaskTerminalsOptions {
  /** Defaults to `resolveDriver()` */
  driver?: TerminalDriver;
  /** Pass when already listed, to skip the git calls */
  workspaces?: Workspace[];
  /** Pass to join each terminal to its recorded agent session */
  agentSessions?: AgentSession[];
}

/**
 * Live terminals grouped by task. Three subprocesses whatever the session
 * count (osascript, ps, lsof), plus a `git worktree list` per repo unless
 * `workspaces` is given. Empty when iTerm2 is not running.
 */
export async function listTaskTerminals(
  config: SabinConfig,
  known: TaskIds,
  options: ListTaskTerminalsOptions = {}
): Promise<Map<string, TaskTerminal[]>> {
  const driver = options.driver ?? await resolveDriver();
  const [sessions, workspaces] = await Promise.all([
    driver.listSessions(),
    options.workspaces ? Promise.resolve(options.workspaces) : listWorkspaces(config, known)
  ]);
  return attributeTerminals(sessions, workspaces, options.agentSessions);
}

/**
 * Bring an iTerm2 session to the front by its GUID (`AgentSession.termSessionId`
 * or `TaskTerminal.id`). False when it is gone or iTerm2 is not running.
 */
export async function focusTerminal(termSessionId: string, driver?: TerminalDriver): Promise<boolean> {
  const resolved = driver ?? await resolveDriver();
  return resolved.focus(termSessionId);
}

export interface OpenWorkspaceTabOptions {
  /** Run after `cd`-ing into the workspace, e.g. `codex resume <id>` */
  command?: string;
  /** Defaults to `terminalTitle(taskId, 'shell')`, or the command's first word */
  title?: string;
  /** The current grouping, from `listTaskTerminals`; listed here when absent */
  terminals?: Map<string, TaskTerminal[]>;
  /** Pass along with `terminals` omitted to save the git calls */
  workspaces?: Workspace[];
  driver?: TerminalDriver;
}

/**
 * Open an iTerm2 tab in a workspace, in the task's own window when it has
 * one (see `windowForTask`), else in a new window. Returns false when there
 * is no iTerm2 to open it in.
 */
export async function openWorkspaceTab(
  config: SabinConfig,
  known: TaskIds,
  workspace: Workspace,
  options: OpenWorkspaceTabOptions = {}
): Promise<boolean> {
  const driver = options.driver ?? await resolveDriver();
  if (driver.name === 'none') return false;

  const terminals = options.terminals ??
    await listTaskTerminals(config, known, { driver, workspaces: options.workspaces });
  const windowId = windowForTask(workspace.taskId, terminals);
  const label = options.command?.trim().split(/\s+/)[0] || 'shell';

  await driver.openTab({
    cwd: workspace.path,
    command: options.command,
    title: options.title ?? terminalTitle(workspace.taskId, label),
    windowId: windowId ?? undefined,
    newWindow: !windowId,
    taskId: workspace.taskId
  });
  return true;
}
