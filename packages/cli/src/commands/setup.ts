import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import {
  ensureHome,
  homePaths,
  listRepos,
  mergeClaudeActivityHooks,
  mergeClaudePromptDeny,
  mergeCodexActivityHooks,
  pathExists,
  readConfig,
  resolveHome,
  MergeResult,
  UnparsableFileError
} from '@sabin/core';
import { errorLine, userHome } from '../cli';

export interface SetupOptions {
  hooks?: boolean;
}

/** Where each agent keeps its files. Honours CLAUDE_CONFIG_DIR and CODEX_HOME. */
export interface AgentPaths {
  /** Claude Code's config directory: $CLAUDE_CONFIG_DIR, else ~/.claude */
  claudeDir: string;
  claudeSettings: string;
  claudeSkill: string;
  /** Codex's home: $CODEX_HOME, else ~/.codex */
  codexHome: string;
  codexHooks: string;
  /** Codex loads user skills from ~/.agents/skills */
  codexSkill: string;
}

export function agentPaths(env: NodeJS.ProcessEnv = process.env): AgentPaths {
  const home = userHome(env);
  const claudeDir = env.CLAUDE_CONFIG_DIR?.trim() || path.join(home, '.claude');
  const codexHome = env.CODEX_HOME?.trim() || path.join(home, '.codex');
  return {
    claudeDir,
    claudeSettings: path.join(claudeDir, 'settings.json'),
    claudeSkill: path.join(claudeDir, 'skills', 'sabin'),
    codexHome,
    codexHooks: path.join(codexHome, 'hooks.json'),
    codexSkill: path.join(home, '.agents', 'skills', 'sabin')
  };
}

/**
 * The repo's skills/sabin. The CLI runs from packages/cli/dist/commands
 * (built) or packages/cli/src/commands (tests): four levels below the root.
 */
export function skillSourceDir(): string {
  return path.resolve(__dirname, '..', '..', '..', '..', 'skills', 'sabin');
}

/**
 * Slash commands from early releases. They would shadow the skill's own
 * routing, so setup removes them, as the old `skill install` did.
 */
const STALE_CLAUDE_COMMANDS = ['sabin-plan', 'sabin-task-complete', 'sabin-task-create', 'sabin-task-implement'];

type Action = 'created' | 'updated' | 'unchanged' | 'removed' | 'failed';

interface Step {
  action: Action;
  path: string;
  note?: string;
}

