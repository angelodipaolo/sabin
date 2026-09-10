import * as path from 'path';
import * as fs from 'fs/promises';
import {
  resolveSabinDir,
  readConfig,
  listTasks,
  createTask,
  setTaskStatus,
  findTaskFile,
  findPlan,
  nextTaskId,
  currentBranch,
  mainWorktreeRoot,
  ticketFromBranch,
  workspacePaths,
  scaffoldWorkspace,
  slugForTicket,
  slugFromTitle,
  codeWorkspacePath,
  writeCodeWorkspace,
  readAgentStates,
  AgentState,
  SabinConfig,
  TaskStatus,
  WorkspacePaths
} from '@sabin/core';

export interface NoteEntry {
  name: string;
  isDirectory: boolean;
}

export interface TaskWorkspace {
  ticket: string;
  name: string;
  title: string;
  status: TaskStatus;
  slug: string | null;
  taskFile: string;
  notesDir: string;
  promptFile: string;
  worktreeDir: string;
  branch: string | null;
  /** Absolute path to plan.md, when it exists */
  planPath: string | null;
}

/**
 * The extension's one door into Sabin data. Everything goes through core, so
 * the board, the tree and the CLI can never disagree about where a ticket's
 * files are or how a status change is written.
 */
export class WorkspaceService {
  private sabinDir: string | null = null;
  private mainRoot: string | null | undefined;
  private config: SabinConfig | null = null;

  constructor(private workspaceRoot: string) {}

  /**
   * Ticket for the branch currently checked out, if any.
   *
   * Checks every workspace folder, so the focused task still resolves when
   * the window is rooted on the Sabin directory and a worktree sits alongside.
   */
  public async currentTicket(searchRoots: string[]): Promise<string | null> {
    const config = await this.getConfig();

    for (const root of searchRoots) {
      const branch = await currentBranch(root);
      if (!branch) continue;

      const ticket = ticketFromBranch(branch, config);
      if (ticket) return ticket;
    }

    return null;
  }

  public async listWorkspaces(): Promise<TaskWorkspace[]> {
    const sabinDir = await this.getSabinDir();
    const workspaces: TaskWorkspace[] = [];

    for (const task of await listTasks(sabinDir)) {
      const paths = await this.pathsFor(task.id, task.slug, task.title);
      workspaces.push({
        ticket: task.id,
        name: paths.name,
        title: task.title,
        status: task.status,
        slug: paths.slug,
        taskFile: task.path,
        notesDir: paths.notesDir,
        promptFile: paths.promptFile,
        worktreeDir: task.worktree ?? paths.worktreeDir,
        branch: task.branch ?? null,
        planPath: await findPlan(paths.notesDir)
      });
    }

    return workspaces;
  }

  public async find(ticket: string): Promise<TaskWorkspace | undefined> {
    return (await this.listWorkspaces()).find(w => w.ticket === ticket);
  }

  public async nextTaskId(): Promise<string> {
    return nextTaskId(await this.getSabinDir(), await this.getConfig());
  }

  /**
   * Create a task with its notes directory and prompt scratchpad, exactly as
   * `sabin task create` does
   */
  public async createTask(title: string, id?: string): Promise<TaskWorkspace> {
    const sabinDir = await this.getSabinDir();
    const config = await this.getConfig();

    const task = await createTask(sabinDir, config, { title, id });
    const paths = await this.pathsFor(task.id, task.slug, task.title);
    await scaffoldWorkspace(paths, task.title);

    return {
      ticket: task.id,
      name: paths.name,
      title: task.title,
      status: task.status,
      slug: paths.slug,
      taskFile: task.path,
      notesDir: paths.notesDir,
      promptFile: paths.promptFile,
      worktreeDir: paths.worktreeDir,
      branch: null,
      planPath: null
    };
  }

  public async setStatus(ticket: string, status: TaskStatus): Promise<void> {
    await setTaskStatus(await this.getSabinDir(), ticket, status);
  }

