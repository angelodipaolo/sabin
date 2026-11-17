import fs from 'fs/promises';
import path from 'path';
import {
  recordAgentEvent,
  readAgentSessions,
  sweepAgentSessions,
  sessionsForTask,
  sessionsByTask,
  agentSessionPath,
  AgentSession,
  AGENT_TEXT_LIMIT,
  RecordAgentEventOptions
} from '../agentSessions';
import { Workspace } from '../workspaces';
import { tempDir } from './helpers';

let home: string;

beforeEach(async () => {
  home = await tempDir('sabin-agents-');
});

afterEach(async () => {
  await fs.rm(home, { recursive: true, force: true });
});

// This process is certainly alive, so a session carrying its pid is live
const live: RecordAgentEventOptions = { findAgentProcess: async () => ({ pid: process.pid, agent: 'codex' }) };
const env = { ITERM_SESSION_ID: 'w0t1p0:ABC-GUID' };

function event(name: string, extra: Record<string, unknown> = {}) {
  return { session_id: 's1', hook_event_name: name, cwd: '/work/T-1', ...extra };
}

async function record(name: string, extra: Record<string, unknown> = {}, options = live) {
  return recordAgentEvent(home, event(name, extra), env, options);
}

describe('event mapping', () => {
  it('SessionStart is idle, with pid, agent and iTerm2 GUID', async () => {
    const session = await record('SessionStart', { source: 'startup' });
    expect(session).toMatchObject({ sessionId: 's1', agent: 'codex', activity: 'idle', cwd: '/work/T-1', pid: process.pid, termSessionId: 'ABC-GUID' });
  });

  it('SessionStart after a mid-turn compaction leaves the activity alone', async () => {
    await record('UserPromptSubmit', { prompt: 'x' });
    expect(await record('SessionStart', { source: 'compact' })).toBeNull();
    await record('SessionEnd');
    expect((await record('SessionStart', { source: 'resume' }))?.activity).toBe('idle');
  });

  it('UserPromptSubmit is busy and records the prompt', async () => {
    const session = await record('UserPromptSubmit', { prompt: 'do it' });
    expect(session).toMatchObject({ activity: 'busy', lastPrompt: 'do it' });
    expect(session?.lastPromptAt).toBeDefined();
  });

  it('PermissionRequest is waiting', async () => {
    expect((await record('PermissionRequest', { tool_name: 'Bash' }))?.activity).toBe('waiting');
  });

  it.each(['permission_prompt', 'idle_prompt', 'elicitation_dialog'])('Notification %s is waiting', async type => {
    await record('UserPromptSubmit', { prompt: 'x' });
    expect((await record('Notification', { notification_type: type }))?.activity).toBe('waiting');
  });

  it('Notification without a type is waiting; auth_success changes nothing', async () => {
    await record('UserPromptSubmit', { prompt: 'x' });
    expect(await record('Notification', { notification_type: 'auth_success' })).toBeNull();
    expect((await record('Notification', { message: 'Claude needs your permission' }))?.activity).toBe('waiting');
  });

  it('PostToolUse resumes a wait and is ignored otherwise', async () => {
    await record('UserPromptSubmit', { prompt: 'x' });
    expect(await record('PostToolUse', { tool_name: 'Bash' })).toBeNull();
    await record('PermissionRequest');
    expect((await record('PostToolUse', { tool_name: 'Bash' }))?.activity).toBe('busy');
  });

  it('Stop is idle and records the last message', async () => {
    await record('UserPromptSubmit', { prompt: 'x' });
    expect(await record('Stop', { last_assistant_message: 'Done.' })).toMatchObject({ activity: 'idle', lastMessage: 'Done.', lastPrompt: 'x' });
  });

  it('SessionEnd is ended, and the file is kept', async () => {
    await record('SessionStart');
    expect((await record('SessionEnd', { reason: 'other' }))?.activity).toBe('ended');
    expect((await readAgentSessions(home))[0].activity).toBe('ended');
  });

  it('unknown events change nothing', async () => {
    expect(await record('PreCompact')).toBeNull();
    expect(await readAgentSessions(home)).toEqual([]);
  });

  it('moves `since` only when the activity changes', async () => {
    await recordAgentEvent(home, event('UserPromptSubmit', { prompt: 'a' }), env, { ...live, now: new Date('2026-01-01T00:00:00Z') });
    const later = await recordAgentEvent(home, event('UserPromptSubmit', { prompt: 'b' }), env, { ...live, now: new Date('2026-01-01T00:05:00Z') });
    expect(later).toMatchObject({ since: '2026-01-01T00:00:00.000Z', lastPrompt: 'b', lastPromptAt: '2026-01-01T00:05:00.000Z' });
  });
});

