import { TerminalDriver, TerminalSession } from './types';
import { ITerm2Driver } from './iterm2';

export * from './types';
export * from './processes';
export { ITerm2Driver } from './iterm2';

/**
 * What every caller gets when there is no terminal to talk to: an empty list,
 * not an error.
 *
 * Sabin works in a plain shell, over SSH, and inside VS Code's terminal.
 * Terminal awareness is a convenience layered on top, so its absence has to
 * read as "no sessions" everywhere - the moment it throws, `sabin sessions`
 * becomes a command that fails on half the machines it runs on.
 */
export const NULL_DRIVER: TerminalDriver = {
  name: 'none',
  isAvailable: async () => false,
  listSessions: async (): Promise<TerminalSession[]> => [],
  focus: async () => false,
  openTab: async () => {}
};

/**
 * The driver for the terminal in use, or the null driver.
 *
 * Only iTerm2 today. A second driver (tmux, WezTerm) is a new file plus a
 * branch here - which is the reason `TerminalDriver` exists at all.
 */
export async function resolveDriver(env: NodeJS.ProcessEnv = process.env): Promise<TerminalDriver> {
  if (process.platform !== 'darwin') return NULL_DRIVER;

  const iterm = new ITerm2Driver();

  // Inside iTerm2 we can skip asking System Events whether it is running
  if (env.TERM_PROGRAM === 'iTerm.app') return iterm;

  // Elsewhere - a VS Code terminal, a cron job - it may still be running with
  // the sessions we care about in it
  return (await iterm.isAvailable()) ? iterm : NULL_DRIVER;
}

/**
 * The session this process is running in, if it is running in one.
 *
 * iTerm2 exports `ITERM_SESSION_ID` as `w0t1p0:<uuid>` - the prefix is a
 * position and moves around, the uuid is the same id `listSessions()`
 * reports. Free to read, so "you are here" costs no extra Apple Event.
 */
export function currentSessionId(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.ITERM_SESSION_ID;
  if (!raw) return null;

  const colon = raw.indexOf(':');
  return colon === -1 ? raw : raw.slice(colon + 1);
}
