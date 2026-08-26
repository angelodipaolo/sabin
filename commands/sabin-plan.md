---
description: Create an implementation plan for a task
---

Create an implementation plan for a task.

## Steps

1. **Orient.** Run `sabin context --json` to get the ticket, its task file, and
   its notes directory. If it errors, stop and ask which ticket to plan — do not
   guess a path.

2. **Read what exists.** Read the task file (`sabin task show`), then list and
   read the notes directory. Earlier notes usually carry decisions and context
   you would otherwise re-derive.

3. **Research the codebase** before writing anything. Read the files the work
   will touch, and cite them as `path/to/file.ts:42` in the plan.

4. **Write the plan** into the ticket's notes directory, at `plan.md`:

```bash
sabin notes new plan --template plan     # prints the path it created
```

   A ticket has exactly one plan. Work that runs in stages becomes phases
   inside that one file — never a second plan file. There is no frontmatter
   field to maintain; the association is the directory plus the fixed name.

   **Re-planning revises `plan.md` in place.** Read what is there and edit it,
   rather than regenerating from scratch — the existing plan usually carries
   decisions and constraints that are cheaper to keep than to rediscover.

5. **Mark the task ready** once the plan is complete:

```bash
sabin task update <TICKET> ready
```

## Plan Structure

- **Overview**: what we're building
- **Current State**: what exists now, with file references
- **Desired End State**: what success looks like
- **What We're NOT Doing**: scope boundaries, stated explicitly
- **Implementation Phases**: each with files to change, specific changes, and
  success criteria
- **Open Decisions**: anything that needs the user's call, flagged rather than
  silently decided

## Rules

- Never hardcode `.sabin/...` paths. In a worktree with a shared Sabin
  directory they do not exist — resolve every path through the CLI.
- Never read the prompts directory.
- Change status with `sabin task update`, never by editing frontmatter.
