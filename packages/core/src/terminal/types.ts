import { ForegroundJob } from './processes';

/**
 * One live terminal session, as the terminal itself reports it.
 *
 * Deliberately says nothing about tasks or agents: a driver knows about
 * windows and processes, and `terminalSessions.ts` is what turns that into
 * "this is SABIN-0017's Codex".
 */
export interface TerminalSession {
  /** Stable for the life of the session; the key `focus()` takes */
  id: string;
  tty: string | null;
  windowId: string;
  /** 1-based, as the terminal counts them */
  tabIndex: number;
  /**
   * The tty's foreground process group, leader first.
   *
   * A group, not a process, because the interesting one is not always the
   * leader: a wrapper script can parent the agent, while Claude Code is
   * itself the parent of its mcpbridge. The choice belongs to
   * `terminalSessions.ts`, not here.
   */
  jobs: ForegroundJob[];
}

export interface OpenTabOptions {
  cwd: string;
  /** Shell command to run; omitted leaves you at a prompt */
  command?: string;
  /** Tab title, set as an override so the shell prompt cannot undo it */
  title?: string;
  /**
   * Put the tab in this window. A window that has since been closed falls
   * back to a new one, so a stale id is never an error.
   */
  windowId?: string;
  /** Ignore `windowId` and make a new window */
  newWindow?: boolean;
  /** Tags the session as this task's (`user.sabinTask`), in a variable the shell cannot clobber */
  taskId?: string;
}

export interface TerminalDriver {
  readonly name: string;
  /** Whether this driver can talk to a running terminal at all */
  isAvailable(): Promise<boolean>;
  listSessions(): Promise<TerminalSession[]>;
  /** Bring a session to the front: its window, its tab, and the app itself */
  focus(sessionId: string): Promise<boolean>;
  /** Open a tab, by preference in a window that is already this task's */
  openTab(options: OpenTabOptions): Promise<void>;
}
