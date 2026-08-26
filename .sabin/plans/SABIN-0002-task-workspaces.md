# Implementation Plan: Task Workspaces (SABIN-0002)

## Overview

Introduce a **workspace** — the place work happens for a ticket — as a first-class concept in Sabin.

Today Sabin models a task as a markdown file with a status. In practice every ticket also has a git worktree, a branch, a directory of notes the agent reads and writes, and a prompt scratchpad the agent must never see. Those four things are created by hand, and their paths are communicated to the agent by copying and pasting. This plan makes them derived, discoverable, and navigable.

The guiding principle: **derive, don't allocate.** Every path for a ticket is a pure function of its ID, so nothing has to be tracked, reconciled, or cleaned up.

```
JIRA-12345 + "update-telemetry"
     ├── branch      angelo/JIRA-12345-update-telemetry
     ├── worktree    ~/dev/myproject-worktrees/JIRA-12345-update-telemetry
     ├── notes       <sabin>/notes/JIRA-12345-update-telemetry/     (agent: read + write)
     ├── prompt      <sabin>/prompts/JIRA-12345-update-telemetry.md (agent: denied)
     └── task        <sabin>/tasks/open/JIRA-12345.md               (bare ID - the stable key)
```

**Descriptive suffixes.** Directory and branch names carry a readable suffix; task filenames stay the
bare ticket ID so lookups never depend on it. The suffix (`slug`) is recorded in task frontmatter,
which is the single source of truth, so paths stay a pure function of (ticket, recorded slug).
`sabin start JIRA-12345-update-telemetry` is the one-command kickoff: it parses the suffix, creates the
task if absent, then builds the worktree, branch, notes directory and prompt file.

## Current State

**What exists.** The CLI has six commands (`packages/cli/src/index.ts`): `init`, `link`, `task create`, `task update`, `task list`, `prompts install`. `SABIN-0003` already made `.sabin` polymorphic — it resolves as either a directory or a file containing `{"sabinDir": "..."}` pointing at a shared directory (`packages/core/src/sabinResolver.ts:12`). `create-task`, `update-status`, and `list-tasks` all route through `resolveSabinDir()`.

**What is missing.** Nothing in the system knows about branches, worktrees, notes, or prompt files. There is no command that answers "where am I" or "where do I write." `resolveSabinDir()` only checks `startDir/.sabin` with no upward walk, so it fails outright in a worktree that lacks a link file.

**The prompts are the sharpest edge.** The six installed workflow prompts do not use the CLI for file access at all. `commands/sabin-plan.md` instructs the agent to run `cat .sabin/tasks/open/TASK-XXXX.md`, write to `.sabin/plans/`, and hand-edit a `plan:` field into frontmatter. These are hardcoded repo-relative paths, which is precisely why the workflow breaks under a worktree with a shared `.sabin`, and why paths get pasted by hand today.

**Concurrency.** `getNextTaskNumber()` (`packages/core/src/markdown.ts:31`) scans both task directories and increments. With several worktrees running agents at once, that races, as do the file moves in `task update`.

## Desired End State

### Layout

```
~/notes/myproject/.sabin/            the real directory, outside every clone
  config.json
  tasks/{open,completed}/
  research/                          cross-cutting, not ticket-scoped
  notes/SABIN-0004/                  agent read + write
  prompts/SABIN-0004.md              agent denied
  myproject.code-workspace           generated once, by init/link

~/dev/myproject/.sabin               link file -> the above
~/dev/myproject-worktrees/SABIN-0004/    created by `sabin start`
```

Work repos that cannot carry a committed `.sabin` use the link file plus a local ignore entry. Personal projects may keep `.sabin` as a committed directory (see Open Decisions).

### Config

```json
{
  "projectPrefix": "SABIN",
  "taskNumberPadding": 4,
  "branch":    { "prefix": "angelo", "template": "{prefix}/{ticket}-{slug}" },
  "worktrees": { "root": "../myproject-worktrees", "postCreate": [] },
  "notesDir": "notes",
  "promptsDir": "prompts"
}
```

`worktrees.root` is relative to the main clone. `notesDir` and `promptsDir` are relative to the resolved `.sabin` directory. `postCreate` holds shell commands run in a new worktree — the escape hatch for `npm ci`, symlinking `.env`, and similar setup cost. Absent all of these, behaviour is exactly as it is today.

### Task frontmatter

Two additions, both recording what git owns:

```yaml
status: in_progress
title: Parallel worktree workspaces
branch: angelo/SABIN-0004-parallel-worktrees
worktree: /Users/angelo/dev/myproject-worktrees/SABIN-0004
```

