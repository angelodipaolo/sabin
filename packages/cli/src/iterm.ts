import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * iTerm2 is where agents get run - one window per project, one tab per
 * worktree. These helpers keep those tabs legible without a plugin: plain
 * escape sequences that other terminals ignore.
 */
export function isITerm(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TERM_PROGRAM === 'iTerm.app';
}

/**
 * Name the current tab after the ticket, so a row of agent tabs reads as
 * SABIN-0011, SABIN-0012... rather than "node".
 *
 * The title and nothing else. iTerm2's badge paints the ticket across the
 * whole window in letters the size of the terminal, over the output you are
 * trying to read - a label the tab already carries, in the one place it is
 * in the way.
 */
export function labelTab(name: string, out: NodeJS.WriteStream = process.stderr): void {
  if (!out.isTTY) return;

  // OSC 1: tab and window title. Understood by every xterm-alike.
  out.write(`\x1b]1;${name}\x07`);
}

/**
 * Open a new iTerm2 tab in the front window, cd'd into `cwd` and running
 * `command`. Lets `sabin implement` kick an agent off in its own tab while
 * the shell you typed it in stays free.
 */
export async function openTab(cwd: string, command: string): Promise<void> {
  const script = [
    'tell application "iTerm2"',
    '  tell current window',
    '    set newTab to (create tab with default profile)',
    '    tell current session of newTab',
    `      write text ${appleScriptString(`cd ${shellQuote(cwd)} && ${command}`)}`,
    '    end tell',
    '  end tell',
    'end tell'
  ].join('\n');

  await execFileAsync('osascript', ['-e', script]);
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
