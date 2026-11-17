import fs from 'fs/promises';
import path from 'path';
import {
  AgentSession,
  NULL_DRIVER,
  TerminalDriver,
  Workspace,
  focusTerminal,
  openWorkspaceTab,
  readAgentSessions,
  resolveDriver,
  terminalTitle
} from '@sabin/core';
import { loadParts } from './snapshot';
import { testHooks } from './testHooks';

/**
 * Terminal actions. Each one is an explicit click - focus a tab, open a
 * shell, resume an ended session - which is why none of them breaks the rule
 * that Sabin never launches an agent on its own.
 *
 * With SABIN_APP_NO_TERMINAL=1 a recording fake stands in for iTerm2, so
 * tests and development never send it an Apple Event.
 */

export function terminalDisabled(): boolean {
  return process.env.SABIN_APP_NO_TERMINAL === '1';
}

function fakeDriver(): TerminalDriver {
  return {
    name: 'fake',
    isAvailable: async () => true,
    listSessions: async () => [],
    focus: async sessionId => {
      testHooks().terminal.push({ action: 'focus', sessionId });
      return true;
    },
    openTab: async options => {
      testHooks().terminal.push({ action: 'openTab', ...options });
    }
  };
}

async function driver(): Promise<TerminalDriver> {
  return terminalDisabled() ? fakeDriver() : resolveDriver();
}

/** A failure from osascript, turned into something a person can act on */
export function explainTerminalError(error: unknown): string {
  const text = error instanceof Error ? `${error.message} ${(error as { stderr?: string }).stderr ?? ''}` : String(error);
  if (/-1743|not authori[sz]ed|not allowed to send/i.test(text)) {
    return 'Sabin is not allowed to control iTerm2. Allow it in System Settings → Privacy & Security → Automation, then try again.';
  }
  if (/-600|isn.t running|not running|Application can.t be found/i.test(text)) {
    return 'iTerm2 is not running. Open iTerm2 and try again.';
  }
  return `iTerm2 did not respond: ${text.trim().split('\n')[0]}`;
}

const NO_ITERM = 'iTerm2 is not running. Open iTerm2 and try again.';

async function findSession(home: string, sessionId: string): Promise<AgentSession> {
  const session = (await readAgentSessions(home)).find(candidate => candidate.sessionId === sessionId);
  if (!session) throw new Error('That agent session no longer exists.');
  return session;
}

export async function focusSession(home: string, sessionId: string): Promise<void> {
  const session = await findSession(home, sessionId);
  if (!session.termSessionId) {
    throw new Error('This session did not record an iTerm2 tab, so there is nothing to focus.');
  }
  const resolved = await driver();
  if (resolved.name === NULL_DRIVER.name) throw new Error(NO_ITERM);
  let focused: boolean;
  try {
    focused = await focusTerminal(session.termSessionId, resolved);
  } catch (error) {
    throw new Error(explainTerminalError(error), { cause: error });
  }
  if (!focused) throw new Error('The iTerm2 tab for this session has been closed.');
}

/** The command that resumes a session in its own agent, or null for an agent we do not know */
export function resumeCommand(agent: string, sessionId: string): string | null {
  // Session ids arrive from hook payloads; only plain ones go anywhere near a shell
  if (!/^[A-Za-z0-9._:-]+$/.test(sessionId)) return null;
  if (agent === 'codex') return `codex resume ${sessionId}`;
  if (agent === 'claude') return `claude --resume ${sessionId}`;
  return null;
}

function deepestWorkspace(workspaces: Workspace[], dir: string): Workspace | null {
  let best: Workspace | null = null;
  for (const workspace of workspaces) {
    const relative = path.relative(workspace.path, dir);
    const inside = relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    if (inside && (!best || workspace.path.length > best.path.length)) best = workspace;
  }
  return best;
}

/**
 * Open a tab running the agent's resume command, in the directory the
 * session ran in (Claude Code keys its history by directory), in the task's
 * window when the session belongs to one.
 */
export async function resumeSession(home: string, sessionId: string): Promise<void> {
  const session = await findSession(home, sessionId);
  const command = resumeCommand(session.agent, session.sessionId);
  if (!command) throw new Error(`Sabin does not know how to resume a "${session.agent}" session.`);

  const cwd = await fs.realpath(session.cwd).catch(() => null);
  if (!cwd) throw new Error(`The session's directory no longer exists: ${session.cwd}`);

  const resolved = await driver();
  if (resolved.name === NULL_DRIVER.name) throw new Error(NO_ITERM);

  const { config, tasks, workspaces } = await loadParts(home);
  const workspace = deepestWorkspace(workspaces, cwd);
  try {
    if (workspace) {
      await openWorkspaceTab(config, tasks, { ...workspace, path: cwd }, {
        command,
        title: terminalTitle(workspace.taskId, session.agent),
        workspaces,
        driver: resolved
      });
    } else {
      await resolved.openTab({ cwd, command, title: session.agent, newWindow: true });
    }
  } catch (error) {
    throw new Error(explainTerminalError(error), { cause: error });
  }
}

/** A shell tab in one of the task's workspaces. The path must be one git reports for that task. */
export async function openTerminal(home: string, taskId: string, workspacePath: string): Promise<void> {
  const { config, tasks, workspaces } = await loadParts(home);
  const workspace = workspaces.find(candidate => candidate.taskId === taskId && candidate.path === workspacePath);
  if (!workspace) throw new Error('That worktree is not one of this task\'s workspaces.');

  const resolved = await driver();
  if (resolved.name === NULL_DRIVER.name) throw new Error(NO_ITERM);
  try {
    await openWorkspaceTab(config, tasks, workspace, { workspaces, driver: resolved });
  } catch (error) {
    throw new Error(explainTerminalError(error), { cause: error });
  }
}
