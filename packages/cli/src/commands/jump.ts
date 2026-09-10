import fs from 'fs';
import chalk from 'chalk';
import {
  listWorktrees,
  mainWorktreeRoot,
  ticketFromBranch,
  groupSessionsByTicket,
  readAgentStates,
  resolveDriver,
  currentSessionId,
  parseTicketArg,
  parseHotkey,
  writeJumpProfile,
  InvalidHotkeyError,
  TicketSession
} from '@sabin/core';
import { loadProject, fail } from '../workspace-context';
import { pick, PickerRow } from '../picker';
import { activityText } from '../activity';

interface JumpOptions {
  /** Always show the picker, even when one target is obvious */
  picker?: boolean;
  /** Never show the picker: take the top-ranked session and go */
  any?: boolean;
  installHotkey?: boolean;
  key?: string;
}

/**
 * Exit code for "there is nothing to focus".
 *
 * Distinct from a plain failure so a caller can fall back to opening a
 * terminal without treating *every* non-zero exit - a bad ticket, an
 * ambiguous choice - as "no terminal exists".
 */
export const NO_SESSIONS = 3;

/** A ticket with a worktree but nothing running in it */
interface IdleTicket {
  ticket: string;
}

type Target = TicketSession | IdleTicket;

/**
 * Go to a ticket's terminal.
 *
 * The command the whole feature is for: worktrees are navigated by ticket,
 * not by hunting along a tab bar. `sabin jump SABIN-0017` when you know where
 * you are going, the picker when you do not.
 */
export async function jump(ticketArg: string | undefined, options: JumpOptions): Promise<void> {
  if (options.installHotkey) return installHotkey(options.key);

  const { sabinDir, projectRoot, config } = await loadProject();

  let wanted: string | null = null;
  if (ticketArg) {
    const parsed = parseTicketArg(ticketArg);
    if (!parsed) fail(`"${ticketArg}" is not a ticket. Expected something like SABIN-0017.`);
    wanted = parsed.ticket;
  }

  const driver = await resolveDriver();
  const mainRoot = (await mainWorktreeRoot(projectRoot)) ?? projectRoot;
  const [live, worktrees, states] = await Promise.all([
    driver.listSessions(),
    listWorktrees(mainRoot),
    readAgentStates(sabinDir)
  ]);

  if (driver.name === 'none') {
    fail('No terminal Sabin can talk to (iTerm2 is not running).', NO_SESSIONS);
  }

  const grouped = groupSessionsByTicket(live, worktrees, config, states);
  const here = currentSessionId();

  if (wanted) {
    const sessions = grouped.get(wanted) ?? [];

    // The one failure a caller can act on: there is nothing to focus, so
    // something else has to open a terminal. Every other outcome below either
    // focuses or asks, and a script can tell the difference by this alone.
    if (sessions.length === 0) {
      fail(
        `${wanted} has no terminal open.\n` +
        `Start one:  sabin term ${wanted}`,
        NO_SESSIONS
      );
    }

    if (!options.picker) {
      // One obvious answer needs no picker: the only session, or the only
      // agent among several
      const agents = sessions.filter(session => session.role === 'agent');
      const direct = sessions.length === 1 ? sessions[0] : agents.length === 1 ? agents[0] : null;
      if (direct) return focus(driver, direct);

      // `--any` is for callers with no terminal to ask in - the VS Code
      // button, a script. `groupSessionsByTicket` has already sorted these by
      // what needs you most, so the first row is the deterministic answer.
      if (options.any) return focus(driver, sessions[0]);
    }
  }

  const rows = buildRows(grouped, worktrees, config, here, wanted);
  if (rows.length === 0) {
    fail(wanted ? `Nothing open for ${wanted}.` : 'No terminals in any ticket worktree.');
  }

  // `--any` with no ticket: the most urgent session anywhere
  if (options.any && !options.picker) {
    const first = rows.find(row => 'id' in row.value);
    if (first) return focus(driver, first.value as TicketSession);
    fail('No terminals in any ticket worktree.', NO_SESSIONS);
  }

  // Piped or redirected - there is no picker to show, so print what it
  // would have offered rather than dying on a missing terminal
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(chalk.gray('More than one candidate, and no terminal to pick in:'));
    for (const row of rows) console.error(`  ${row.title}  ${chalk.gray(row.detail)}`);
    process.exit(1);
  }

  const chosen = await pick(rows, {
    title: wanted ? `Jump to ${wanted}` : 'Jump to a worktree',
    empty: 'No ticket matches'
  });

  if (!chosen) return;

  if ('id' in chosen) return focus(driver, chosen);

  // A ticket with a worktree and nothing running in it. Printing the command
  // rather than running it: a mistyped filter should never be able to launch
  // an autonomous agent.
  console.log(`${chalk.bold(chosen.ticket)} has no terminal open.`);
  console.log(`  sabin implement ${chosen.ticket}`);
}

