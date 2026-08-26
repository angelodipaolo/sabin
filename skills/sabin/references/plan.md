# Plan a task

Write the implementation plan that later sessions - yours or another agent's -
will execute from. It is the source of truth for a task that outlives one
conversation.

## Steps

1. **Orient.** `sabin context --json`. If it errors, ask which ticket.
2. **Read what exists.** `sabin task show`, then everything in `notesDir`.
   If `plan.md` already exists you are **revising**, not starting over: keep
   its decisions unless the user changed them.
3. **Research the codebase** before writing. Read the files the work will
   touch and cite them as `path/to/file.ts:42`.
4. **Write `plan.md`** in the notes directory:

   ```bash
   sabin notes new plan --template plan     # prints the path; no-op if it exists
   ```

5. **Mark the task ready:**

   ```bash
   sabin task update <TICKET> ready
   ```

6. Report the plan path and any open decisions.

## Plan structure

- **Overview** - what we are building and why
- **Current state** - what exists now, with file references
- **Desired end state** - what success looks like, observably
- **What we're NOT doing** - scope boundaries, stated explicitly
- **Implementation phases** - each with the files to change, the specific
  changes, and success criteria as `- [ ]` checkboxes the implementer ticks
- **Open decisions** - anything that needs the user's call, flagged rather
  than silently decided

A plan is one file. Work that runs in stages is phases inside it.
