import chalk from 'chalk';
import { sessionTitle, pathExists } from '@sabin/core';
import { getWorkspace, fail } from '../workspace-context';
import { ticketTerminals } from '../terminal-context';

interface TermOptions {
  window?: boolean;
}

/**
 * A plain shell in the ticket's worktree, in the ticket's window.
 *
 * The third tab you always end up wanting - the one for `git log`, a test
 * run, a quick grep - without the `cd` and without it landing in whatever
 * window you happened to be looking at.
 */
export async function term(ticketArg: string | undefined, options: TermOptions): Promise<void> {
  const { workspace, projectRoot, config } = await getWorkspace(ticketArg);

  if (!(await pathExists(workspace.worktreeDir))) {
    fail(
      `${workspace.ticket} has no worktree yet.\n` +
      `Make one:  sabin implement ${workspace.ticket} --no-launch`
    );
  }

  const { driver, windowId } = await ticketTerminals(workspace.ticket, projectRoot, config);

  if (driver.name === 'none') {
    fail(
      'No terminal Sabin can talk to (iTerm2 is not running).\n' +
      `The worktree is at:  ${workspace.worktreeDir}`
    );
  }

  await driver.openTab({
    cwd: workspace.worktreeDir,
    title: sessionTitle(workspace.ticket, 'shell'),
    windowId: windowId ?? undefined,
    newWindow: options.window,
    ticket: workspace.ticket
  });

  console.error(chalk.gray(
    `▸ shell in ${workspace.ticket}${windowId && !options.window ? "'s window" : ' (new window)'}`
  ));
}
