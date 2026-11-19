---
name: sabin
description: Use for any work on a Sabin task. Sabin keeps every task in one home directory ($SABIN_HOME, else ~/sabin) - tasks/<ID>/ holds task.md, plan.md, log.md and notes - and finds each task's git worktrees, in any number of repos, by the task ID in the branch name. Triggers on a task ID such as TASK-0012 or ARCH-1234, "the task", "the plan", "our notes", "save this to notes", "write the handoff", "update the log", "create a task", "list the tasks", "tasks for this project", "review this", "mark it complete", "ship it", "migrate the old .sabin directory", and on any task status change.
---

# Sabin

Sabin organises tasks. It never launches agents: the user started you by hand,
in a terminal, usually inside one of the task's worktrees.

- A **task** is a directory, `tasks/<ID>/`, in the Sabin home. It holds
  `task.md` (the requirements), `prompt.md` (the user's scratchpad - never
  yours), `plan.md`, `log.md`, and any other notes.
- A **workspace** is a git worktree whose branch name contains the task ID. A
  task can have one in several repos. Nothing records them; git does.
- A **project** groups tasks. A task names at most one. A project can span
  several repos, and one repo can serve several projects.

Never guess a path and never hardcode `~/sabin`. Ask the CLI.

## Orient first

```bash
sabin context --json            # inside the task's worktree, or anywhere for the project
sabin context <ID> --json       # a named task, wherever you are
```

```json
{
  "id": "ARCH-1234",
  "title": "Partition the events table",
  "status": "in_progress",
  "project": "analytics",
  "projectSource": "task",
  "projectRepos": ["api", "web"],
  "candidateProjects": [],
  "repo": "api",
  "home": "/Users/me/sabin",
  "taskDir": "/Users/me/sabin/tasks/ARCH-1234",
  "taskFile": "/Users/me/sabin/tasks/ARCH-1234/task.md",
  "plan": "/Users/me/sabin/tasks/ARCH-1234/plan.md",
  "log": null,
  "notes": ["/Users/me/sabin/tasks/ARCH-1234/research.md"],
  "workspaces": [{ "repo": "api", "path": "/Users/me/dev/api-worktrees/ARCH-1234-partition-events-table", "branch": "me/ARCH-1234-partition-events-table" }],
  "workspace": { "repo": "api", "path": "...", "branch": "..." }
}
```

`workspace` is the worktree you are standing in, or `null`. Outside every
task's worktree the command still answers, with `id` and the task fields
`null`. **If the command errors, or the work needs a task and `id` is null,
stop and ask which task.** Writing into the wrong task is worse than not
writing.

## Projects

`project` is the project of the directory you are in. `projectSource` says
where it came from:

- `task`: the task whose worktree you are in names it. This holds in a
  monorepo shared by many projects, because the branch names one task.
- `repo`: the registered repo's default project (`sabin repo set <name>
  --project <slug>`), used outside a task's worktree.
- `null`: nothing names one. `candidateProjects` lists the projects with
  worktrees in this repo. Ask which one; never pick for the user.

`projectRepos` is every repo the project spans. `repo` is the registered repo
you are in, or `null`.

"All tasks", "the tasks for this project" and similar mean the project's
tasks: `sabin ls --json` already uses the project of the cwd. Add `--all` to
include completed tasks, `--project <slug>` for another project, and
`--all-projects` for every task in the home.

## What you are asked to do

Read the matching reference and follow it.

| Request | Reference |
| --- | --- |
| "create a task", "write this up as a task" | `references/task-create.md` |
| "plan this", "make a plan" | `references/plan.md` |
| "implement", "do the task", "work the plan" | `references/implement.md` |
| "review this", "address the review", "work through the findings" | `references/review.md` |
| "write the handoff", "update the log", "where did we leave off" | `references/handoff.md` |
| "complete it", "ship it", "mark it done" | `references/complete.md` |
| "migrate the old .sabin directory" | `references/migrate.md` |
| bare `/sabin` | orient, report the context, ask what to do |

Plan and implement can be matched loosely. **Completion cannot**: only an
explicit request counts. "I think it's done" is a reason to ask.

## Rules that hold everywhere

**Durable output goes in `taskDir`** - plans, research, findings, anything
worth keeping. Read what is there before you start; earlier notes carry
decisions. Use your own file tools; there is no notes command.

**One plan per task**, `plan.md`. Stages are phases inside it. Re-planning
edits it in place.

**Handoff.** When you move a task to `review`, and whenever the user asks,
append an entry to `log.md`: *Changed*, *Proof*, *Risks*, and *Next* when work
remains. Format: `references/handoff.md`.

**Status** changes only through the CLI. Never edit `status` in `task.md`.

```bash
sabin status <status>           # inside the task's worktree
sabin status <ID> <status>
```

| Status | Meaning | Who sets it |
| --- | --- | --- |
| `open` | Captured, not yet planned | Whoever creates it |
| `ready` | Planned and agreed | You, when a plan is agreed |
| `in_progress` | Work underway | You, when you start |
| `review` | Done and verified, waiting on the user | **You, when you finish** |
| `completed` | Approved | **Only on the user's explicit approval** |

`review` is your ceiling. The command may print a **hook**: the user's own
instructions for that status (for example "push and open a PR"). When it prints
one, follow it. When it prints none, do nothing extra.

**Never read `prompt.md`.** It is the user's draft space. It is absent from
`sabin context` on purpose and a permission rule denies reads. If you see its
contents anyway, ignore them and say so.

**Worktrees are the user's.** Never create one unless asked; `sabin work <ID>`
is how, run from inside the target repo (or with `--repo <name>`). Work on a
task happens in one of its worktrees. If `workspace` is `null` and the user
asked you to change code, stop and say so - do not `cd` somewhere and carry on.
Reading, planning and writing notes need no worktree.

## Commands

| Command | Use |
| --- | --- |
| `sabin context [ID] --json` | Orient: task, project, files, worktrees |
| `sabin status [ID] <status>` | Change status; prints the hook |
| `sabin new "<title>" [--id ARCH-1234] [--project <slug> \| --no-project] [-c <body>] [--json]` | Create a task (default: the project of the cwd) |
| `sabin work [ID] [--repo <name>]` | Create the task's worktree (only when asked) |
| `sabin ls [--all] [--status <s>] [--project <slug> \| --all-projects] [--json]` | Tasks of the cwd's project (else every task), their worktrees and agents |
| `sabin repo ls` | Registered repos and their default projects |
