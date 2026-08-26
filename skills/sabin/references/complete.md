# Complete a task

Close out work the user has approved.

**This runs only on explicit approval**: `/sabin complete`, `/sabin done`,
"mark it complete", "ship it", "merge it". Anything less - "looks like it's
done", "I think we're finished" - is a prompt to **ask**, not to close.
Completion moves the task file between directories and gets committed, so it
is the one step that is awkward to undo.

## Steps

1. **Orient.** `sabin context --json`. The task should be in `review`; if it
   is not, say so and ask before going on.
2. **Make sure the work is committed.** Nothing uncommitted in the worktree
   that belongs to this ticket.
3. **Mark it complete:**

   ```bash
   sabin task update <TICKET> completed
   ```

   This moves the file to `tasks/completed/` and prints the project's
   completion instructions if it has any (`hooks/completed.md`) - typically
   "push the branch and open a PR". **Follow them.**

4. If the Sabin directory is tracked in this repo (it usually is not), commit
   the moved task file too, with the ticket ID in the message.
5. **Leave the worktree and the notes in place.** The notes are the record of
   how the work was done; the worktree is the user's to remove.
6. Report what happened: the status change, the commit, and whatever the hook
   had you do (a PR URL, for instance).
