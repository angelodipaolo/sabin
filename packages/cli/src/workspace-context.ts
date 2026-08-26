import chalk from 'chalk';
import {
  readConfig,
  resolveSabinDir,
  resolveWorkspace,
  NoTicketError,
  SabinConfig,
  Workspace
} from '@sabin/core';

export interface CliWorkspace {
  workspace: Workspace;
  config: SabinConfig;
  isLinked: boolean;
  projectRoot: string;
}

/**
 * Resolve .sabin, config and the current workspace in one step.
 *
 * Exits with a clear message rather than guessing when no ticket can be
 * determined - silently resolving to the wrong ticket's notes would be worse
 * than failing.
 */
export async function getWorkspace(ticket?: string): Promise<CliWorkspace> {
  const { sabinDir, isLinked, projectRoot } = await resolveSabinDir();
  const config = await readConfig(sabinDir);

  try {
    const workspace = await resolveWorkspace({ sabinDir, config, ticket });
    return { workspace, config, isLinked, projectRoot };
  } catch (error) {
    if (error instanceof NoTicketError) {
      console.error(chalk.red(error.message));
      process.exit(1);
    }
    throw error;
  }
}

export function fail(message: string): never {
  console.error(chalk.red(message));
  process.exit(1);
}
