import fs from 'fs/promises';
import path from 'path';
import { homePaths } from './home';
import { writeFileAtomic, isWithin } from './fs';
import { findAncestor } from './terminal/processes';
import { currentSessionId } from './terminal';
import type { Workspace } from './workspaces';

export const AGENT_ACTIVITIES = ['busy', 'waiting', 'idle', 'ended'] as const;

export type AgentActivity = typeof AGENT_ACTIVITIES[number];

export function isAgentActivity(value: unknown): value is AgentActivity {
  return typeof value === 'string' && (AGENT_ACTIVITIES as readonly string[]).includes(value);
}

/** The agents Sabin recognises, by process name */
export const KNOWN_AGENTS = ['claude', 'codex'] as const;

/**
 * What one agent session is doing, as its hooks last reported. One file per
 * agent session id, in state/sessions/. Ended sessions are kept: they are the
 * "where I left off" record.
 */
export interface AgentSession {
  /** The agent's own session id (what `codex resume <id>` takes) */
  sessionId: string;
  agent: 'claude' | 'codex' | string;
  activity: AgentActivity;
  /** ISO, the last activity change */
  since: string;
  cwd: string;
  /** The agent process, for liveness */
  pid?: number;
  /** iTerm2 session GUID, for focus */
  termSessionId?: string;
  lastPrompt?: string;
  lastPromptAt?: string;
  lastMessage?: string;
  lastMessageAt?: string;
}

/** Cap on recorded prompt and message text */
export const AGENT_TEXT_LIMIT = 4000;
/** Ended sessions older than this are swept */
export const ENDED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** At most this many ended sessions are kept per cwd */
export const ENDED_PER_CWD = 5;
/**
 * How long a live-looking session with no pid is believed. Without a pid
 * there is no liveness signal at all, and trusting it for ever brings back
 * the permanent "busy" badge of an agent killed mid-turn.
 */
export const PIDLESS_TTL_MS = 12 * 60 * 60 * 1000;

export function agentSessionPath(home: string, sessionId: string): string {
  // Session ids arrive in a hook payload, so they never go straight into a path
  return path.join(homePaths(home).sessionsDir, `${sessionId.replace(/[^A-Za-z0-9._-]/g, '_')}.json`);
}

function truncate(text: unknown): string | undefined {
  if (typeof text !== 'string') return undefined;
  return text.length > AGENT_TEXT_LIMIT ? `${text.slice(0, AGENT_TEXT_LIMIT - 1)}…` : text;
}

/**
 * Notification types (Claude Code) that mean the agent is blocked on you.
 * `elicitation_dialog` is an MCP server asking a question - also a wait.
 */
const WAITING_NOTIFICATIONS = new Set(['permission_prompt', 'idle_prompt', 'elicitation_dialog']);

/**
 * The activity an event moves a session to, or null when it changes nothing.
 *
 * `PostToolUse` only matters as the end of a wait: approving a permission
 * fires no event of its own, so the tool finishing is the first sign the
 * agent is working again. Mid-turn it would only be noise.
 */
export function activityForEvent(payload: Record<string, unknown>, current: AgentActivity | null): AgentActivity | null {
  switch (payload.hook_event_name) {
    case 'SessionStart':
      // Auto-compaction restarts the session mid-turn; the agent is still working
      return payload.source === 'compact' && current && current !== 'ended' ? null : 'idle';
    case 'UserPromptSubmit': return 'busy';
    case 'PermissionRequest': return 'waiting';
    case 'Notification': {
      // Older Claude Code sent no type; every notification then was a wait
      const type = payload.notification_type;
      return typeof type !== 'string' || WAITING_NOTIFICATIONS.has(type) ? 'waiting' : null;
    }
    case 'PostToolUse': return current === 'waiting' ? 'busy' : null;
    case 'Stop': return 'idle';
    case 'SessionEnd': return 'ended';
    default: return null;
  }
}

