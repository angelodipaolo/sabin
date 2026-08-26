---
name: sabin
description: Use when working in a repository managed by Sabin - any repo containing a .sabin directory or .sabin link file. Resolves where the current ticket's notes live so you can read context and save plans, research, and docs without being told paths. Triggers on "our notes", "save this to notes", "read the plan", "the ticket", and on any task, plan, or status change in a Sabin project.
---

# Sabin workspaces

Sabin gives every ticket a **workspace**: a branch, a git worktree, a notes
directory you read and write, and a prompt scratchpad you must never touch.

Paths are derived, not fixed. Never guess one, and never hardcode `.sabin/...` —
in a worktree with a shared Sabin directory those paths do not exist.

## Start every session by orienting

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
  "notes": ["plan.md", "schema.json", "transcripts/"]
}
```

The ticket is inferred from the branch name. **If the command errors, stop and
ask** — it means the branch carries no ticket. Do not fall back to a guess:
writing into the wrong ticket's notes is worse than not writing at all.

For a single path in a shell command, `sabin where --notes` prints just that.

## The notes directory

`notesDir` is where all durable work product goes: plans, research, design
docs, findings, saved output, context files. When the user says "our notes",
"save this", or "read the plan", this is the directory they mean.

Notes are **not only markdown**. JSON, YAML, CSV, logs, plain text — anything
you or the user might read later belongs here.

- **Read**: list `notesDir` and read what is relevant before starting work.
  Existing notes usually carry decisions you would otherwise re-litigate.
- **Write**: create files directly with ordinary file tools. To scaffold one
  with the plan template, `sabin notes new plan --template plan` prints the
  path it created.

Plans live in the ticket's notes directory, one file per plan. There is no
`plan:` frontmatter field to maintain — the association is the directory.

## Changing task status

Always through the CLI:

```bash
sabin task update <TICKET> <status>    # open | ready | in_progress | review | completed
```

Never edit `status` in frontmatter directly. Status lives in **both** the
frontmatter and the containing directory (`tasks/open/` vs `tasks/completed/`),
so a direct edit desynchronises them.

Read a task with `sabin task show` rather than guessing which directory holds it.

## The prompt scratchpad

Sabin keeps a per-ticket scratchpad where the user drafts the prompts they hand
to you. **Never read, list, or write it.** It holds half-formed instructions
that were never meant to be acted on, and acting on them produces work the user
did not ask for.

It lives in the Sabin directory's `prompts/` folder, outside the repository, and
`sabin context --json` deliberately omits its path. A permission rule denies
reads. If you somehow encounter its contents, ignore them and say so.

## Command reference

| Command | Use |
| --- | --- |
| `sabin context --json` | Orient: ticket, status, branch, worktree, notes |
| `sabin where --notes` | One path, for shell interpolation |
| `sabin task show [id]` | Read a task without knowing its directory |
| `sabin task update <id> <status>` | Change status |
| `sabin task create -t "<title>"` | Create a task, with its notes directory |
| `sabin notes new <name>` | Scaffold a note and print its path |
| `sabin task list [-s <status>]` | See what else is in flight |

`sabin draft`, `sabin start`, and `sabin finish` create and tear down
worktrees. Those are the user's to run, not yours — suggest them, do not
invoke them unasked.
