import path from 'path';
import {
  resolveSabinDir,
  readConfig,
  resolveWorkspace,
  currentSessionId,
  writeAgentState,
  clearAgentState,
  isAgentActivity,
  availableAgents,
  findAncestor,
  SabinConfig
} from '@sabin/core';

/**
 * The agent whose hook this is, found by walking up our own process tree.
 *
 * `SABIN_AGENT` covers the agents Sabin launched; this covers the ones you
 * started by hand, and gives both a pid - which is what lets a state be
 * disbelieved after the agent is killed without its SessionEnd hook running.
 */
async function findAgentProcess(config: SabinConfig): Promise<{ name: string; pid: number } | null> {
  const agents = availableAgents(config);

  const found = await findAncestor(program =>
    Object.entries(agents).some(
      ([name, definition]) => program === name || path.basename(definition.command) === program
    )
  );
  if (!found) return null;

  const name = Object.keys(agents).find(
    key => found.program === key || path.basename(agents[key].command) === found.program
  );

  return { name: name ?? found.program, pid: found.pid };
}

/**
 * Record what the agent in this terminal is doing. Called by agent hooks.
 *
 * Hidden from `--help` because it is plumbing: you never type it, a hook
 * does, several times a turn.
 *
 * **It never fails.** Every path here exits 0, including the ones that did
 * nothing - a hook that errors or writes to stderr is a hook that interrupts
 * the agent it exists to watch. Not being able to record activity is not a
 * problem worth showing anyone.
 */
export async function agentState(activity: string): Promise<void> {
  try {
    // No terminal session means nothing to attach the state to: the state
    // file is keyed by the session so the UI can join it to a live terminal
    const sessionId = currentSessionId();
    if (!sessionId) return;

    const { sabinDir } = await resolveSabinDir();

    if (activity === 'gone') {
      await clearAgentState(sabinDir, sessionId);
      return;
    }

    if (!isAgentActivity(activity)) return;

    const config = await readConfig(sabinDir);
    const workspace = await resolveWorkspace({ sabinDir, config }).catch(() => null);
    const agent = await findAgentProcess(config);

    await writeAgentState(sabinDir, {
      sessionId,
      activity,
      since: new Date().toISOString(),
      ticket: workspace?.ticket,
      agent: process.env.SABIN_AGENT ?? agent?.name,
      pid: agent?.pid
    });
  } catch {
    // Deliberately silent - see above
  }
}
