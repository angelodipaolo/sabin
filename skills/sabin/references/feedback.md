# The feedback file

Review findings for a ticket live in **one file**: `feedback.md` in the
ticket's `notesDir`. One file per ticket, always - every review pass, every
model, and every batch of GitHub comments appends a round to it. That is what
makes "what still needs doing" survive a session boundary and a change of
reviewer.

Scaffold it with:

```bash
sabin notes new feedback --template feedback
```

It prints the path, and is a no-op if the file already exists. `sabin context
--json` reports `feedback` once it does, so an agent orienting knows there is
feedback waiting without listing the notes directory.

This file defines the **format only**. How to review is
`references/review.md`; how to work through findings is
`references/address-feedback.md`.

## The format

````markdown
# Feedback: SABIN-0020

## Round 1 — claude-opus-5 · 2026-08-26

- [ ] **`packages/core/src/tasks.ts:42` — status desyncs if rename fails after the
      frontmatter write**
  If `fs.rename` throws, the file claims `review` while still sitting in `tasks/open/`.
  `withLock` does not roll back.
  *Suggested:* write the frontmatter after the move, or restore the previous frontmatter
  in a catch.

- [x] **`packages/cli/src/index.ts:88` — `--print` documented twice**
  *Suggested:* drop the second `.option()` call.
  *Addressed:* removed the duplicate.

## Round 2 — gh pr #12 · 2026-08-27

- [ ] **`packages/cli/src/iterm.ts:30` — quoting breaks on a branch with a space**
  From a review comment on the PR (comment 2145566771).
  *Suggested:* route it through `shellQuote`.

- [x] **`packages/cli/src/index.ts:44` — `--yolo` deserves a confirmation prompt**
  *Suggested:* prompt unless `--yes` is also passed.
  *Declined:* the whole point of the flag is not being asked; a prompt would
  make it useless in a tab that was opened to run unattended.
````

## The rules

1. **One `##` heading per pass**, `## Round <n> — <source> · <YYYY-MM-DD>`. The
   source is the reviewing model or agent name, or `gh pr #<n>` for a pull from
   GitHub. Get the date from `date +%F` rather than guessing it.
2. **Every finding is a checkbox item.** A reviewer writes `- [ ]` and never
   anything else.
3. **The headline is bold**: a backticked `file:line` where there is one, an
   em-dash, and a one-line claim. That single line is what a later pass scans to
   avoid re-filing.
4. **The body is free-form** - prose, a code block, a stack trace, whatever the
   reviewing model judges useful. Deliberately unconstrained: review in your own
   voice, only the shape around it is fixed.
5. **`*Suggested:*` is required** for anything actionable. A finding without a
   recommended change is an observation, and this file is a worklist.
6. **A closed item carries exactly one of two lines.** `*Addressed:*` - what
   the implementer actually did, in a sentence. `*Declined:*` - the user's call
   not to do it, with their reason. An item stays `- [ ]` only while it is
   genuinely undecided; a disagreement the user has ruled on is closed, not left
   open. Ticking something with an `*Addressed:*` line describing work that was
   deliberately not done is a lie in the one file meant to be the record.

   No commit SHA in the normal case - nothing is committed until
   `/sabin complete`, so there is none to give. On a ticket whose PR is already
   open, where each round is committed and pushed
   (`references/address-feedback.md`), record the SHA: the reader is on the pull
   request and that is how they find the fix.
7. **Append-only.** Never delete an item, never rewrite wording that is already
   in the file - including your own `*Addressed:*` or `*Declined:*` lines from an
   earlier round - and never un-tick. A closing line that later turns out wrong
   or incomplete is corrected by *appending* beneath it (`*Correction:*`, or
   `*Resolved in Round <n>:*`), never by replacing it. A later round that finds a
   ticked item still broken files a *new* item that says so and points at the old
   one. The file has to support the findings it records, and a later pass trusts
   what is written here rather than re-deriving it (rule 8) - text that quietly
   disappeared takes both of those with it.
8. **Read before writing.** A new round skips anything already filed, open or
   ticked, unless it has something genuinely new to add.
9. **A clean pass still writes its round**, with a one-line `No findings.` - so
   "reviewed, nothing wrong" is distinguishable from "never reviewed".

## Pulling comments from GitHub

Only when the user asks for it. Never as part of a review pass, never as part
of completing.

```bash
gh pr view --json number,url,comments,reviews                # conversation + review bodies
gh api repos/{owner}/{repo}/pulls/<number>/comments          # inline review threads
gh api repos/{owner}/{repo}/pulls/<number>/reviews           # the same review bodies, with ids
```

Three different things live on a pull request, and the obvious pair -
`--json comments` and `/pulls/<n>/comments` - misses one of them:

- **`comments`** - the PR-level conversation.
- **`reviews`** - the body someone types into the box when they submit
  **Request changes** or **Approve**. GitHub keeps this separate from
  `comments`, and on most PRs it is where the substantive "here is what is
  wrong" lives while the inline threads carry only line-level nits. Miss it and
  you will write a round saying there was nothing actionable while the real
  feedback sits unread.
- **inline threads** - `/pulls/<n>/comments`, which carry `path` and `line`.

The inline threads' `path` and `line` become the item headline. The other two
usually have none, so lead with the claim instead.

- Each pull is **one round**, sourced `gh pr #<n>`.
- Record each comment's id in the item body, so a later pull can skip what is
  already in the file.
- Comments that are not actionable - approvals, "nice", a question already
  answered - are not findings. Say so in the round rather than filing them. A
  review with `state: APPROVED` and an empty body is the same case.