  /**
   * Remove the task file only. Notes stay - they may be the only record of
   * why the task was dropped.
   */
  public async deleteTask(ticket: string): Promise<void> {
    const file = await findTaskFile(await this.getSabinDir(), ticket);
    if (file) await fs.unlink(file);
  }

  /**
   * Make sure a ticket's notes directory and scratchpad exist before opening
   * them - both are derived paths, created lazily
   */
  public async ensureFiles(workspace: TaskWorkspace): Promise<void> {
    await scaffoldWorkspace(workspace, workspace.title);
  }

  public async notesFor(workspace: TaskWorkspace): Promise<NoteEntry[]> {
    return this.listDirectory(workspace.notesDir);
  }

  /**
   * Notes are any context an agent might read, so nothing is filtered by
   * extension - only dotfiles are hidden. Directories sort first.
   */
  public async listDirectory(dir: string): Promise<NoteEntry[]> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      return entries
        .filter(entry => !entry.name.startsWith('.'))
        .map(entry => ({ name: entry.name, isDirectory: entry.isDirectory() }))
        .sort((a, b) =>
          a.isDirectory === b.isDirectory
            ? a.name.localeCompare(b.name)
            : a.isDirectory ? -1 : 1
        );
    } catch {
      return [];
    }
  }

  /**
   * Every path belonging to a ticket. Shares core's slug precedence so the
   * extension and `sabin where` never disagree about where notes live.
   */
  public async pathsFor(
    ticket: string,
    recordedSlug: string | undefined,
    title: string
  ): Promise<WorkspacePaths> {
    const sabinDir = await this.getSabinDir();
    const config = await this.getConfig();
    const slug = (await slugForTicket(ticket, recordedSlug, title, sabinDir, config))
      ?? slugFromTitle(title, config);

    return workspacePaths({ ticket, slug }, sabinDir, await this.getMainRoot(), config);
  }

  /**
   * The project's .code-workspace file, generating it if absent.
   *
   * When the window is rooted on the Sabin directory itself there is no main
   * clone to name it after, so fall back to whichever workspace file is there.
   */
  public async getCodeWorkspacePath(): Promise<string | null> {
    const sabinDir = await this.getSabinDir();
    const mainRoot = await this.getMainRoot();

    if (mainRoot) {
      const target = codeWorkspacePath(sabinDir, mainRoot);
      try {
        await fs.access(target);
      } catch {
        await writeCodeWorkspace(sabinDir, mainRoot);
      }
      return target;
    }

    try {
      const existing = (await fs.readdir(sabinDir)).find(file => file.endsWith('.code-workspace'));
      return existing ? path.join(sabinDir, existing) : null;
    } catch {
      return null;
    }
  }

  /**
   * What each agent is doing, as its hooks last reported.
   *
   * Read from files inside the Sabin directory the watcher already covers -
   * no polling, no `osascript`, no subprocess. The extension cannot ask
   * iTerm2 anything and does not need to: the terminals it cares about are
   * the ones with an agent in them, and those write their own state.
   */
  public async agentStates(): Promise<AgentState[]> {
    return [...(await readAgentStates(await this.getSabinDir())).values()];
  }

  public async getSabinDir(): Promise<string> {
    if (!this.sabinDir) {
      this.sabinDir = (await resolveSabinDir(this.workspaceRoot)).sabinDir;
    }
    return this.sabinDir;
  }

  private async getConfig(): Promise<SabinConfig> {
    if (!this.config) {
      this.config = await readConfig(await this.getSabinDir());
    }
    return this.config;
  }

  private async getMainRoot(): Promise<string | null> {
    if (this.mainRoot === undefined) {
      this.mainRoot = await mainWorktreeRoot(this.workspaceRoot);
    }
    return this.mainRoot;
  }

  public invalidate(): void {
    this.config = null;
  }
}
