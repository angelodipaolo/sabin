# Review a task's changes

Review the work on a ticket that is in `review` before the user does. Run this
as a subagent when the host supports it, so the review is a fresh read of the
diff rather than the implementer grading its own work.

## Steps

1. **Orient.** `sabin context --json`, then `sabin task show` and the plan in
   `notesDir` if there is one. The task's acceptance criteria are the bar.
2. **Read the diff** of the ticket's branch against its base, in full.
3. **Look for**, in this order: behaviour that does not meet the acceptance
   criteria; correctness bugs with a concrete failing input; missing tests
   for the behaviour that changed; and only then simplifications worth making.
4. **Write the findings** to `notesDir/review.md` - one entry per finding with
   file, line, what fails and how - so they survive the session and the
   implementer can work through them.
5. Report the findings to the user. Do not change the task's status: `review`
   already says what it needs to.

If asked to **address** review feedback instead, read `notesDir/review.md`,
fix each item, tick it off in that file, commit, and report - the task stays
in `review`.
