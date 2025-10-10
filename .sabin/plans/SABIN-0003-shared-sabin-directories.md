# Shared .sabin Directory Implementation Plan

Ticket: SABIN-0003

## Overview

This plan implements support for sharing a single `.sabin` directory across multiple project directories using a Git-worktree-inspired approach where `.sabin` can be either a **directory** (traditional) or a **file** (pointing to a shared directory). This enables monorepo-style workflows where multiple projects can share the same task management system while tracking which project is working on each task.

## Current State Analysis

### Existing Architecture
- **CLI Commands**: All hardcode `const sabinDir = '.sabin'` in current working directory
- **VS Code Extension**: Uses `workspaceRoot/.sabin` pattern
- **Core Package**: Functions accept `sabinDir` parameter defaulting to `.sabin`
- **Configuration**: `.sabin/config.json` contains `projectPrefix` and `taskNumberPadding`
- **Task Frontmatter**: Contains `status`, `title`, `plan` (optional)

### Key Constraints
- No directory discovery mechanism exists
- All paths are relative to current working directory
- Task interface has no tracking of working directory
- Both CLI and extension assume `.sabin` is in a fixed location
- `.sabin` is always assumed to be a directory

### Key Discoveries
- Config module already parameterized: `readConfig(sabinDir)`, `writeConfig(config, sabinDir)` (packages/core/src/config.ts:20,41)
- parseTask/writeTask are path-based, no assumptions about location (packages/core/src/markdown.ts:7,20)
- Task interface can be extended with new frontmatter fields (packages/core/src/types.ts:1)
- gray-matter library handles arbitrary frontmatter fields automatically
- Git uses same pattern: `.git` can be file or directory (worktrees)

## Desired End State

### Directory Structure Example
```
projects/
  .sabin/                    # Shared task database (directory)
    config.json
    tasks/
      open/
      completed/
  project-1/
    .sabin                  # File pointing to ../.sabin
    src/
  project-2/
    .sabin                  # File pointing to ../.sabin
    src/
```

### `.sabin` as a File (Link to Shared Directory)

**`project-1/.sabin`** (file, not directory):
```json
{
  "sabinDir": "../.sabin"
}
```

### `.sabin` as a Directory (Traditional)

**`legacy-project/.sabin/`** (directory):
```
legacy-project/
  .sabin/                   # Traditional directory structure
    config.json
    tasks/
      open/
      completed/
```

### `.sabin/config.json` (Unchanged)
```json
{
  "projectPrefix": "SABIN",
  "taskNumberPadding": 4
}
```

### Task Frontmatter
```yaml
---
status: in_progress
title: Implement feature X
workingDir: project-1
---
```

### Verification
- CLI commands detect if `.sabin` is file or directory
- If file: read it to get path to shared directory
- If directory: use it directly (backward compatible)
- Tasks automatically record working directory when updated to `in_progress`
- `sabin link <path>` converts directory setup to shared setup

## What We're NOT Doing

- Not implementing task filtering by working directory (all tasks visible everywhere)
- Not preventing concurrent work on same task from different directories
- Not migrating existing projects automatically (manual setup required)
- Not supporting multiple `.sabin` directories per project
- Not tracking history of all directory changes (only current working directory)
- Not using symlinks (cross-platform compatibility)

## Implementation Approach

The implementation follows a layered approach:
1. Core utilities for `.sabin` detection (file vs directory) and path resolution
2. CLI command for linking to shared directories
3. Task model extension for working directory tracking
4. Update all CLI commands to use new resolution logic
5. VS Code extension updates
6. Comprehensive testing

This ensures each layer is independently testable and the changes are incremental.

---

## Phase 1: Core - .sabin Detection and Resolution

### Overview
Add logic to detect whether `.sabin` is a file or directory, and resolve the actual `.sabin` directory path accordingly. This phase creates the foundation for all other changes.

### Changes Required

#### 1. Create .sabin Resolution Module

**File**: `packages/core/src/sabinResolver.ts` (NEW)