/** Every file under `dir`, as relative paths, sorted */
async function listFiles(dir: string, prefix = ''): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(path.join(dir, prefix), { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(dir, relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files.sort();
}

async function sameTree(source: string, dest: string): Promise<boolean> {
  const [from, to] = await Promise.all([listFiles(source), listFiles(dest)]);
  if (from.length !== to.length || from.some((file, i) => file !== to[i])) return false;
  for (const file of from) {
    const [a, b] = await Promise.all([fs.readFile(path.join(source, file)), fs.readFile(path.join(dest, file))]);
    if (!a.equals(b)) return false;
  }
  return true;
}

/** Make `dest` an exact copy of `source`, touching nothing when it already is */
async function syncSkill(source: string, dest: string): Promise<Action> {
  const existed = await pathExists(dest);
  if (existed && await sameTree(source, dest)) return 'unchanged';
  await fs.rm(dest, { recursive: true, force: true });
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.cp(source, dest, { recursive: true });
  return existed ? 'updated' : 'created';
}

/** Whether `dir` holds a copy of this skill (and not something else named sabin) */
async function isSabinSkill(dir: string): Promise<boolean> {
  try {
    return /^name:\s*sabin\s*$/m.test(await fs.readFile(path.join(dir, 'SKILL.md'), 'utf8'));
  } catch {
    return false;
  }
}

async function removeStale(paths: AgentPaths): Promise<Step[]> {
  const steps: Step[] = [];
  for (const name of STALE_CLAUDE_COMMANDS) {
    const file = path.join(paths.claudeDir, 'commands', `${name}.md`);
    if (!(await pathExists(file))) continue;
    await fs.rm(file, { force: true });
    steps.push({ action: 'removed', path: file, note: 'old slash command' });
  }

  // The old installer copied the skill into $CODEX_HOME/skills; Codex loads
  // ~/.agents/skills, and a second, older copy would contradict the new one
  const legacy = path.join(paths.codexHome, 'skills', 'sabin');
  if (path.resolve(legacy) !== path.resolve(paths.codexSkill) && await isSabinSkill(legacy)) {
    await fs.rm(legacy, { recursive: true, force: true });
    steps.push({ action: 'removed', path: legacy, note: 'old Codex skill location' });
  }
  return steps;
}

function fromMerge(result: MergeResult, what: string): Step {
  return {
    action: result.changed ? 'updated' : 'unchanged',
    path: result.path,
    note: result.changed ? `added ${what}: ${result.added.join(', ')}` : what
  };
}

/** Run one merge; an unparsable file is reported and left alone rather than ending setup */
async function merge(run: () => Promise<MergeResult>, file: string, what: string): Promise<Step> {
  try {
    return fromMerge(await run(), what);
  } catch (error) {
    if (error instanceof UnparsableFileError) return { action: 'failed', path: file, note: errorLine(error) };
    throw error;
  }
}

const PAINT: Record<Action, (text: string) => string> = {
  created: chalk.green,
  updated: chalk.green,
  unchanged: chalk.gray,
  removed: chalk.yellow,
  failed: chalk.red
};

function printSteps(title: string, steps: Step[]): void {
  console.log(chalk.bold(title));
  for (const step of steps) {
    const note = step.note ? chalk.gray(`  ${step.note}`) : '';
    console.log(`  ${PAINT[step.action](step.action.padEnd(9))} ${step.path}${note}`);
  }
}

/**
 * Make this machine ready for Sabin: the home and its config, the skill for
 * Claude Code and Codex, and the rule that keeps agents out of prompt.md.
 * `--hooks` adds the activity hooks. Idempotent: a second run changes
 * nothing, and every file it would touch is listed either way.
 */
export async function setup(options: SetupOptions = {}): Promise<void> {
  const home = resolveHome();
  const paths = agentPaths();

  const created = await ensureHome(home);
  const homeSteps: Step[] = created.map(file => ({ action: 'created', path: file }));
  if (homeSteps.length === 0) homeSteps.push({ action: 'unchanged', path: homePaths(home).configFile });

  const source = skillSourceDir();
  if (!(await pathExists(path.join(source, 'SKILL.md')))) {
    throw new Error(`The skill source is missing: ${source}`);
  }
  const skillSteps: Step[] = [
    { action: await syncSkill(source, paths.claudeSkill), path: paths.claudeSkill, note: 'Claude Code' },
    { action: await syncSkill(source, paths.codexSkill), path: paths.codexSkill, note: 'Codex' },
    ...await removeStale(paths)
  ];

  const settingsSteps: Step[] = [
    await merge(() => mergeClaudePromptDeny(paths.claudeSettings, home), paths.claudeSettings, 'prompt.md deny rule')
  ];

  let hookSteps: Step[] = [];
  if (options.hooks) {
    hookSteps = [
      await merge(() => mergeClaudeActivityHooks(paths.claudeSettings), paths.claudeSettings, 'Claude Code hooks'),
      await merge(() => mergeCodexActivityHooks(paths.codexHooks), paths.codexHooks, 'Codex hooks')
    ];
  }

  printSteps(`Sabin home  ${home}`, homeSteps);
  printSteps('Skill', skillSteps);
  printSteps('Claude Code settings', settingsSteps);

  if (options.hooks) {
    printSteps('Activity hooks', hookSteps);
    console.log(chalk.yellow('  Codex skips new or changed hooks until you trust them: run /hooks in Codex once and trust the sabin ones.'));
  } else {
    console.log(chalk.bold('Activity hooks'));
    console.log(chalk.gray('  not installed. Run `sabin setup --hooks` to show agent activity in `sabin ls` and the app.'));
  }

  const repos = listRepos(await readConfig(home));
  console.log(chalk.bold('Repos'));
  console.log(repos.length > 0
    ? `  ${repos.map(repo => repo.name).join(', ')}`
    : chalk.gray('  none registered. `sabin work` registers the repo it runs in, or use `sabin repo add`.'));

  const changed = [...homeSteps, ...skillSteps, ...settingsSteps, ...hookSteps].some(step => step.action !== 'unchanged');
  if (changed) console.log(chalk.gray('Restart running agents to pick up the skill and settings.'));
  if ([...settingsSteps, ...hookSteps].some(step => step.action === 'failed')) process.exitCode = 1;
}
