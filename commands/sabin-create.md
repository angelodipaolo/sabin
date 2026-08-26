---
description: Create a detailed task from high-level requirements
---

Create a detailed task from high-level requirements.

Expand the requirements given in $ARGUMENTS into a task worth handing to an
implementer.

## 1. Write the task details

**Requirements** — expand the high-level ask into specifics:
- User stories or use cases
- Functional requirements: what it should do
- Non-functional requirements: performance, security, accessibility
- Edge cases and error handling
- UI/UX considerations

**Acceptance Criteria** — clear and testable:
- Expected behavior and outputs
- Test cases or scenarios that must pass
- Metrics or benchmarks that must be met
- An explicit definition of done

## 2. Create the task

```bash
sabin task create --title "<title>" --content "<detailed requirements>"
```

For an external ticket, pass its ID:

```bash
sabin task create -n JIRA-12345 --title "<title>" --content "<requirements>"
```

The command prints the task path, its notes directory, and the allocated ID.
The notes directory is created up front, so research and context can go there
before work starts.

## 3. Hand it back

Report the task ID and where its notes live. Do not start work on it, create a
worktree, or change its status — the user decides when a task begins.
