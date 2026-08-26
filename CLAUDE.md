# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Sabin is a file-based workflow management system for agentic coding. It consists of three packages in a monorepo structure:
- **@sabin/core**: Shared types and utilities for parsing/writing tasks and TODO items
- **@sabin/cli**: Command-line interface for workflow management
- **sabin-vscode**: VS Code extension with task visualization and management UI

The system manages work through markdown files with YAML frontmatter, organized in a `.sabin` directory structure.

## Build, Test, and Development Commands

### Root-level commands (using Lerna):
```bash
npm run build      # Build all packages
npm test           # Run tests for all packages
npm run lint       # Lint all packages
npm run typecheck  # Type-check all packages
```

### Package-specific commands:
```bash
# Build specific package
npm run build -w @sabin/core
npm run build -w @sabin/cli
npm run build -w sabin-vscode

# Run CLI in development mode
cd packages/cli && npm run dev

# VS Code extension development
cd packages/vscode-extension && npm run watch  # Watch mode for development (uses esbuild)
cd packages/vscode-extension && npm run package  # Build production bundle
cd packages/vscode-extension && npx @vscode/vsce package  # Create VSIX package
```

### Installing CLI locally:
```bash
cd packages/cli && npm link
```

### Testing VS Code extension:

**Development (F5 debugging):**
- Open `packages/vscode-extension` in VS Code
- Press `F5` to launch Extension Development Host
- Changes require rebuild (watch mode auto-rebuilds)

**VSIX installation testing:**
```bash
cd packages/vscode-extension
npm run package  # Build bundle
npx @vscode/vsce package  # Create VSIX (~25KB)
code --install-extension sabin-vscode-0.1.0.vsix  # Install
```

**IMPORTANT: After making changes to the VS Code extension:**
After modifying any code in the VS Code extension, you MUST:
1. Package the extension: `cd packages/vscode-extension && npx @vscode/vsce package`
2. Install the VSIX: `code --install-extension sabin-vscode-0.1.0.vsix` (from the vscode-extension directory)
3. Reload VS Code to see the changes take effect

The extension is bundled with esbuild - all dependencies (including `gray-matter`) are bundled into a single `dist/extension.js` file. No `node_modules` required at runtime.

## Architecture

### Data Model

The system uses a file-based approach with this directory structure:
```
.sabin/
  tasks/
    open/              # Tasks with status: open, ready, or review
    completed/         # Tasks with status: completed
  plans/               # Implementation plan documents
  research/            # Research and context documents
```

### Task Structure

Tasks are markdown files with YAML frontmatter:
- **Frontmatter fields**: `status` (open/ready/in_progress/review/completed), `title`, `slug` (optional descriptive suffix), `plan` (optional path to plan file), `branch`, `worktree`, `workingDir`
- **Statuses**:
  - `open`: Initial requirements, not ready for implementation
  - `ready`: Has enough detail/plan for implementation
  - `review`: Changes made, awaiting review/testing
  - `completed`: Approved and committed (moves to `tasks/completed/`)
- **File naming**: `TASK-####.md` with zero-padded 4-digit numbers

### Workspaces

Every ticket has a workspace, with all paths derived from the ticket ID (nothing is tracked or allocated):

```
JIRA-12345 + "update-telemetry"
     |
     +-- branch      angelo/JIRA-12345-update-telemetry
     +-- worktree    <repo>-worktrees/JIRA-12345-update-telemetry
     +-- notes       .sabin/notes/JIRA-12345-update-telemetry/     (agent: read + write)
     +-- prompt      .sabin/prompts/JIRA-12345-update-telemetry.md (agent: denied)
     +-- task        .sabin/tasks/open/JIRA-12345.md               (bare ID - the stable key)
```

The descriptive suffix (`slug`) is **derived from the task title by default**, so `sabin start SABIN-0004`
alone produces `SABIN-0004-task-workspaces-worktree-notes`. One slug drives the branch, worktree, notes
and prompt names alike, so they always match. Derivation drops filler words ("for", "the", "per"),
truncates on a word boundary at 32 characters, and never ends on a filler word. Configure it under
`slug` in `config.json`, or switch it off with `"slug": { "from": "none" }`.

Resolution order for the suffix: an explicit `--slug`/argument suffix, then the recorded `slug`, then an
existing directory on disk, then the title. The recorded value is the single source of truth once set.
Task **filenames** stay the bare ticket ID so lookups never depend on the suffix; every other path
carries it. `sabin start JIRA-12345-update-telemetry` sets the suffix and creates the task if it does
not exist yet. Once recorded, the suffix is fixed - passing a different one warns and keeps the
original rather than orphaning directories.

