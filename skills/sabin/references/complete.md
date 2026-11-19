# Complete a task

Close out work the user has approved.

**Only on explicit approval**: "complete it", "ship it", "mark it done",
"merge it". "Looks done" is a reason to ask, not to close. This is where the
work gets committed, so it is the one step that is awkward to undo.

## Steps

1. **Orient.** `sabin context --json`. If `id` is null, ask which task. The
   task should be in `review`; if it is not, say so and ask.
2. **Check for open findings.** Any `- [ ]` in `review.md`, or any thread from
   `rede threads --pending`, stops this step. Report them and ask. If the
   user says to complete anyway, say in your report what was left open.
3. **Commit, in every workspace with changes** (`workspaces` in the context).
   One commit per repo, task ID in the message. Stage explicitly - files
   created during the work are untracked, and `git commit -am` would leave
   them out:

   ```bash
   git status --porcelain
   git add -A          # or file by file, if some of the tree is not this task's
   git commit -m "<ID>: <summary>"
   ```

4. **Mark it complete**, from inside a workspace so the repo's own hook
   applies:

   ```bash
   sabin status completed
   ```

5. **Follow the hook, and only the hook.** Pushing, opening a pull request,
   notifying anyone: none of it happens unless the printed hook says so. No
   hook means the work is finished at the commit.
6. **Leave the worktrees and the task directory alone.** The worktrees are the
   user's to remove; the task directory is the record.
7. Report the commits, the status change, and what the hook had you do.
