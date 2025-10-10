---
status: open
title: Add git worktree support for parallel task execution
---
## Overview

Enable working on multiple tasks in parallel using git worktrees with a shared `.sabin` directory as the single source of truth.

## Goals

- Share single `.sabin` directory across all worktrees
- Auto-detect worktree when updating task status
- Claim tasks to worktrees when status changes to `in_progress`
- Display worktree assignments in VS Code extension
- Enable working on multiple tasks in parallel via manual worktree creation

## Architecture

### Shared .sabin Directory
- Main repo contains the single source of truth `.sabin/` directory
- All worktrees reference and modify main repo's `.sabin`
- Worktree detection: parse `.git` file to find main repo path

### Data Structures

**Task frontmatter additions:**
```yaml
claimedBy: feature-login  # Worktree directory name that claimed this task
worktreeBranch: feature/login  # Branch name for the worktree
```

**Worktree discovery:** Use `git worktree list --porcelain` as source of truth. Git already tracks:
- Worktree paths
- Branch names
- HEAD commits
- Lock status

No separate metadata files needed - task frontmatter records which worktree claimed it.

### File Locking
- Use pessimistic locking with `proper-lockfile` package
- Wrap all `.sabin` file operations in locks
- Prevents race conditions when multiple worktrees update simultaneously

## Implementation Plan

### Phase 1: Core Worktree Utilities
1. Add `proper-lockfile` dependency to @sabin/core
2. Create `packages/core/src/worktree.ts`:
   - `detectWorktree()`: Detect if running in worktree, return main repo path
   - `getSabinPath()`: Return path to `.sabin` (main repo if worktree, cwd if main)
   - `parseGitWorktreeList()`: Parse `git worktree list --porcelain` output
3. Create `packages/core/src/lock.ts`:
   - `withLock(fn)`: Execute function with file lock on `.sabin` directory
4. Update `packages/core/src/types.ts`:
   - Add `claimedBy?: string` to Task interface
   - Add `worktreeBranch?: string` to Task interface
5. Update all file operations in `packages/core/src/markdown.ts`:
   - Use `getSabinPath()` instead of hardcoded paths
   - Wrap operations in `withLock()`

### Phase 2: Update Task Update Command
1. Update `packages/cli/src/commands/update-status.ts`:
   - When status changes to `in_progress`:
     - Detect if running in worktree using `detectWorktree()`
     - If in worktree, set `claimedBy` to worktree name and `worktreeBranch` to branch name
     - If in main repo, leave unclaimed (user hasn't created worktree yet)
   - When status changes away from `in_progress`:
     - Keep claim info (shows which worktree worked on it)
   - All operations use `getSabinPath()` to access main repo's `.sabin`
   - Wrap all file operations in `withLock()`

### Phase 3: VS Code Extension Updates
1. Update `packages/vscode-extension/src/extension.ts`:
   - Import `detectWorktree()` and `getSabinPath()` from `@sabin/core`
   - Detect if VS Code is opened in worktree or main repo
   - Use `getSabinPath()` to find correct `.sabin` directory
   - Extension works the same whether opened in main repo or worktree
2. Update `packages/vscode-extension/src/providers/taskProvider.ts`:
   - Use `getSabinPath()` to read tasks from main repo's `.sabin`
   - Display worktree info on claimed tasks (show `claimedBy` and `worktreeBranch`)
   - Group tasks by claimed/unclaimed
3. Optional: Create `packages/vscode-extension/src/providers/worktreeProvider.ts`:
   - Use `git worktree list --porcelain` to discover all worktrees
   - Show all worktrees with their claimed tasks
   - TreeView showing worktree → task relationships
4. Update `packages/vscode-extension/src/watchers/fileWatcher.ts`:
   - Watch main repo's `.sabin/tasks/` (using `getSabinPath()`)
   - Watch `.git/worktrees/` for changes to refresh worktree views

### Phase 4: Testing & Documentation
1. Add tests for worktree detection and locking
2. Test concurrent operations from multiple worktrees
3. Update README with worktree workflow examples
4. Add troubleshooting guide

## Workflow Example

```bash
# Main repo - create tasks
sabin task create -t "Add login"     # TASK-0001
sabin task create -t "Add tests"     # TASK-0002

# Work on TASK-0001 - manually create worktree
git worktree add ../feature-login -b feature/login
cd ../feature-login

# Claim task (auto-detects worktree)
sabin task update TASK-0001 in_progress
# → Sets claimedBy: feature-login, worktreeBranch: feature/login

# ... implement feature ...
sabin task update TASK-0001 review
git commit -m "feat: add login (TASK-0001)"

# Switch to TASK-0002 while TASK-0001 in review
cd ../main-repo
git worktree add ../feature-tests -b feature/tests
cd ../feature-tests

sabin task update TASK-0002 in_progress
# → Sets claimedBy: feature-tests, worktreeBranch: feature/tests

# ... work in parallel ...

# Complete and cleanup
sabin task update TASK-0001 completed
git worktree remove ../feature-login
```

## Technical Considerations

1. **Worktree detection**: Parse `.git` file to detect if running in worktree, extract main repo path
2. **Worktree naming**: Users can name worktrees however they want (no conventions enforced)
3. **Lock timeouts**: 10 retries with exponential backoff (100ms-1000ms)
4. **Error handling**: Clear messages if task already claimed by another worktree
5. **Broken worktrees**: Filter out worktrees where directory no longer exists (use `fs.existsSync()`)
6. **Git as source of truth**: Use `git worktree list --porcelain` for worktree discovery in VS Code

## Success Criteria

- All sabin commands access main repo's `.sabin` when run from worktree
- Tasks auto-claim to worktree when status → `in_progress`
- File locking prevents corruption from concurrent access
- VS Code extension shows which worktree has which task
- Can work on multiple tasks in parallel via manual worktree creation
- No double-claiming (error if task already claimed by another worktree)