The prompt file is a human scratchpad for drafting prompts. It lives outside the repo tree so the agent
never sees it. Notes are where the agent reads context and writes plans and docs.

**The CLI owns what the filesystem cannot know** - branch inference, ID allocation, status transitions
(status lives in *both* frontmatter and the containing directory, so direct edits desynchronise them),
and worktree lifecycle. File tools own bytes. There are deliberately no note CRUD commands: once
`sabin where --notes` gives the path, an ordinary write is strictly more capable.

### Core Package (@sabin/core)

Located in `packages/core/src/`:
- `types.ts`: Defines `Task`, `SabinConfig` and related interfaces
- `git.ts`: Branch, worktree and repo-root helpers (`currentBranch`, `mainWorktreeRoot`, `listWorktrees`, `addWorktree`)
- `workspace.ts`: `ticketFromBranch()`, `parseTicketArg()`, `workspaceName()`, `workspacePaths()`, `resolveWorkspace()`, `findTaskFile()`
- `lock.ts`: `withLock()` - mkdir-based, scoped to ID allocation and status mutations only
- `sabinResolver.ts`: Resolves `.sabin` (directory or link file), walking up and falling back to the main worktree root
- `markdown.ts`: Utility functions for parsing/writing tasks and TODO files
  - `parseTask()`: Read task from file
  - `writeTask()`: Write task to file
  - `parseTodoFile()`: Parse TODO.md into TodoItem array
  - `removeTodoItem()`: Remove item from TODO.md by index
  - `getNextTaskNumber()`: Generate next task number

Uses `gray-matter` library for frontmatter parsing.

### CLI Package (@sabin/cli)

Located in `packages/cli/src/`:
- `index.ts`: Commander.js program definition
- `commands/`:
  - `init.ts`: Initialize `.sabin` directory structure
  - `create-task.ts`: Create new task with title/description (supports interactive prompts)
  - `update-status.ts`: Update task status (handles file moves)
  - `list-tasks.ts`: List tasks with optional status filter

**CLI Commands:**
- `sabin init` - Set up Sabin for a project. Run it from inside the repo.
  - Interactively asks whether `.sabin` lives outside the repo (shared across worktrees) or inside it
  - `-s, --shared <path>` - Create or reuse a shared `.sabin` there and link to it
  - `--local` - Keep `.sabin` inside the repo, skipping the prompt (the non-interactive default)
  - `-p, --prefix <prefix>` - Task ID prefix (defaults to the repo directory name)
  - `-b, --branch-prefix <prefix>` - Personal branch prefix (defaults to your git `user.name`)
  - `-w, --worktrees <path>` - Worktree root, relative to the repo
  - `--no-exclude` - Skip adding `.sabin` to `.git/info/exclude`
  - Pointing a second repo at an existing shared `.sabin` just links it, leaving the config alone
- `sabin link <path>` - Link this project to a shared `.sabin` directory (`init --shared` does this for you)
- `sabin start <ticket>` - Create the worktree, branch, notes directory and prompt file. Idempotent.
  - Accepts a descriptive suffix: `sabin start JIRA-12345-update-telemetry`
  - Creates the task when it does not exist, provided a suffix or `--title` is given
  - `-t, --title <title>` - Task title, when creating the task
  - `--json` - Machine-readable output (returns the worktree path)
  - `--no-worktree` - Skip worktree and branch creation
- `sabin finish [ticket]` - Mark completed and remove the worktree
  - `--keep-worktree`, `--json`
- `sabin context` - Show the current workspace (ticket, branch, worktree, notes and prompt paths)
  - `--json` - Small flat object; this is the agent's orienting call
  - `-t, --ticket <ticket>` - Override branch inference
- `sabin where [ticket]` - Print a single path, for shell interpolation
  - Ticket paths: `--notes` (default), `--prompt`, `--worktree`, `--task`
  - Project paths, which need no ticket: `--sabin`, `--code-workspace`
  - `--code-workspace` regenerates the file if it is missing, since it is fully derived from config
- `sabin task create` - Create a new task
  - `-t, --title <title>`, `-c, --content <content>`, `-n, --number <number>`, `--slug <slug>`
- `sabin task list` - List all tasks
  - `-s, --status <status>` - Filter by status
