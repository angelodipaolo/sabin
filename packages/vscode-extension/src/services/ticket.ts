/** Anything a tree node or a posted message might carry a ticket on */
export interface TicketBearer {
  ticket?: string;
  workspace?: { ticket?: string };
}

/**
 * The ticket a command was invoked on, whatever shape it arrived in.
 *
 * A VS Code command reaches us four ways and they do not agree: a
 * `view/item/context` contribution passes the selected tree node, the index
 * posts a ticket string, an internal caller passes `{ ticket }`, and the
 * command palette passes nothing at all and means "whichever one the detail
 * view is on". Every command that takes a ticket has to handle all four, so it
 * lives here rather than being re-derived - and got wrong - per command.
 *
 * Deliberately free of any `vscode` import, so it can be tested as what it
 * is: four shapes in, one string out.
 */
export function ticketFrom(
  arg: TicketBearer | string | undefined,
  current: () => string | undefined
): string | undefined {
  if (typeof arg === 'string') return arg;
  return arg?.workspace?.ticket ?? arg?.ticket ?? current();
}
