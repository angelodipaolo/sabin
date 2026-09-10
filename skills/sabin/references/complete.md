# Complete a task

Close out work the user has approved.

**This runs only on explicit approval**: `/sabin complete`, `/sabin done`,
"mark it complete", "ship it", "merge it". Anything less - "looks like it's
done", "I think we're finished" - is a prompt to **ask**, not to close.
Completion is where the work gets committed and the task file moves between
directories, so it is the one step that is awkward to undo.

## Steps

1. **Orient.** `sabin context --json`. The task should be in `review`; if it
   is not, say so and ask before going on.
2. **Read `feedback.md` if there is one.** Any open `- [ ]` item stops this
   step: report the open items and ask, rather than closing over feedback that
   was never addressed. If the user says to complete anyway, say in the report
   what was left open.
3. **Commit the work** - one commit, ticket ID in the message. This is the
   only commit in the workflow: `implement` and `address feedback` deliberately
   leave the worktree dirty so a reviewer reads the working state.

   **Stage explicitly**, and look before you do:

   ```bash
   git status --porcelain
   git add -A          # or file by file, if some of the tree is not this ticket's
   git commit -m "<TICKET>: ..."
   ```

   Nothing was committed earlier in this workflow, so files created during the
   work are still untracked and are the normal case here - `git commit -am`
   would silently leave every one of them out.
4. **Mark it complete:**

   ```bash
   sabin task update <TICKET> completed
   ```

   This moves the file to `tasks/completed/` and prints the project's
   completion instructions if it has any (`hooks/completed.md`).
5. **Follow the hook, and do only what it says.** A project with no
   `completed.md` is finished at the commit. Pushing the branch, opening a pull
   request, notifying anyone - none of that happens unless a hook asked for it.
6. If the Sabin directory is tracked in this repo (it usually is not), commit
   the moved task file too, with the ticket ID in the message.
7. **Leave the worktree and the notes in place.** The notes are the record of
   how the work was done; the worktree is the user's to remove.
8. Report what happened: the commit, the status change, and whatever the hook
   had you do.
