# Review a task, and address the findings

Two halves of one loop. A **review pass** reads the work and records findings.
**Addressing** works through them. Ideally a fresh session reviews, so the
reviewer reads the work instead of grading its own.

The work is **uncommitted** while a task is in `review`. A dirty worktree is
normal.

## Where findings go

- **`margin` on PATH** (`command -v margin`): findings are Margin threads.
  Run `margin guide` once and follow it. Record each finding with
  `margin comment <path>[:<line>[-<end>]] -m "<finding>"`. Margin shows the
  threads beside the diff; the user answers there.
- **Otherwise**: `review.md` in `taskDir`, in the format below.

Use one or the other for a task, not both. If `review.md` already exists, keep
using it.

## Review pass

1. **Orient.** `sabin context --json`. Read `taskFile`, the plan (its success
   criteria are the bar), the end of `log.md`, and every existing finding
   (`review.md`, or `margin threads --all`). Do not file a finding twice.
2. **Read the uncommitted work**, in each workspace of the task:

   ```bash
   git status --porcelain
   git diff
   git diff --cached
   ```

   Read untracked files in full; they do not show in a diff. Then read any
   commits on the branch against its base.
3. **Look for**, in this order: behaviour that misses the acceptance criteria;
   correctness bugs with a concrete failing input; missing tests for changed
   behaviour; only then simplifications.
4. **Record the findings.** A clean pass still records itself (`No findings.`),
   so "reviewed, nothing wrong" differs from "never reviewed".
5. Report them, and point at the next step. Do not fix anything, do not
   commit, and do not change the status.

## review.md format

````markdown
# Review: TASK-0020

## Round 1 — claude-opus · 2026-11-16

- [ ] **`packages/core/src/tasks.ts:42` — status write is not atomic**
  If the rename throws, the file is left half-written.
  *Suggested:* write to a temp file and rename.

- [x] **`packages/cli/src/index.ts:88` — `--print` documented twice**
  *Suggested:* drop the second `.option()`.
  *Addressed:* removed the duplicate.
````

1. One `##` heading per pass: `## Round <n> — <reviewer> · <YYYY-MM-DD>`. Get
   the date from `date +%F`.
2. Every finding is a `- [ ]` item. Its headline is bold: a backticked
   `file:line` when there is one, an em-dash, a one-line claim.
3. The body is free-form. `*Suggested:*` is required for anything actionable.
4. **Append-only.** Never delete an item, never rewrite one, never un-tick.
   A ticked item that is still broken gets a *new* item pointing at the old
   one. A closing line that turns out wrong is corrected by appending
   `*Correction:*` beneath it.

## Addressing findings

1. Read **every** open finding: all rounds of `review.md`, or
   `margin threads --pending`.
2. Work them oldest first. For each: make the change, verify it (build, tests,
   lint, typecheck, behaviour), then close it:
   - `review.md`: tick it and add `*Addressed:*` with what you did.
   - Margin: `margin reply <id> -m "<what you did>" --resolve`.
   Close only what is verified.
3. **Disagree in writing.** Leave the item open and say why in it (or in a
   Margin reply). Once the user decides, close it: `*Declined:*` with their
   reason, never `*Addressed:*`. An item stays open only while it is truly
   undecided - completion reads an open item as work nobody did.
4. Do not commit and do not change the status. The exception: the task's pull
   request is already open (the `completed` hook pushed it). The branch is
   public then, so commit and push each round, and record the SHA in the
   `*Addressed:*` line.
5. Append a handoff entry to `log.md` (`references/handoff.md`) and report
   what was addressed and what is still open.

## Comments from a GitHub pull request

Only when the user asks. Each pull is one round, sourced `gh pr #<n>`:

```bash
gh pr view --json number,url,comments,reviews                 # conversation and review bodies
gh api repos/{owner}/{repo}/pulls/<number>/comments           # inline threads, with path and line
```

Review bodies (`reviews`) often hold the real feedback; do not skip them.
Record each comment's id in the item body so a later pull can skip it.
Approvals and "nice" are not findings.
