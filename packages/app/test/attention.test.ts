import { describe, expect, it } from 'vitest';
import { groupTasks, lastLine, liveUnassigned, needsYouCount, primarySession } from '../src/shared/attention';
import type { SessionInfo, TaskStatus, TaskSummary } from '../src/shared/types';

const at = (minutes: number) => new Date(Date.UTC(2026, 10, 16, 12, 0) - minutes * 60_000).toISOString();

function session(activity: SessionInfo['activity'], minutesAgo: number, extra: Partial<SessionInfo> = {}): SessionInfo {
  return { sessionId: `${activity}-${minutesAgo}-${Math.random()}`, agent: 'codex', activity, since: at(minutesAgo), cwd: '/w', ...extra };
}

function task(id: string, status: TaskStatus, sessions: SessionInfo[] = [], project: string | null = null): TaskSummary {
  return { id, title: id, status, project, created: null, workspaces: [], sessions };
}

const order = (tasks: TaskSummary[], filter?: Parameters<typeof groupTasks>[1]) =>
  groupTasks(tasks, filter).map(group => [group.key, group.rows.map(row => row.task.id)]);

describe('groupTasks', () => {
  it('orders groups: needs you, working, in progress, ready, open, completed', () => {
    const tasks = [
      task('T-1', 'completed'),
      task('T-2', 'open'),
      task('T-3', 'ready'),
      task('T-4', 'in_progress'),
      task('T-5', 'open', [session('busy', 1)]),
      task('T-6', 'review'),
      task('T-7', 'in_progress', [session('waiting', 5)])
    ];
    expect(groupTasks(tasks).map(group => group.key)).toEqual(['needs-you', 'working', 'in_progress', 'ready', 'open', 'completed']);
  });

  it('puts waiting agents first, longest wait first, then review', () => {
    const tasks = [
      task('T-1', 'review', [session('idle', 2)]),
      task('T-2', 'in_progress', [session('waiting', 3)]),
      task('T-3', 'review'),
      task('T-4', 'ready', [session('waiting', 40)])
    ];
    expect(order(tasks)[0]).toEqual(['needs-you', ['T-4', 'T-2', 'T-1', 'T-3']]);
  });

  it('lets a waiting agent win over busy and over status', () => {
    const tasks = [task('T-1', 'completed', [session('busy', 1), session('waiting', 2)])];
    const [group] = groupTasks(tasks);
    expect(group.key).toBe('needs-you');
    expect(group.rows[0].reason).toBe('waiting');
    expect(group.rows[0].waitingSince).toBe(at(2));
  });

  it('treats ended and idle sessions as no activity for grouping', () => {
    expect(order([task('T-1', 'ready', [session('ended', 1), session('idle', 2)])])).toEqual([['ready', ['T-1']]]);
  });

  it('orders the rest by latest activity, untouched tasks last by newest ID', () => {
    const tasks = [task('T-2', 'open'), task('T-10', 'open'), task('T-1', 'open', [session('ended', 60)]), task('T-3', 'open', [session('idle', 5)])];
    expect(order(tasks)).toEqual([['open', ['T-3', 'T-1', 'T-10', 'T-2']]]);
  });

  it('filters by project and by no project', () => {
    const tasks = [task('T-1', 'open', [], 'a'), task('T-2', 'open', [], 'b'), task('T-3', 'open')];
    expect(order(tasks, { kind: 'project', slug: 'a' })).toEqual([['open', ['T-1']]]);
    expect(order(tasks, { kind: 'none' })).toEqual([['open', ['T-3']]]);
  });
});

describe('primarySession and lastLine', () => {
  it('picks the most urgent session, then the most recent', () => {
    const idle = session('idle', 1);
    const busyOld = session('busy', 30);
    const busyNew = session('busy', 2);
    expect(primarySession([idle, busyOld, busyNew])).toBe(busyNew);
    expect(primarySession([])).toBeNull();
  });

  it('prefers the message, unless a newer prompt exists', () => {
    expect(lastLine(session('idle', 1, { lastMessage: 'done', lastPrompt: 'do it' }))).toEqual({ text: 'done', kind: 'message' });
    expect(lastLine(session('busy', 1, { lastMessage: 'old', lastMessageAt: at(30), lastPrompt: 'new', lastPromptAt: at(1) })))
      .toEqual({ text: 'new', kind: 'prompt' });
    expect(lastLine(session('busy', 1))).toBeNull();
  });
});

describe('counts and unassigned', () => {
  it('counts tasks needing you plus waiting agents outside tasks', () => {
    const tasks = [task('T-1', 'review'), task('T-2', 'open', [session('waiting', 1)]), task('T-3', 'open')];
    expect(needsYouCount(tasks, [session('waiting', 3), session('busy', 1)])).toBe(3);
  });

  it('lists live unassigned sessions, waiting first', () => {
    const busy = session('busy', 1);
    const waiting = session('waiting', 9);
    expect(liveUnassigned([busy, session('ended', 1), waiting])).toEqual([waiting, busy]);
  });
});
