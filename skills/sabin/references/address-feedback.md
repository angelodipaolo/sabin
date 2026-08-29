# Address review feedback

Work through the open items in a ticket's `feedback.md`. This usually runs in
the session that did the implementing, in the ticket's worktree.

**There is no CLI verb for this step.** `sabin implement <TICKET>` is not it -
that hands the agent the implement prompt, which starts from the plan and never
opens the feedback file. To resume in a fresh session: the worktree is almost
always still there, so open it and say "address the feedback". If it is gone,
`sabin implement <TICKET> --no-launch` rebuilds it and starts nothing. Do not
use `sabin review <TICKET>` for this - it runs a full review pass and appends a
round before you get a word in.

## Steps

1. **Orient.** `sabin context --json`. `feedback` in the JSON is the file; if
   it is `null` there is nothing to address - say so rather than inventing
   work.
2. **Read `feedback.md` in full**, every round. An item ticked in round 1 can
   be re-opened as a new item in round 3, so the whole file is the worklist,
   not just the last heading.
3. If you were asked to **pull GitHub comments** first, follow the `gh` section
   of `references/feedback.md` and add that round before starting on anything.
4. **Work the open `- [ ]` items, oldest round first.** For each one:
   - make the change,
   - verify it - build, tests, lint, typecheck, and a check that the behaviour
     is actually right,
   - then tick the box and add an `*Addressed:*` line saying what was done.

   Tick only what is verified. A half-done item stays open.
5. **An item you disagree with is not silently skipped.** Leave it open and
   write why in its body, so the disagreement is in the file rather than only
   in a transcript. The user decides - and once they have, **close it**: tick it
   and add `*Declined:*` with their reason, never `*Addressed:*`. An item stays
   `- [ ]` only while the question is still live. `/sabin complete` reads an open
   box as work nobody did, so a settled disagreement left open blocks every
   future completion, and a later reviewer cannot tell it from a real one.
6. **Do not commit.** Nothing is committed until `/sabin complete`.

   **One exception, and it is the PR case.** If this ticket's pull request is
   already open - it was completed, the hook pushed and opened it, and these
   findings came down from it with `gh` - then Sabin's one commit has already
   happened and the branch is public. Ordinary PR etiquette applies from there:
   commit and push each round, so the reviewer can see the fix. The
   commit-nothing rule exists to keep an *unreviewed* worktree readable, and
   there is no such worktree once the PR exists.
7. **Never change the status.** A ticket in `review` stays in `review`;
   addressing feedback never walks it back to `in_progress`, and a ticket whose
   PR is open is already `completed` and stays there.
8. Report what was addressed and what is still open, and suggest another pass
   before completing:

   > 3 of 4 addressed; 1 left open (disagreed - see the note). Run
   > `sabin review SABIN-0020` for another pass, then `/sabin complete`.
