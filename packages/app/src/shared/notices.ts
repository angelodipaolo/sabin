import { SessionInfo, Snapshot } from './types';

/**
 * What deserves a notification, found by diffing two consecutive snapshots.
 * Only two things do: an agent starting to wait on you, and a task entering
 * review. Everything else is visible in the list when you look.
 */

export interface Notice {
  kind: 'waiting' | 'review';
  /** The task to open on click; null for an agent outside every task */
  taskId: string | null;
  title: string;
  body: string;
  /** Stable key, so one change never notifies twice */
  key: string;
}

function snippet(text: string | undefined, limit = 140): string {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

function sessionsById(snapshot: Snapshot): Map<string, { session: SessionInfo; taskId: string | null }> {
  const map = new Map<string, { session: SessionInfo; taskId: string | null }>();
  for (const task of snapshot.tasks) {
    for (const session of task.sessions) map.set(session.sessionId, { session, taskId: task.id });
  }
  for (const session of snapshot.unassigned) map.set(session.sessionId, { session, taskId: null });
  return map;
}

/**
 * Notices for the change from `prev` to `next`. No `prev` means first load,
 * which never notifies - opening the app is not news. A session that appears
 * already waiting does notify; a task that appears already in review does
 * not (that is a migration or a bulk edit, not a hand-off).
 */
export function diffNotices(prev: Snapshot | null, next: Snapshot): Notice[] {
  if (!prev || !prev.homeExists) return [];
  const notices: Notice[] = [];

  const before = sessionsById(prev);
  const titles = new Map(next.tasks.map(task => [task.id, task.title]));
  for (const [sessionId, { session, taskId }] of sessionsById(next)) {
    if (session.activity !== 'waiting') continue;
    const old = before.get(sessionId)?.session;
    // A new wait: was not waiting, or is waiting again since a later moment
    if (old && old.activity === 'waiting' && old.since === session.since) continue;
    const where = taskId ? `${taskId} · ${titles.get(taskId) ?? ''}`.trim() : session.cwd;
    notices.push({
      kind: 'waiting',
      taskId,
      title: `${session.agent} is waiting`,
      body: snippet(session.lastPrompt) ? `${where}\n${snippet(session.lastPrompt)}` : where,
      key: `waiting:${sessionId}:${session.since}`
    });
  }

  const oldStatus = new Map(prev.tasks.map(task => [task.id, task.status]));
  for (const task of next.tasks) {
    const was = oldStatus.get(task.id);
    if (task.status !== 'review' || was === undefined || was === 'review') continue;
    notices.push({
      kind: 'review',
      taskId: task.id,
      title: `${task.id} is ready for review`,
      body: task.title,
      key: `review:${task.id}:${next.version}`
    });
  }

  return notices;
}