```typescript
import fs from 'fs/promises';
import path from 'path';

export interface SabinLinkConfig {
  sabinDir: string;
}

/**
 * Resolve the actual .sabin directory path
 * Handles both file (link) and directory cases
 */
export async function resolveSabinDir(startDir: string = process.cwd()): Promise<{
  sabinDir: string;
  isLinked: boolean;
  projectRoot: string;
}> {
  const projectRoot = path.resolve(startDir);
  const sabinPath = path.join(projectRoot, '.sabin');

  try {
    const stat = await fs.stat(sabinPath);

    if (stat.isDirectory()) {
      // Traditional .sabin directory
      return {
        sabinDir: sabinPath,
        isLinked: false,
        projectRoot
      };
    } else if (stat.isFile()) {
      // .sabin file contains link to shared directory
      const content = await fs.readFile(sabinPath, 'utf8');
      const config: SabinLinkConfig = JSON.parse(content);

      if (!config.sabinDir) {
        throw new Error('.sabin file must contain "sabinDir" field');
      }

      const resolvedDir = path.resolve(projectRoot, config.sabinDir);
      return {
        sabinDir: resolvedDir,
        isLinked: true,
        projectRoot
      };
    } else {
      throw new Error('.sabin exists but is neither a file nor directory');
    }
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new Error('.sabin not found. Run "sabin init" first.');
    }
    throw error;
  }
}

/**
 * Write .sabin link file
 */
export async function writeSabinLink(projectRoot: string, targetSabinDir: string): Promise<void> {
  const sabinPath = path.join(projectRoot, '.sabin');

  // Calculate relative path from project to target .sabin
  const relativePath = path.relative(projectRoot, targetSabinDir);

  const config: SabinLinkConfig = {
    sabinDir: relativePath
  };

  const content = JSON.stringify(config, null, 2);
  await fs.writeFile(sabinPath, content);
}

/**
 * Check if .sabin exists and whether it's a file or directory
 */
export async function checkSabinType(projectRoot: string): Promise<'file' | 'directory' | 'none'> {
  const sabinPath = path.join(projectRoot, '.sabin');

  try {
    const stat = await fs.stat(sabinPath);
    if (stat.isFile()) return 'file';
    if (stat.isDirectory()) return 'directory';
    return 'none';
  } catch {
    return 'none';
  }
}
```

#### 2. Update Task Interface

**File**: `packages/core/src/types.ts`

```typescript
export interface Task {
  status: 'open' | 'ready' | 'in_progress' | 'review' | 'completed';
  title: string;
  plan?: string;
  workingDir?: string;  // NEW: relative path from .sabin parent
  content: string;
  path: string;
}
```

#### 3. Add Working Directory Utilities

**File**: `packages/core/src/workingDir.ts` (NEW)

```typescript
import path from 'path';

/**
 * Get the relative working directory name from a project root
 * relative to the .sabin parent directory
 *
 * Example:
 *   sabinDir: /projects/.sabin
 *   projectRoot: /projects/project-1
 *   Returns: project-1
 */
export function getWorkingDirName(sabinDir: string, projectRoot: string): string {
  const sabinParent = path.dirname(sabinDir);
  const relativePath = path.relative(sabinParent, projectRoot);

  // If same directory, return '.'
  if (relativePath === '') {
    return '.';
  }

  return relativePath;
}
```

#### 4. Update Core Package Exports

**File**: `packages/core/src/index.ts`

```typescript
// Existing exports
export * from './types';
export * from './markdown';
export * from './config';
export * from './errors';

// NEW exports
export * from './sabinResolver';
export * from './workingDir';
```

### Success Criteria

#### Automated Verification:
- [ ] Unit tests pass for `resolveSabinDir()`: `npm test -w @sabin/core -- sabinResolver.test.ts`
  - Test resolving directory (traditional .sabin/)
  - Test resolving file (linked .sabin)
  - Test error when .sabin doesn't exist
  - Test error when .sabin file has invalid JSON
- [ ] Unit tests pass for `getWorkingDirName()`: Various path combinations
- [ ] Type checking passes: `npm run typecheck`
- [ ] Linting passes: `npm run lint`
- [ ] All core package tests pass: `npm test -w @sabin/core`

#### Manual Verification:
- [ ] Create test directory with .sabin as file and verify resolution
- [ ] Create test directory with .sabin as directory and verify resolution
- [ ] Verify errors for missing .sabin

---

## Phase 2: CLI - Add Link Command and Update Init

### Overview
Add `sabin link` command to create linked setups, and update `sabin init` to always create a directory.

### Changes Required

#### 1. Simplify Init Command

**File**: `packages/cli/src/commands/init.ts`

```typescript
import { writeConfig, getDefaultConfig } from '@sabin/core';
import { checkSabinType } from '@sabin/core';

interface InitOptions {
  prefix: string;
}

export async function initProject(options: InitOptions): Promise<void> {
  const spinner = ora('Initializing Sabin project structure...').start();

  try {
    const projectRoot = process.cwd();
    const sabinType = await checkSabinType(projectRoot);

    if (sabinType !== 'none') {
      throw new Error(
        `.sabin already exists in this directory.\n` +
        `To link to a shared .sabin, remove the existing one and run: sabin link <path>`
      );
    }

    const sabinDir = path.join(projectRoot, '.sabin');

    // Create directory structure
    const dirs = [
      path.join(sabinDir, 'tasks', 'open'),
      path.join(sabinDir, 'tasks', 'completed'),
      path.join(sabinDir, 'plans'),
      path.join(sabinDir, 'research')
    ];

    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
    }

    // Create config file
    const config = getDefaultConfig();
    config.projectPrefix = options.prefix;
    await writeConfig(config, sabinDir);

    spinner.succeed(chalk.green('Sabin project initialized successfully!'));
    console.log(chalk.cyan(`\nProject prefix set to: ${options.prefix}`));
    console.log(chalk.gray(`Location: ${sabinDir}`));
  } catch (error: any) {
    spinner.fail(chalk.red('Failed to initialize Sabin project'));
    console.error(chalk.red(error.message));
    process.exit(1);
  }
}
```

