Create an implementation plan for a task.

## Steps

1. Read the task file to understand requirements:
```bash
cat .sabin/tasks/open/TASK-XXXX.md
```

2. Create a plan file in `.sabin/plans/` with:
   - Overview of the task
   - Current state analysis
   - Desired end state
   - What we're NOT doing
   - Implementation phases with specific changes
   - Success criteria for each phase

3. Link the plan to the task by adding a `plan:` field to the task's frontmatter:
```yaml
---
status: ready
title: Your task title
description: Brief description
plan: .sabin/plans/your-plan-name.md
---
```

4. Update the task status to `ready` when the plan is complete.

## Plan Structure

A good plan includes:
- **Overview**: What we're building
- **Current State**: What exists now
- **Desired End State**: What success looks like
- **Implementation Phases**: Step-by-step breakdown with:
  - Files to change
  - Specific code changes
  - Success criteria
  - Testing approach

## Example

```bash
# Create plan file
echo "# Implementation Plan for Feature X" > .sabin/plans/feature-x-plan.md

# Link plan to task
sabin update-status TASK-0001 ready
```
