# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Overview

Sabin is a worktree command center for agentic coding: write a task, hand it to an agent in its own
worktree, review what comes back. Three packages in a monorepo:

- **@sabin/core** - the data model and every operation on it: tasks, statuses, workspaces, git,
  agents. Pure Node, no CLI or VS Code dependencies.
- **@sabin/cli** - the `sabin` command. Thin: argument handling, output, process launching.
- **sabin-vscode** - VS Code extension: the Workspace tree and the Board, both backed by core.

Plus `skills/sabin/` - the agent contract - which the repo also exposes as a Claude Code plugin
(`.claude-plugin/`).

Everything is markdown with YAML frontmatter under a Sabin directory that lives **outside the repo**.

## Build, test, lint

```bash
npm run build      # all packages (lerna)
npm test
npm run lint
npm run typecheck

npm test -w @sabin/core -- path/to/test.ts    # one file
cd packages/vscode-extension && npm run watch  # esbuild watch mode
```

`sabin` on PATH is `npm link`ed to `packages/cli`, so `npm run build` updates it.

**After changing the VS Code extension** you must package and reinstall it, then reload VS Code:

```bash
cd packages/vscode-extension && npx @vscode/vsce package && code --install-extension sabin-vscode-0.1.0.vsix
```

## Data model

```
<sabin dir>/
  config.json
  tasks/open/        status open, ready, in_progress, review
  tasks/completed/   status completed
  notes/<TICKET>-<slug>/          agent-readable; plan.md lives here
  prompts/<TICKET>-<slug>.md      human scratchpad; agent denied
  hooks/<status>.md               printed by `task update` after that transition
  research/
```

**Task**: `tasks/<dir>/<ID>.md`. The filename is the ID and the stable key. Frontmatter: `status`,
`title`, optional `slug`, `branch`, `worktree`. Status lives in *both* the frontmatter and the
directory, which is why every status write goes through `setTaskStatus()` in core - never through a
direct edit. Legacy `resolved` is read as `completed`.

**Workspace**: everything a ticket owns, derived from its ID plus one slug (from the title by
default, capped at 32 chars on a word boundary, filler words dropped). The slug names the branch
(`{prefix}/{ticket}-{slug}`), the worktree (`<repo>-worktrees/<name>`), the notes directory and the
scratchpad. Once recorded in the task file it is fixed. Resolution order: explicit argument, recorded
`slug`, an existing directory on disk, then the title.

**Plan**: exactly one per ticket, at `notesDir/plan.md`. Derived, never recorded. `findPlan()` is the
only answer to "does this ticket have a plan".

**Hooks**: `hooks/<status>.md` is prose for the agent. `sabin task update X completed` prints
`hooks/completed.md` after the move, so "push and open a PR" arrives from the command the agent had to
run anyway. No new command, nothing for the skill to remember.

**Ticket inference**: from the branch (the project prefix first, then any `UPPER-123` key). No ticket
on the branch is an error, not a fallback - resolving to the wrong ticket's notes is the worst failure.

## Core (`packages/core/src`)

| File | Owns |
| --- | --- |
| `types.ts` | `Task`, `TaskStatus`, `TASK_STATUSES`, `SabinConfig` |
| `tasks.ts` | `listTasks`, `findTask`, `createTask`, `setTaskStatus`, `nextTaskId`, `readHook` - every task write, under `withLock` |
| `markdown.ts` | `parseTask` / `writeTask` (gray-matter) |
| `workspace.ts` | `resolveWorkspace`, `workspacePaths`, slugs, `branchNameFor`, `findPlan`, `scaffoldWorkspace` |
| `agents.ts` | `resolveAgent`, `agentArgv`, `buildTaskPrompt` - pure, so an orchestrator can compose prompts without the CLI |
| `git.ts` | `currentBranch`, `mainWorktreeRoot`, `listWorktrees`, `addWorktree` |
| `sabinResolver.ts` | finds the Sabin directory: link file, walking up, then the main worktree root |
| `lock.ts` | mkdir lock, scoped to ID allocation and status writes |
| `config.ts` | `readConfig` - a missing file is defaults; an unparsable one is an error |
| `codeWorkspace.ts`, `agentPermissions.ts`, `gitExclude.ts` | the files `init`/`link` write |