**Update command registration in** `packages/cli/src/index.ts`:

```typescript
program
  .command('init')
  .description('Initialize Sabin in the current directory')
  .requiredOption('-p, --prefix <prefix>', 'Project prefix for task IDs')
  .action(initProject);
```

#### 2. Add Link Command

**File**: `packages/cli/src/commands/link.ts` (NEW)

```typescript
import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { writeSabinLink, checkSabinType } from '@sabin/core';

export async function linkToSharedSabin(targetPath: string): Promise<void> {
  const spinner = ora('Linking to shared .sabin...').start();

  try {
    const projectRoot = process.cwd();
    const resolvedTarget = path.resolve(projectRoot, targetPath);

    // Verify target .sabin exists and is a directory
    try {
      const stat = await fs.stat(resolvedTarget);
      if (!stat.isDirectory()) {
        throw new Error(`${targetPath} is not a directory`);
      }

      // Verify it's a valid .sabin directory (has config.json)
      const configPath = path.join(resolvedTarget, 'config.json');
      await fs.access(configPath);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new Error(
          `${targetPath} is not a valid .sabin directory.\n` +
          `Expected to find config.json at: ${path.join(targetPath, 'config.json')}`
        );
      }
      throw error;
    }

    // Check if .sabin already exists in current directory
    const currentType = await checkSabinType(projectRoot);

    if (currentType === 'directory') {
      spinner.warn(chalk.yellow('.sabin directory already exists'));
      const confirm = await promptConfirm(
        'Replace local .sabin directory with link to shared directory? This will DELETE the local directory.'
      );

      if (!confirm) {
        spinner.info('Cancelled');
        return;
      }

      // Remove existing directory
      await fs.rm(path.join(projectRoot, '.sabin'), { recursive: true, force: true });
      spinner.text = 'Removed local .sabin directory...';
    } else if (currentType === 'file') {
      throw new Error(
        '.sabin link already exists.\n' +
        'Remove it first if you want to link to a different directory.'
      );
    }

    // Create .sabin link file
    await writeSabinLink(projectRoot, resolvedTarget);

    spinner.succeed(chalk.green('Successfully linked to shared .sabin'));
    console.log(chalk.gray(`Target: ${resolvedTarget}`));
    console.log(chalk.gray(`Link file: ${path.join(projectRoot, '.sabin')}`));
  } catch (error: any) {
    spinner.fail(chalk.red('Failed to link to shared .sabin'));
    console.error(chalk.red(error.message));
    process.exit(1);
  }
}

async function promptConfirm(message: string): Promise<boolean> {
  // Use inquirer for confirmation prompt
  const { confirm } = await import('@inquirer/prompts');
  return await confirm({ message, default: false });
}
```

**Add to** `packages/cli/src/index.ts`:

```typescript
import { linkToSharedSabin } from './commands/link';

program
  .command('link')
  .description('Link to a shared .sabin directory')
  .argument('<path>', 'Path to shared .sabin directory')
  .action(linkToSharedSabin);
```

#### 3. Update Create Task Command

**File**: `packages/cli/src/commands/create-task.ts`

```typescript
import {
  getNextTaskNumber,
  writeTask,
  readConfig,
  resolveSabinDir,
  getWorkingDirName
} from '@sabin/core';

export async function createTask(options: CreateTaskOptions): Promise<void> {
  const spinner = ora('Creating task...').start();

  try {
    // Resolve .sabin directory (file or directory)
    const { sabinDir, isLinked, projectRoot } = await resolveSabinDir();
    const tasksDir = path.join(sabinDir, 'tasks');
    const openDir = path.join(tasksDir, 'open');

    // Read config from resolved .sabin directory
    const config = await readConfig(sabinDir);

    // ... rest of task creation logic ...

    // Create task object
    const task: Task = {
      status: 'open',
      title,
      content: content || '',
      path: filePath
    };

    // Add working directory if using linked setup
    if (isLinked) {
      task.workingDir = getWorkingDirName(sabinDir, projectRoot);
    }

    await writeTask(task);

    spinner.succeed(chalk.green(`Created task: ${filename}`));
    console.log(chalk.gray(`Location: ${filePath}`));
    if (task.workingDir) {
      console.log(chalk.gray(`Working directory: ${task.workingDir}`));
    }
  } catch (error: any) {
    spinner.fail(chalk.red('Failed to create task'));
    console.error(chalk.red(error.message));
    process.exit(1);
  }
}
```

#### 4. Update Status Command

**File**: `packages/cli/src/commands/update-status.ts`

