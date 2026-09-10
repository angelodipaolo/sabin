# Review a task's changes

Review the work on a ticket that is in `review`, before it is committed. This
is meant to be a fresh session - `sabin review <TICKET>` opens one in the
ticket's worktree - so the reviewer is reading the work rather than grading its
own.

The work is **uncommitted**. A dirty worktree is the normal state for a ticket
in `review`; nothing is committed until `/sabin complete`.

## Steps

1. **Orient.** `sabin context --json`, then `sabin task show`, the plan in
   `notesDir` if there is one, and **any rounds already in `feedback.md`**. The
   plan's acceptance criteria are the bar; the existing rounds are what not to
   re-file.
2. **Read the uncommitted work first:**

   ```bash
   git status --porcelain
   git diff
   git diff --cached
   ```

   Read untracked files in full - they will not show in a diff. Then read any
   commits already on the branch against its base, for the rest of the picture.
3. **Look for**, in this order: behaviour that does not meet the acceptance
   criteria; correctness bugs with a concrete failing input; missing tests
   for the behaviour that changed; and only then simplifications worth making.
4. **Write the findings** as a new round in `notesDir/feedback.md`, following
   `references/feedback.md` - that file is the format, and this one does not
   restate it. Never tick a box and never edit an item from an earlier round;
   a finding that an earlier item is still broken is a new item pointing at the
   old one. A pass that finds nothing still writes its round, with
   `No findings.`
5. Report the findings to the user, and point at the next step:

   > Round 2 written to feedback.md - 3 open items. `/sabin address feedback`
   > to work through them.

   Do not change the task's status: `review` already says what it needs to. Do
   not fix anything yourself, and do not commit.
