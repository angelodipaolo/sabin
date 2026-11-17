# Plan a task

Work the problem through *with* the user, then write down what you agreed.

The plan outlives the conversation. It must carry decisions the user made, not
decisions you made plausibly on their behalf. A plan written without talking to
them is a guess, and its first reader will be an agent that believes it.

**This step is a conversation.** Do not hand back a finished plan on your first
turn.

## Steps

1. **Orient.** `sabin context --json` (or `sabin context <ID> --json`). If it
   errors, ask which task.
2. **Read what exists**: `taskFile`, then every note in `taskDir`, and the end
   of `log.md` if there is one. If `plan` is not null you are **revising**:
   keep its decisions unless the user changes them.
3. **Read the code** the work will touch, in every repo the task spans. A plan
   that cites `path/to/file.ts:42` is one the implementer can check.
4. **Talk it through.** This is the step, not a preamble to it:
   - Ask about what the task leaves ambiguous. A few sharp questions beat a
     long list of shallow ones.
   - Name the cases the task does not mention: the empty one, the concurrent
     one, the one already on disk.
   - Propose an approach, and say what you would *not* do, and why.
   - When a choice is the user's, put it to them.
   If the user says "just write it", write it, and state your assumptions.
5. **Write `plan.md`** in `taskDir` once there is something agreed.
6. **Mark the task ready:** `sabin status <ID> ready`, and follow any hook it
   prints.
7. Report the plan path and any decisions still open.

## Plan structure

- **Overview** - what and why
- **Current state** - what exists now, with file references
- **Desired end state** - what success looks like, observably
- **Not doing** - scope boundaries, and what was considered and dropped, so it
  is not proposed again
- **Phases** - per phase: the repo and files to change, the changes, and
  success criteria as `- [ ]` checkboxes the implementer ticks
- **Open decisions** - anything that needs the user's call

A task with worktrees in several repos still has one plan. Say which repo each
phase touches.
