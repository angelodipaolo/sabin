import path from 'path';
import { spawn } from 'child_process';
import chalk from 'chalk';
import { parseTaskId, pathExists } from '@sabin/core';
import { fail, userHome } from '../cli';

export interface AppOptions {
  task?: string;
}

/** Where an installed Sabin.app may live, in the order they are tried */
export function appCandidates(): string[] {
  return ['/Applications/Sabin.app', path.join(userHome(), 'Applications', 'Sabin.app')];
}

/**
 * The monorepo's dev launcher. The CLI runs from packages/cli/dist (built)
 * or packages/cli/src (tests), both two levels below packages/.
 */
export function devLauncherPath(): string {
  return path.resolve(__dirname, '..', '..', '..', 'app', 'bin', 'sabin-app.js');
}

/** Seams for tests; the defaults are the real thing */
export interface AppDeps {
  candidates?: string[];
  launcher?: string;
  run?: (command: string, args: string[]) => void;
}

function runDetached(command: string, args: string[]): void {
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.unref();
}

/**
 * Open the desktop app: an installed Sabin.app when there is one, else the
 * dev launcher in this checkout. `--task` opens straight onto one task.
 */
export async function app(options: AppOptions = {}, deps: AppDeps = {}): Promise<void> {
  let task: string | null = null;
  if (options.task !== undefined) {
    task = parseTaskId(options.task);
    if (!task) fail(`Invalid task ID: "${options.task}". Expected something like TASK-12.`);
  }
  const taskArgs = task ? ['--task', task] : [];
  const run = deps.run ?? runDetached;

  for (const candidate of deps.candidates ?? appCandidates()) {
    if (!(await pathExists(candidate))) continue;
    run('open', ['-a', candidate, ...(task ? ['--args', ...taskArgs] : [])]);
    console.log(`Opening ${candidate}${task ? ` on ${task}` : ''}`);
    return;
  }

  const launcher = deps.launcher ?? devLauncherPath();
  if (!(await pathExists(launcher))) {
    fail(`Sabin.app is not installed (looked in /Applications and ~/Applications), and the dev launcher is missing: ${launcher}`);
  }
  run(process.execPath, [launcher, ...taskArgs]);
  console.log(`Starting the dev app${task ? ` on ${task}` : ''}: ${launcher}`);
  console.log(chalk.gray('No installed Sabin.app was found, so this runs the monorepo build.'));
}
