import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import matter from 'gray-matter';

interface SabinConfig {
  projectPrefix: string;
  taskNumberPadding: number;
}

const DEFAULT_CONFIG: SabinConfig = {
  projectPrefix: 'TASK',
  taskNumberPadding: 4
};

export interface Task {
  id: string;
  status: 'open' | 'ready' | 'in_progress' | 'review' | 'completed';
  title: string;
  plan?: string;
  workingDir?: string;
  content: string;
  path: string;
  filename: string;
}

/**
 * Shared service for task file operations used by both TreeView and Webview
 */
export class TaskService {
  private static instance: TaskService;
  private workspaceRoot: string;
  private config: SabinConfig | null = null;
  private sabinDir: string | null = null;
  private isLinked: boolean = false;

  private constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  public static getInstance(workspaceRoot?: string): TaskService {
    if (!TaskService.instance && workspaceRoot) {
      TaskService.instance = new TaskService(workspaceRoot);
    }
    if (!TaskService.instance) {
      throw new Error('TaskService must be initialized with a workspace root');
    }
    return TaskService.instance;
  }

  /**
   * Resolve .sabin directory (file or directory)
   */
  private async resolveSabinDir(): Promise<{ sabinDir: string; isLinked: boolean }> {
    if (this.sabinDir) {
      return { sabinDir: this.sabinDir, isLinked: this.isLinked };
    }

    // Check if workspace root itself is a .sabin directory
    // by looking for characteristic files/folders
    const isSabinRoot = this.isSabinDirectory(this.workspaceRoot);

    if (isSabinRoot) {
      // Workspace root IS the .sabin directory
      this.sabinDir = this.workspaceRoot;
      this.isLinked = false;
      return { sabinDir: this.sabinDir, isLinked: this.isLinked };
    }

    const sabinPath = path.join(this.workspaceRoot, '.sabin');

    try {
      const stat = fs.statSync(sabinPath);

      if (stat.isDirectory()) {
        // Traditional .sabin directory
        this.sabinDir = sabinPath;
        this.isLinked = false;
      } else if (stat.isFile()) {
        // .sabin file contains link to shared directory
        const content = fs.readFileSync(sabinPath, 'utf8');
        const config = JSON.parse(content);

        if (config.sabinDir) {
          this.sabinDir = path.resolve(this.workspaceRoot, config.sabinDir);
          this.isLinked = true;
        } else {
          throw new Error('.sabin file must contain "sabinDir" field');
        }
      } else {
        // Fallback to traditional path
        this.sabinDir = sabinPath;
        this.isLinked = false;
      }
    } catch (error) {
      console.error('Failed to resolve .sabin:', error);
      // Fallback to traditional path
      this.sabinDir = sabinPath;
      this.isLinked = false;
    }

    // sabinDir is guaranteed to be set at this point
    return { sabinDir: this.sabinDir!, isLinked: this.isLinked };
  }

  /**
   * Check if a directory is a .sabin directory by looking for characteristic structure
   */
  private isSabinDirectory(dirPath: string): boolean {
    // Check for tasks/ directory or config.json file
    const tasksDir = path.join(dirPath, 'tasks');
    const configFile = path.join(dirPath, 'config.json');

    return fs.existsSync(tasksDir) || fs.existsSync(configFile);
  }

  /**
   * Get working directory name
   */
  private getWorkingDirName(sabinDir: string): string {
    // If workspace root IS the .sabin directory, no working directory needed
    if (this.workspaceRoot === sabinDir) {
      return '.';
    }

    const sabinParent = path.dirname(sabinDir);
    const relativePath = path.relative(sabinParent, this.workspaceRoot);
    return relativePath === '' ? '.' : relativePath;
  }

  /**
   * Read the config file, returning default config if it doesn't exist
   */
  private async getConfig(): Promise<SabinConfig> {
    if (this.config) {
      return this.config;
    }

    const { sabinDir } = await this.resolveSabinDir();
    const configPath = path.join(sabinDir, 'config.json');
    let loadedConfig: SabinConfig;

    try {
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf8');
        const config = JSON.parse(content);
        loadedConfig = { ...DEFAULT_CONFIG, ...config };
      } else {
        loadedConfig = { ...DEFAULT_CONFIG };
      }
    } catch (error) {
      loadedConfig = { ...DEFAULT_CONFIG };
    }

