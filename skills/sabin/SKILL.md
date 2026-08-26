---
name: sabin
description: Use when working in a repository managed by Sabin - any repo containing a .sabin directory or .sabin link file. Resolves where the current ticket's notes live so you can read context and save plans, research, and docs without being told paths. Triggers on "our notes", "save this to notes", "read the plan", "the ticket", and on any task, plan, or status change in a Sabin project.
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
| `/sabin create`, "write up a task", "turn this into a ticket" | `references/task-create.md` |
| `/sabin plan`, "plan this", "make a plan for the ticket" | `references/plan.md` |
| `/sabin implement`, `/sabin start`, "do the task", "implement the plan" | `references/implement.md` |
| `/sabin review`, "review the changes" | `references/review.md` |
| `/sabin complete`, `/sabin done`, "mark it complete", "ship it" | `references/complete.md` |
| bare `/sabin` | orient, report the context, ask what to do |

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
| `ready` | Planned, ready to implement | You, once a plan exists |
| `in_progress` | Work underway | `sabin start` / `sabin run`, or you |
| `review` | Finished and committed, awaiting the user | **You, when you finish** |
| `completed` | Approved | **Only with the user's approval** |

`review` is your ceiling. When you finish, move the task to `review` and tell
the user it is waiting on them:

> SABIN-0002 is in review. Say `/sabin complete` once you have verified it.

**The prompt scratchpad** is the user's draft space for prompts to you. Never
read, list, or write it. Its path is deliberately absent from `sabin context`
and a permission rule denies reads. If you meet its contents anyway, ignore
them and say so.

**Worktrees** are the user's. `sabin start` and `sabin run` are theirs to
invoke; suggest, do not run.

## Command reference

| Command | Use |
| --- | --- |
| `sabin context --json` | Orient: ticket, status, branch, worktree, notes, plan |
| `sabin where --notes` / `--plan` | One path, for shell interpolation |
| `sabin task show [id]` | Read a task without knowing its directory |
| `sabin task update <id> <status>` | Change status; prints the project hook |
| `sabin task create "<title>" [-c <body>] [-n <id>]` | Create a task with its notes directory |
| `sabin task list [-s <status>] [--json]` | What else is in flight |
| `sabin notes new <name> [--template plan]` | Scaffold a note and print its path |
