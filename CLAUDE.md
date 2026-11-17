# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Overview

Sabin is a command center for agentic coding: one place to see every task across every repo and
worktree, and where each one was left off. It answers three problems and nothing more: agents
produce more code than you can keep up with, more output than you can keep up with, and they run in
parallel across projects and tasks.

**Product rule: Sabin observes and organises. It never launches an agent and never orchestrates.**
You start agents by hand in iTerm2 (Codex mostly, Claude Code sometimes). Sabin reads what they do
through hooks and what they changed through git. Every `plan`/`implement`/`review` launcher from
earlier versions is gone on purpose (SABIN-0025).

Three packages in a monorepo:

- **@sabin/core** - the data model and every operation on it: home, tasks, projects, repos,
  workspaces, agent sessions, hooks, iTerm2. Pure Node; no CLI or UI dependencies. The CLI and the
  app are both thin layers over it.
- **@sabin/cli** - the `sabin` command. Argument handling and output only.
- **packages/app** - the Electron desktop app (see "App" below).

Plus `skills/sabin/` - the agent contract - also exposed as a Claude Code plugin (`.claude-plugin/`).

No backward compatibility with the old per-repo `.sabin` directories. They are migrated by an agent
following `skills/sabin/references/migrate.md`.

## Build, test, lint

```bash
npm run build      # all packages (lerna)
npm test
npm run lint
npm run typecheck

npm run build -w @sabin/core && npm run build -w @sabin/cli
npm test -w @sabin/cli -- src/__tests__/work.test.ts    # one file
```

`sabin` on PATH is `npm link`ed to `packages/cli`, so `npm run build` updates it. The CLI resolves
`@sabin/core` through its built `dist/`, so build core before the CLI.

**Tests never touch the real home.** Both packages' jest `setupFiles` point `SABIN_HOME` (and, in
the CLI, `HOME`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`) at temp directories before any module loads. Under
Jest, `os.homedir()` ignores a changed `HOME` - Jest hands each test a copy of `process.env` - so
the CLI reads the user's home through `userHome()` (`cli.ts`), which reads `$HOME` first. Never call
`os.homedir()` directly in code that writes.

## Data model

One directory per machine: `$SABIN_HOME`, else `~/sabin` (`resolveHome()`). No link files, no
per-repo init, no walking up from the cwd: every command, the app and every hook resolve to the
same place whatever directory they run in.

```
<home>/
  config.json
  projects/<slug>.md          frontmatter: title, optional status (active | paused | done); body is prose
  tasks/<ID>/
    task.md                   frontmatter: status, title, optional project, created (YYYY-MM-DD)
    prompt.md                 human scratchpad; agents never read it
    plan.md                   optional; exactly one
    log.md                    optional; session handoffs, appended
    *.md                      anything else is a note
  hooks/<status>.md           prose printed by `sabin status` after that transition
  hooks/<repo>/<status>.md    per-repo override; wins when the command runs inside that repo
  state/sessions/<id>.json    agent activity, written by agent hooks
