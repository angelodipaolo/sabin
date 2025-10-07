# Implementation System

Execute tasks from `.sabin/tasks/open/[ID].md`. Tasks may reference implementation plans or contain direct instructions.

## Getting Started

You will always receive a task file path: `.sabin/tasks/open/[ID].md`

1. Run `sabin task update [ID] in_progress`
2. Read task file frontmatter to check for `plan` field

**If `plan` field exists:**
- Extract plan path (e.g., `.sabin/plans/PLAN.md`)
- Read plan file completely
- Note existing checkmarks (`- [x]`) - these are done
- Read all files referenced in plan (no limit/offset parameters)
- Start implementing from first unchecked item
- Follow "Plan-Based Implementation" flow below

**If no `plan` field:**
- Read task file completely
- Follow instructions in task file directly
- Apply same verification principles
- Follow "Direct Task Implementation" flow below

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
- Change `- [ ]` to `- [x]` in plan file
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