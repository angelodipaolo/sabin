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
  notes/<TICKET>-<slug>/          agent-readable; plan.md and feedback.md live here
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
`slug`, the task title, then an existing directory on disk (as a migration fallback).

**Plan**: exactly one per ticket, at `notesDir/plan.md`. Derived, never recorded. `findPlan()` is the
only answer to "does this ticket have a plan".

**Feedback**: exactly one per ticket, at `notesDir/feedback.md`, beside the plan. Derived, never
recorded. `findFeedback()` is the only answer to "is there feedback". Every review pass appends a
`## Round <n> — <source> · <date>` section of `- [ ]` findings; the implementer ticks them and adds
`*Addressed:*`. Append-only - nothing is deleted, rewritten or un-ticked, so a second model's pass
sits below the first's and GitHub PR comments pulled down with `gh` are just another round. The
format lives in `skills/sabin/references/feedback.md` and nowhere else.

**Hooks**: `hooks/<status>.md` is prose for the agent. `sabin task update X completed` prints
`hooks/completed.md` after the move, so "push and open a PR" arrives from the command the agent had to
run anyway. No new command, nothing for the skill to remember.

**Ticket inference**: from the branch (the project prefix first, then any `UPPER-123` key). No ticket
on the branch is an error, not a fallback - resolving to the wrong ticket's notes is the worst failure.
A ticket named explicitly (argument or `SABIN_TICKET`) must have a task file or `resolveWorkspace()`
throws `UnknownTicketError`; every path is derived from the ID, so a typo would otherwise resolve
cleanly into a directory nothing else looks in. Branch-derived tickets are exempt - `task create`
records the branch before the task lands - and `allowMissingTask` lets `ensureWorkspace` refuse with
its own message.

## Core (`packages/core/src`)

| File | Owns |
| --- | --- |
| `types.ts` | `Task`, `TaskStatus`, `TASK_STATUSES`, `SabinConfig` |
| `tasks.ts` | `listTasks`, `findTask`, `createTask`, `setTaskStatus`, `nextTaskId`, `readHook` - every task write, under `withLock` |
| `markdown.ts` | `parseTask` / `writeTask` (gray-matter) |
| `workspace.ts` | `resolveWorkspace`, `workspacePaths`, slugs, `branchNameFor`, `findPlan`, `findFeedback`, `scaffoldWorkspace` |
| `agents.ts` | `resolveAgent`, `agentArgv`, `buildTaskPrompt`, `WorkflowStep` - pure, so an orchestrator can compose prompts without the CLI |
| `git.ts` | `currentBranch`, `mainWorktreeRoot`, `listWorktrees`, `addWorktree` |
| `sabinResolver.ts` | finds the Sabin directory: link file, walking up, then the main worktree root |
| `terminal/` | `TerminalDriver`, the iTerm2 driver, and `ps`/`lsof` process reading |
| `agentState.ts` | `state/sessions/*.json` - what each agent is doing, written by hooks |
| `sessions.ts` | `groupSessionsByTicket`, `chooseJob`, `windowForTicket` - terminals to tickets |
| `itermProfile.ts` | the Dynamic Profile `jump --install-hotkey` writes |
| `lock.ts` | mkdir lock, scoped to ID allocation and status writes |
| `config.ts` | `readConfig` - a missing file is defaults; an unparsable one is an error |
| `codeWorkspace.ts`, `agentPermissions.ts`, `gitExclude.ts` | the files `init`/`link` write |

## CLI (`packages/cli/src`)

`index.ts` is the Commander definition; one file per command under `commands/`.
`workspace-context.ts` (`loadProject`, `getWorkspace`, `fail`) and `workspace-start.ts`
(`ensureWorkspace`, shared by the three step verbs) are the only shared pieces. `iterm.ts` titles
tabs and opens new ones - the title only; the iTerm2 badge was removed in SABIN-0016 because it
painted the ticket over the output.

