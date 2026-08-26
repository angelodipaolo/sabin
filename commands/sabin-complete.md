---
description: Complete and commit a task
---

Resolve completed work.

**Only run this when the user has approved the work.** Finishing a task and
verifying it are different steps: you move a task to `review`, the user moves
it to `completed`. Your own tests passing is not approval.

## Steps

1. **Orient.** `sabin context --json` gives the ticket, its task file, and its
   notes directory.

2. **Mark it complete:**

```bash
sabin task update <TICKET> completed
```

   This moves the task file from `tasks/open/` to `tasks/completed/`. Never
   edit the status in frontmatter — status lives in both the frontmatter and
   the containing directory, so a direct edit desynchronises them.

3. **Commit**, including the task number in the message. Include the moved task
   file if it is tracked in this repository. When the Sabin directory is shared
   and lives outside the repo, it is not part of the commit.

4. **Commit the move.** A completed task whose file move is left uncommitted
   reads as unfinished to everyone else.

5. **Leave the notes.** They are the record of how the work was done and stay
   after the task closes.

If the user also wants the worktree torn down, that is `sabin finish <TICKET>`
— suggest it rather than running it, since it removes a checkout they may still
have open.
