export const TASK_STATUSES = ['open', 'ready', 'in_progress', 'review', 'completed'] as const;

export type TaskStatus = typeof TASK_STATUSES[number];

export function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}

export interface Task {
  /** Ticket ID, e.g. SABIN-0004 - always the file's basename */
  id: string;
  status: TaskStatus;
  title: string;
  /** Descriptive suffix used for branch, notes and worktree names */
  slug?: string;
  branch?: string;
  worktree?: string;
  content: string;
  path: string;
}

export interface BranchConfig {
  /** Personal prefix applied to generated branch names, e.g. "angelo" */
  prefix?: string;
  /** Supports {prefix}, {ticket} and {slug} */
  template?: string;
}

export interface WorktreeConfig {
  /** Where worktrees are created, relative to the main clone */
  root?: string;
  /** Shell commands run inside a freshly created worktree */
  postCreate?: string[];
}

export interface SlugConfig {
  /** Derive the suffix from the task title, or leave tickets bare */
  from?: 'title' | 'none';
  /** Cap on the derived suffix. Truncation lands on a word boundary. */
  maxLength?: number;
  /** Drop filler words ("for", "the", "per") before truncating */
  stopWords?: boolean;
}

export interface AgentDefinition {
  /** Executable to spawn, e.g. "codex" */
  command: string;
  /** Argv template. Supports {prompt}, {ticket}, {notesDir}, {worktree}, {taskFile}. */
  args?: string[];
  /**
   * Flags that let the agent work without asking permission, prepended when
   * autonomy is on. Kept apart from `args` so a project can retune one
   * without restating the other.
   */
  autonomousArgs?: string[];
  /** Extra environment for the agent process */
  env?: Record<string, string>;
}

export interface AgentsConfig {
  /** Agent launched when --agent is not given */
  default?: string;
  /**
   * Launch agents with permission checks bypassed. Off unless asked for -
   * `--yolo` turns it on for one run, this makes it the standing default.
   */
  autonomous?: boolean;
  /** Named agents, layered over the built-ins */
  definitions?: Record<string, AgentDefinition>;
}

export interface SabinConfig {
  projectPrefix: string;
  taskNumberPadding: number;
  branch?: BranchConfig;
  worktrees?: WorktreeConfig;
  slug?: SlugConfig;
  agents?: AgentsConfig;
  /** Editor command for `sabin open` (default: code) */
  editor?: string;
  /** Relative to the resolved .sabin directory */
  notesDir?: string;
  /** Relative to the resolved .sabin directory */
  promptsDir?: string;
}