describe('recordAgentEvent', () => {
  it('truncates prompt and message to the limit', async () => {
    const long = 'x'.repeat(AGENT_TEXT_LIMIT * 2);
    expect((await record('UserPromptSubmit', { prompt: long }))?.lastPrompt).toHaveLength(AGENT_TEXT_LIMIT);
    expect((await record('Stop', { last_assistant_message: long }))?.lastMessage).toHaveLength(AGENT_TEXT_LIMIT);
  });

  it('accepts the raw stdin string', async () => {
    expect((await recordAgentEvent(home, JSON.stringify(event('SessionStart')), env, live))?.activity).toBe('idle');
  });

  it('never throws, whatever it is given', async () => {
    for (const payload of ['not json', '', null, 42, [], { hook_event_name: 'Stop' }, { session_id: '', hook_event_name: 'Stop' }]) {
      await expect(recordAgentEvent(home, payload, env, live)).resolves.toBeNull();
    }
    // An unwritable home: a file where the directory should be
    const blocked = path.join(home, 'blocked');
    await fs.writeFile(blocked, '');
    await expect(recordAgentEvent(blocked, event('SessionStart'), env, live)).resolves.toBeNull();
  });

  it('survives a failing pid lookup', async () => {
    const session = await record('SessionStart', {}, { findAgentProcess: async () => { throw new Error('ps gone'); } });
    expect(session?.pid).toBeUndefined();
  });

  it('runs the real process walk without throwing', async () => {
    await expect(recordAgentEvent(home, event('SessionStart'), {})).resolves.toMatchObject({ activity: 'idle' });
  });

  it('names the agent from the transcript path when it can', async () => {
    const claude = await record('SessionStart', { transcript_path: '/Users/x/.claude/projects/p/s1.jsonl' });
    expect(claude?.agent).toBe('claude');
  });

  it('keeps a session id out of the path', async () => {
    await recordAgentEvent(home, { ...event('SessionStart'), session_id: '../../evil' }, env, live);
    expect(agentSessionPath(home, '../../evil')).toBe(path.join(home, 'state', 'sessions', '.._.._evil.json'));
    expect(await fs.readdir(path.join(home, 'state', 'sessions'))).toEqual(['.._.._evil.json']);
  });
});

async function writeSession(session: Partial<AgentSession> & { sessionId: string }) {
  const full = { agent: 'codex', activity: 'idle', since: new Date().toISOString(), cwd: '/work/T-1', ...session };
  await fs.mkdir(path.join(home, 'state', 'sessions'), { recursive: true });
  await fs.writeFile(agentSessionPath(home, session.sessionId), JSON.stringify(full));
}

/** A pid that is certainly not running */
async function deadPid(): Promise<number> {
  const { spawn } = await import('child_process');
  const child = spawn('true');
  await new Promise(resolve => child.on('exit', resolve));
  return child.pid!;
}

