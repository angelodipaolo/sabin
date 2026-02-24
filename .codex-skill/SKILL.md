---
name: sabin
description: Manage Sabin file-based tasks and plans in .sabin/ using the Sabin CLI across open/ready/in_progress/review/completed workflow stages.
---

# Sabin Workflow Skill (Codex / OpenClaw)

## Overview

Use this skill when a project uses Sabin's file-based workflow (`.sabin/`) and you need to create tasks, write plans, implement work, and update task status via the Sabin CLI.

## When To Use

- The repo has a `.sabin/` directory or the user asks for Sabin task workflow
- You need to create, plan, implement, or complete tasks using `sabin` commands
- You're asked to check task status, list tasks, or manage the task backlog

## Prerequisites

The `sabin` CLI must be installed and available on PATH. Install from the sabin repo:

```bash
cd packages/cli && npm link
```

Verify: `sabin --version`

## Task Lifecycle

```
open → ready → in_progress → review → completed
```

| Status        | Meaning                                    | File Location              |
|---------------|--------------------------------------------|----------------------------|
| `open`        | Requirements captured, needs planning      | `.sabin/tasks/open/`       |
| `ready`       | Plan written, ready to implement           | `.sabin/tasks/open/`       |
| `in_progress` | Currently being worked on                  | `.sabin/tasks/open/`       |
| `review`      | Implementation done, awaiting review       | `.sabin/tasks/open/`       |
| `completed`   | Approved and committed                     | `.sabin/tasks/completed/`  |

## Core Workflow

### 1) Create Task

Expand high-level requirements into detailed Requirements + Acceptance Criteria, then create via CLI:

```bash
sabin task create --title "Title" --content "Detailed requirements and acceptance criteria"
```

**Requirements should include:** user stories, functional requirements, edge cases, error handling, and UI/UX considerations.

**Acceptance Criteria should include:** expected behavior, specific test cases, metrics/benchmarks, and definition of done.

### 2) Plan Task

Read the task file, then create an implementation plan:

```bash
cat .sabin/tasks/open/TASK-XXXX.md
```

Write a plan file in `.sabin/plans/` covering:
- Overview of the task
- Current state analysis
- Desired end state
- What we're NOT doing (scope boundaries)
- Implementation phases with specific file changes
- Success criteria for each phase

Add `plan:` to the task frontmatter pointing to the plan file, then update status:

```bash
sabin task update TASK-XXXX ready
```

### 3) Implement Task

Move task to in_progress, then implement based on the plan:

```bash
sabin task update TASK-XXXX in_progress
```

**If the task has a `plan:` field** — read the plan, check for existing `[x]` marks (already done), start from the first unchecked item. After each phase passes verification, mark it `[x]` in the plan file.

**If no plan** — follow the task description directly.

**Verification cycle for each phase:**
1. Implement the changes
2. Run build/test/lint commands
3. If failing, debug and fix before proceeding
4. Mark phase complete in plan

After all work is done and verified:

```bash
sabin task update TASK-XXXX review
```

### 4) Complete Task

After user review/approval, mark as completed and commit:

```bash
sabin task update TASK-XXXX completed
```

Include the task number in the commit message (e.g., `TASK-XXXX: Add authentication feature`).

## Querying Tasks

```bash
# List all tasks
sabin task list

# List by status
sabin task list -s open
sabin task list -s ready
sabin task list -s review

# Read a specific task
cat .sabin/tasks/open/TASK-XXXX.md
```

## Handling Mismatches

When plan expectations don't match the actual codebase, STOP and report:

```
Phase [N] Mismatch:
Plan says: [expected state]
Reality: [actual state]
Impact: [why this blocks progress]
Options: [possible approaches]
Recommendation: [suggested path]
```

Wait for user guidance before proceeding.

## Conventions

- Task files are markdown with YAML frontmatter (`status`, `title`, `description`, `plan`)
- Files live in `.sabin/` and are versioned with the repo
- Prefer CLI commands over manual file edits unless explicitly requested
- Always read files completely (no partial reads) for full context
- Track progress by updating plan checkboxes (`- [ ]` → `- [x]`)
- Include `.sabin/tasks/**/TASK-XXXX.md` changes in your commits