| Command | Does |
| --- | --- |
| `init` / `link` | Sabin directory outside the repo, `.sabin` link, `.git/info/exclude`, `.code-workspace`, prompts deny rule; `--hooks` also installs the activity hooks |
| `agent-state <activity>` | hidden; what the activity hooks call. Never fails, never prints |
| `task create "<title>"` | task + notes dir + scratchpad; `-n` for external IDs, `--open` to edit, `--json` |
| `task list` | one line per active task; `--all`, `-s`, `--json` |
| `task update <id> <status>` | the status write; prints the hook |
| `task show` | print the file |
| `plan` / `implement` / `review` `[ticket]` | the three step verbs - see below |
| `sessions [ticket]` | live terminals, grouped by the ticket whose worktree they sit in; `--all`, `--json` |
| `jump [ticket]` | focus a ticket's terminal, or pick one; `--any` for callers with no terminal to ask in (exits 3 when there is nothing to focus); `--install-hotkey` binds a global picker |
| `term [ticket]` | a shell in the ticket's worktree, in the ticket's window |
| `open` | the `.code-workspace`, or `--notes/--prompt/--plan/--feedback/--task/--worktree/--sabin` (notes and prompt are scaffolded on the way) |
| `context --json` | the agent's orienting call; deliberately omits the prompt file |
| `where` | one path for shell interpolation; `--plan` and `--feedback` among them |
| `notes new` | scaffold a note, print the path; `--template plan\|feedback`; the only notes command on purpose |
| `skill install` | copy `skills/sabin/` to `~/.claude/skills` (or `--agent codex`), removing stale `/sabin-*` commands |

There is deliberately no `finish`, no worktree removal, no task deletion, and no `complete` verb in
the CLI. Completion needs the user's approval and goes through `task update`.

**The step verbs** (`commands/agent-step.ts`) are one `runStep(step, ticket, options)` registered
three times from one option set in `index.ts`, so they cannot drift apart. Only the prompt differs.
They replaced `start` and `run` in SABIN-0016 - those two names were the reported confusion, and
anything either did is now a verb plus a flag (`--no-launch` is `start`).

Two rules govern worktrees, and they are the whole model:

- `task create` never makes one. A task is a draft you edit until the idea is whole.
- `plan`, `implement` and `review` always make one, and launch the agent inside it.

There is no `--no-worktree`: it would be a hole in the only rule here worth having, and the thing it
would be for is what drafting already is. Status is per-step - only `implement` writes
`in_progress`, since planning precedes `ready` and reviewing follows it (`STATUS_FOR_STEP`).

Under iTerm2 a new tab is the default (`--here` opts out). Autonomy is not: `--yolo` or
`agents.autonomous` in config.json, with `--supervised` to override. The tab re-invocation has to
forward the step, the agent and the autonomy choice, or the child opens a tab of its own.

## Terminal sessions

A ticket owns its live terminals the way it owns its plan: **derived, never recorded**. A session
belongs to SABIN-0017 because its working directory is inside SABIN-0017's worktree - so a tab you
opened by hand and `cd`'d into counts exactly as much as one Sabin launched, and there is no
registry to go stale when you close a tab.

Three subprocesses per pass, whatever the session count:

1. `osascript` - three bulk Apple Events for the window/tab/session tree with each session's `tty`.
   Reading `variable named "path"` per session instead is 7x slower and, for Claude Code, wrong:
   it rewrites its process title, so `jobName` reads `2.1.246`.
2. `ps -eo tty=,pid=,pgid=,stat=,command=` - the foreground process group per tty.
3. `lsof -a -d cwd -Fn -p <pids>` - the working directory per pid.

Both go through `capture()`, which keeps stdout regardless of exit code: `lsof` exits non-zero when
any pid in its list has already gone, and one transient `grep` must not empty the whole listing.

`chooseJob()` picks the process a session is *about*: prefer a member of the group that matches a
configured agent, else the group leader. Neither leader nor deepest-child works alone - `sabin
implement` is a launcher that parents the agent, while Claude Code parents its own mcpbridge.

**Agent activity** is the one thing the working directory cannot tell you: whether the Claude Code
in that tab is mid-edit, waiting for permission, or finished twenty minutes ago. Hooks report it -
`UserPromptSubmit` → busy, `Notification` → waiting, `Stop` → idle, `SessionEnd` → gone - each
firing `sabin agent-state`, which writes one small file keyed by terminal session and **always exits
0**: a hook that fails is a hook that interrupts the agent it exists to watch.

