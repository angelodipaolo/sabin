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
  research/            # Cross-cutting research and context documents
  notes/               # Per-ticket notes, including each ticket's plan.md
  prompts/             # Per-ticket prompt scratchpads (agent denied)
```

### Task Structure

Tasks are markdown files with YAML frontmatter:
- **Frontmatter fields**: `status` (open/ready/in_progress/review/completed), `title`, `slug` (optional descriptive suffix), `branch`, `worktree`, `workingDir`
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

**A ticket has exactly one plan, at `plan.md` in its notes directory.** There is no `plan:` frontmatter
field: the association is the directory plus a fixed name, so nothing has to be attached and nothing can
drift from the file it names. Work that runs in stages becomes phases inside that one file - the plan
template already ships `## Implementation Phases` for exactly that. Re-planning revises `plan.md` in
place. `sabin task list` reports a plan by checking the filesystem, so the CLI and the agent always
agree about where it is.

**The CLI owns what the filesystem cannot know** - branch inference, ID allocation, status transitions
(status lives in *both* frontmatter and the containing directory, so direct edits desynchronise them),
and worktree lifecycle. File tools own bytes. There are deliberately no note CRUD commands: once
`sabin where --notes` gives the path, an ordinary write is strictly more capable.

### Core Package (@sabin/core)

Located in `packages/core/src/`:
- `types.ts`: Defines `Task`, `SabinConfig` and related interfaces
- `git.ts`: Branch, worktree and repo-root helpers (`currentBranch`, `mainWorktreeRoot`, `listWorktrees`, `addWorktree`)
- `workspace.ts`: `ticketFromBranch()`, `parseTicketArg()`, `workspaceName()`, `workspacePaths()`, `resolveWorkspace()`, `findTaskFile()`, `slugForTicket()`, `planPath()`, `findPlan()`
  - `slugForTicket()` resolves a ticket's suffix without a git call, for callers listing every task at once
  - `findPlan()` returns `notesDir/plan.md` when it exists - the one place that answers "does this ticket have a plan"
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
- `sabin open [ticket]` - Open the project in your editor: board, notes and prompts in one window
  - Opens the generated `.code-workspace`, which is what lets the extension swap folders per task
  - `--worktree`, `--notes`, `--prompt`, `--sabin` - open that part of a ticket instead
  - `-n, --new-window`, `-e, --editor <command>`
  - Editor precedence: `--editor`, `SABIN_EDITOR`, `editor` in `config.json`, then `code`
- `sabin draft [ticket]` - Create a ticket's notes directory and prompt scratchpad **without starting work**
  - Touches neither status nor the worktree, so you can think a task through before committing to it
  - Creates the task if it does not exist, given a description or `--title`
  - Opens the scratchpad in your editor; `--no-open` to skip
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
  - Notes are **any** context an agent might read - `.json`, `.yaml`, `.csv`, `.log`, plain text
  - An extension you supply is kept; a bare name defaults to `.md`
  - Only markdown and JSON get seed content; other formats start empty rather than guessing syntax
  - `--template plan`, `-t, --ticket <ticket>`
- `sabin prompts install` - Install workflow prompts as slash commands
  - `-a, --agent <agent>` - Target agent (default: claude)

**Lifecycle**: `task create` or `draft` scaffold the notes directory and scratchpad while the task is
still `open`. `start` adds the worktree and branch and flips the status to `in_progress`. `finish`
completes it and removes the worktree. Drafting is deliberately separate from starting, because a
prompt gets written before there is anything to check out.

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

**This repository manages its own tasks externally**: `.sabin` here is a link file pointing at
`~/notes/sabin/.sabin`. A committed `.sabin` breaks under worktrees — a worktree checks out its own
stale copy from HEAD and resolves to that, and status changes written from a worktree land in the main
clone's working tree on whatever branch it has checked out. Run `sabin link <path>` to set this up in
another project; it writes the link file, the workspace file, the `.git/info/exclude` entry and the
prompts deny rule.

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

## Agent Integration

`skills/sabin/SKILL.md` is the agent contract, installed by `sabin prompts install` to
`~/.claude/skills/sabin/`. It tells an agent to:

1. Run `sabin context --json` at session start; if it errors, stop and ask rather than guess
2. Write everything durable under the returned `notesDir`
3. Change status with `sabin task update`, never by editing frontmatter
4. Never read the prompts directory

Rule 4 is enforced, not requested: `sabin init` writes a `permissions.deny` rule to the project's
`.claude/settings.local.json`, using the `Read(//absolute/path/**)` form (a single leading slash
anchors at the settings file, not the filesystem root). `sabin context --json` also omits `promptFile`
— handing an agent the path to the file it is told to ignore would undercut the whole arrangement.

## Workflow Prompts

The `prompts/` directory contains workflow guidance for Claude Code. None of them hardcode `.sabin/`
paths — those break in a worktree with a shared Sabin directory, so every path is resolved through
the CLI:
- `task-create.md`: Guide for creating new tasks
- `plan.md`: Creating implementation plans for tasks
- `task-implement.md`: Implementing tasks based on plans
- `task-complete.md`: Completing and committing tasks
- `commit.md`: Git commit workflow

These prompts define the standard workflow for managing tasks with Sabin.

## Making Changes

- Run linter and tests after change
- Include the task number in the commit message
