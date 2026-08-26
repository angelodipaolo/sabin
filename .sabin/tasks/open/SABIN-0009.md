---
status: review
title: Rewrite workflow prompts and skill to use the CLI
plan: .sabin/plans/SABIN-0002-task-workspaces.md
---
## Problem

The installed workflow prompts don't use the Sabin CLI for file access at all. `commands/sabin-plan.md` tells the agent to run `cat .sabin/tasks/open/TASK-XXXX.md`, write to `.sabin/plans/`, and hand-edit a `plan:` field into frontmatter. These are hardcoded repo-relative paths, so the workflow breaks in a worktree with a shared `.sabin` — which is why paths get pasted by hand today. Hand-editing frontmatter is also unsafe: status lives in both the frontmatter and the containing directory, so a direct edit silently desynchronises them.

## Scope

**Phase 3** of the plan.

- Rewrite all six `commands/*.md` and `prompts/*.md` to call the CLI instead of hardcoding `.sabin/` paths
- Add the agent-contract skill
- Have `sabin init` write a `permissions.deny` rule for the prompts directory

### The agent contract

Four rules, short enough to be followed reliably:

1. Run `sabin context --json` at session start. If it errors, stop and ask — never guess paths.
2. Write every artifact under the returned `notesDir`.
3. Change status with `sabin task update`, never by editing frontmatter.
4. Never read or write the prompts directory.

Rule 4 is enforced rather than requested — the prompts directory sits outside the repo tree, plus the deny rule. Rule 2 dies quietly if `sabin context` output is verbose, so the JSON must stay small and flat rather than dumping every file.

## Blocked on

**Open Decision 1: do plans fold into `notes/<TICKET>/`?** This ticket can't be written until that's settled, because the plan prompt's target directory depends on it.

If plans fold in, multiple plans per task becomes multiple files in a directory — which dissolves SABIN-0004 and makes SABIN-0005 unnecessary, since the association becomes the directory rather than a frontmatter pointer. `.sabin/research/` would stay for genuinely cross-cutting documents. The cost is that SABIN-0005 is currently in `review`, so some work may be undone, and plans stop being listable in one flat directory.

## Dependencies

SABIN-0002 — the prompts call `sabin context` / `sabin where`, which don't exist yet.

## Success criteria

- No prompt contains a hardcoded `.sabin/` path
- An agent started in a fresh worktree finds its notes directory without being told
- The prompts directory is unreadable to the agent
- No prompt instructs the agent to edit task frontmatter directly
