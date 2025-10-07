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
- **Frontmatter fields**: `status` (open/ready/review/completed), `title`, `description` (optional), `plan` (optional path to plan file)
- **Statuses**:
  - `open`: Initial requirements, not ready for implementation
  - `ready`: Has enough detail/plan for implementation
  - `review`: Changes made, awaiting review/testing
  - `completed`: Approved and committed (moves to `tasks/completed/`)
- **File naming**: `TASK-####.md` with zero-padded 4-digit numbers

### Core Package (@sabin/core)

Located in `packages/core/src/`:
- `types.ts`: Defines `Task` and `TodoItem` interfaces
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
- `sabin init` - Initialize Sabin in current directory
  - `-p, --prefix <prefix>` - Project prefix for task IDs (default: TASK)
- `sabin task create` - Create a new task
  - `-t, --title <title>` - Task title (will prompt if not provided)
  - `-c, --content <content>` - Task content (will prompt if not provided)
  - `-n, --number <number>` - Custom task ID (e.g., JIRA-12345)
- `sabin task list` - List all tasks
  - `-s, --status <status>` - Filter by status (open/ready/review/completed)
- `sabin task update <id> <status>` - Update task status
  - Positional args: task ID and new status

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
**Views**: Activity bar view and Explorer view showing tasks organized by status
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
  "taskNumberPadding": 4
}
```

Initialize with custom prefix: `sabin init --prefix MYPROJECT`

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
