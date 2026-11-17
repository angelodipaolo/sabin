/**
 * Everything that crosses the IPC boundary. Plain data only - no classes, no
 * functions - so it survives structured clone, and no Node imports, so the
 * renderer can use it.
 */

export const TASK_STATUSES = ['open', 'ready', 'in_progress', 'review', 'completed'] as const;
export type TaskStatus = typeof TASK_STATUSES[number];

export const STATUS_LABELS: Record<TaskStatus, string> = {
  open: 'Open',
  ready: 'Ready',
  in_progress: 'In progress',
  review: 'Review',
  completed: 'Completed'
};

export type AgentActivity = 'busy' | 'waiting' | 'idle' | 'ended';

/** Mirrors core's `AgentSession`, with the effective (liveness-checked) activity */
export interface SessionInfo {
  sessionId: string;
  agent: string;
  activity: AgentActivity;
  since: string;
  cwd: string;
  pid?: number;
  termSessionId?: string;
  lastPrompt?: string;
  lastPromptAt?: string;
  lastMessage?: string;
  lastMessageAt?: string;
}

export interface GitState {
  branch: string | null;
  dirty: number;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
}

export interface WorkspaceInfo {
  taskId: string;
  repo: string;
  repoPath: string;
  path: string;
  branch: string;
  main: boolean;
  /** Null when git could not read the worktree */
  git: GitState | null;
}

export interface TaskSummary {
  id: string;
  title: string;
  status: TaskStatus;
  project: string | null;
  created: string | null;
  workspaces: WorkspaceInfo[];
  /** Most recent first */
  sessions: SessionInfo[];
}

export interface ProjectInfo {
  slug: string;
  title: string;
  /** Tasks that are not completed */
  open: number;
  total: number;
  hasFile: boolean;
}

export interface RepoInfo {
  name: string;
  path: string;
  /** False when the path is gone */
  exists: boolean;
}

export interface Snapshot {
  home: string;
  /** The user's home directory, for showing paths as ~/... */
  userHome: string;
  /** False before `sabin setup` (or the first-run button) has created it */
  homeExists: boolean;
  /** Bumped on every snapshot; lets the renderer re-read an open file */
  version: number;
  takenAt: string;
  tasks: TaskSummary[];
  projects: ProjectInfo[];
  repos: RepoInfo[];
  /** Sessions whose cwd is in no task's workspace */
  unassigned: SessionInfo[];
  /** Whether state/sessions holds any file at all - no files means no hooks */
  hooksSeen: boolean;
  /** Non-fatal problems, shown in a strip; the snapshot is still usable */
  warnings: string[];
  /** Placeholder for the new-task dialog, e.g. TASK-0013 */
  nextId: string | null;
  /** Whether `margin` was found on the PATH */
  marginAvailable: boolean;
}

/** Which tasks the sidebar selects */
export type ProjectFilter = { kind: 'all' } | { kind: 'none' } | { kind: 'project'; slug: string };

export type TaskFileKind = 'task' | 'prompt' | 'plan' | 'log' | 'note';

export interface TaskFileEntry {
  name: string;
  kind: TaskFileKind;
  exists: boolean;
}

export interface FileContent {
  name: string;
  exists: boolean;
  /** For task.md, the body only - the frontmatter never reaches the editor */
  content: string;
}

export type Result<T = undefined> = { ok: true; value: T } | { ok: false; error: string };

export interface MarginResult {
  url: string;
  title: string;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Menu commands main forwards to the renderer, so accelerators work even when the review view has focus */
export type AppCommand = 'switcher' | 'new-task' | 'list' | 'back';

export interface SabinApi {
  getSnapshot(): Promise<Snapshot>;
  /** The task named by `--task` on launch, once */
  initialTask(): Promise<string | null>;
  createHome(): Promise<Result>;

  createTask(input: { title: string; id?: string; project?: string }): Promise<Result<string>>;
  setStatus(id: string, status: TaskStatus): Promise<Result>;
  updateTask(id: string, update: { title?: string; project?: string | null }): Promise<Result>;
  createProject(title: string): Promise<Result<string>>;
  addRepo(): Promise<Result<string | null>>;
  removeRepo(name: string): Promise<Result<boolean>>;
  createWorkspace(taskId: string, repo: string): Promise<Result<string>>;

  listFiles(taskId: string): Promise<Result<TaskFileEntry[]>>;
  readFile(taskId: string, name: string): Promise<Result<FileContent>>;
  writeFile(taskId: string, name: string, content: string): Promise<Result>;
  createFile(taskId: string, name: string): Promise<Result<string>>;
  renameFile(taskId: string, from: string, to: string): Promise<Result<string>>;
  deleteFile(taskId: string, name: string): Promise<Result<boolean>>;
  fileMenu(taskId: string, name: string): Promise<'rename' | 'delete' | 'reveal' | null>;
  revealFile(taskId: string, name: string): Promise<Result>;

  focusSession(sessionId: string): Promise<Result>;
  resumeSession(sessionId: string): Promise<Result>;
  openTerminal(taskId: string, workspacePath: string): Promise<Result>;
  copyText(text: string): Promise<void>;
  reveal(taskId: string, workspacePath: string): Promise<Result>;

  openReview(taskId: string, workspacePath: string): Promise<Result<MarginResult>>;
  showReview(url: string, bounds: Bounds): Promise<Result>;
  hideReview(): Promise<void>;
  openExternal(url: string): Promise<void>;

  onSnapshot(listener: (snapshot: Snapshot) => void): () => void;
  onCommand(listener: (command: AppCommand) => void): () => void;
  onOpenTask(listener: (taskId: string) => void): () => void;
}