State carries the agent's **pid**, found by walking the hook's own process tree to the nearest
agent ancestor - a hook's parent is a transient shell, so its ppid would look dead immediately. That
is what lets a killed agent's last "busy" be disbelieved by anyone holding the file, including the
extension, which cannot enumerate terminals. A state with no pid falls back to a 12h expiry rather
than being trusted for ever.

Filtering on read is not enough on its own, because **a dying process writes no file** and the
extension's watcher only hears about files. Two things close that: the launcher clears its child's
state from its own `exit` handler, and the extension re-reads when its window regains focus
(`onDidChangeWindowState`) - event-driven, no timer.

Opt-in, via `sabin init --hooks`, and merged into `.claude/settings.local.json` rather than written
over it. Not part of plain `init`: hooks execute a command on every turn of every agent, which is a
heavier thing to put in someone's project than a deny rule. No activity is **not** a state - an
agent with no hooks installed gets no badge rather than a guessed one. State whose session is no
longer open is ignored on read and swept on the next `sabin sessions`.

**One window per ticket.** `windowForTicket()` derives it from where the ticket's sessions already
are, and only reuses a window the ticket has **to itself** - otherwise, on a machine that already
has one window holding everything, every ticket's "own" window is that window and the flat tab bar
survives for ever. Refusing a shared window means each ticket moves out on its next tab, so the
layout migrates incrementally. `implement`, `review` and `term` then land beside each other and
⌘1-⌘9 walks one ticket. Tabs are
titled `SABIN-0017 · claude` and tagged with a `user.sabinTicket` variable - the title is
best-effort, because a shell that writes the title on every prompt will overwrite it, but nothing
depends on the title: attribution is always the working directory.

## VS Code extension (`packages/vscode-extension/src`)

**An index and a detail, never both.** The sidebar holds two views contributed to the same container
with complementary `when` clauses on one context key, `sabin.detail` (`navigation.ts`) - so exactly
one exists at a time and there is no third state. SABIN-0022 replaced the old side-by-side Workspace
tree and Board, which split the vertical space and each rendered the same task list a different way.

- `providers/indexProvider.ts` + `media/board.js` - the index: every uncompleted task, grouped by
  status, completed folded away. The card is **one** click target and posts `open`; the small buttons
  on it carry their own `data-action`, and the delegated listener resolves to the nearest one, so
  they never stop propagation. The page posts `{command, ticket}`; paths are resolved
  extension-side, never trusted from the page. HTML is escaped.
- `providers/detailProvider.ts` - one ticket: scratchpad, task file, live agents, notes. A
  `createTreeView` rather than a bare data provider, because the ticket is the view's **title** and
  `F2` needs `.selection`. `load()` runs outside `getChildren` so the title and the title-bar buttons
  stay right while the view is hidden.
- `navigation.ts` - `Navigator`. `showDetail` flips the context key **before** focusing the view:
  `.focus` on a `when`-hidden view is a silent no-op.
- `services/workspaceService.ts` - the only door to Sabin data; everything goes through core.
- `services/workspaceFolders.ts` - swaps folders 1+ to the open ticket's worktree and notes. Folder 0
  is never touched (VS Code restarts the extension host), so this needs the `.code-workspace`.
- `watchers/fileWatcher.ts` - one debounced watcher over the whole Sabin directory. `state/` gets a
  longer debounce: agent activity changes several times a turn, on every agent at once.

**No focus, no pin, no branch-following.** Removed in SABIN-0022 as circular: in a Sabin
`.code-workspace` window folder 0 is the main clone (always `main`) and folders 1+ are the worktree
`focusFolders()` swapped in *when the user clicked a task*, so the branch only ever matched a ticket
that had already been selected. Which ticket you are on is now simply which detail view you
navigated to.

**Notes are files, and behave like files.** Rename, Delete, Reveal in Explorer and Copy Path on
right-click, `F2` and ⌘⌫ on the selection, all through `vscode.workspace.fs` so editors follow a
rename and a delete lands in the Trash. `validateNoteName` (`services/noteFiles.ts`) refuses a
collision while you are still typing. The scratchpad and the task file carry their own context values
(`sabinPrompt`, `sabinTaskFile`) and get neither rename nor delete: **both paths are derived from the
ticket**, so moving one would leave every other reader looking somewhere else. Before SABIN-0022 all
three shared `sabinNote`.

