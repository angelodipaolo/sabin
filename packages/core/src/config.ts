import fs from 'fs/promises';
import path from 'path';
import { Repo, RepoConfig, SabinConfig } from './types';
import { writeFileAtomic, realpathOr } from './fs';
import { mainWorktreeRoot } from './git';
import { withLock } from './lock';
import { parseProjectSlug } from './slug';
import { InvalidProjectError, NotAGitRepoError, RepoNotFoundError } from './errors';

export const DEFAULT_BRANCH_TEMPLATE = '{prefix}/{id}-{slug}';

export function defaultConfig(): SabinConfig {
  return {
    idPrefix: 'TASK',
    idPadding: 4,
    branch: { prefix: '', template: DEFAULT_BRANCH_TEMPLATE },
    repos: {}
  };
}

export function configPath(home: string): string {
  return path.join(home, 'config.json');
}

/**
 * Read config.json, layered over the defaults.
 *
 * A missing file means defaults. A file that cannot be parsed is an error,
 * not a silent fallback - defaulting the prefix because of a stray comma
 * would allocate task IDs under the wrong name, and an empty repo registry
 * would make every workspace vanish.
 */
export async function readConfig(home: string): Promise<SabinConfig> {
  const file = configPath(home);

  let content: string;
  try {
    content = await fs.readFile(file, 'utf8');
  } catch (error: any) {
    if (error.code === 'ENOENT') return defaultConfig();
    throw error;
  }

  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch (error: any) {
    throw new Error(`Could not parse ${file}: ${error.message}`, { cause: error });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Could not parse ${file}: expected a JSON object`);
  }

  const defaults = defaultConfig();
  return {
    ...defaults,
    ...parsed,
    branch: { ...defaults.branch, ...(parsed.branch ?? {}) },
    repos: { ...(parsed.repos ?? {}) }
  };
}

export async function writeConfig(home: string, config: SabinConfig): Promise<void> {
  await writeFileAtomic(configPath(home), `${JSON.stringify(config, null, 2)}\n`);
}

/** One registered repo with defaults applied, or null when its entry is unusable */
export function resolveRepo(name: string, entry: RepoConfig | undefined): Repo | null {
  if (!entry || typeof entry.path !== 'string' || !entry.path) return null;

  const repoPath = path.resolve(entry.path);
  const root = entry.worktreesRoot
    ? path.resolve(repoPath, entry.worktreesRoot)
    : path.join(path.dirname(repoPath), `${path.basename(repoPath)}-worktrees`);

  return {
    name,
    path: repoPath,
    worktreesRoot: root,
    postCreate: Array.isArray(entry.postCreate) ? entry.postCreate.filter(c => typeof c === 'string') : [],
    project: typeof entry.project === 'string' ? parseProjectSlug(entry.project) : null
  };
}

/** Every registered repo, sorted by name. Entries without a path are skipped. */
export function listRepos(config: SabinConfig): Repo[] {
  return Object.entries(config.repos ?? {})
    .map(([name, entry]) => resolveRepo(name, entry))
    .filter((repo): repo is Repo => repo !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function findRepo(config: SabinConfig, name: string): Repo | null {
  return resolveRepo(name, config.repos?.[name]);
}

/**
 * Which registered repo `dir` belongs to: the main clone or any of its linked
 * worktrees, wherever they live. Asks git for the main clone rather than
 * matching path prefixes, so a worktree outside `worktreesRoot` still counts.
 */
export async function repoForPath(config: SabinConfig, dir: string): Promise<Repo | null> {
  const main = await mainWorktreeRoot(dir);
  if (!main) return null;
  const canonical = await realpathOr(main);

  for (const repo of listRepos(config)) {
    if ((await realpathOr(repo.path)) === canonical) return repo;
  }
  return null;
}

export interface AddRepoResult {
  repo: Repo;
  /** False when the repo was already registered */
  added: boolean;
}

export interface AddRepoOptions {
  /** Set the repo's default project; applies to an already registered repo too */
  project?: string;
}

/** A project slug for config.json, or InvalidProjectError */
function projectSlugOrThrow(input: string): string {
  const slug = parseProjectSlug(input);
  if (!slug) throw new InvalidProjectError(input);
  return slug;
}

/**
 * Register the repo containing `dir`.
 *
 * A linked worktree registers its main clone - worktrees are discovered from
 * there. The name is the directory's basename, with `-2`, `-3` appended on a
 * collision. Registering the same clone twice returns the existing entry.
 */
export async function addRepo(home: string, dir: string, options: AddRepoOptions = {}): Promise<AddRepoResult> {
  const project = options.project === undefined ? undefined : projectSlugOrThrow(options.project);
  const main = await mainWorktreeRoot(dir);
  if (!main) throw new NotAGitRepoError(dir);
  const repoPath = await realpathOr(main);

  return withLock(home, async () => {
    const config = await readConfig(home);

    for (const repo of listRepos(config)) {
      if ((await realpathOr(repo.path)) !== repoPath) continue;
      if (project === undefined || repo.project === project) return { repo, added: false };
      config.repos[repo.name] = { ...config.repos[repo.name], project };
      await writeConfig(home, config);
      return { repo: resolveRepo(repo.name, config.repos[repo.name])!, added: false };
    }

    const name = uniqueRepoName(path.basename(repoPath), config.repos);
    config.repos[name] = project ? { path: repoPath, project } : { path: repoPath };
    await writeConfig(home, config);

    return { repo: resolveRepo(name, config.repos[name])!, added: true };
  });
}

/** Unregister a repo. Touches nothing on disk but config.json. */
export async function removeRepo(home: string, name: string): Promise<Repo> {
  return withLock(home, async () => {
    const config = await readConfig(home);
    const repo = findRepo(config, name);
    if (!repo || !(name in config.repos)) throw new RepoNotFoundError(name);

    delete config.repos[name];
    await writeConfig(home, config);
    return repo;
  });
}

/**
 * Set or clear a repo's default project. Keeps every other key of the entry.
 * The project need not exist yet: like a task's `project`, naming it is
 * enough.
 */
export async function setRepoProject(home: string, name: string, project: string | null): Promise<Repo> {
  const slug = project === null ? null : projectSlugOrThrow(project);
  return withLock(home, async () => {
    const config = await readConfig(home);
    if (!findRepo(config, name) || !(name in config.repos)) throw new RepoNotFoundError(name);

    const entry = { ...config.repos[name] };
    if (slug) entry.project = slug;
    else delete entry.project;
    config.repos[name] = entry;
    await writeConfig(home, config);
    return resolveRepo(name, config.repos[name])!;
  });
}

function uniqueRepoName(base: string, taken: Record<string, unknown>): string {
  const safe = base.replace(/[^A-Za-z0-9._-]/g, '-') || 'repo';
  if (!(safe in taken)) return safe;
  for (let n = 2; ; n++) {
    if (!(`${safe}-${n}` in taken)) return `${safe}-${n}`;
  }
}
