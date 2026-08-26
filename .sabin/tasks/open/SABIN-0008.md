---
status: open
title: VS Code task workspace UI
plan: .sabin/plans/SABIN-0002-task-workspaces.md
---
## Problem

There is no single place in VS Code to see everything belonging to a ticket. Notes live in one directory, the prompt scratchpad in another, and the code in a worktree somewhere else. Finding a file means searching Cmd+P for a ticket number across everything, which is noise. Jumping between the three or four tickets in flight means losing your place in all of them.

## Scope

**Phase 4** of the plan. One window, one workspace file per project, opened once. Focusing a task swaps the Explorer to that ticket's code and notes and scopes Cmd+P to it.

```
EXPLORER                          SABIN
▾ sabin                           ▾ FOCUSED · SABIN-0004      in_progress
▾ main                                  prompt.md                  ⌥⌘P
▾ SABIN-0004 · code    <- swaps         angelo/SABIN-0004-…
▾ SABIN-0004 · notes   <- swaps         myproject-worktrees/SABIN-0004
                                  ▾ IN PROGRESS
                                       SABIN-0002  Worktree support
                                  ▾ READY
                                       SABIN-0009  Notes migration
```

### Work

- Generate the project `.code-workspace` in `sabin init` / `sabin link` (one per project, not per ticket)
- TreeView above the existing board webview: focused task with its prompt file, notes, branch, and worktree; task list beneath
- Clicking a task focuses it — swap roots via `workspace.updateWorkspaceFolders()`
- `Sabin: Open Prompt for Current Task`, bound to `⌥⌘P`
- Focus auto-follows the active branch

## Design decisions

- **The Explorer is the task view.** Named roots (`SABIN-0004 · code`, `SABIN-0004 · notes`) mean no custom file tree to maintain, and Cmd+P scoping comes free from multi-root workspaces.
- **Focus auto-follows the branch.** Dendron's most-requested missing feature was "reveal active note in tree" — a custom tree that doesn't stay synced becomes a second thing to navigate rather than a replacement for navigating.
- **The prompt file is not a workspace root.** Keeping it out of `notes/` avoids the agent listing a directory containing a file it's told to ignore. It doesn't need to be Cmd+P-reachable because it opens with one keystroke.
- **The board stays per-project.**

## Implementation constraint

VS Code terminates and restarts the extension host when workspace folder 0 changes, or when a window transitions from single-folder to multi-folder (microsoft/vscode#46048). So `.sabin` occupies index 0 permanently, the generated workspace ships with a second permanent root, and all swapping happens at index 2 and above.

## Out of scope

Pinning two tasks visible at once, `⌃1`–`⌃9` hotkeys, a `Sabin: New Agent Terminal` command, and cross-project views. All additive later; none block the core loop.

## Dependencies

SABIN-0002 — needs `sabin context` and workspace path resolution.

## Success criteria

- One window for everything; no per-ticket window sprawl
- Clicking a task swaps the Explorer to its code and notes
- Cmd+P shows only the focused ticket's files
- The prompt file opens with one keystroke and never appears in a workspace root
- Switching tasks does not restart the extension host