async function focus(
  driver: { focus(id: string): Promise<boolean> },
  session: TicketSession
): Promise<void> {
  const found = await driver.focus(session.id);
  if (!found) {
    fail(`That terminal has gone away. Run \`sabin sessions\` for what is still open.`);
  }
}

function buildRows(
  grouped: Map<string, TicketSession[]>,
  worktrees: { path: string; branch?: string }[],
  config: Parameters<typeof ticketFromBranch>[1],
  here: string | null,
  wanted: string | null
): PickerRow<Target>[] {
  const rows: PickerRow<Target>[] = [];

  for (const ticket of [...grouped.keys()].sort()) {
    if (wanted && ticket !== wanted) continue;

    for (const session of grouped.get(ticket)!) {
      const what = session.role === 'agent' ? session.agent ?? 'agent' : session.job?.program ?? 'shell';
      rows.push({
        value: session,
        title: `${ticket}  ${what}`,
        detail: [
          activityText(session.activity, session.activitySince),
          session.step,
          `tab ${session.tabIndex}`,
          session.id === here ? 'you are here' : ''
        ].filter(Boolean).join(' · '),
        search: `${ticket} ${what} ${session.step ?? ''} ${session.activity ?? ''}`
      });
    }
  }

  if (wanted) return rows;

  // Tickets with a worktree and nothing running, last and dimmed - they are
  // still the answer to "where is that work", just not somewhere to jump
  for (const worktree of worktrees) {
    if (!worktree.branch) continue;
    const ticket = ticketFromBranch(worktree.branch, config);
    if (!ticket || grouped.has(ticket)) continue;

    rows.push({
      value: { ticket },
      title: `${ticket}  —`,
      detail: 'no terminal',
      search: ticket,
      inactive: true
    });
  }

  return rows;
}

const DEFAULT_HOTKEY = 'opt+space';

/**
 * How to invoke this same Sabin from a profile that has no shell around it.
 *
 * An absolute path, because a hotkey window is not a login shell and may not
 * have your PATH. And `node <script>` when the script is not executable in
 * its own right - which is how Sabin runs from a worktree build, the exact
 * case where you are most likely to be trying the hotkey out before merging.
 */
function selfCommand(): string {
  const script = process.argv[1];

  try {
    fs.accessSync(script, fs.constants.X_OK);
    return shellQuote(script);
  } catch {
    return `${shellQuote(process.execPath)} ${shellQuote(script)}`;
  }
}

function shellQuote(value: string): string {
  return /^[\w./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

async function installHotkey(key: string | undefined): Promise<void> {
  const spec = key ?? DEFAULT_HOTKEY;

  try {
    const hotkey = parseHotkey(spec);
    const file = await writeJumpProfile({ command: `${selfCommand()} jump --picker`, hotkey });

    console.log(`${chalk.green('created')} ${file}`);
    console.log(`  Press ${chalk.bold(spec)} anywhere to open the picker.`);
    console.log(chalk.gray('  iTerm2 picks this up immediately. Delete the file to remove it.'));
  } catch (error) {
    if (error instanceof InvalidHotkeyError) fail(error.message);
    throw error;
  }
}
