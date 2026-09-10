/** Anything a tree node might carry a ticket on */
export interface TicketBearer {
  workspace?: { ticket?: string };
}

/**
 * The ticket a command was invoked on, whatever shape it arrived in.
 *
 * A VS Code command reaches us three ways and they do not agree: a
 * `view/item/context` contribution passes the selected tree node, the board
 * posts a ticket string, and the command palette passes nothing at all and
 * means "the focused one". Every command that takes a ticket has to handle
 * all three, so it lives here rather than being re-derived - and got wrong -
 * per command.
 *
 * Deliberately free of any `vscode` import, so it can be tested as what it
 * is: three shapes in, one string out.
 */
export function ticketFrom(
  arg: TicketBearer | string | undefined,
  focused: () => string | undefined
): string | undefined {
  if (typeof arg === 'string') return arg;
  return arg?.workspace?.ticket ?? focused();
}
