import fs from 'fs/promises';
import path from 'path';

export const AGENT_ACTIVITIES = ['busy', 'waiting', 'idle'] as const;

export type AgentActivity = typeof AGENT_ACTIVITIES[number];

export function isAgentActivity(value: string): value is AgentActivity {
  return (AGENT_ACTIVITIES as readonly string[]).includes(value);
}

export interface AgentState {
  /** The terminal session the agent is running in - the join key */
  sessionId: string;
  activity: AgentActivity;
  /** ISO timestamp of the last change, for "waiting for 6 minutes" */
  since: string;
  ticket?: string;
  agent?: string;
  /**
   * The agent process, so a state can be disbelieved without asking the
   * terminal anything.
   *
   * An agent killed with `kill -9` never runs its SessionEnd hook, so its
   * last state - usually "busy" - would otherwise sit there for ever. A pid
   * makes staleness a question anyone can answer with a signal 0, including
   * the VS Code extension, which has no way to enumerate terminals.
   */
  pid?: number;
}

/**
 * Where agent activity is recorded, inside the Sabin directory.
 *
 * Inside it on purpose: the VS Code extension already watches the whole Sabin
 * directory, so state written here reaches the UI as a file event, with no
 * polling and no subprocess.
 */
export function agentStateDir(sabinDir: string): string {
  return path.join(sabinDir, 'state', 'sessions');
}

function stateFile(sabinDir: string, sessionId: string): string {
  // Session ids are UUIDs, but they arrive from the environment, so they are
  // never trusted straight into a path
  return path.join(agentStateDir(sabinDir), `${sessionId.replace(/[^A-Za-z0-9._-]/g, '_')}.json`);
}

/**
 * Record what an agent is doing.
 *
 * Called by agent hooks, several times a turn, so it stays a single small
 * write and never throws: a hook that fails is a hook that interrupts the
 * agent it was supposed to be watching.
 */
export async function writeAgentState(sabinDir: string, state: AgentState): Promise<void> {
  try {
    await fs.mkdir(agentStateDir(sabinDir), { recursive: true });
    await fs.writeFile(stateFile(sabinDir, state.sessionId), `${JSON.stringify(state, null, 2)}\n`);
    // Every agent writes several times a turn, so this is the cheapest place
    // to notice that some *other* agent died without saying so
    await sweepDeadStates(sabinDir);
  } catch {
    // Nothing to do about it, and nothing worth interrupting the agent for
  }
}

/** Delete states whose process is gone - the killed-without-SessionEnd case */
async function sweepDeadStates(sabinDir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(agentStateDir(sabinDir));
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const file = path.join(agentStateDir(sabinDir), entry);
    try {
      const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
      if (isCurrent(parsed ?? {})) continue;
    } catch {
      continue;
    }
    await fs.rm(file, { force: true });
  }
}

export async function clearAgentState(sabinDir: string, sessionId: string): Promise<void> {
  try {
    await fs.rm(stateFile(sabinDir, sessionId), { force: true });
  } catch {
    // As above
  }
}

/**
 * Every recorded state, keyed by terminal session.
 *
 * A file whose session is no longer open is ignored rather than trusted -
 * an agent killed mid-turn leaves its last state behind saying "busy", and
 * believing it would show a busy agent forever. `pruneAgentStates` clears
 * those up for real.
 */
export async function readAgentStates(sabinDir: string): Promise<Map<string, AgentState>> {
  const states = new Map<string, AgentState>();

  let entries: string[];
  try {
    entries = await fs.readdir(agentStateDir(sabinDir));
  } catch {
    return states;
  }

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    try {
      const parsed = JSON.parse(await fs.readFile(path.join(agentStateDir(sabinDir), entry), 'utf8'));
      if (parsed?.sessionId && isAgentActivity(parsed.activity) && isCurrent(parsed)) {
        states.set(parsed.sessionId, parsed as AgentState);
      }
    } catch {
      // A half-written or hand-edited file is skipped, not fatal
    }
  }

  return states;
}

/**
 * Whether the process that wrote a state is still running.
 *
 * Signal 0 does not deliver anything - it only asks whether the pid could be
 * signalled. A state with no pid recorded is trusted: it predates this, or
 * came from somewhere the agent process could not be identified, and dropping
 * it would silently blank the badges.
 */
export function isLive(pid: unknown): boolean {
  if (typeof pid !== 'number' || !Number.isFinite(pid) || pid <= 0) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means it exists and belongs to someone else - still alive
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * How long a state with no pid is believed.
 *
 * Process-tree discovery finds the agent almost always, but "almost" is the
 * problem: a state with no pid has no liveness signal at all, and trusting it
 * for ever brings back exactly the permanent-badge bug the pid was added to
 * fix. Long enough that a real agent waiting on you overnight is not thrown
 * away, short enough that a lost one does not haunt the board.
 */
export const PIDLESS_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Whether a state is still worth believing.
 *
 * A recorded pid is the good answer. Without one, age is the only signal
 * left.
 */
export function isCurrent(state: { pid?: unknown; since?: unknown }, now = Date.now()): boolean {
  if (typeof state.pid === 'number' && Number.isFinite(state.pid) && state.pid > 0) {
    return isLive(state.pid);
  }

  const since = typeof state.since === 'string' ? Date.parse(state.since) : NaN;
  if (!Number.isFinite(since)) return false;

  return now - since < PIDLESS_TTL_MS;
}

/** Delete the state of every session that is no longer open */
export async function pruneAgentStates(sabinDir: string, liveSessionIds: Iterable<string>): Promise<void> {
  const live = new Set(liveSessionIds);

  // Reads the directory rather than `readAgentStates`, which already hides
  // dead-pid states - those are exactly the files that need deleting
  let entries: string[];
  try {
    entries = await fs.readdir(agentStateDir(sabinDir));
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const file = path.join(agentStateDir(sabinDir), entry);
    try {
      const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
      if (parsed?.sessionId && live.has(parsed.sessionId) && isCurrent(parsed)) continue;
    } catch {
      // Unreadable files are swept too
    }
    await fs.rm(file, { force: true });
  }
}