describe('readAgentSessions', () => {
  it('reads a dead pid as ended', async () => {
    await writeSession({ sessionId: 'dead', activity: 'busy', pid: await deadPid() });
    await writeSession({ sessionId: 'alive', activity: 'busy', pid: process.pid });
    const sessions = await readAgentSessions(home);
    expect(Object.fromEntries(sessions.map(s => [s.sessionId, s.activity]))).toEqual({ dead: 'ended', alive: 'busy' });
  });

  it('expires a pid-less session after 12 hours', async () => {
    await writeSession({ sessionId: 'old', activity: 'waiting', since: new Date(Date.now() - 13 * 3600e3).toISOString() });
    await writeSession({ sessionId: 'new', activity: 'waiting' });
    const sessions = await readAgentSessions(home);
    expect(Object.fromEntries(sessions.map(s => [s.sessionId, s.activity]))).toEqual({ old: 'ended', new: 'waiting' });
  });

  it('skips unreadable files and sorts most recent first', async () => {
    await writeSession({ sessionId: 'a', since: '2026-01-01T00:00:00Z', activity: 'ended' });
    await writeSession({ sessionId: 'b', since: '2026-02-01T00:00:00Z', activity: 'ended' });
    await fs.writeFile(path.join(home, 'state', 'sessions', 'junk.json'), '{');
    expect((await readAgentSessions(home)).map(s => s.sessionId)).toEqual(['b', 'a']);
  });
});

describe('sweepAgentSessions', () => {
  it('drops ended sessions past 30 days and keeps five per cwd', async () => {
    const now = new Date('2026-11-16T12:00:00Z');
    const daysAgo = (n: number) => new Date(now.getTime() - n * 86400e3).toISOString();

    await writeSession({ sessionId: 'ancient', activity: 'ended', since: daysAgo(31) });
    for (let n = 1; n <= 7; n++) await writeSession({ sessionId: `e${n}`, activity: 'ended', since: daysAgo(n), cwd: '/work/A' });
    await writeSession({ sessionId: 'other-cwd', activity: 'ended', since: daysAgo(20), cwd: '/work/B' });
    // Dead pid: effectively ended, so it counts and goes
    await writeSession({ sessionId: 'killed', activity: 'busy', since: daysAgo(40), pid: await deadPid() });
    // Live, however old: never touched
    await writeSession({ sessionId: 'live', activity: 'busy', since: daysAgo(60), pid: process.pid });
    await fs.writeFile(path.join(home, 'state', 'sessions', 'junk.json'), 'nope');

    const removed = (await sweepAgentSessions(home, now)).map(file => path.basename(file, '.json')).sort();
    expect(removed).toEqual(['ancient', 'e6', 'e7', 'junk', 'killed']);

    const left = (await readAgentSessions(home, now)).map(s => s.sessionId).sort();
    expect(left).toEqual(['e1', 'e2', 'e3', 'e4', 'e5', 'live', 'other-cwd']);
  });
});

describe('sessions by task', () => {
  const ws = (taskId: string, p: string): Workspace => ({ taskId, repo: 'r', repoPath: '/r', path: p, branch: `me/${taskId}`, head: null, main: false });
  const s = (sessionId: string, cwd: string): AgentSession => ({ sessionId, agent: 'codex', activity: 'idle', since: '2026-01-01', cwd });

  it('attributes by cwd, deepest workspace first', () => {
    const workspaces = [ws('T-1', '/wt/T-1'), ws('T-2', '/wt/T-1/nested/T-2'), ws('T-1', '/other/T-1')];
    const sessions = [s('a', '/wt/T-1/src'), s('b', '/wt/T-1/nested/T-2'), s('c', '/other/T-1'), s('d', '/wt/T-10'), s('e', '/elsewhere')];

    expect(sessionsForTask(sessions, workspaces.filter(w => w.taskId === 'T-1')).map(x => x.sessionId)).toEqual(['a', 'b', 'c']);

    const grouped = sessionsByTask(sessions, workspaces);
    expect(grouped.get('T-1')?.map(x => x.sessionId)).toEqual(['a', 'c']);
    expect(grouped.get('T-2')?.map(x => x.sessionId)).toEqual(['b']);
  });
});
