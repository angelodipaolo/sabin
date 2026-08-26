---
description: Implement a task based on its plan
---

# Implementation System

Execute a Sabin task. A task may have one or more plans in its notes
directory, or it may carry direct instructions.

## Getting Started

1. **Orient.** Run `sabin context --json`. It returns the ticket, its status,
   its task file, its notes directory, and what is already in there. If it
   errors, stop and ask which ticket to implement — never guess a path, and
   never hardcode `.sabin/...`, which does not exist in a worktree with a
   shared Sabin directory.

2. **Read the task:** `sabin task show`

3. **Read the notes.** Everything durable for this ticket lives in `notesDir`:
   plans, research, design docs, context files. Read what is relevant before
   writing code — earlier notes usually carry decisions you would otherwise
   re-litigate.

4. `sabin task update <TICKET> in_progress`

**If the notes directory contains a plan:**
- Read it completely
- Note existing checkmarks (`- [x]`) - these are done
- Read all files referenced in the plan (no limit/offset parameters)
- Start implementing from the first unchecked item
- Follow "Plan-Based Implementation" below

**If there is no plan:**
- Follow the task's instructions directly
- Apply the same verification principles
- Follow "Direct Task Implementation" below

## Plan-Based Implementation

For each phase, follow this cycle:

### 1. Read & Understand
- Read phase specifications completely
- Read all files mentioned in current phase
- Read related files as you discover dependencies
- Understand how changes fit into broader codebase

### 2. Implement
- Follow plan's intent, adapt to actual code structure
- Complete entire phase before verification
- Don't alternate between implementing and testing

### 3. Verify

**Run automated checks:**
```bash
# Examples - actual commands are in plan's success criteria
make build
make test
npm run typecheck
make lint
```

**Perform manual checks:**
- Feature works as described
- No regressions in related functionality
- Edge cases handled correctly

### 4. Handle Results

**If verification passes:**
- Update plan: change `- [ ]` to `- [x]` for completed items
- Move to next phase

**If verification fails:**
- Debug the issue
- Fix the implementation
- Re-run verification
- Repeat until passing
- Then mark complete and proceed

## Direct Task Implementation

When task has no plan, follow task instructions while applying these principles:

### 1. Understand Requirements
- Read task description completely
- Identify what needs to be built/changed
- Clarify any ambiguities before starting

### 2. Research & Plan
- Find relevant files in codebase
- Understand current implementation
- Identify integration points
- Make a mental model of the changes

### 3. Implement
- Make required changes
- Follow existing code patterns
- Keep changes focused on task requirements

### 4. Verify
**Run appropriate checks for the codebase:**
```bash
# Examples - adjust to project
make build
make test
npm run typecheck
```

**Manual verification:**
- Feature works as described in task
- No regressions
- Edge cases handled

**If verification fails:**
- Debug and fix
- Re-verify
- Repeat until passing

### 5. Ask When Stuck
If requirements are unclear or you encounter blockers, stop and ask rather than guessing.

## Handling Mismatches

When plan expectations don't match reality, STOP:

```
Phase [N] Mismatch:

Plan says: [what plan expects]
Reality: [what you actually found]
Impact: [why this blocks progress]

Options:
1. [Possible approach A]
2. [Possible approach B]

Recommendation: [your suggested path]
```

Wait for user guidance before proceeding.

**Common mismatch scenarios:**
- File structure changed since plan was written
- Dependencies updated with breaking changes
- Assumptions in plan don't match actual code
- Required functionality already exists differently

## Progress Tracking

**Mark items complete immediately after verification passes:**
- Change `- [ ]` to `- [x]` in the plan file, in the ticket's notes directory
- Use Edit tool to update the plan
- Creates resume points if work is interrupted

**When resuming work:**
- Trust existing checkmarks
- Pick up from first unchecked item
- Only re-verify if something seems incorrect

## Debugging Guidelines

**First, verify you understand the code:**
- Read relevant files completely
- Trace data flow and dependencies
- Check if codebase evolved since plan was written

**Use sub-tasks only for:**
- Targeted debugging of complex issues
- Exploring unfamiliar parts of codebase
- Isolated problem investigation

Don't spawn sub-tasks for general implementation.

## Saving Work Product

Anything durable you produce along the way - research, findings, design
decisions, saved output - belongs in the ticket's notes directory, not in the
conversation and not scattered in the repo. Notes are any file type an agent or
the user might read later: markdown, JSON, YAML, CSV, logs.

```bash
sabin where --notes        # the directory to write into
sabin notes new <name>     # scaffold a file and print its path
```

Never read or write the prompts directory. It holds the user's own draft
prompts and is not addressed to you.

## Completion

After all phases implemented and verified:

```bash
sabin task update [TASK-ID] review
```

Then request user to:
- Review all changes
- Perform final validation
- Approve or request modifications

## Key Principles

**Read completely:** Always read files without limit/offset parameters for full context

**Implement fully:** Complete entire phases before verifying - maintain momentum

**Verify thoroughly:** Don't skip checks, even if confident

**Communicate blocks:** Stop and ask when stuck, don't guess

**Track progress:** Update checkboxes to show what's done

**Focus on goal:** You're implementing a solution, not just checking boxes