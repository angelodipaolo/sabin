import chalk from 'chalk';
import {
  listWorktrees,
  mainWorktreeRoot,
  ticketFromBranch,
  groupSessionsByTicket,
  readAgentStates,
  pruneAgentStates,
  resolveDriver,
  currentSessionId,
  parseTicketArg,
  TicketSession
} from '@sabin/core';
import { loadProject, fail } from '../workspace-context';
import { activityBadge } from '../activity';

interface SessionsOptions {
  json?: boolean;
  /** Also list ticket worktrees with nothing running in them */
  all?: boolean;
}

/**
 * Every live terminal, grouped by the ticket whose worktree it is sitting in.
 *
 * The read half of worktree navigation: `sabin jump` acts on exactly this
 * list, the VS Code tree shows it, and on its own it answers "what is
 * actually running right now" without walking the tab bar.
 */
export async function sessions(ticketArg: string | undefined, options: SessionsOptions): Promise<void> {
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

  // An agent killed mid-turn leaves a file saying "busy" behind it; the live
  // session list is the only thing that knows it is gone
  await pruneAgentStates(sabinDir, live.map(session => session.id));

  const grouped = groupSessionsByTicket(live, worktrees, config, states);
  const here = currentSessionId();

  const idle = options.all ? idleTickets(worktrees, grouped, config) : [];
  const tickets = [...new Set([...grouped.keys(), ...idle])]
    .sort()
    .filter(ticket => !wanted || ticket === wanted);

  if (options.json) {
    console.log(JSON.stringify({
      driver: driver.name,
      current: here,
      tickets: tickets.map(ticket => ({
        ticket,
        sessions: (grouped.get(ticket) ?? []).map(session => ({
          ...session,
          current: session.id === here
        }))
      }))
    }, null, 2));
    return;
  }

  if (driver.name === 'none') {
    console.log(chalk.gray('No terminal Sabin can talk to (iTerm2 is not running).'));
    return;
  }

  if (tickets.length === 0) {
    console.log(chalk.gray(wanted ? `No terminals in ${wanted}'s worktree` : 'No terminals in any ticket worktree'));
    return;
  }

  for (const ticket of tickets) {
    const sessions = grouped.get(ticket) ?? [];
    console.log(chalk.bold(ticket) + (sessions.length === 0 ? chalk.gray('  no terminals') : ''));
    for (const session of sessions) {
      console.log(`  ${describe(session, session.id === here)}`);
    }
  }
}

/** Tickets that have a worktree but nothing running in it */
function idleTickets(
  worktrees: { path: string; branch?: string }[],
  grouped: Map<string, TicketSession[]>,
  config: Parameters<typeof ticketFromBranch>[1]
): string[] {
  const idle: string[] = [];

  for (const worktree of worktrees) {
    if (!worktree.branch) continue;
    const ticket = ticketFromBranch(worktree.branch, config);
    if (ticket && !grouped.has(ticket)) idle.push(ticket);
  }

  return idle;
}

function describe(session: TicketSession, current: boolean): string {
  const label = session.role === 'agent'
    ? chalk.cyan((session.agent ?? 'agent').padEnd(8))
    : chalk.gray((session.job?.program ?? 'shell').padEnd(8));

  const step = session.step ? chalk.magenta(session.step) : '';
  const badge = activityBadge(session.activity, session.activitySince);
  const where = chalk.gray(`win ${session.windowId} · tab ${session.tabIndex}`);

  return [label, step, badge, where, current ? chalk.green('← you are here') : '']
    .filter(Boolean)
    .join('  ');
}