```typescript
import {
  parseTask,
  writeTask,
  resolveSabinDir,
  getWorkingDirName
} from '@sabin/core';

export async function updateStatus(taskId: string, newStatus: string): Promise<void> {
  const spinner = ora(`Updating task ${taskId} status to ${newStatus}...`).start();

  try {
    // Validate status
    const validStatuses: TaskStatus[] = ['open', 'ready', 'in_progress', 'review', 'completed'];
    if (!validStatuses.includes(newStatus as TaskStatus)) {
      throw new Error(`Invalid status: ${newStatus}. Must be one of: ${validStatuses.join(', ')}`);
    }

    // Resolve .sabin directory
    const { sabinDir, isLinked, projectRoot } = await resolveSabinDir();
    const tasksDir = path.join(sabinDir, 'tasks');

    // Find task file (logic unchanged)
    let taskPath: string | null = null;
    let currentDir: string = '';

    // ... find task in open/ or completed/ ...

    if (!taskPath) {
      throw new Error(`Task ${taskId} not found`);
    }

    // Parse and update task
    const task = await parseTask(taskPath);
    task.status = newStatus as TaskStatus;

    // Update working directory when moving to in_progress
    if (newStatus === 'in_progress' && isLinked) {
      task.workingDir = getWorkingDirName(sabinDir, projectRoot);
    }

    // File move logic (unchanged)
    const shouldBeInCompleted = newStatus === 'completed';
    const isInCompleted = currentDir === 'completed';

    if (shouldBeInCompleted !== isInCompleted) {
      const filename = path.basename(taskPath);
      const newDir = shouldBeInCompleted ?
        path.join(tasksDir, 'completed') :
        path.join(tasksDir, 'open');

      await fs.mkdir(newDir, { recursive: true });
      const newPath = path.join(newDir, filename);

      task.path = newPath;
      await writeTask(task);
      await fs.unlink(taskPath);

      spinner.succeed(chalk.green(`Updated task ${taskId} status to ${newStatus}`));
      console.log(chalk.gray(`Moved from ${currentDir} to ${shouldBeInCompleted ? 'completed' : 'open'}`));
    } else {
      await writeTask(task);
      spinner.succeed(chalk.green(`Updated task ${taskId} status to ${newStatus}`));
    }

    if (task.workingDir) {
      console.log(chalk.gray(`Working directory: ${task.workingDir}`));
    }
  } catch (error: any) {
    spinner.fail(chalk.red(`Failed to update task status`));
    console.error(chalk.red(error.message));
    process.exit(1);
  }
}
```

#### 5. Update List Command

**File**: `packages/cli/src/commands/list-tasks.ts`

```typescript
import {
  parseTask,
  readConfig,
  resolveSabinDir
} from '@sabin/core';

export async function listTasks(options: ListTasksOptions): Promise<void> {
  try {
    // Resolve .sabin directory
    const { sabinDir } = await resolveSabinDir();
    const tasksDir = path.join(sabinDir, 'tasks');
    const config = await readConfig(sabinDir);
    const tasks: Task[] = [];

    // Rest of listing logic unchanged, just use resolved paths
    // ...

    // Display tasks with working directory
    for (const task of filteredTasks) {
      console.log(chalk.cyan(`\n${path.basename(task.path, '.md')}`));
      console.log(chalk.gray(`  Status: ${task.status}`));
      console.log(chalk.gray(`  Title: ${task.title}`));
      if (task.workingDir) {
        console.log(chalk.gray(`  Working Dir: ${task.workingDir}`));
      }
    }
  } catch (error: any) {
    console.error(chalk.red('Failed to list tasks'));
    console.error(chalk.red(error.message));
    process.exit(1);
  }
}
```

### Success Criteria

#### Automated Verification:
- [ ] All CLI tests pass: `npm test -w @sabin/cli`
- [ ] Type checking passes: `npm run typecheck`
- [ ] Linting passes: `npm run lint`
- [ ] Build succeeds: `npm run build`

#### Manual Verification:
- [ ] `sabin init --prefix TEST` creates .sabin/ directory
- [ ] `sabin link ../.sabin` creates .sabin file (after removing directory)
- [ ] Create task from project with .sabin file works correctly
- [ ] Update task status to in_progress records workingDir
- [ ] List tasks shows working directory
- [ ] Backward compatibility: existing projects with .sabin/ directory still work
- [ ] Error handling: helpful messages for invalid targets

---

## Phase 3: VS Code Extension - Shared Directory Support

### Overview
Update the VS Code extension to detect and resolve `.sabin` files (links) in addition to directories.

### Changes Required

#### 1. Update Task Service

**File**: `packages/vscode-extension/src/services/taskService.ts`

