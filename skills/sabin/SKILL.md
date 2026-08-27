---
name: sabin
description: Use when working in a repository managed by Sabin - any repo containing a .sabin directory or .sabin link file. Resolves where the current ticket's notes live so you can read context and save plans, research, and docs without being told paths. Triggers on "Follow the sabin skill: plan/implement/review <TICKET>" (how `sabin plan`, `sabin implement` and `sabin review` open a session), on "our notes", "save this to notes", "read the plan", "the ticket", and on any task, plan, or status change in a Sabin project.
---

# Sabin

Sabin gives every ticket a **workspace**: a branch, a git worktree, a notes
directory you read and write, and a prompt scratchpad you must never touch.
Paths are derived, not fixed. Never guess one and never hardcode `.sabin/...` -
in a worktree the Sabin directory lives elsewhere.

## Orient first

```bash
sabin context --json
```

If you were handed a ticket and the branch is not its own - you are in the
main clone, or somewhere else entirely - name it, rather than letting the
branch answer for you:

```bash
sabin context --json -t <TICKET>
```

```json
{
  "ticket": "JIRA-12345",
  "name": "JIRA-12345-update-telemetry",
  "status": "in_progress",
  "branch": "angelo/JIRA-12345-update-telemetry",
  "worktree": "/Users/angelo/dev/myproject-worktrees/JIRA-12345-update-telemetry",
  "notesDir": "/Users/angelo/notes/myproject/.sabin/notes/JIRA-12345-update-telemetry",
  "taskFile": "/Users/angelo/notes/myproject/.sabin/tasks/open/JIRA-12345.md",
  "plan": "/Users/angelo/notes/myproject/.sabin/notes/JIRA-12345-update-telemetry/plan.md",
  "notes": ["plan.md", "schema.json", "transcripts/"]
}
```

The ticket is inferred from the branch. **If the command errors, stop and ask**
which ticket - writing into the wrong ticket's notes is worse than not writing.

## What you are being asked to do

Route on the request, then read the matching reference and follow it:

| Request | Reference |
| --- | --- |
| `Follow the sabin skill: plan <TICKET>` | `references/plan.md` |
| `Follow the sabin skill: implement <TICKET>` | `references/implement.md` |
| `Follow the sabin skill: review <TICKET>` | `references/review.md` |
| `/sabin create`, "write up a task", "turn this into a ticket" | `references/task-create.md` |
| `/sabin plan`, "plan this", "make a plan for the ticket" | `references/plan.md` |
| `/sabin implement`, "do the task", "implement the plan" | `references/implement.md` |
| `/sabin review`, "review the changes" | `references/review.md` |
| `/sabin complete`, `/sabin done`, "mark it complete", "ship it" | `references/complete.md` |
| bare `/sabin` | orient, report the context, ask what to do |

The first three are how `sabin plan`, `sabin implement` and `sabin review`
open a session. That prompt is the whole prompt - deliberately. Everything
about *how* to do the step is in the reference file, so read it and follow it
rather than improvising from three lines.

Plan and implement can be matched loosely. **Completion cannot.** Only the
explicit forms above count as approval to close a task; anything ambiguous
("I think it's done", "the task is complete") - ask, do not close.

## The rules that hold everywhere

**Notes.** `notesDir` is where every durable work product goes: plans,
research, findings, saved output, any format. Read it before starting work;
earlier notes carry decisions you would otherwise re-litigate. Write with
ordinary file tools. `sabin notes new <name>` scaffolds a file and prints its
path.

**One plan per ticket**, at `plan.md` in `notesDir`. Stages are phases inside
that file, never a second file. Re-planning edits it in place.

**Status** changes only through the CLI:

```bash
sabin task update <TICKET> <status>
```

Never edit `status` in frontmatter - it lives in both the frontmatter and the
containing directory, and a direct edit desynchronises them. The command prints
the project's instructions for that status (`hooks/<status>.md`) when there
are any - follow them.

| Status | Meaning | Who sets it |
| --- | --- | --- |
| `open` | Requirements captured | Whoever files it |
| `ready` | Planned, ready to implement | You, once a plan is agreed |
| `in_progress` | Work underway | `sabin implement`, or you |
| `review` | Finished and committed, awaiting the user | **You, when you finish** |
| `completed` | Approved | **Only with the user's approval** |

`review` is your ceiling. When you finish, move the task to `review` and tell
the user it is waiting on them:

> SABIN-0002 is in review. Say `/sabin complete` once you have verified it.

**The prompt scratchpad** is the user's draft space for prompts to you. Never
read, list, or write it. Its path is deliberately absent from `sabin context`
and a permission rule denies reads. If you meet its contents anyway, ignore
them and say so.

**Worktrees** are the user's. `sabin plan`, `sabin implement` and
`sabin review` are theirs to invoke; suggest, do not run.

**Work on a ticket happens in that ticket's worktree.** Those three commands
create it and start you inside it, so a session opened by one is already in
the right place. If you were asked for a step by hand and `worktree` from
`sabin context --json` is not the directory you are in, **stop and say so** -
do not `cd`, do not create it, and do not proceed against whatever branch
happens to be checked out:

> SABIN-0016's worktree is not here. Run `sabin plan SABIN-0016` - it creates
> the worktree and starts the session in it.

Drafting a task needs no worktree: `sabin task create` is for the stage where
the idea is still forming.

## Command reference

| Command | Use |
| --- | --- |
| `sabin context --json` | Orient: ticket, status, branch, worktree, notes, plan |
| `sabin plan <TICKET>` | Put an agent on a ticket to plan it, in its worktree |
| `sabin implement <TICKET>` | Put an agent on a ticket to do the work |
| `sabin review <TICKET>` | Put an agent on a ticket to review its changes |
| `sabin where --notes` / `--plan` | One path, for shell interpolation |
| `sabin task show [id]` | Read a task without knowing its directory |
| `sabin task update <id> <status>` | Change status; prints the project hook |
| `sabin task create "<title>" [-c <body>] [-n <id>]` | Create a task with its notes directory |
| `sabin task list [-s <status>] [--json]` | What else is in flight |
| `sabin notes new <name> [--template plan]` | Scaffold a note and print its path |
