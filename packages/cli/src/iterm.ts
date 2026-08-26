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
 * Name the current tab after the ticket and pin it as a badge, so a row of
 * agent tabs reads as SABIN-0011, SABIN-0012... rather than "node".
 */
export function labelTab(name: string, ticket: string, out: NodeJS.WriteStream = process.stderr): void {
  if (!out.isTTY) return;

  // OSC 1: tab and window title. Understood by every xterm-alike.
  out.write(`\x1b]1;${name}\x07`);

  // OSC 1337 SetBadgeFormat: iTerm2 only, ignored elsewhere
  if (isITerm()) {
    out.write(`\x1b]1337;SetBadgeFormat=${Buffer.from(ticket).toString('base64')}\x07`);
  }
}

/**
 * Open a new iTerm2 tab in the front window, cd'd into `cwd` and running
 * `command`. Lets `sabin run --tab` kick an agent off while the shell you
 * typed it in stays free.
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
