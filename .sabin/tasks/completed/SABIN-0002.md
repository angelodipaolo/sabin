---
status: completed
title: 'Task workspaces - worktree, notes, and prompt file per ticket'
plan: .sabin/plans/SABIN-0002-task-workspaces.md
---
## Problem

Starting a ticket means creating a branch in a worktree, a prompt scratchpad, and a notes directory by hand — then telling the agent where the notes live by copying and pasting the path on every session. Sabin knows about tasks but nothing about branches, worktrees, notes, or prompt files, so none of that is automated and none of it is discoverable.

## Scope

Introduce a **workspace** as a first-class concept: the branch, worktree, notes directory, and prompt scratchpad belonging to a ticket. Every path derives from the ticket ID, so nothing needs tracking or reconciling.

```
ticket  ──┬── branch      angelo/SABIN-0004-parallel-worktrees
          ├── worktree    ~/dev/myproject-worktrees/SABIN-0004
          ├── notes       <sabin>/notes/SABIN-0004/     (agent: read + write)
          └── prompt      <sabin>/prompts/SABIN-0004.md (agent: denied)
```

This ticket covers **Phases 1 and 2** of the plan — core resolution and CLI lifecycle.

### Phase 1 — Core workspace resolution

- `packages/core/src/git.ts`: current branch, main worktree root, worktree list/add/remove
- `packages/core/src/workspace.ts`: `ticketFromBranch()`, `workspacePaths()`, `resolveWorkspace()`
- Extend `resolveSabinDir()` to walk up and fall back to the main worktree root
- New commands: `sabin context [--json]`, `sabin where [--notes|--prompt|--worktree|--task]`, `sabin task show [id]`

Branch inference matches `([A-Z][A-Z0-9]*-\d+)`, first match wins, so external IDs like `JIRA-12345` work identically. A non-match is an **error, not a fallback** — resolving to the wrong ticket's notes is the worst failure mode here. `--ticket` / `SABIN_TICKET` overrides inference.

### Phase 2 — Workspace lifecycle

- Add `branch` and `worktree` to the `Task` interface
- `packages/core/src/lock.ts`: lock only ID allocation and status mutations (notes writes are per-ticket, no contention)
- `sabin start <TICKET> [--json]`: worktree + branch + notes dir + prompt file + status, in one command, idempotent
- `sabin finish [TICKET]`
- `task update` records branch/worktree; `task create` prints the allocated ID; `init --prefix` becomes optional

### Config additions

```json
"branch":    { "prefix": "angelo", "template": "{prefix}/{ticket}-{slug}" },
"worktrees": { "root": "../myproject-worktrees", "postCreate": [] },
"notesDir": "notes",
"promptsDir": "prompts"
```

All optional — absent them, behaviour is unchanged.

## Design decisions

- **Derive, don't allocate.** No worktree pool, no allocation table. A pool needs release, reconciliation, and a "none free" failure mode that an orchestrating agent would have to handle.
- **The CLI owns what the filesystem can't know** — branch inference, ID allocation, status transitions (status lives in both frontmatter *and* the containing directory), worktree lifecycle. File tools own bytes. No note CRUD commands.
- **Notes and prompts live inside the shared `.sabin`**, which sits outside every worktree. The prompt file is therefore invisible to the agent by default, plus a `permissions.deny` rule.

## Out of scope

- VS Code UI (SABIN-0008)
- Prompt and skill rewrite (SABIN-0009)
- Agent orchestration. `--json` output makes it buildable later; building it is not part of this.

## Open decisions

Neither blocks this ticket, but both are in the plan and want answers:

1. **Do plans fold into `notes/<TICKET>/`?** If so, SABIN-0004 (multiple plans per task) dissolves and SABIN-0005 becomes unnecessary. Blocks SABIN-0009 only.
2. **Does `.sabin` stay committed in personal projects?** Several worktrees mutating a committed `.sabin` scatters task history across feature branches.

## Success criteria

- From any worktree, `sabin where --notes` prints the correct absolute path
- On a branch with no ticket, resolution fails loudly rather than guessing
- A worktree with no `.sabin` link file still resolves
- `sabin start SABIN-0004` produces a working worktree, notes directory, and prompt file in one command, and is idempotent
- Concurrent `task create` from three worktrees allocates three distinct IDs
