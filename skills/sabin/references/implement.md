# Implement a task

Execute a task from its plan, or directly from its requirements when it has
no plan.

## Getting started

1. **Orient.** `sabin context --json`. If it errors, ask which ticket.
2. **Read the task:** `sabin task show`.
3. **Read the notes.** Everything in `notesDir`, plan first if there is one.
4. If the status is behind `in_progress` (`open` or `ready`):
   `sabin task update <TICKET> in_progress`. Never write it over `review` -
   addressing feedback is implementation work that happens *in* `review`, and
   walking the task back would claim nobody had reviewed it.

## With a plan

`plan.md` is the state of the work. Trust its checkmarks: `- [x]` is done,
start from the first `- [ ]`. Read every file the current phase references,
in full.

For each phase: read, implement the whole phase, then verify against its
success criteria - build, tests, typecheck, lint, and a manual check that the
feature actually behaves. Tick the boxes as they pass. A ticked plan is the
resume point if the session ends.

**When the plan and reality disagree, stop:**

```
Phase N mismatch
Plan says:  ...
Found:      ...
Impact:     ...
Options:    1. ...  2. ...
Recommend:  ...
```

Wait for the user before continuing. Common causes: files moved since the
plan was written, a dependency changed, the functionality already exists in
another form.

## Without a plan

Follow the task's requirements directly. Research the code the change touches
first, keep the change focused on the task, and verify the same way. If the
requirements are unclear, ask rather than guess.

## Along the way

Durable work product - findings, design decisions, saved output, research -
goes in `notesDir`, in whatever format suits it. `sabin notes new <name>`
scaffolds a file and prints its path.

## Finishing

1. Run the full verification once more.
2. **Do not commit.** The worktree is left dirty on purpose, so the reviewer
   reads the actual working state rather than a diff of something already
   sealed. `/sabin complete` makes the one commit, at the end.
3. `sabin task update <TICKET> review` - and follow anything it prints.
4. Tell the user, naming the next step and the fact that nothing is committed:

   > SABIN-0002 is in review - nothing is committed yet. Run
   > `sabin review SABIN-0002` for a fresh read, then `/sabin complete` once
   > you are happy.

You do not move a task to `completed`. That is the user's call.