/** Which agent wrote a payload, from its transcript path, when that says */
function agentFromPayload(payload: Record<string, unknown>): string | null {
  const transcript = typeof payload.transcript_path === 'string' ? payload.transcript_path : '';
  if (transcript.includes(`${path.sep}.codex${path.sep}`)) return 'codex';
  if (transcript.includes(`${path.sep}.claude${path.sep}`)) return 'claude';
  return null;
}

/** The nearest agent ancestor of this process - a hook's parent is a transient shell */
async function findAgentProcess(): Promise<{ pid: number; agent: string } | null> {
  const found = await findAncestor(program => (KNOWN_AGENTS as readonly string[]).includes(program));
  return found ? { pid: found.pid, agent: found.program } : null;
}

export interface RecordAgentEventOptions {
  /** Defaults to now */
  now?: Date;
  /** Override pid discovery; tests use this so they never depend on their own process tree */
  findAgentProcess?: () => Promise<{ pid: number; agent: string } | null>;
}

/**
 * Apply one hook event to its session file. What `sabin agent-state` runs,
 * with the hook's stdin JSON as `payload` (string or parsed).
 *
 * Never throws and never prints: a hook that fails, or writes to stdout,
 * interrupts or corrupts the agent it exists to watch. Returns the session
 * as written, or null when nothing was written (no session id, an event that
 * changes nothing, or any failure).
 */
export async function recordAgentEvent(
  home: string,
  payload: unknown,
  env: NodeJS.ProcessEnv = process.env,
  options: RecordAgentEventOptions = {}
): Promise<AgentSession | null> {
  try {
    const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
    if (!data || typeof data !== 'object') return null;
    const event = data as Record<string, unknown>;

    const sessionId = typeof event.session_id === 'string' ? event.session_id.trim() : '';
    if (!sessionId) return null;

    const file = agentSessionPath(home, sessionId);
    const existing = await readSessionFile(file);
    const activity = activityForEvent(event, existing?.activity ?? null);
    if (!activity) return null;

    const now = (options.now ?? new Date()).toISOString();

    // One process-tree walk per agent process, not per event: reuse the pid
    // until it dies (a `codex resume` brings the same session back in a new one)
    let pid = existing?.pid;
    let agent = existing?.agent;
    if (!pid || !isLive(pid)) {
      const found = await (options.findAgentProcess ?? findAgentProcess)().catch(() => null);
      pid = found?.pid;
      agent = found?.agent ?? agent;
    }

    const session: AgentSession = {
      ...existing,
      sessionId,
      agent: agentFromPayload(event) ?? agent ?? 'unknown',
      activity,
      since: existing && existing.activity === activity ? existing.since : now,
      cwd: typeof event.cwd === 'string' && event.cwd ? event.cwd : existing?.cwd ?? process.cwd()
    };
    if (pid) session.pid = pid;
    else delete session.pid;

    const termSessionId = currentSessionId(env);
    if (termSessionId) session.termSessionId = termSessionId;

    if (event.hook_event_name === 'UserPromptSubmit' && typeof event.prompt === 'string') {
      session.lastPrompt = truncate(event.prompt);
      session.lastPromptAt = now;
    }
    if (event.hook_event_name === 'Stop' && typeof event.last_assistant_message === 'string') {
      session.lastMessage = truncate(event.last_assistant_message);
      session.lastMessageAt = now;
    }

    await writeFileAtomic(file, `${JSON.stringify(session, null, 2)}\n`);

    // Bounded growth, paid only at the edges of a session rather than on
    // every turn
    if (event.hook_event_name === 'SessionStart' || event.hook_event_name === 'SessionEnd') {
      await sweepAgentSessions(home, options.now ?? new Date());
    }

    return session;
  } catch {
    return null;
  }
}

async function readSessionFile(file: string): Promise<AgentSession | null> {
  try {
    return asSession(JSON.parse(await fs.readFile(file, 'utf8')));
  } catch {
    return null;
  }
}

function asSession(value: any): AgentSession | null {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.sessionId !== 'string' || !isAgentActivity(value.activity)) return null;
  if (typeof value.since !== 'string' || typeof value.cwd !== 'string') return null;
  return value as AgentSession;
}

/**
 * Whether a pid could be signalled. Signal 0 delivers nothing; EPERM means
 * the process exists but belongs to someone else.
 */