```typescript
import * as path from 'path';
import * as fs from 'fs';

export class TaskService {
  private static instance: TaskService;
  private workspaceRoot: string;
  private sabinDir: string | null = null;
  private isLinked: boolean = false;

  private constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  // Resolve .sabin directory (file or directory)
  private async resolveSabinDir(): Promise<{ sabinDir: string; isLinked: boolean }> {
    if (this.sabinDir) {
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
      }
    } catch (error) {
      console.error('Failed to resolve .sabin:', error);
      // Fallback to traditional path
      this.sabinDir = sabinPath;
      this.isLinked = false;
    }

    return { sabinDir: this.sabinDir, isLinked: this.isLinked };
  }

  // Get working directory name
  private getWorkingDirName(sabinDir: string): string {
    const sabinParent = path.dirname(sabinDir);
    const relativePath = path.relative(sabinParent, this.workspaceRoot);
    return relativePath === '' ? '.' : relativePath;
  }

  // Update all methods to use resolveSabinDir()
  async getTasks(): Promise<Task[]> {
    const { sabinDir } = await this.resolveSabinDir();
    const tasksPath = path.join(sabinDir, 'tasks');
    // ... rest of implementation
  }

  async updateTaskStatus(taskId: string, newStatus: string): Promise<void> {
    const { sabinDir, isLinked } = await this.resolveSabinDir();

    // Find and read file
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

    // Read and update content
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

    // Write updated content
    fs.writeFileSync(filePath, content);

    // Move file if needed
    if (newStatus === 'completed' && !filePath.includes('/completed/')) {
      await this.moveTaskToCompleted(filePath, sabinDir);
    } else if (newStatus !== 'completed' && filePath.includes('/completed/')) {
      await this.moveTaskToOpen(filePath, sabinDir);
    }
  }

  async createTask(title: string, description?: string, taskNumber?: string): Promise<string> {
    const { sabinDir, isLinked } = await this.resolveSabinDir();

    // ... task creation logic ...

    // Add working directory for tasks in linked setup
    if (isLinked) {
      const workingDir = this.getWorkingDirName(sabinDir);
      if (workingDir !== '.') {
        frontmatter.workingDir = workingDir;
      }
    }

    // ... rest of implementation
  }
}
```

#### 2. Update File Watcher

**File**: `packages/vscode-extension/src/watchers/fileWatcher.ts`

```typescript
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class SabinFileWatcher implements vscode.Disposable {
  private watcher: vscode.FileSystemWatcher | null = null;
  private onChangeCallback: () => void;

  constructor(onChange: () => void) {
    this.onChangeCallback = onChange;
    this.setupWatcher();
  }

  private async setupWatcher() {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceRoot) return;

    // Resolve .sabin location
    const sabinDir = this.resolveSabinDir(workspaceRoot.uri.fsPath);

    // Watch the resolved .sabin directory
    const filePattern = new vscode.RelativePattern(sabinDir, '**/*.md');
    this.watcher = vscode.workspace.createFileSystemWatcher(filePattern);

    // ... rest of watcher setup
  }

  private resolveSabinDir(workspaceRoot: string): string {
    const sabinPath = path.join(workspaceRoot, '.sabin');

    try {
      const stat = fs.statSync(sabinPath);

      if (stat.isFile()) {
        // Read link file
        const content = fs.readFileSync(sabinPath, 'utf8');
        const config = JSON.parse(content);
        if (config.sabinDir) {
          return path.resolve(workspaceRoot, config.sabinDir);
        }
      }
    } catch (error) {
      console.error('Failed to read .sabin:', error);
    }

    // Default to treating as directory
    return sabinPath;
  }

  dispose() {
    this.watcher?.dispose();
  }
}
```

### Success Criteria

#### Automated Verification:
- [ ] Extension builds successfully: `cd packages/vscode-extension && npm run package`
- [ ] Type checking passes: `npm run typecheck`
- [ ] Linting passes: `npm run lint`
- [ ] All extension tests pass: `npm test -w sabin-vscode`

#### Manual Verification:
- [ ] Install VSIX: `cd packages/vscode-extension && npx @vscode/vsce package && code --install-extension sabin-vscode-0.1.0.vsix`
- [ ] Open workspace with .sabin file (linked)
- [ ] Extension shows tasks from shared directory
- [ ] Creating task via extension adds workingDir field
- [ ] Updating task to in_progress records working directory
- [ ] File watcher detects changes in shared .sabin directory
- [ ] Backward compatibility: workspaces with .sabin/ directory still work

---

## Phase 4: Documentation and Polish

### Overview
Add documentation, error messages, and user guidance for the new shared directory feature.

### Changes Required

#### 1. Update README

**File**: `README.md`

Add section explaining shared directory setup:

