export interface Task {
  status: 'open' | 'ready' | 'in_progress' | 'review' | 'completed' | 'resolved';
  title: string;
  /** Descriptive suffix used for branch, notes and worktree names */
  slug?: string;
  workingDir?: string;
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

export interface SabinConfig {
  projectPrefix: string;
  taskNumberPadding: number;
  branch?: BranchConfig;
  worktrees?: WorktreeConfig;
  slug?: SlugConfig;
  /** Relative to the resolved .sabin directory */
  notesDir?: string;
  /** Relative to the resolved .sabin directory */
  promptsDir?: string;
}