```

**config.json**: `idPrefix`, `idPadding`, `branch: { prefix, template }`, and `repos: { <name>: {
path, worktreesRoot?, postCreate? } }`. A missing file is defaults; an unparsable one is an error,
never a silent fallback - a defaulted prefix would allocate IDs under the wrong name and an empty
registry would make every workspace vanish. A repo's name is its directory basename, with `-2`,
`-3` on a collision; `worktreesRoot` is relative to the repo unless absolute, default
`../<basename>-worktrees`.

**Task.** The directory name is the ID: `^[A-Z][A-Z0-9]*-\d+$`, uppercased on input. That pattern
is also the path-safety check - nothing that passes it holds a separator or `..` - so it is
validated on create **and on every lookup** (`taskDirPath()` is the one place an ID becomes a
path). External IDs such as `ARCH-1234` are passed in; otherwise `nextTaskId()` allocates the next
`<idPrefix>-<n>`, counting directory names so a task with a broken `task.md` still holds its number.
Status lives in the frontmatter only; nothing moves on disk. Every status write goes through
`setTaskStatus()`: under the lock, atomic (temp file + rename), keeping unknown keys and the body.
A task has no repo, branch, worktree or slug field.

**Project.** Optional grouping, independent of repos. A task names one with `project: <slug>`. A
project exists if `projects/<slug>.md` exists **or** any task names the slug.

**Workspace** - derived, never recorded. One git worktree, in one registered repo, whose branch name
contains a known task ID: case-insensitive, and bounded so `ARCH-12` matches neither `ARCH-123` nor
`XARCH-12` (`taskIdFromBranch()`, which takes the known IDs so `fix/UTF-8-handling` names nothing
unless UTF-8 is a task). Found by one `git worktree list --porcelain` per registered repo. A task has
zero or more, across repos. `createWorkspace()` makes branch `{prefix}/{id}-{slug}` at
`<worktreesRoot>/<ID>-<slug>`; the slug is computed from the title (stop words dropped, 32 chars on
a word boundary) and not stored - the branch is the record. It is idempotent: if the task already
has a workspace in that repo, it is returned and nothing is created.

**Agent session.** Hooks call `sabin agent-state` with their JSON payload on stdin. One file per
agent session id. `SessionStart` → idle; `UserPromptSubmit` → busy, records the prompt;
`PermissionRequest` (Codex) and a permission/idle `Notification` (Claude Code) → waiting;
`PostToolUse` → busy only if currently waiting (approving a permission fires nothing else);
`Stop` → idle, records `last_assistant_message`; `SessionEnd` → ended. **Ended sessions are kept** -
they are the "where I left off" record - and swept at the edges of a session: older than 30 days,
or beyond the 5 most recent per cwd. A session whose pid is dead reads as `ended`; one with no pid
is believed for 12h. A session belongs to a task when its cwd is inside one of the task's
workspaces.

**Hooks** (status hooks, not agent hooks) are prose for the agent. `sabin status X completed`
prints `hooks/completed.md`, or `hooks/<repo>/completed.md` inside that repo, so "push and open a
PR" arrives from the command the agent had to run anyway.

## Core (`packages/core/src`)

| File | Owns |
| --- | --- |
| `home.ts` | `resolveHome`, `homePaths`, `ensureHome` |
| `config.ts` | `readConfig`/`writeConfig`, the repo registry: `listRepos`, `findRepo`, `repoForPath`, `addRepo`, `removeRepo` |
| `ids.ts` | `parseTaskId`, `TASK_ID_PATTERN`, `compareTaskIds`, `taskIdFromBranch` |
| `taskFiles.ts` | paths inside a task directory; `findPlan`, `findLog`, `listNotes` |
| `tasks.ts` | `listTasks`, `findTask`/`getTask`, `createTask`, `setTaskStatus`, `updateTask`, `nextTaskId` |
| `projects.ts` | `listProjects`, `findProject`, `createProject` |
| `hooks.ts` | `hookPath`, `findHook` (text and file), `readHook` |
| `git.ts` | `listWorktrees`, `mainWorktreeRoot`, `currentBranch`, `addWorktree` |
| `workspaces.ts` | `listWorkspaces`, `workspacesForTask`, `workspaceForPath`, `createWorkspace`, `workspaceGitStatus` |
| `agentSessions.ts` | `recordAgentEvent` (never throws, never prints), `readAgentSessions`, `sweepAgentSessions`, `sessionsByTask` |
| `agentIntegration.ts` | merges the prompt deny rule and activity hooks into settings files whose paths the caller chooses |
| `terminal/` | the iTerm2 driver and the `ps`/`lsof` process reader |
| `terminalSessions.ts` | live terminals attributed to tasks by cwd; `focusTerminal`, `openWorkspaceTab`, `windowForTask` |
| `lock.ts` | mkdir lock over the home: ID allocation, `task.md` writes, `config.json` edits |
| `markdown.ts`, `slug.ts`, `fs.ts`, `errors.ts` | frontmatter, slugs, atomic writes, `SabinError` subclasses with stable `code`s |

Listing is tolerant (one broken `task.md` never blanks the list); a lookup of a bad ID throws
`InvalidTaskIdError`, so a typo and a missing task are different answers.

## CLI (`packages/cli/src`)

`index.ts` is only a router: `agent-state` takes a fast path that loads neither Commander nor any
other command, and everything else goes to `program.ts`, the Commander definition. One file per
command under `commands/`. `cli.ts` holds the shared pieces: `CliError`/`fail()`, `loadHome()`,
`resolveTaskId()` (the ID given, else the task whose worktree holds the cwd - never a guess),
`userHome()`, and the output helpers.

| Command | Does |
| --- | --- |
| `setup [--hooks]` | Creates the home and config; installs the skill for Claude Code (`$CLAUDE_CONFIG_DIR` or `~/.claude`, `/skills/sabin`) and Codex (`~/.agents/skills/sabin`); writes the `prompt.md` deny rule to Claude Code's `settings.json`; removes what the old installer left (`commands/sabin-*.md`, `$CODEX_HOME/skills/sabin`). `--hooks` merges activity hooks into Claude Code's `settings.json` and `$CODEX_HOME/hooks.json`. |
| `new "<title>" [--id] [-p <project>] [-c <body>] [--json]` | Creates the task directory, `task.md` and `prompt.md`. Never a worktree. |
| `work [id] [-r <repo>] [--json]` | Creates the task's worktree in the repo of the cwd (registering it on first use) or `--repo`; runs `postCreate`. |
| `ls [-p <project>] [-s <status>] [-a] [--json]` | Every task: id, status, project, title, repos with a workspace, the most urgent live agent. Completed hidden unless `--all`. |
| `status [id] <status>` | The status write; prints the hook (per-repo first). |
| `context [id] [--json]` | The agent's orienting call. Keys: `id, title, status, project, home, taskDir, taskFile, plan, log, notes, workspaces, workspace`. Never `prompt.md`. |
| `repo add [path]` / `repo ls` / `repo rm <name>` | The registry. `rm` touches nothing on disk. |
| `app [-t <id>]` | `open -a` an installed `Sabin.app` (`/Applications`, then `~/Applications`), else the dev launcher `packages/app/bin/sabin-app.js` with node, detached. |
| `agent-state` | Hidden; what the hooks run. |

Rules every command follows:

- **Each command ends by printing the resulting state** in a few plain lines - what was created,
  where, and what to run next - so nobody wonders what happened.
- **Errors are one line on stderr and exit 1.** Commands `throw`; `program.ts` prints. Core's
  `SabinError` messages are written for people, so they pass through unchanged.
- **`agent-state` prints nothing and always exits 0**, even on garbage input: Codex rejects plain
  text on `Stop`, and a failing hook interrupts the agent it watches. It ignores its arguments, so
  hooks written by the old `sabin init --hooks` (`sabin agent-state busy`) still work. It costs about
  40ms per event, most of it the process-tree walk that finds the agent's pid.
- **Setup is idempotent and conservative.** It prints every file it created, updated, left
  unchanged or removed. A skill copy is replaced only when its contents differ. A settings file that
  does not parse is reported and left alone (exit 1), never overwritten.
- **Codex skips new or changed hooks until the user trusts them** in Codex's `/hooks`; `setup
  --hooks` says so.

Removed in SABIN-0025, deliberately: `init`, `link`, `plan`, `implement`, `review`, `term`, `jump`,
`sessions`, `open`, `where`, `notes new`, `task *`, `skill install` (folded into `setup`), and all
agent launching.

## App (`packages/app`, Electron)

Files are the truth; the app holds no state of its own beyond window layout. It reads and writes
through core, like the CLI.

- **Sidebar:** All tasks, each project with open-task counts, "No project", and the repo list with
  add/remove.
- **Home is an attention list**, not a board, filtered by the selected project: *Needs you* (an agent
  waiting, longest wait first; then tasks in `review`), *Working*, *In progress*, *Ready*, *Open*,
  *Completed* (folded). A row shows the ID, title, project, a chip per workspace (repo, dirty/ahead),
  the agent badge, and one line of the agent's last message.
- **Task view:** title, status and project controls; `task.md`, `prompt.md`, `plan.md`, `log.md` and
  the notes in a markdown editor; *Sessions* (Focus a live one in iTerm2, Resume an ended one);
  *Workspaces* (Terminal, Review, copy path, reveal; "create worktree in <repo>").
- **Review** runs `rede` for a worktree and shows Rede's UI in a web view. Rede stays a separate
  tool; Sabin only calls its CLI.
- **Notifications** only when an agent starts waiting or a task enters `review`.
- Live updates from one debounced watcher over the home, plus a re-read on window focus. No polling.

**Processes.** The main process (`src/main`) does all file, git, terminal and Rede work, and all
of it through `@sabin/core`, which esbuild bundles into `main.js`. The renderer (`src/renderer`,
Preact) is sandboxed - context isolation, no Node, a strict CSP - and talks through the typed
`SabinApi` bridge in `src/shared/types.ts`. Pure logic the tests cover lives in `src/shared`
(`attention.ts` for grouping and order, `notices.ts` for the snapshot diff behind notifications).

**The renderer never sends a path.** It sends a task ID and a file name; `paths.ts` validates both
and checks the real path against the home, so a symlink cannot lead out. A workspace path is accepted
only if git lists it for that task. `task.md` and `prompt.md` can be neither renamed nor deleted;
deletes go to the Trash.

**One snapshot, pushed.** `snapshot.ts` assembles tasks, projects, repos, workspaces with git state,
and sessions in one pass, and turns each partial failure into a visible warning. `watcher.ts` is one
recursive `fs.watch` over the home (120 ms debounce, 700 ms for `state/`). Git state is refreshed
only with a snapshot, so a worktree that changes while nothing under the home does is stale until the
window regains focus.

**Rede** runs in its own `WebContentsView` with a persistent session partition, because Rede
keeps drafts in `localStorage` per origin and refuses cross-site frames. `rede.ts` runs
`rede --no-open` in the worktree, loads only the URL Rede printed, and sends any other link to
the browser. The native view paints above the page, so it hides while a dialog is open.

**Terminal** actions (`terminal.ts`) are explicit clicks: Focus, Terminal, and Resume
(`codex resume <id>` or `claude --resume <id>` in a new tab). They are the only things the app
spawns besides git and Rede. A Finder-launched app has a minimal PATH, so `shellEnv.ts` reads the
login shell's PATH once at startup.

**Single instance.** A second launch focuses the window. `--task <ID>` travels in the
single-instance lock's additional data, because Chromium reorders a second launch's arguments.

```bash
npm run dev -w @sabin/app                 # uses the real home unless SABIN_HOME is set
node packages/app/bin/sabin-app.js        # the built app; what `sabin app` runs
npm run package -w @sabin/app             # unsigned packages/app/release/mac-arm64/Sabin.app
npm run test:e2e -w @sabin/app            # Playwright against a fixture home
```

The e2e suite sets `SABIN_APP_NO_TERMINAL=1`, which swaps the iTerm2 driver for a recording fake.
Nothing in the tests sends Apple Events.

## Agent integration

`skills/sabin/SKILL.md` is lean and routes; each step lives in `skills/sabin/references/`
(`task-create`, `plan`, `implement`, `review`, `handoff`, `complete`, `migrate`) and loads only when
asked for. `sabin setup` installs the same files for Claude Code and Codex.

Rules the skill enforces: orient with `sabin context --json` and stop if it errors; durable output
in `taskDir`, one `plan.md`; status only through `sabin status`, `review` is the agent's ceiling and
`completed` needs explicit approval; follow the printed hook; never read `prompt.md` (also denied by
the rule `setup` writes); never create a worktree unless asked.

**Handoff.** When a task goes to `review`, and whenever the user asks, the agent appends to
`log.md` a dated entry: *Changed*, *Proof*, *Risks*, and *Next* when work remains. It is what the app
shows as "where it was left off" alongside the last agent message.

**Review.** When `rede` is on PATH, findings are Rede threads. Otherwise they go in `review.md`
in the task directory as append-only rounds of `- [ ]` items, closed with `*Addressed:*` or
`*Declined:*`. Completion blocks on any open item. Nothing is committed until completion, so a
reviewer reads the working tree.

## This repository's own Sabin

This repo's tasks live in the global home with every other repo's, under the project `sabin`
(migrated from `~/notes/sabin/.sabin` on 2026-11-16; that directory and the `.sabin` link file at the
repo root are leftovers the new CLI ignores). Use `sabin context --json` for paths and never hardcode
them.

Include the task ID in commit messages. Run lint and tests before finishing.
