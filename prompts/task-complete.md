Resolve completed work.

The user has verified the changes and is ready to commit.

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

4. **Leave the notes.** They are the record of how the work was done and stay
   after the task closes.

If the user also wants the worktree torn down, that is `sabin finish <TICKET>`
— suggest it rather than running it, since it removes a checkout they may still
have open.