Notes and prompt paths are **not** stored. They are derived from the ticket ID, so they cannot go stale.

### CLI

New:

| Command | Purpose |
|---|---|
| `sabin start <TICKET> [--json] [--no-worktree]` | Create worktree + branch + notes dir + prompt file, set status, print paths. Idempotent. |
| `sabin finish [TICKET] [--keep-worktree]` | Remove worktree, mark completed. |
| `sabin context [--json]` | Resolve the current workspace: ticket, title, status, branch, worktree, notes dir, existing note files. |
| `sabin where [TICKET] [--notes\|--prompt\|--worktree\|--task]` | One path to stdout, for shell interpolation. |
| `sabin task show [id]` | Print a task without needing to know which directory it lives in. |
| `sabin notes new <name> [--template plan]` | Resolve path, seed a template, print the path. |

Changed:

- `task update` records `branch` and `worktree`; gains `--json`.
- `task create` prints the allocated ID to stdout so it can chain into `start`.
- `init`'s `--prefix` becomes optional with a default (it is a `requiredOption` today at `packages/cli/src/index.ts:21`, which makes non-interactive use awkward).
- `init` and `link` generate the project's `.code-workspace` file and write a `permissions.deny` rule for the prompts directory.

Every ticket argument is optional and inferred from the current branch when omitted.

### The CLI/filesystem line

The CLI owns anything requiring knowledge the filesystem does not have: ticket-to-branch inference, ID allocation, status transitions (status lives in *both* frontmatter and the containing directory, so direct edits corrupt the model), and worktree lifecycle. File tools own bytes. There is deliberately no `sabin notes add/list/rm` — once the agent has the notes path, an ordinary write is strictly more capable than a wrapper.

### VS Code

One window, one workspace file per project, opened once. The extension adds and removes ticket roots live via `workspace.updateWorkspaceFolders()`, so focusing a task swaps the Explorer to that ticket's code and notes and scopes Cmd+P to it.

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