    this.config = loadedConfig;
    return this.config;
  }

  /**
   * Get all tasks, optionally filtered by status
   */
  async getTasks(status?: string): Promise<Task[]> {
    const { sabinDir } = await this.resolveSabinDir();
    const tasksPath = path.join(sabinDir, 'tasks');
    const tasks: Task[] = [];

    for (const dir of ['open', 'completed']) {
      const dirPath = path.join(tasksPath, dir);

      if (!fs.existsSync(dirPath)) {
        continue;
      }

      const files = fs.readdirSync(dirPath);

      for (const file of files.filter(f => f.endsWith('.md'))) {
        const filePath = path.join(dirPath, file);
        const task = await this.parseTask(filePath);

        if (!status || task.status === status) {
          tasks.push(task);
        }
      }
    }

    return tasks;
  }

  /**
   * Parse a task file and return a Task object
   */
  private async parseTask(filePath: string): Promise<Task> {
    const content = fs.readFileSync(filePath, 'utf8');
    const { data, content: body } = matter(content);

    return {
      id: path.basename(filePath, '.md'),
      status: data.status || 'open',
      title: data.title || path.basename(filePath, '.md'),
      plan: data.plan,
      workingDir: data.workingDir,
      content: body,
      path: filePath,
      filename: path.basename(filePath)
    };
  }

  /**
   * Update a task's status and move file if necessary
   */
  async updateTaskStatus(taskId: string, newStatus: string): Promise<void> {
    const { sabinDir, isLinked } = await this.resolveSabinDir();

    let filePath: string | undefined;
    for (const dir of ['open', 'completed']) {
      const testPath = path.join(sabinDir, 'tasks', dir, `${taskId}.md`);
      if (fs.existsSync(testPath)) {
        filePath = testPath;
        break;
      }
    }

    if (!filePath) {
      throw new Error(`Task ${taskId} not found`);
    }

    let content = fs.readFileSync(filePath, 'utf8');

    // Update status
    content = content.replace(
      /^status:\s*\w+$/m,
      `status: ${newStatus}`
    );

    // Add/update workingDir when moving to in_progress
    if (newStatus === 'in_progress' && isLinked) {
      const workingDir = this.getWorkingDirName(sabinDir);

      if (content.match(/^workingDir:/m)) {
        // Update existing
        content = content.replace(
          /^workingDir:.*$/m,
          `workingDir: ${workingDir}`
        );
      } else {
        // Add after status line
        content = content.replace(
          /^(status:\s*\w+)$/m,
          `$1\nworkingDir: ${workingDir}`
        );
      }
    }

    // Write updated content first
    fs.writeFileSync(filePath, content);

    // Move file if needed (with delay to ensure write completes)
    if (newStatus === 'completed' && !filePath.includes('/completed/')) {
      await this.moveTaskToCompleted(filePath, sabinDir);
    } else if (newStatus !== 'completed' && filePath.includes('/completed/')) {
      await this.moveTaskToOpen(filePath, sabinDir);
    }
  }

  /**
   * Move a task file to the completed directory
   */
  private async moveTaskToCompleted(filePath: string, sabinDir: string): Promise<void> {
    // Small delay to ensure file write completes
    await new Promise(resolve => setTimeout(resolve, 100));

    const filename = path.basename(filePath);
    const newPath = path.join(sabinDir, 'tasks', 'completed', filename);

    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(newPath)));
    await vscode.workspace.fs.rename(vscode.Uri.file(filePath), vscode.Uri.file(newPath));
  }

  /**
   * Move a task file to the open directory
   */
  private async moveTaskToOpen(filePath: string, sabinDir: string): Promise<void> {
    // Small delay to ensure file write completes
    await new Promise(resolve => setTimeout(resolve, 100));

    const filename = path.basename(filePath);
    const newPath = path.join(sabinDir, 'tasks', 'open', filename);

    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(newPath)));
    await vscode.workspace.fs.rename(vscode.Uri.file(filePath), vscode.Uri.file(newPath));
  }

  /**
   * Get the configured project prefix
   */
  async getProjectPrefix(): Promise<string> {
    const config = await this.getConfig();
    return config.projectPrefix;
  }

  /**
   * Get the next available task number
   */
  async getNextTaskNumber(): Promise<string> {
    const config = await this.getConfig();
    const { sabinDir } = await this.resolveSabinDir();
    const tasksDir = path.join(sabinDir, 'tasks');
    const fsVscode = vscode.workspace.fs;

    let maxNumber = 0;

    // Create regex pattern based on configured prefix
    const pattern = new RegExp(`^${config.projectPrefix}-(\\d+)\\.md$`);

    for (const dir of ['open', 'completed']) {
      try {
        const dirPath = path.join(tasksDir, dir);
        const existingTasks = await fsVscode.readDirectory(vscode.Uri.file(dirPath));
        for (const [name] of existingTasks) {
          const match = name.match(pattern);
          if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxNumber) {
              maxNumber = num;
            }
          }
        }
      } catch (error) {
        // Directory might not exist
      }
    }

    return String(maxNumber + 1).padStart(config.taskNumberPadding, '0');
  }

  /**
   * Create a new task
   */
  async createTask(title: string, description?: string, taskNumber?: string): Promise<string> {
    const config = await this.getConfig();
    const { sabinDir, isLinked } = await this.resolveSabinDir();
    const tasksDir = path.join(sabinDir, 'tasks');
    const fsVscode = vscode.workspace.fs;

    await fsVscode.createDirectory(vscode.Uri.file(path.join(tasksDir, 'open')));
    await fsVscode.createDirectory(vscode.Uri.file(path.join(tasksDir, 'completed')));

    // Get task ID - use provided ID or generate next one
    let taskId: string;
    let filename: string;

    if (taskNumber) {
      // Accept any non-empty string as task ID
      const customId = taskNumber.trim();
      if (!customId) {
        throw new Error('Task ID cannot be empty.');
      }

      // Use the ID as-is for the filename
      taskId = customId;
      filename = `${taskId}.md`;

      // Check if task already exists
      const testPathOpen = path.join(tasksDir, 'open', filename);
      const testPathCompleted = path.join(tasksDir, 'completed', filename);

      if (fs.existsSync(testPathOpen)) {
        throw new Error(`Task ${taskId} already exists in open/`);
      }
      if (fs.existsSync(testPathCompleted)) {
        throw new Error(`Task ${taskId} already exists in completed/`);
      }
    } else {
      // Generate next task number using configured prefix
      const nextNumber = await this.getNextTaskNumber();
      taskId = `${config.projectPrefix}-${nextNumber}`;
      filename = `${taskId}.md`;
    }

    const filePath = path.join(tasksDir, 'open', filename);

    // Helper function to safely quote YAML values
    const quoteYaml = (value: string) => {
      // Quote if contains special characters like colons, quotes, or starts with special chars
      if (/[:\[\]{}&*#?|<>=!%@`]/.test(value) || /^['"@-]/.test(value)) {
        return `"${value.replace(/"/g, '\\"')}"`;
      }
      return value;
    };

    let frontmatter = `---
status: open
title: ${quoteYaml(title)}`;

    // Add working directory for tasks in linked setup
    if (isLinked) {
      const workingDir = this.getWorkingDirName(sabinDir);
      if (workingDir !== '.') {
        frontmatter += `\nworkingDir: ${workingDir}`;
      }
    }

    frontmatter += '\n---\n';

    const content = `${frontmatter}
${description || ''}
`;

    await fsVscode.writeFile(vscode.Uri.file(filePath), Buffer.from(content));

    return filePath;
  }

  /**
   * Delete a task file
   */
  async deleteTask(taskPath: string): Promise<void> {
    if (!fs.existsSync(taskPath)) {
      throw new Error(`Task file not found: ${taskPath}`);
    }

    await vscode.workspace.fs.delete(vscode.Uri.file(taskPath));
  }
}
