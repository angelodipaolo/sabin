import {
  listWorktrees,
  mainWorktreeRoot,
  groupSessionsByTicket,
  windowForTicket,
  resolveDriver,
  SabinConfig,
  TerminalDriver,
  TicketSession
} from '@sabin/core';

export interface TicketTerminals {
  driver: TerminalDriver;
  sessions: TicketSession[];
  /** The window this ticket's terminals already live in, if any */
  windowId: string | null;
}

/**
 * Everything the terminal commands need to know about one ticket.
 *
 * Shared by `implement`/`plan`/`review` and by `term`, so a ticket's tabs all
 * land in the same window whichever of them opened it.
 */
export async function ticketTerminals(
  ticket: string,
  projectRoot: string,
  config: SabinConfig
): Promise<TicketTerminals> {
  const driver = await resolveDriver();
  if (driver.name === 'none') return { driver, sessions: [], windowId: null };

  const mainRoot = (await mainWorktreeRoot(projectRoot)) ?? projectRoot;
  const [live, worktrees] = await Promise.all([driver.listSessions(), listWorktrees(mainRoot)]);
  const grouped = groupSessionsByTicket(live, worktrees, config);

  return {
    driver,
    sessions: grouped.get(ticket) ?? [],
    windowId: windowForTicket(ticket, grouped)
  };
}