- `sabin task update <id> <status>` - Update task status
  - `--json`
- `sabin task show [id]` - Print a task file
- `sabin notes new <name>` - Scaffold a note in the ticket notes directory and print its path
  - `--template plan`, `-t, --ticket <ticket>`
- `sabin prompts install` - Install workflow prompts as slash commands
  - `-a, --agent <agent>` - Target agent (default: claude)

**Ticket arguments are optional** and inferred from the current branch. Inference tries the configured
`projectPrefix` first, then any uppercase JIRA-style key. A branch with no ticket is an **error, not a
fallback** - resolving to the wrong ticket's notes would be worse than failing.

Uses `chalk` for colored output, `ora` for spinners, and `@inquirer/prompts` for interactive input.

### VS Code Extension (sabin-vscode)

Located in `packages/vscode-extension/src/`:
- `extension.ts`: Main activation and command registration
- `providers/`:
  - `taskProvider.ts`: TreeView provider for tasks in sidebar
  - `webviewProvider.ts`: Webview UI for task management (board view)
- `watchers/`:
  - `fileWatcher.ts`: Watches `.sabin` directory for changes

**Activation**: Triggers when workspace contains `.sabin` directory
**Views**:
- `sabin.workspaceView` (tree) - the focused task with its prompt file, task file and notes, above the
  task list grouped by status. Focus follows the checked-out branch until you click another task,
  which pins it; "Sabin: Follow Current Branch" unpins.
- `sabin.tasksView` (webview) - the board

**Commands**: `sabin.focusTask` (`⌥⌘T`), `sabin.openPrompt` (`⌥⌘P`), `sabin.openWorktree`,
`sabin.unpinTask`, `sabin.newTask`, `sabin.refreshTasks`

**Folder swapping**: focusing a task swaps the window's folders to that ticket's code and notes via
`updateWorkspaceFolders()`, which scopes Cmd+P to the focused ticket. Requires the window to be opened
on the generated `.code-workspace` file - VS Code restarts the extension host when folder 0 changes or
when a plain folder window becomes multi-root, so swapping only happens from index 1 upward.
**Bundling**: Uses esbuild to bundle all dependencies into `dist/extension.js` (68KB minified)

## TypeScript Configuration

- Root `tsconfig.json` uses composite project references
- Each package has its own `tsconfig.json` extending root config
- Target: ES2020, Module: CommonJS
- Strict mode enabled

## Testing

Uses Jest with ts-jest:
- Test files in `__tests__` directories
- Run all tests: `npm test` (root level) or `npm test` in individual packages
- Run specific test file: `npm test -w @sabin/core -- path/to/test.ts`
- Run tests in watch mode: `npm test -- --watch` (in package directory)

## Configuration

The `.sabin/config.json` file stores project-level settings:
```json
{
  "projectPrefix": "TASK",
  "taskNumberPadding": 4,
  "branch":    { "prefix": "angelo", "template": "{prefix}/{ticket}-{slug}" },
  "worktrees": { "root": "../myproject-worktrees", "postCreate": [] },
  "slug":      { "from": "title", "maxLength": 32, "stopWords": true },
  "notesDir": "notes",
  "promptsDir": "prompts"
}
```

All fields past `taskNumberPadding` are optional. `worktrees.root` is relative to the main clone and
defaults to a sibling `<repo>-worktrees` directory; `postCreate` runs shell commands in a freshly
created worktree (`npm ci`, symlinking `.env`). `notesDir` and `promptsDir` are relative to `.sabin`.

Set up a new project in one command, run from inside the repo:

```bash
sabin init --shared ~/notes/myproject/.sabin -p MYPROJECT -b angelo
```

This creates the shared directory outside the repo, writes the `.sabin` link file into the repo, and
adds `.sabin` to `.git/info/exclude` so the link is invisible to other contributors without touching
the shared `.gitignore`. Omit the flags to be prompted.

External task IDs (e.g., `JIRA-12345`) can be used with `-n` flag and are excluded from auto-increment counting.

## Workflow Prompts

The `prompts/` directory contains workflow guidance for Claude Code:
- `task-create.md`: Guide for creating new tasks
- `plan.md`: Creating implementation plans for tasks
- `task-implement.md`: Implementing tasks based on plans
- `task-complete.md`: Completing and committing tasks
- `commit.md`: Git commit workflow

These prompts define the standard workflow for managing tasks with Sabin.

## Making Changes

- Run linter and tests after change
- Include the task number in the commit message
