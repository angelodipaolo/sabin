import { ProjectFilter, SessionInfo, TaskStatus, TaskSummary } from './types';

/**
 * The attention list: tasks grouped by what they ask of you, not by status
 * column. Pure, so the order the eye lands on is tested rather than eyeballed.
 */

export type GroupKey = 'needs-you' | 'working' | 'in_progress' | 'ready' | 'open' | 'completed';

export const GROUP_LABELS: Record<GroupKey, string> = {
  'needs-you': 'Needs you',
  working: 'Working',
  in_progress: 'In progress',
  ready: 'Ready',
  open: 'Open',
  completed: 'Completed'
};

const GROUP_ORDER: GroupKey[] = ['needs-you', 'working', 'in_progress', 'ready', 'open', 'completed'];

export type RowReason = 'waiting' | 'review' | 'busy' | 'status';

export interface AttentionRow {
  task: TaskSummary;
  reason: RowReason;
  /** The session the badge describes - see `primarySession` */
  primary: SessionInfo | null;
  /** The earliest `since` of a waiting session, for "waiting 12m" */
  waitingSince: string | null;
  /** The latest timestamp any session recorded */
  lastActivity: string | null;
}

export interface AttentionGroup {
  key: GroupKey;
  label: string;
  rows: AttentionRow[];
}

const ACTIVITY_RANK: Record<string, number> = { waiting: 0, busy: 1, idle: 2, ended: 3 };

function latest(...values: (string | undefined | null)[]): string | null {
  let best: string | null = null;
  for (const value of values) if (value && (!best || value > best)) best = value;
  return best;
}

export function sessionActivityAt(session: SessionInfo): string {
  return latest(session.since, session.lastMessageAt, session.lastPromptAt) ?? session.since;
}

/**
 * The one session a row speaks for: the most urgent activity (waiting, busy,
 * idle, ended), the most recent within it.
 */
export function primarySession(sessions: SessionInfo[]): SessionInfo | null {
  let best: SessionInfo | null = null;
  for (const session of sessions) {
    if (!best) {
      best = session;
      continue;
    }
    const rank = ACTIVITY_RANK[session.activity] - ACTIVITY_RANK[best.activity];
    if (rank < 0 || (rank === 0 && sessionActivityAt(session) > sessionActivityAt(best))) best = session;
  }
  return best;
}

/** The text a row shows under its title: the last message, else the last prompt */
export function lastLine(session: SessionInfo | null): { text: string; kind: 'message' | 'prompt' } | null {
  if (!session) return null;
  const message = session.lastMessage?.trim();
  const prompt = session.lastPrompt?.trim();
  // Prefer whichever is newer when both exist, so a fresh prompt is not hidden behind an old answer
  if (message && prompt && session.lastPromptAt && session.lastMessageAt && session.lastPromptAt > session.lastMessageAt) {
    return { text: prompt, kind: 'prompt' };
  }
  if (message) return { text: message, kind: 'message' };
  if (prompt) return { text: prompt, kind: 'prompt' };
  return null;
}

export function matchesFilter(task: TaskSummary, filter: ProjectFilter): boolean {
  if (filter.kind === 'all') return true;
  if (filter.kind === 'none') return !task.project;
  return task.project === filter.slug;
}

/** ID order: prefix, then number - SABIN-2 before SABIN-10 */
export function compareIds(a: string, b: string): number {
  const [pa, na] = splitId(a);
  const [pb, nb] = splitId(b);
  return pa === pb ? na - nb : pa.localeCompare(pb);
}

function splitId(id: string): [string, number] {
  const dash = id.lastIndexOf('-');
  return [id.slice(0, dash), Number(id.slice(dash + 1))];
}

export function rowFor(task: TaskSummary): { group: GroupKey; row: AttentionRow } {
  const waiting = task.sessions.filter(session => session.activity === 'waiting');
  const busy = task.sessions.some(session => session.activity === 'busy');
  const waitingSince = waiting.length ? waiting.map(session => session.since).sort()[0] : null;
  const lastActivity = latest(...task.sessions.map(sessionActivityAt));
  const primary = primarySession(task.sessions);

  const row = (reason: RowReason): AttentionRow => ({ task, reason, primary, waitingSince, lastActivity });

  if (waitingSince) return { group: 'needs-you', row: row('waiting') };
  if (task.status === 'review') return { group: 'needs-you', row: row('review') };
  if (busy) return { group: 'working', row: row('busy') };
  return { group: task.status as Exclude<TaskStatus, 'review'>, row: row('status') };
}

/** Most recent activity first; tasks never touched by an agent last, newest ID first */
function byRecency(a: AttentionRow, b: AttentionRow): number {
  if (a.lastActivity !== b.lastActivity) {
    if (!a.lastActivity) return 1;
    if (!b.lastActivity) return -1;
    return a.lastActivity < b.lastActivity ? 1 : -1;
  }
  return compareIds(b.task.id, a.task.id);
}

function needsYouOrder(a: AttentionRow, b: AttentionRow): number {
  const aWait = a.reason === 'waiting';
  const bWait = b.reason === 'waiting';
  if (aWait !== bWait) return aWait ? -1 : 1;
  // Longest wait first
  if (aWait && bWait && a.waitingSince !== b.waitingSince) return a.waitingSince! < b.waitingSince! ? -1 : 1;
  return byRecency(a, b);
}

/**
 * Group and order tasks for the attention list. Empty groups are left out,
 * except that the order of the ones present is always: Needs you (waiting
 * agents by longest wait, then tasks in review), Working, In progress, Ready,
 * Open, Completed.
 */
export function groupTasks(tasks: TaskSummary[], filter: ProjectFilter = { kind: 'all' }): AttentionGroup[] {
  const buckets = new Map<GroupKey, AttentionRow[]>();
  for (const task of tasks) {
    if (!matchesFilter(task, filter)) continue;
    const { group, row } = rowFor(task);
    buckets.set(group, [...(buckets.get(group) ?? []), row]);
  }

  return GROUP_ORDER.filter(key => buckets.has(key)).map(key => ({
    key,
    label: GROUP_LABELS[key],
    rows: buckets.get(key)!.sort(key === 'needs-you' ? needsYouOrder : byRecency)
  }));
}

/** Live sessions outside every task, waiting first, then most recent */
export function liveUnassigned(sessions: SessionInfo[]): SessionInfo[] {
  return sessions
    .filter(session => session.activity !== 'ended')
    .sort((a, b) => ACTIVITY_RANK[a.activity] - ACTIVITY_RANK[b.activity] || (sessionActivityAt(b) > sessionActivityAt(a) ? 1 : -1));
}

/** What the dock badge counts: tasks in Needs you, plus waiting agents outside any task */
export function needsYouCount(tasks: TaskSummary[], unassigned: SessionInfo[] = []): number {
  const tasksNeeding = tasks.filter(task => rowFor(task).group === 'needs-you').length;
  return tasksNeeding + unassigned.filter(session => session.activity === 'waiting').length;
}
