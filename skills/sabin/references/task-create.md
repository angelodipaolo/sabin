# Create a task

Turn a rough ask into a task worth handing to an implementer. The input is
whatever the user gave you - a sentence, a bug report, a feature idea.

## 1. Expand the requirements

**Requirements** - be specific about what it should do:
- User stories or use cases
- Functional behaviour, and the non-functional constraints that matter here
  (performance, security, accessibility)
- Edge cases and error handling
- UI/UX considerations, if any

**Acceptance criteria** - clear and testable:
- Expected behaviour and outputs
- Scenarios that must pass
- An explicit definition of done

Read the codebase where it changes what you would write. Do not pad: a task
that fits on one screen gets read.

## 2. Create it

```bash
sabin task create "<title>" -c "<requirements and acceptance criteria>"
```

For an external ticket, keep its ID:

```bash
sabin task create "<title>" -n JIRA-12345 -c "<...>"
```

The command creates the notes directory alongside the task and prints the ID
last. Research that informed the task can go straight into that directory.

## 3. Hand it back

Report the ID and the notes path. Do **not** start work, create a worktree, or
change status - the user decides when a task begins.
