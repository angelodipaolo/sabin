import { describe, expect, it } from 'vitest';
import { diffNotices } from '../src/shared/notices';
import type { SessionInfo, Snapshot, TaskSummary } from '../src/shared/types';

function snapshot(tasks: TaskSummary[], unassigned: SessionInfo[] = [], version = 1): Snapshot {
  return {
    home: '/h', userHome: '/u', homeExists: true, version, takenAt: '', tasks, projects: [], repos: [], unassigned,
    hooksSeen: true, warnings: [], nextId: null, redeAvailable: false
  };
}
const s = (id: string, activity: SessionInfo['activity'], since = '2026-11-16T10:00:00Z'): SessionInfo =>
  ({ sessionId: id, agent: 'codex', activity, since, cwd: '/w', lastPrompt: 'Run the tests' });
const t = (id: string, status: TaskSummary['status'], sessions: SessionInfo[] = []): TaskSummary =>
  ({ id, title: `Title ${id}`, status, project: null, created: null, workspaces: [], sessions });

describe('diffNotices', () => {
  it('never notifies on first load', () => {
    expect(diffNotices(null, snapshot([t('T-1', 'review', [s('a', 'waiting')])]))).toEqual([]);
  });

  it('notifies when a session starts waiting, with the task to open', () => {
    const notices = diffNotices(snapshot([t('T-1', 'open', [s('a', 'busy')])]), snapshot([t('T-1', 'open', [s('a', 'waiting', '2026-11-16T10:05:00Z')])]));
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ kind: 'waiting', taskId: 'T-1', title: 'codex is waiting' });
    expect(notices[0].body).toContain('Run the tests');
  });

  it('does not repeat a wait that is unchanged', () => {
    const waiting = snapshot([t('T-1', 'open', [s('a', 'waiting')])]);
    expect(diffNotices(waiting, waiting)).toEqual([]);
  });

  it('notifies a new session that appears waiting, also outside tasks', () => {
    const notices = diffNotices(snapshot([]), snapshot([], [s('x', 'waiting')]));
    expect(notices).toMatchObject([{ kind: 'waiting', taskId: null }]);
  });

  it('notifies when a task enters review, but not for a new task already in review', () => {
    const notices = diffNotices(snapshot([t('T-1', 'in_progress')]), snapshot([t('T-1', 'review'), t('T-2', 'review')], [], 2));
    expect(notices).toMatchObject([{ kind: 'review', taskId: 'T-1' }]);
  });

  it('ignores busy, idle and ended changes', () => {
    const before = snapshot([t('T-1', 'open', [s('a', 'busy')])]);
    const after = snapshot([t('T-1', 'ready', [s('a', 'idle')])]);
    expect(diffNotices(before, after)).toEqual([]);
  });
});