- **The extension never enumerates terminals.** It reads `state/sessions/*.json` through the watcher
  it already has - no polling, no `osascript`, no timer. The cost is that it lists agents, not
  shells; the complete list is `sabin sessions` and the picker. `sabin.gotoAgent` (`sabin jump`) and
  `sabin.openTerminal` (`sabin term`) are the only things that spawn anything, and the line is a
  capability one: **`jump` and `term`, never `plan`, `implement` or `review`.** SABIN-0016 refused to
  let the extension launch agents; navigating to a terminal that already exists is a different act.
  They were one button until SABIN-0022, where `jump` fell through to `term` on exit 3 - which meant
  "give me a shell in the worktree" was not a thing you could ask for. Now `gotoAgent` reports that
  there is no agent and offers the shell.

Commands: `gotoTask` (⌥⌘T - the picker matches ID, title, slug, branch and status), `showIndex`,
`openPrompt` (⌥⌘P), `openPlan` (⌥⌘L), `openTask`, `openWorktree`, `setStatus`, `gotoAgent`,
`openTerminal`, `newTask`, `newNote`, `renameNote` (F2), `deleteNote` (⌘⌫), `revealNote`,
`copyTicket`, `copyPath`, `refreshTasks`, `openProjectWorkspace`. `sabin open` reaches a running
window through the URI `vscode://angelodipaolo.sabin-vscode/focus?ticket=…`; that path is the CLI's
(`commands/open.ts`) and stays `/focus` whatever the commands behind it are called.

## Agent integration

`skills/sabin/SKILL.md` is lean and routes; the long-form workflow is in `skills/sabin/references/`
(`task-create`, `plan`, `implement`, `review`, `address-feedback`, `complete`, plus `feedback` for the
file format) and loads only when that step is requested. Rules the skill enforces: orient with
`sabin context --json` and stop if it errors; everything durable goes in `notesDir`; status only via
`sabin task update`; `review` is the agent's ceiling and `completed` needs explicit approval; never
read the prompts directory (also enforced by a `permissions.deny` rule `init` writes to
`.claude/settings.local.json`).

**Feedback (SABIN-0020).** One `feedback.md` per ticket, beside `plan.md`, derived by `findFeedback()`
and surfaced the same ways `plan` is (`context --json`, `where --feedback`, `open --feedback`,
`notes new --template feedback`). Review passes append rounds to it and never edit an earlier one; the
implementer ticks `- [x]` and adds either `*Addressed:*` (what was done) or `*Declined:*` (the
user's call not to do it) - an item stays open only while it is genuinely undecided, since
`complete` reads an open box as work nobody did. The format lives only in `references/feedback.md` -
the template in `notes.ts` is a title and a pointer, so there is no second copy to drift. Nothing is
committed until `/sabin complete`: `implement` and `address feedback` deliberately leave the worktree
dirty so a reviewer reads the working state, and `complete` blocks on any open `- [ ]`. The one
exception is a ticket whose PR is already open - past completion the branch is public, so rounds
pulled from that PR commit and push normally. No step verb moves a task backwards either
(`stepStatus` in `workspace-start.ts`), so `implement` on a ticket in `review` leaves it there. What happens
after completion is the hook's to say (`hooks/completed.md`), never the skill's.

`buildTaskPrompt()` is an address, not a procedure - three lines naming the step, the ticket and the
task file, and nothing else. How to do a step lives in `references/<step>.md`, which loads on demand
and can be edited without a release; anything restated in the prompt would be a second copy free to
drift. It passes the task **path**, not the task body: the file is the source of truth and can change
mid-session. The agent's cwd is the ticket's worktree, so its `sabin context --json` needs no
arguments.

The skill stops rather than coping when a step is asked for outside the ticket's worktree - it never
`cd`s and never creates one. Orchestration (SABIN-0014) is intentionally not built; the seams for it
are `references/`, `buildTaskPrompt`, and `<step> --print`.

## This repository's own Sabin

`.sabin` here is a link to `~/notes/sabin/.sabin`. Use `sabin context --json` / `sabin where` for
paths; never hardcode them. Include the ticket ID in commit messages. Run lint and tests before
finishing.
