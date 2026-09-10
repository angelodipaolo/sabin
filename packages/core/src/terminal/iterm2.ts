import { execFile } from 'child_process';
import { promisify } from 'util';
import { TerminalDriver, TerminalSession, OpenTabOptions } from './types';
import { foregroundJobs } from './processes';

const execFileAsync = promisify(execFile);

/**
 * Enumerate every session in three Apple Events.
 *
 * The obvious script - loop the sessions, read `variable named "path"` and
 * `"jobName"` on each - costs one event per read and measures 1.2s against 23
 * open sessions. This one asks for three nested lists and rebuilds the
 * window/tab/session structure by iterating them *outside* the tell block,
 * where iteration is free: 177ms for the same terminal.
 *
 * `tty` and `id` can be bulk-read because they are real AppleScript
 * properties of a session. Variables cannot, which is the whole reason cwd
 * and the running job come from `ps` and `lsof` instead.
 */
const LIST_SESSIONS = `
tell application "iTerm2"
  set wids to id of every window
  set idsNested to id of every session of every tab of every window
  set ttyNested to tty of every session of every tab of every window
end tell

set out to ""
repeat with wi from 1 to count of wids
  set wid to (item wi of wids) as text
  set tabsOfW to item wi of idsNested
  set ttyTabsOfW to item wi of ttyNested
  repeat with ti from 1 to count of tabsOfW
    set sIds to item ti of tabsOfW
    set sTtys to item ti of ttyTabsOfW
    repeat with si from 1 to count of sIds
      set out to out & wid & tab & ti & tab & (item si of sIds) & tab & (item si of sTtys) & linefeed
    end repeat
  end repeat
end repeat
return out
`;

/**
 * Focus by session id rather than by index. Window and tab positions shuffle
 * as tabs are opened and closed; the id does not.
 */
const FOCUS_SESSION = `
on run argv
  set target to item 1 of argv
  tell application "iTerm2"
    repeat with w in windows
      repeat with t in tabs of w
        repeat with s in sessions of t
          if (id of s) is target then
            select w
            select t
            select s
            activate
            return "ok"
          end if
        end repeat
      end repeat
    end repeat
  end tell
  return "missing"
end run
`;

/**
 * Open a tab in a named window, or a new window when that one has gone.
 *
 * The tab is also tagged with `user.sabinTicket`. The *title* cannot be
 * relied on - a zsh that writes the title on every prompt overwrites whatever
 * we set, and there is no way to stop it - but a user variable is a separate
 * channel nothing else writes to. Put `\(user.sabinTicket)` in a profile's
 * title format and the ticket sticks; leave it out and nothing is lost,
 * because attribution never depended on the title.
 *
 * The window is the ticket: `sabin implement` and `sabin review` on the same
 * ticket land beside each other, so ⌘1-⌘9 walks one ticket's terminals
 * instead of everything you have open. The tab is created but the window is
 * not raised - the shell you typed the command in stays yours.
 */
const OPEN_TAB = `
on run argv
  set targetWindowId to item 1 of argv
  set theTitle to item 2 of argv
  set theCommand to item 3 of argv
  set theTicket to item 4 of argv

  tell application "iTerm2"
    set theWindow to missing value
    if targetWindowId is not "" then
      repeat with w in windows
        if ((id of w) as text) is targetWindowId then
          set theWindow to w
          exit repeat
        end if
      end repeat
    end if

    if theWindow is missing value then
      set theWindow to (create window with default profile)
      tell current session of theWindow
        if theTicket is not "" then set variable named "user.sabinTicket" to theTicket
        if theTitle is not "" then set name to theTitle
        if theCommand is not "" then write text theCommand
      end tell
      return "window"
    end if

    tell theWindow
      set newTab to (create tab with default profile)
      tell current session of newTab
        if theTicket is not "" then set variable named "user.sabinTicket" to theTicket
        if theTitle is not "" then set name to theTitle
        if theCommand is not "" then write text theCommand
      end tell
    end tell
    return "tab"
  end tell
end run
`;

export class ITerm2Driver implements TerminalDriver {
  readonly name = 'iterm2';

  async isAvailable(): Promise<boolean> {
    try {
      // Asks whether the app is running without launching it, so a `sabin
      // sessions` on a machine with iTerm2 closed stays quiet
      const { stdout } = await execFileAsync('osascript', [
        '-e',
        'tell application "System Events" to return (exists process "iTerm2")'
      ]);
      return stdout.trim() === 'true';
    } catch {
      return false;
    }
  }

  async listSessions(): Promise<TerminalSession[]> {
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync('osascript', ['-e', LIST_SESSIONS], {
        maxBuffer: 4 * 1024 * 1024
      }));
    } catch {
      return [];
    }

    const jobs = await foregroundJobs();
    const sessions: TerminalSession[] = [];

    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue;
      const [windowId, tabIndex, id, tty] = line.split('\t');
      if (!id) continue;

      // ps reports "ttys018"; iTerm2 reports "/dev/ttys018"
      const device = tty ? tty.replace(/^\/dev\//, '') : null;

      sessions.push({
        id,
        tty: device ?? null,
        windowId,
        tabIndex: Number(tabIndex) || 1,
        jobs: (device ? jobs.get(device) : undefined) ?? []
      });
    }

    return sessions;
  }

  async openTab(options: OpenTabOptions): Promise<void> {
    const command = options.command
      ? `cd ${shellQuote(options.cwd)} && ${options.command}`
      : `cd ${shellQuote(options.cwd)}`;

    await execFileAsync('osascript', [
      '-e',
      OPEN_TAB,
      options.newWindow ? '' : options.windowId ?? '',
      options.title ?? '',
      command,
      options.ticket ?? ''
    ]);
  }

  async focus(sessionId: string): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync('osascript', ['-e', FOCUS_SESSION, sessionId]);
      return stdout.trim() === 'ok';
    } catch {
      return false;
    }
  }
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
