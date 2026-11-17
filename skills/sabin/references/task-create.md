# Create a task

Turn a rough ask into a task worth handing to an implementer. The input is
whatever the user gave you: a sentence, a bug report, a feature idea.

## 1. Expand the requirements

**Requirements** - specific about what it should do:
- Use cases, and the behaviour each one needs
- Constraints that matter here (performance, security, accessibility)
- Edge cases and error handling
- UI considerations, if any

**Acceptance criteria** - clear and testable:
- Expected behaviour and outputs
- Scenarios that must pass
- An explicit definition of done

Read the code where it changes what you would write. Do not pad: a task that
fits on one screen gets read.

## 2. Create it

```bash
sabin new "<title>" -c "<requirements and acceptance criteria>" --json
```

- An external ticket keeps its ID: `--id ARCH-1234`.
- A task that belongs to a project: `--project <slug>`. `sabin ls --json`
  shows the projects already in use; ask before inventing a new one.

The JSON gives `id` and `taskDir`. Research that informed the task can go
straight into `taskDir` as its own note.

## 3. Hand it back

Report the ID and `taskDir`. Do **not** create a worktree or change the status:
the user decides when work starts. `sabin work <ID>` is theirs to run, or yours
only when they ask.
