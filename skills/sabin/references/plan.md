# Plan a task

Work the problem through *with* the user, then write down what you agreed.

The plan is the source of truth for a task that outlives one conversation - so
it has to carry decisions the user actually made, not decisions you made
plausibly on their behalf. A plan produced without talking to them is a guess
with a file extension, and its first reader will be an agent that believes it.

**This step is a conversation.** Do not read the task and hand back a finished
plan on your first turn. That is the failure mode this step exists to prevent.

## Steps

1. **Orient.** `sabin context --json`. If it errors, ask which ticket.
2. **Read what exists.** `sabin task show`, then everything in `notesDir`.
   If `plan.md` already exists you are **revising**, not starting over: keep
   its decisions unless the user changed them.
3. **Research the codebase** before proposing anything. Read the files the
   work will touch. You cannot ask a good question about code you have not
   read, and a plan that cites `path/to/file.ts:42` is one the implementer can
   check.
4. **Talk it through.** This is the step, not a preamble to it:
   - Ask about anything the task leaves ambiguous. Prefer a few sharp
     questions to a long list of shallow ones.
   - Name the cases the task does not mention - the empty one, the concurrent
     one, the one that already exists on disk.
   - Propose an approach and say what you would *not* do, and why.
   - When a choice is genuinely the user's, put it to them rather than
     picking and mentioning it in passing.
   Keep going until the shape is settled. If the user says "just write it",
   write it - but say what you are assuming.
5. **Write `plan.md`** once, when there is something agreed to write:

   ```bash
   sabin notes new plan --template plan     # prints the path; no-op if it exists
   ```

6. **Mark the task ready:**

   ```bash
   sabin task update <TICKET> ready
   ```

7. Report the plan path and any decisions still open.

## Plan structure

- **Overview** - what we are building and why
- **Current state** - what exists now, with file references
- **Desired end state** - what success looks like, observably
- **What we're NOT doing** - scope boundaries, stated explicitly. Record what
  was considered and dropped, and why, so it is not re-proposed later.
- **Implementation phases** - each with the files to change, the specific
  changes, and success criteria as `- [ ]` checkboxes the implementer ticks
- **Open decisions** - anything that needs the user's call, flagged rather
  than silently decided

A plan is one file. Work that runs in stages is phases inside it.