export function isLive(pid: unknown): boolean {
  if (typeof pid !== 'number' || !Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * The activity to believe. An agent killed with `kill -9` never runs its
 * SessionEnd hook, so a dead pid reads as `ended`; with no pid, a session
 * silent for longer than `PIDLESS_TTL_MS` does too.
 */
export function effectiveActivity(session: AgentSession, now: Date = new Date()): AgentActivity {
  if (session.activity === 'ended') return 'ended';
  if (session.pid) return isLive(session.pid) ? session.activity : 'ended';
  const since = Date.parse(session.since);
  return Number.isFinite(since) && now.getTime() - since < PIDLESS_TTL_MS ? session.activity : 'ended';
}

async function readAllSessionFiles(home: string): Promise<{ file: string; session: AgentSession | null }[]> {
  const dir = homePaths(home).sessionsDir;
  let names: string[];
  try {
    names = (await fs.readdir(dir)).filter(name => name.endsWith('.json'));
  } catch {
    return [];
  }
  return Promise.all(names.map(async name => {
    const file = path.join(dir, name);
    return { file, session: await readSessionFile(file) };
  }));
}

/**
 * Every recorded session with its effective activity (see
 * `effectiveActivity`), most recent first. Unreadable files are skipped.
 */
export async function readAgentSessions(home: string, now: Date = new Date()): Promise<AgentSession[]> {
  return (await readAllSessionFiles(home))
    .map(entry => entry.session)
    .filter((session): session is AgentSession => session !== null)
    .map(session => ({ ...session, activity: effectiveActivity(session, now) }))
    .sort((a, b) => b.since.localeCompare(a.since));
}

/**
 * Delete ended sessions older than 30 days, keep at most the five most
 * recent ended sessions per cwd, and drop unreadable files. Live sessions
 * are never touched. Returns the files removed.
 */
export async function sweepAgentSessions(home: string, now: Date = new Date()): Promise<string[]> {
  const removed: string[] = [];
  const endedByCwd = new Map<string, { file: string; since: string }[]>();

  for (const { file, session } of await readAllSessionFiles(home)) {
    if (!session) {
      removed.push(file);
      continue;
    }
    if (effectiveActivity(session, now) !== 'ended') continue;

    const since = Date.parse(session.since);
    if (!Number.isFinite(since) || now.getTime() - since > ENDED_RETENTION_MS) {
      removed.push(file);
      continue;
    }
    const list = endedByCwd.get(session.cwd) ?? [];
    list.push({ file, since: session.since });
    endedByCwd.set(session.cwd, list);
  }

  for (const list of endedByCwd.values()) {
    list.sort((a, b) => b.since.localeCompare(a.since));
    removed.push(...list.slice(ENDED_PER_CWD).map(entry => entry.file));
  }

  await Promise.all(removed.map(file => fs.rm(file, { force: true }).catch(() => undefined)));
  return removed;
}

/** Sessions whose cwd is inside one of `workspaces` */
export function sessionsForTask(sessions: AgentSession[], workspaces: Workspace[]): AgentSession[] {
  const roots = workspaces.map(workspace => path.resolve(workspace.path));
  return sessions.filter(session => {
    const cwd = path.resolve(session.cwd);
    return roots.some(root => isWithin(cwd, root));
  });
}

/**
 * Sessions grouped by the task whose workspace holds their cwd. The deepest
 * workspace wins when worktrees nest; sessions in no workspace are left out.
 */
export function sessionsByTask(sessions: AgentSession[], workspaces: Workspace[]): Map<string, AgentSession[]> {
  const roots = workspaces
    .map(workspace => ({ taskId: workspace.taskId, root: path.resolve(workspace.path) }))
    .sort((a, b) => b.root.length - a.root.length);

  const grouped = new Map<string, AgentSession[]>();
  for (const session of sessions) {
    const cwd = path.resolve(session.cwd);
    const match = roots.find(entry => isWithin(cwd, entry.root));
    if (!match) continue;
    grouped.set(match.taskId, [...(grouped.get(match.taskId) ?? []), session]);
  }
  return grouped;
}
