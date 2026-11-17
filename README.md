# Sabin

A command center for agentic coding. One place to see every task across every
repo and worktree, what each agent is doing, and where each task was left off.

Sabin observes and organises. **It never launches an agent.** You start Codex
or Claude Code yourself, in a terminal, in a task's worktree. Sabin learns what
they do from their hooks and what they changed from git.

Everything is text in one directory, `~/sabin` (or `$SABIN_HOME`). A task is a
directory of markdown files. Its worktrees are not recorded anywhere: Sabin
finds them by the task ID in the branch name, in every repo you registered.

## The workflow

```bash
sabin new "Partition the events table" --id ARCH-1234 --project analytics
cd ~/dev/api && sabin work ARCH-1234       # worktree + branch in this repo (registers it)
cd ~/dev/web && sabin work ARCH-1234       # the same task can span repos
cd ../api-worktrees/ARCH-1234-partition-events-table && codex
sabin ls                                   # every task, its repos, and what its agents are doing
sabin app                                  # the desktop app
```

```
ID          STATUS       PROJECT    TITLE                         REPOS    AGENT
ARCH-1234   in_progress  analytics  Partition the events table    api,web  codex waiting 6m
TASK-0007   review       -          Fix the flaky upload test     api      claude idle 2h
2 tasks  (completed hidden; --all to show)
```

The agent follows the **sabin skill**: it orients with `sabin context --json`,
reads and writes the task's files, moves the task to `review` when the work is
done and verified, and appends a handoff to `log.md` - what changed, the proof
it works, the risks, and what is next. The work stays **uncommitted** in
`review`, so a fresh reviewer reads the working tree. Findings go to
[Margin](#review) threads when `margin` is installed, otherwise to `review.md`.

You approve completion. That is where the commit happens, the task moves to
`completed`, and your hook for that status runs - "push and open a PR", say.
Worktrees are never removed for you.

## Layout

```
~/sabin/
  config.json
  projects/<slug>.md          optional grouping: title, status, prose
  tasks/<ID>/
    task.md                   status, title, project, created; the requirements
    prompt.md                 your scratchpad - agents are denied it
    plan.md                   one plan per task
    log.md                    session handoffs, appended
    *.md                      notes
  hooks/<status>.md           printed by `sabin status` after that transition
  hooks/<repo>/<status>.md    per-repo override
  state/sessions/             agent activity, written by hooks
```

`config.json`:

```json
{
  "idPrefix": "TASK",
  "idPadding": 4,
  "branch": { "prefix": "me", "template": "{prefix}/{id}-{slug}" },
  "repos": {
    "api": { "path": "/Users/me/dev/api", "worktreesRoot": "../api-worktrees", "postCreate": ["npm install"] }
  }
}
```

A missing file means defaults. Repos are added by `sabin work` (the repo you
run it in) or `sabin repo add`; `worktreesRoot` defaults to
`../<repo>-worktrees` and `postCreate` runs in each new worktree.

## Commands

| Command | Does |
| --- | --- |
| `sabin setup [--hooks]` | Create the home, install the skill for Claude Code and Codex, deny agents `prompt.md`. `--hooks` adds the activity hooks. Safe to re-run. |
| `sabin new "<title>" [--id ARCH-1234] [-p <project>] [-c <body>] [--json]` | Create a task. Never a worktree. |
| `sabin work [id] [-r <repo>] [--json]` | Create the task's worktree in this repo (or `--repo`). Idempotent. |
| `sabin ls [-p <project>] [-s <status>] [-a] [--json]` | Tasks across all repos, with worktrees and agent activity. |
| `sabin status [id] <status>` | `open`, `ready`, `in_progress`, `review`, `completed`. Prints the hook. The ID is inferred inside a worktree. |
| `sabin context [id] [--json]` | What an agent needs to orient. Never includes `prompt.md`. |
| `sabin repo add [path]` / `ls` / `rm <name>` | The repo registry. |
| `sabin app [-t <id>]` | Open the desktop app. |

## Install

```bash
npm install && npm run build
cd packages/cli && npm link                # puts `sabin` on PATH
sabin setup --hooks
```

`setup` writes to `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR`),
`~/.claude/skills/sabin`, `~/.agents/skills/sabin` and, with `--hooks`,
`~/.codex/hooks.json` (or `$CODEX_HOME`). It merges into existing settings and
prints every file it touched. **Codex runs new hooks only after you trust them**:
open `/hooks` in Codex once and approve the `sabin agent-state` entries.

Without hooks, everything works except agent activity in `ls` and the app.

## Review

When Margin (`margin`, a local diff review tool) is on PATH, a review pass records
its findings as Margin threads, and the app shows Margin's review UI for a
worktree. Without it, findings go to `review.md` in the task directory as
checkbox rounds. Either way, completion waits until every finding is
addressed or declined.

## Moving from the old `.sabin` directories

Earlier versions kept a `.sabin` directory per repo. There is no automatic
upgrade: ask an agent to "migrate the old .sabin directory at <path>". It
follows `skills/sabin/references/migrate.md`, shows a dry run first, copies
rather than moves, and keeps existing worktrees and branches.

## Development

```bash
npm run build && npm test && npm run lint && npm run typecheck
```

See `CLAUDE.md` for the design and the reasons behind it.
