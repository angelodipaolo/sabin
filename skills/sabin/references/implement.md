# Implement a task

Do the work, from the plan when there is one, else from the requirements.

## Start

1. **Orient.** `sabin context --json`. If it errors, ask which task.
2. **Check where you are.** `workspace` must not be null: code changes happen
   in one of the task's worktrees. If it is null, stop and say so. Do not `cd`
   and do not create a worktree unless the user asks (`sabin work <ID>`).
3. **Read** `taskFile`, the plan, the notes, the end of `log.md` (the last
   session's *Next*), and `review.md` if there is one.
4. If the status is `open` or `ready`: `sabin status in_progress`. Never write
   it over `review` - addressing findings happens *in* review.

## With a plan

`plan.md` is the state of the work. `- [x]` is done; start at the first
`- [ ]`. Read every file the current phase names, in full. Implement the whole
phase, then verify it against its success criteria - build, tests, typecheck,
lint, and a check that the behaviour is really right. Tick the boxes as they
pass; a ticked plan is the resume point.

**When the plan and reality disagree, stop:**

```
Phase N mismatch
Plan says:  ...
Found:      ...
Impact:     ...
Options:    1. ...  2. ...
Recommend:  ...
```

Wait for the user before continuing.

## Without a plan

Follow the requirements. Read the code the change touches first, keep the
change focused, verify the same way. If the requirements are unclear, ask.

## Several repos

A task may have a worktree in more than one repo (`workspaces` in the context).
You work in the one you are standing in. If the plan needs a change in another
repo, say so; the user decides whether that is this session's job.

## Finish

1. Run the full verification once more.
2. **Do not commit.** The worktree stays dirty so the review reads the real
   working state. `references/complete.md` makes the commit.
3. **Write the handoff**: append an entry to `log.md` (`references/handoff.md`).
4. `sabin status review`, and follow any hook it prints.
5. Tell the user it is waiting on them, and that nothing is committed:

   > TASK-0002 is in review - nothing is committed yet. The handoff is in
   > log.md. Start a fresh session for a review, or say "complete it".

You never move a task to `completed` on your own.