Implementation constraint: VS Code terminates and restarts the extension host when workspace folder 0 changes, or when a window goes from single-folder to multi-folder (microsoft/vscode#46048). So `.sabin` occupies index 0 permanently, the generated workspace ships with a second permanent root, and all swapping happens at index 2 and above.

### Agent contract

The installed skill states four rules:

1. Run `sabin context --json` at session start. If it errors, stop and ask — never guess paths.
2. Write every artifact under the returned `notesDir`.
3. Change status with `sabin task update`, never by editing frontmatter.
4. Never read or write the prompts directory.

Rule 4 is enforced, not requested: the directory sits outside the repo tree, and `sabin init` writes a `permissions.deny` entry for it.

## Open Decisions

**1. Do plans fold into `notes/<TICKET>/`? — RESOLVED: yes.**

If a plan is just a file in the ticket's notes directory, then `SABIN-0004` (multiple plans per task) needs no schema change — multiple plans is multiple files — and `SABIN-0005` (CLI to attach a plan) becomes unnecessary, since the association is the directory rather than a frontmatter pointer. The cost: `SABIN-0005` is currently in `review`, so some work may be undone, and plans stop being listable in one flat directory.

Resolved in favour of folding. `sabin notes new plan --template plan` writes into the ticket's notes
directory, and the rewritten prompts point there. `.sabin/research/` stays for genuinely cross-cutting
documents, and existing `.sabin/plans/` files are left alone.

Consequences for the two open tickets, which have **not** been closed:
- `SABIN-0004` (multiple plans per task) needs no schema change — multiple plans is multiple files.
- `SABIN-0005` (CLI to attach a plan) is unnecessary — the association is the directory, not a
  frontmatter pointer. It is sitting in `review`, so some work there may be superseded.

**2. Does `.sabin` stay committed in personal projects?**

Once several worktrees mutate a committed `.sabin`, every status change dirties the main clone's working tree and lands in whichever branch happens to commit it, scattering task history. Work projects avoid this because `.sabin` is external. Uniformity — always external, with `~/notes` as its own repo — solves it at the cost of losing task history next to the code it describes.

**3. Ignore strategy for work repos. — RESOLVED.** `sabin init` writes `.git/info/exclude`.

Recommendation: a global gitignore entry for yourself, plus `sabin link` writing `.git/info/exclude` per repo as a safety net. Neither is visible to other contributors, so the shared `.gitignore` stays untouched. Note that `git clean -fdx` only ever removes the two-line link file — the data lives outside the repo and is recreated by rerunning `sabin link`.

## What We're NOT Doing

- No worktree pool or allocation table. Worktree paths derive from ticket IDs.
- No note CRUD commands.
- No cross-project board. The board stays per-project.
- No per-ticket `.code-workspace` files. One per project, generated once.
- No pinning two tasks at once, `⌃1`–`⌃9` hotkeys, or agent-terminal command in this pass. All additive later.
- No automatic migration of existing notes trees.
- No agent orchestration. `sabin start --json` returns a worktree path so an orchestrator *can* be built on top; building one is out of scope.

---

## Phase 1 — Core workspace resolution

New `packages/core/src/git.ts`: `currentBranch()`, `mainWorktreeRoot()` (via `git rev-parse --git-common-dir`), `listWorktrees()` (parsing `git worktree list --porcelain`), `addWorktree()`, `removeWorktree()`.

New `packages/core/src/workspace.ts`:
- `ticketFromBranch(branch, config)` — matches `([A-Z][A-Z0-9]*-\d+)` case-insensitively, first match wins. Handles `angelo/SABIN-0004-slug`, bare `SABIN-0004`, and `angelo/JIRA-12345-slug` identically. **A non-match is an error, not a fallback** — silently resolving to the wrong ticket's notes is the worst failure mode in this design.
- `workspacePaths(ticket, sabinDir, config)` — pure function returning notes, prompt, worktree, and task paths.
- `resolveWorkspace(cwd)` — combines the two, honouring a `--ticket` argument or `SABIN_TICKET` environment variable as an override so an orchestrator can be explicit rather than relying on a sub-agent's cwd.

Extend `resolveSabinDir()` to walk up from `cwd` and fall back to the main worktree root, so a worktree without a link file still resolves.

Then wire `sabin context`, `sabin where`, and `sabin task show`.

**Success:** from any worktree, `sabin where --notes` prints the correct absolute path; `sabin context --json` returns a small flat object; on `main`, both exit non-zero with a clear message; a worktree with no link file resolves correctly.

## Phase 2 — Workspace lifecycle

Add `branch` and `worktree` to the `Task` interface (`packages/core/src/types.ts:1`).

Add `packages/core/src/lock.ts` with `withLock()`. Scope it narrowly: only `getNextTaskNumber()` and task status mutations race. Notes writes go to per-ticket directories and need no lock.

Implement `sabin start`: resolve or allocate the ticket, create the worktree at `<worktrees.root>/<TICKET>` with branch from `branch.template`, run `postCreate`, create `notes/<TICKET>/`, seed `prompts/<TICKET>.md`, set status `in_progress`, record branch and worktree, drop a `.sabin` link file into the new worktree, print paths (`--json`). Running it twice returns the existing workspace rather than erroring.

Implement `sabin finish`. Update `task create`/`task update`/`init` per Desired End State.

**Success:** `sabin start SABIN-0004` produces a working worktree, notes directory, and prompt file in one command; is idempotent; concurrent `task create` from three worktrees allocates three distinct IDs.

## Phase 3 — Prompts and skill

Rewrite all six `commands/*.md` and `prompts/*.md` to call the CLI rather than hardcoding `.sabin/` paths. Add the agent-contract skill. Have `init` write the `permissions.deny` rule for the prompts directory.

Blocked on Open Decision 1, since the plan prompt's target directory depends on it.

**Success:** no prompt contains a hardcoded `.sabin/` path; an agent started in a fresh worktree locates its notes directory without being told; the prompts directory is unreadable to the agent.

## Phase 4 — VS Code task workspace UI

Generate the project `.code-workspace` in `init`/`link`. Add a TreeView above the existing board showing the focused task (prompt file, notes, branch, worktree) and the task list beneath it. Clicking a task focuses it, swapping roots at index 2+ via `updateWorkspaceFolders()`. Add `Sabin: Open Prompt for Current Task` bound to `⌥⌘P` (not `⌘⇧P`, which is the command palette). Focus auto-follows the active branch.

**Success:** one window; clicking a task swaps the Explorer to its code and notes; Cmd+P shows only that ticket's files; the prompt file opens with one keystroke and never appears in a workspace root; switching tasks does not restart the extension host.

## Phase 5 — Docs and migration

README coverage of the worktree workflow, the shared/external setup for work repos, ignore strategy, and a documented manual path for moving an existing notes tree into `.sabin/notes/<TICKET>/`.

---

## Ticket Breakdown

- **SABIN-0002** — Phases 1 and 2. Core resolution and CLI lifecycle.
- **SABIN-0008** — Phase 4. VS Code task workspace UI. Depends on SABIN-0002.
- **SABIN-0009** — Phase 3. Prompt and skill rewrite. Depends on SABIN-0002 and Open Decision 1.

Phase 5 folds into whichever ticket lands last.