## CLI (`packages/cli/src`)

`index.ts` is the Commander definition; one file per command under `commands/`.
`workspace-context.ts` (`loadProject`, `getWorkspace`, `fail`) and `workspace-start.ts`
(`ensureWorkspace`, shared by `start` and `run`) are the only shared pieces. `iterm.ts` labels tabs
and opens new ones.

| Command | Does |
| --- | --- |
| `init` / `link` | Sabin directory outside the repo, `.sabin` link, `.git/info/exclude`, `.code-workspace`, prompts deny rule |
| `task create "<title>"` | task + notes dir + scratchpad; `-n` for external IDs, `--open` to edit, `--json` |
| `task list` | one line per active task; `--all`, `-s`, `--json` |
| `task update <id> <status>` | the status write; prints the hook |
| `task show` | print the file |
| `start <ticket>[-suffix]` | worktree, branch, notes, `in_progress`; creates the task only when given a suffix or `-t` |
| `run [ticket]` | `start`, then spawn the agent in the worktree; `--tab` for a new iTerm2 tab, `--print` is a pure read |
| `open` | the `.code-workspace`, or `--notes/--prompt/--plan/--task/--worktree/--sabin` (notes and prompt are scaffolded on the way) |
| `context --json` | the agent's orienting call; deliberately omits the prompt file |
| `where` | one path for shell interpolation |
| `notes new` | scaffold a note, print the path; the only notes command on purpose |
| `skill install` | copy `skills/sabin/` to `~/.claude/skills` (or `--agent codex`), removing stale `/sabin-*` commands |

There is deliberately no `finish`, no worktree removal, and no task deletion in the CLI.

## VS Code extension (`packages/vscode-extension/src`)

- `services/workspaceService.ts` - the only door to Sabin data; everything goes through core.
- `providers/workspaceProvider.ts` - the Workspace tree: focused task (scratchpad, task, notes) above
  open tasks by status. Focus follows the branch until a click pins it.
- `providers/webviewProvider.ts` + `media/board.js` - the Board. The page posts `{command, ticket}`;
  paths are resolved extension-side, never trusted from the page. HTML is escaped.
- `services/workspaceFolders.ts` - swaps folders 1+ to the focused ticket's worktree and notes. Folder 0
  is never touched (VS Code restarts the extension host), so this needs the `.code-workspace`.
- `watchers/fileWatcher.ts` - one debounced watcher over the whole Sabin directory.

Commands: `focusTask` (⌥⌘T), `openPrompt` (⌥⌘P), `openPlan` (⌥⌘L), `openTask`, `openWorktree`,
`newTask`, `newNote`, `unpinTask`, `refreshTasks`, `openProjectWorkspace`.

## Agent integration

`skills/sabin/SKILL.md` is lean and routes; the long-form workflow is in `skills/sabin/references/`
(`task-create`, `plan`, `implement`, `review`, `complete`) and loads only when that step is requested.
Rules the skill enforces: orient with `sabin context --json` and stop if it errors; everything durable
goes in `notesDir`; status only via `sabin task update`; `review` is the agent's ceiling and
`completed` needs explicit approval; never read the prompts directory (also enforced by a
`permissions.deny` rule `init` writes to `.claude/settings.local.json`).

`buildTaskPrompt()` tells a launched agent to follow the skill and end in `review`. Orchestration
(SABIN-0014) is intentionally not built; the seams for it are `references/`, `buildTaskPrompt`, and
`run --print`.

## This repository's own Sabin

`.sabin` here is a link to `~/notes/sabin/.sabin`. Use `sabin context --json` / `sabin where` for
paths; never hardcode them. Include the ticket ID in commit messages. Run lint and tests before
finishing.
