import * as path from 'path';
import * as fs from 'fs/promises';
import {
  resolveSabinDir,
  readConfig,
  parseTask,
  currentBranch,
  mainWorktreeRoot,
  ticketFromBranch,
  workspacePaths,
  slugFromTitle,
  findWorkspaceDir,
  codeWorkspacePath,
  writeCodeWorkspace,
  DEFAULT_NOTES_DIR,
  SabinConfig
} from '@sabin/core';

export interface TaskWorkspace {
  ticket: string;
  name: string;
  title: string;
  status: string;
  slug: string | null;
  taskFile: string;
  notesDir: string;
  promptFile: string;
  worktreeDir: string;
  branch: string | null;
}

/**
 * Resolves the workspace behind each task: its notes directory, prompt
 * scratchpad, worktree and branch.
 *
 * Kept separate from TaskService, which owns the board's view of tasks.
 */
export class WorkspaceService {
  private sabinDir: string | null = null;
  private mainRoot: string | null = null;
  private config: SabinConfig | null = null;

  constructor(private workspaceRoot: string) {}

  /**
   * Ticket for the branch currently checked out, if any.
   *
   * Checks every workspace folder, so the focused task still resolves when
   * the window is rooted on .sabin and a worktree sits alongside it.
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

  /**
   * Every task that has a workspace, newest status first
   */
  public async listWorkspaces(): Promise<TaskWorkspace[]> {
    const sabinDir = await this.getSabinDir();
    const config = await this.getConfig();
    const tasksDir = path.join(sabinDir, 'tasks');

    const workspaces: TaskWorkspace[] = [];

    for (const statusDir of await subdirectories(tasksDir)) {
      const dir = path.join(tasksDir, statusDir);

      for (const file of await markdownFiles(dir)) {
        const taskFile = path.join(dir, file);

        try {
          const task = await parseTask(taskFile);
          const ticket = path.basename(file, '.md');
          const slug = await this.resolveSlug(ticket, task.slug, task.title, sabinDir, config);
          const paths = workspacePaths({ ticket, slug }, sabinDir, await this.getMainRoot(), config);

          workspaces.push({
            ticket,
            name: paths.name,
            title: task.title ?? ticket,
            status: task.status ?? 'open',
            slug,
            taskFile,
            notesDir: paths.notesDir,
            promptFile: paths.promptFile,
            worktreeDir: task.worktree ?? paths.worktreeDir,
            branch: task.branch ?? null
          });
        } catch {
          // A malformed task file should not blank the whole view
        }
      }
    }

    return workspaces;
  }

  public async notesFor(workspace: TaskWorkspace): Promise<string[]> {
    try {
      const entries = await fs.readdir(workspace.notesDir, { withFileTypes: true });
      return entries
        .filter(entry => entry.isFile() && !entry.name.startsWith('.'))
        .map(entry => entry.name)
        .sort();
    } catch {
      return [];
    }
  }

  /**
   * Mirrors the CLI's precedence so the extension and `sabin where` never
   * disagree about where a ticket's notes live.
   */
  private async resolveSlug(
    ticket: string,
    recorded: string | undefined,
    title: string,
    sabinDir: string,
    config: SabinConfig
  ): Promise<string | null> {
    if (recorded) return recorded;

    const notesRoot = path.resolve(sabinDir, config.notesDir ?? DEFAULT_NOTES_DIR);
    const existing = await findWorkspaceDir(notesRoot, ticket);
    if (existing && existing.length > ticket.length) {
      return existing.slice(ticket.length + 1);
    }

    return title ? slugFromTitle(title, config) : null;
  }

  /**
   * The project's .code-workspace file, generating it if absent.
   *
   * When the window is rooted on .sabin itself there is no main clone to name
   * it after, so fall back to whichever workspace file is already there.
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
    if (this.mainRoot === null) {
      this.mainRoot = await mainWorktreeRoot(this.workspaceRoot);
    }
    return this.mainRoot;
  }

  public invalidate(): void {
    this.config = null;
  }
}

async function subdirectories(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
  } catch {
    return [];
  }
}

async function markdownFiles(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir)).filter(file => file.endsWith('.md'));
  } catch {
    return [];
  }
}