```markdown
## Shared .sabin Setup

For monorepos or multi-project workflows, you can share a single `.sabin` directory across multiple projects.

### How It Works

Sabin uses a Git-worktree-inspired approach where `.sabin` can be:
- **A directory** (traditional setup) - contains your tasks directly
- **A file** (linked setup) - points to a shared `.sabin` directory elsewhere

### Setup

1. Create the first project with a traditional `.sabin` directory:
   ```bash
   cd projects/project-1
   sabin init --prefix MYPROJECT
   ```

2. Link other projects to the same `.sabin`:
   ```bash
   cd ../project-2
   sabin link ../project-1/.sabin
   ```

   Or if you want the shared `.sabin` in a parent directory:
   ```bash
   mv project-1/.sabin .
   cd project-1
   sabin link ../.sabin
   cd ../project-2
   sabin link ../.sabin
   ```

3. All linked projects now share tasks!

### Working Directory Tracking

When you update a task to `in_progress`, Sabin records which project directory is working on it:

```bash
cd projects/project-1
sabin task update MYPROJECT-0001 in_progress
# Task frontmatter now includes: workingDir: project-1
```

This helps teams see which project is actively working on each task.

### .sabin File Format

When `.sabin` is a file (linked setup), it contains:

```json
{
  "sabinDir": "../.sabin"
}
```

Paths can be relative or absolute.
```

#### 2. Add Migration Guide

**File**: `docs/MIGRATION.md` (NEW)

```markdown
# Shared .sabin Setup Guide

## Converting to Shared Setup

### Option 1: Move Existing .sabin to Parent

If you have an existing project with `.sabin/`:

```bash
cd my-project
mv .sabin ../.sabin
sabin link ../.sabin
```

Now other projects can link to it:

```bash
cd ../other-project
sabin link ../.sabin
```

### Option 2: Create New Shared Directory

```bash
# Create shared .sabin in parent directory
cd projects
mkdir .sabin
# Or use sabin init in a temporary directory and move it

# Link projects to it
cd project-1
sabin link ../.sabin

cd ../project-2
sabin link ../.sabin
```

## Unlinking

To convert back from linked to local:

```bash
# Remove .sabin link file
rm .sabin

# Create new local .sabin
sabin init --prefix YOUR_PREFIX
```

Note: This creates a new empty `.sabin`. To copy tasks from the shared directory, manually copy them first.
```

#### 3. Improve Error Messages

Update CLI commands to provide helpful errors:

```typescript
// In commands when .sabin not found:
throw new Error(
  '.sabin not found. Run "sabin init --prefix YOUR_PREFIX" to create one.'
);

// In link command when target is invalid:
throw new Error(
  `${targetPath} is not a valid .sabin directory.\n` +
  `Expected to find config.json at: ${path.join(targetPath, 'config.json')}\n` +
  `Make sure you're pointing to a valid .sabin directory.`
);

// When .sabin file has invalid format:
throw new Error(
  '.sabin file has invalid format.\n' +
  'Expected JSON with "sabinDir" field: { "sabinDir": "../.sabin" }'
);
```

### Success Criteria

#### Automated Verification:
- [ ] Markdown linting passes: `npm run lint-md` (if available)
- [ ] Documentation builds correctly

#### Manual Verification:
- [ ] README accurately describes shared setup process
- [ ] Migration guide is clear and actionable
- [ ] Error messages are helpful and guide users to solutions
- [ ] Examples in documentation work as written

---

## Phase 5: Testing

### Overview
Comprehensive testing of all changes including integration tests for shared directory workflows.

### Changes Required

#### 1. Core Package Tests

**File**: `packages/core/src/__tests__/sabinResolver.test.ts` (NEW)

```typescript
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  resolveSabinDir,
  writeSabinLink,
  checkSabinType
} from '../sabinResolver';

describe('sabinResolver', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sabin-test-'));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('resolveSabinDir', () => {
    it('should resolve .sabin directory (traditional setup)', async () => {
      const sabinDir = path.join(testDir, '.sabin');
      await fs.mkdir(sabinDir);

      const result = await resolveSabinDir(testDir);

      expect(result.sabinDir).toBe(sabinDir);
      expect(result.isLinked).toBe(false);
      expect(result.projectRoot).toBe(testDir);
    });

    it('should resolve .sabin file (linked setup)', async () => {
      const sharedSabin = path.join(testDir, 'shared', '.sabin');
      await fs.mkdir(sharedSabin, { recursive: true });

      const projectDir = path.join(testDir, 'project-1');
      await fs.mkdir(projectDir);
      await writeSabinLink(projectDir, sharedSabin);

      const result = await resolveSabinDir(projectDir);

      expect(result.sabinDir).toBe(sharedSabin);
      expect(result.isLinked).toBe(true);
      expect(result.projectRoot).toBe(projectDir);
    });

    it('should throw error when .sabin does not exist', async () => {
      await expect(resolveSabinDir(testDir)).rejects.toThrow('.sabin not found');
    });

    it('should throw error when .sabin file has invalid JSON', async () => {
      const sabinFile = path.join(testDir, '.sabin');
      await fs.writeFile(sabinFile, 'invalid json');

      await expect(resolveSabinDir(testDir)).rejects.toThrow();
    });

    it('should throw error when .sabin file missing sabinDir field', async () => {
      const sabinFile = path.join(testDir, '.sabin');
      await fs.writeFile(sabinFile, JSON.stringify({ foo: 'bar' }));

      await expect(resolveSabinDir(testDir)).rejects.toThrow('must contain "sabinDir"');
    });
  });

  describe('checkSabinType', () => {
    it('should return "directory" for .sabin directory', async () => {
      await fs.mkdir(path.join(testDir, '.sabin'));
      const type = await checkSabinType(testDir);
      expect(type).toBe('directory');
    });

    it('should return "file" for .sabin file', async () => {
      await fs.writeFile(path.join(testDir, '.sabin'), '{}');
      const type = await checkSabinType(testDir);
      expect(type).toBe('file');
    });

    it('should return "none" when .sabin does not exist', async () => {
      const type = await checkSabinType(testDir);
      expect(type).toBe('none');
    });
  });
});
```

**File**: `packages/core/src/__tests__/workingDir.test.ts` (NEW)

```typescript
import path from 'path';
import { getWorkingDirName } from '../workingDir';

