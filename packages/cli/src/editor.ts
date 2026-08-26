import { spawn } from 'child_process';
import chalk from 'chalk';
import { resolveSabinDir, readConfig } from '@sabin/core';

/**
 * Editor precedence: explicit flag, SABIN_EDITOR, config, then VS Code
 */
export async function resolveEditor(flag?: string): Promise<string> {
  if (flag) return flag;
  if (process.env.SABIN_EDITOR) return process.env.SABIN_EDITOR;

  try {
    const { sabinDir } = await resolveSabinDir();
    const config = await readConfig(sabinDir) as { editor?: string };
    if (config.editor) return config.editor;
  } catch {
    // Fall through to the default
  }

  return 'code';
}

export interface LaunchOptions {
  editor?: string;
  newWindow?: boolean;
  quiet?: boolean;
}

export async function launchEditor(target: string, options: LaunchOptions = {}): Promise<void> {
  const editor = await resolveEditor(options.editor);
  const args = options.newWindow ? ['-n', target] : [target];

  const child = spawn(editor, args, { detached: true, stdio: 'ignore' });

  // Report only once the process actually started - an unresolvable editor
  // fails asynchronously, and "Opening..." followed by an error reads badly
  child.on('spawn', () => {
    if (!options.quiet) console.log(chalk.gray(`Opening ${target}`));
    child.unref();
  });

  child.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      console.error(chalk.red(`Could not run "${editor}".`));
      console.error(chalk.gray(
        'Install the VS Code shell command (Shell Command: Install \'code\' command in PATH),\n' +
        'or set a different editor with --editor, SABIN_EDITOR, or "editor" in config.json.'
      ));
    } else {
      console.error(chalk.red(`Failed to open: ${error.message}`));
    }
    process.exit(1);
  });
}
