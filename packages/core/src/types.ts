export interface Task {
  status: 'open' | 'ready' | 'in_progress' | 'review' | 'completed' | 'resolved';
  title: string;
  /** Descriptive suffix used for branch, notes and worktree names */
  slug?: string;
  plan?: string;
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

export interface AgentDefinition {
  /** Executable to spawn, e.g. "codex" */
  command: string;
  /** Argv template. Supports {prompt}, {ticket}, {notesDir}, {worktree}, {taskFile}. */
  args?: string[];
  /** Extra environment for the agent process */
  env?: Record<string, string>;
}

export interface AgentsConfig {
  /** Agent launched when --agent is not given */
  default?: string;
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
  /** Relative to the resolved .sabin directory */
  notesDir?: string;
  /** Relative to the resolved .sabin directory */
  promptsDir?: string;
}