describe('workingDir', () => {
  describe('getWorkingDirName', () => {
    it('should return relative directory name', () => {
      const sabinDir = '/projects/.sabin';
      const projectRoot = '/projects/project-1';

      const result = getWorkingDirName(sabinDir, projectRoot);
      expect(result).toBe('project-1');
    });

    it('should return . for same directory', () => {
      const sabinDir = '/projects/.sabin';
      const projectRoot = '/projects';

      const result = getWorkingDirName(sabinDir, projectRoot);
      expect(result).toBe('.');
    });

    it('should handle nested directories', () => {
      const sabinDir = '/projects/.sabin';
      const projectRoot = '/projects/apps/web';

      const result = getWorkingDirName(sabinDir, projectRoot);
      expect(result).toBe('apps/web');
    });
  });
});
```

#### 2. CLI Integration Tests

**File**: `packages/cli/src/__tests__/link.test.ts` (NEW)

```typescript
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { linkToSharedSabin } from '../commands/link';
import { initProject } from '../commands/init';

describe('sabin link', () => {
  let testRoot: string;
  let sharedSabin: string;
  let project1: string;

  beforeEach(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sabin-link-test-'));
    sharedSabin = path.join(testRoot, '.sabin');
    project1 = path.join(testRoot, 'project-1');

    // Create shared .sabin
    await fs.mkdir(path.join(sharedSabin, 'tasks', 'open'), { recursive: true });
    await fs.writeFile(
      path.join(sharedSabin, 'config.json'),
      JSON.stringify({ projectPrefix: 'TEST', taskNumberPadding: 4 })
    );

    // Create project directory
    await fs.mkdir(project1);
  });

  afterEach(async () => {
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  it('should create .sabin link file', async () => {
    process.chdir(project1);
    await linkToSharedSabin('../.sabin');

    const sabinFile = path.join(project1, '.sabin');
    const stat = await fs.stat(sabinFile);
    expect(stat.isFile()).toBe(true);

    const content = await fs.readFile(sabinFile, 'utf8');
    const config = JSON.parse(content);
    expect(config.sabinDir).toBe('../.sabin');
  });

  it('should error if target does not exist', async () => {
    process.chdir(project1);
    await expect(linkToSharedSabin('../nonexistent')).rejects.toThrow();
  });

  it('should error if target is not a valid .sabin directory', async () => {
    const invalidDir = path.join(testRoot, 'invalid');
    await fs.mkdir(invalidDir);

    process.chdir(project1);
    await expect(linkToSharedSabin('../invalid')).rejects.toThrow('not a valid .sabin');
  });
});
```

**File**: `packages/cli/src/__tests__/shared-workflow.test.ts` (NEW)

```typescript
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { initProject } from '../commands/init';
import { linkToSharedSabin } from '../commands/link';
import { createTask } from '../commands/create-task';
import { updateStatus } from '../commands/update-status';

describe('Shared .sabin workflow', () => {
  let testRoot: string;
  let project1: string;
  let project2: string;

  beforeEach(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sabin-shared-test-'));
    project1 = path.join(testRoot, 'project-1');
    project2 = path.join(testRoot, 'project-2');

    await fs.mkdir(project1);
    await fs.mkdir(project2);
  });

  afterEach(async () => {
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  it('should share tasks between projects', async () => {
    // Initialize project-1 with .sabin directory
    process.chdir(project1);
    await initProject({ prefix: 'TEST' });

    // Move .sabin to parent and link
    await fs.rename(path.join(project1, '.sabin'), path.join(testRoot, '.sabin'));
    await linkToSharedSabin('../.sabin');

    // Link project-2
    process.chdir(project2);
    await linkToSharedSabin('../.sabin');

    // Create task from project-1
    process.chdir(project1);
    await createTask({ title: 'Shared task' });

    // Verify task is visible from project-2
    const tasksDir = path.join(testRoot, '.sabin', 'tasks', 'open');
    const tasks = await fs.readdir(tasksDir);

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toContain('TEST-0001');
  });

  it('should track working directory on status update', async () => {
    // Setup
    process.chdir(project1);
    await initProject({ prefix: 'TEST' });
    await fs.rename(path.join(project1, '.sabin'), path.join(testRoot, '.sabin'));
    await linkToSharedSabin('../.sabin');

    await createTask({ title: 'Test task' });

    // Update to in_progress from project-1
    await updateStatus('TEST-0001', 'in_progress');

    // Read task and verify workingDir
    const taskPath = path.join(testRoot, '.sabin', 'tasks', 'open', 'TEST-0001.md');
    const content = await fs.readFile(taskPath, 'utf8');

    expect(content).toContain('workingDir: project-1');
  });
});
```

### Success Criteria

#### Automated Verification:
- [ ] All core tests pass: `npm test -w @sabin/core`
- [ ] All CLI tests pass: `npm test -w @sabin/cli`
- [ ] All extension tests pass: `npm test -w sabin-vscode`
- [ ] Integration tests pass: `npm test`
- [ ] Type checking passes: `npm run typecheck`
- [ ] Linting passes: `npm run lint`
- [ ] Full build succeeds: `npm run build`

#### Manual Verification:
- [ ] End-to-end workflow: Create project, link to shared, create tasks, update status
- [ ] Backward compatibility: Existing projects with .sabin/ continue to work
- [ ] Error handling: Invalid links produce helpful errors
- [ ] VS Code integration: Extension works with both file and directory .sabin

---

## Testing Strategy

### Unit Tests
- .sabin type detection (file vs directory)
- .sabin resolution (both cases)
- Working directory name calculation
- Link file creation
- Error cases (missing, invalid)

### Integration Tests
- CLI workflow: init → link → create → update → list
- Task visibility across linked projects
- Working directory tracking
- Backward compatibility

### Manual Testing Steps

1. **Fresh Linked Setup**:
   ```bash
   mkdir -p /tmp/test-shared/project-{1,2}
   cd /tmp/test-shared/project-1
   sabin init --prefix TEST
   mv .sabin ../.sabin
   sabin link ../.sabin
   cd ../project-2
   sabin link ../.sabin
   ls -la  # Verify .sabin is a file in both projects
   ```

2. **Create Task from Project 1**:
   ```bash
   cd /tmp/test-shared/project-1
   sabin task create -t "Shared feature" -c "Build something"
   ```

3. **View from Project 2**:
   ```bash
   cd /tmp/test-shared/project-2
   sabin task list
   # Should see TEST-0001
   ```

4. **Update Status from Project 2**:
   ```bash
   sabin task update TEST-0001 in_progress
   cat ../.sabin/tasks/open/TEST-0001.md
   # Should contain: workingDir: project-2
   ```

5. **VS Code Extension**:
   - Open `/tmp/test-shared/project-1` in VS Code
   - Verify tasks appear in sidebar
   - Create task via UI
   - Verify task appears in `/tmp/test-shared/.sabin/tasks/open/`

6. **Backward Compatibility**:
   ```bash
   cd /tmp
   mkdir legacy-project
   cd legacy-project
   sabin init --prefix OLD
   ls -la .sabin  # Should be a directory
   sabin task create -t "Legacy task"
   sabin task list
   # Should work normally
   ```

## Performance Considerations

### File vs Directory Check
- Single `fs.stat()` call to check type
- Performance impact: < 1ms (negligible)
- No directory walking needed (unlike original .sabinconfig approach)

### File Watching
- VS Code extension must watch resolved .sabin path
- Single watcher per shared directory (efficient for multiple projects)
- No performance impact compared to current implementation

### Backward Compatibility
- Traditional .sabin/ directories have zero overhead
- Detection is instant (single stat check)

## Migration Notes

### Existing Projects

**No migration required** for projects that keep `.sabin` in project directory. The system is backward compatible.

**For projects adopting shared setup**:
1. Initialize first project: `sabin init --prefix YOUR_PREFIX`
2. Move `.sabin` to desired location (e.g., parent directory)
3. Link first project: `sabin link ../path/to/.sabin`
4. Link other projects: `sabin link ../path/to/.sabin`

### .sabin Detection Logic

1. Check if `.sabin` exists
2. If exists, check type (file or directory)
3. If file: read and resolve path
4. If directory: use directly
5. If missing: error

## References

- Original ticket: `.sabin/tasks/open/SABIN-0003.md`
- Current config handling: `packages/core/src/config.ts`
- Current task updates: `packages/cli/src/commands/update-status.ts`
- Task interface: `packages/core/src/types.ts:1`
- Git worktree inspiration: `.git` file format
