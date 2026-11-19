export const TASK_STATUSES = ['open', 'ready', 'in_progress', 'review', 'completed'] as const;

export type TaskStatus = typeof TASK_STATUSES[number];

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value);
}

export interface Task {
  /** Validated, uppercase ID, e.g. SABIN-0025 - always the directory name */
  id: string;
  status: TaskStatus;
  title: string;
  /** Project slug, when the task belongs to one */
  project?: string;
  /** ISO date (YYYY-MM-DD) the task was created */
  created?: string;
  /** Markdown body of task.md, below the frontmatter */
  content: string;
  /** tasks/<ID> */
  dir: string;
  /** tasks/<ID>/task.md */
  file: string;
  /** tasks/<ID>/prompt.md - the human scratchpad, never shown to agents */
  promptFile: string;
}

export const PROJECT_STATUSES = ['active', 'paused', 'done'] as const;

export type ProjectStatus = typeof PROJECT_STATUSES[number];

export interface BranchConfig {
  /** Personal prefix for generated branch names, e.g. "angelo" */
  prefix?: string;
  /** Supports {prefix}, {id} and {slug}. Default `{prefix}/{id}-{slug}`. */
  template?: string;
}

/** A repo as written in config.json */
export interface RepoConfig {
  /** Absolute path of the main clone */
  path: string;
  /** Relative to `path` unless absolute. Default `../<basename>-worktrees`. */
  worktreesRoot?: string;
  /** Shell commands run inside a freshly created worktree */
  postCreate?: string[];
  /**
   * Default project slug for work in this repo when no task says otherwise.
   * A default, never a constraint: a repo shared by several projects leaves it
   * unset, and a project can span any number of repos.
   */
  project?: string;
}

export interface SabinConfig {
  idPrefix: string;
  idPadding: number;
  branch: BranchConfig;
  /** Keyed by repo name */
  repos: Record<string, RepoConfig>;
}

/** A registered repo with every default applied and every path absolute */
export interface Repo {
  name: string;
  path: string;
  worktreesRoot: string;
  postCreate: string[];
  /** Default project slug, or null */
  project: string | null;
}
