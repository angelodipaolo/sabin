import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { pathExists } from './fs';
import { defaultConfig, writeConfig } from './config';

/**
 * The one Sabin directory on this machine: $SABIN_HOME, else ~/sabin.
 *
 * Never walks up from the cwd and never follows a link file - every command,
 * the app and every hook resolve to the same place whatever directory they
 * run in.
 */
export function resolveHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.SABIN_HOME?.trim();
  if (!configured) return path.join(os.homedir(), 'sabin');
  return path.resolve(configured.replace(/^~(?=$|\/)/, os.homedir()));
}

/** Every fixed location in the home */
export interface HomePaths {
  home: string;
  configFile: string;
  projectsDir: string;
  tasksDir: string;
  hooksDir: string;
  stateDir: string;
  sessionsDir: string;
  lockDir: string;
}

export function homePaths(home: string): HomePaths {
  return {
    home,
    configFile: path.join(home, 'config.json'),
    projectsDir: path.join(home, 'projects'),
    tasksDir: path.join(home, 'tasks'),
    hooksDir: path.join(home, 'hooks'),
    stateDir: path.join(home, 'state'),
    sessionsDir: path.join(home, 'state', 'sessions'),
    lockDir: path.join(home, '.lock')
  };
}

/**
 * Create the home's directories and a default config.json, leaving anything
 * already there alone. Returns the paths it created.
 */
export async function ensureHome(home: string): Promise<string[]> {
  const paths = homePaths(home);
  const created: string[] = [];

  for (const dir of [home, paths.projectsDir, paths.tasksDir, paths.hooksDir, paths.sessionsDir]) {
    if (await pathExists(dir)) continue;
    await fs.mkdir(dir, { recursive: true });
    created.push(dir);
  }

  if (!(await pathExists(paths.configFile))) {
    await writeConfig(home, defaultConfig());
    created.push(paths.configFile);
  }

  return created;
}
