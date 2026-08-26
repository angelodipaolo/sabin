import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import {
  writeSabinLink,
  writeCodeWorkspace,
  denyPromptsAccess,
  addGitExclude,
  readConfig,
  checkSabinType
} from '@sabin/core';
import { expandHome } from './init';

/**
 * Point this repo at an existing Sabin directory.
 *
 * Same setup as `sabin init` minus the scaffolding: link file, workspace
 * file, local git exclude and the prompts deny rule.
 */
export async function linkToSharedSabin(targetPath: string): Promise<void> {
  try {
    const projectRoot = process.cwd();
    const target = path.resolve(projectRoot, expandHome(targetPath));

    try {
      await fs.access(path.join(target, 'config.json'));
    } catch {
      throw new Error(
        `${targetPath} is not a Sabin directory - no config.json there.\n` +
        `Run "sabin init --shared ${targetPath}" to create one.`
      );
    }

    const existing = await checkSabinType(projectRoot);
    if (existing === 'directory') {
      throw new Error(
        '.sabin is a directory here. Sabin data lives outside the repo now:\n' +
        `move it to ${target} (or merge it in), delete the directory, then link again.`
      );
    }
    if (existing === 'file') {
      throw new Error('.sabin link already exists. Remove it first to link somewhere else.');
    }

    await writeSabinLink(projectRoot, target);
    const codeWorkspace = await writeCodeWorkspace(target, projectRoot);
    const excluded = await addGitExclude(projectRoot);
    const config = await readConfig(target);
    const denied = await denyPromptsAccess(projectRoot, path.resolve(target, config.promptsDir ?? 'prompts'));

    console.log(chalk.green('Linked to Sabin directory'));
    console.log(chalk.gray(`  Target:          ${target}`));
    console.log(chalk.gray(`  Link file:       ${path.join(projectRoot, '.sabin')}`));
    console.log(chalk.gray(`  Workspace:       ${codeWorkspace}`));
    console.log(chalk.gray(`  Locally ignored: ${excluded ? '.git/info/exclude' : 'no - add .sabin to your ignores'}`));
    console.log(chalk.gray(`  Prompts denied:  ${path.relative(projectRoot, denied.path)}`));
  } catch (error: any) {
    console.error(chalk.red('Failed to link'));
    console.error(chalk.red(error.message));
    process.exit(1);
  }
}
