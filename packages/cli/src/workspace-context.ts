import chalk from 'chalk';
import {
  readConfig,
  resolveSabinDir,
  resolveWorkspace,
  NoTicketError,
  SabinConfig,
  Workspace
} from '@sabin/core';

export interface Project {
  sabinDir: string;
  projectRoot: string;
  config: SabinConfig;
}

export interface CliWorkspace extends Project {
  workspace: Workspace;
}

/**
 * Resolve .sabin and its config - what every command needs before it can
 * do anything
 */
export async function loadProject(): Promise<Project> {
  const { sabinDir, projectRoot } = await resolveSabinDir();
  const config = await readConfig(sabinDir);
  return { sabinDir, projectRoot, config };
}

/**
 * Resolve the project and the current ticket's workspace in one step.
 *
 * Exits with a clear message rather than guessing when no ticket can be
 * determined - silently resolving to the wrong ticket's notes would be worse
 * than failing.
 */
export async function getWorkspace(ticket?: string): Promise<CliWorkspace> {
  const project = await loadProject();

  try {
    const workspace = await resolveWorkspace({ sabinDir: project.sabinDir, config: project.config, ticket });
    return { ...project, workspace };
  } catch (error) {
    if (error instanceof NoTicketError) fail(error.message);
    throw error;
  }
}

export function fail(message: string, code = 1): never {
  console.error(chalk.red(message));
  process.exit(code);
}
