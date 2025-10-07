Create Task with Sabin CLI

Create a detailed task based on the following high-level requirements provided in $ARGUMENTS.

# 1. Write task details

Structure the task with these sections:

## Requirements
Expand the high-level requirements into detailed user requirements. Include:
- Specific user stories or use cases
- Functional requirements (what the feature should do)
- Non-functional requirements (performance, security, accessibility considerations)
- Edge cases and error handling scenarios
- Any UI/UX considerations

## Acceptance Criteria
Define clear, testable acceptance criteria that specify when this task is complete. Include:
- Expected behavior and outputs
- Specific test cases or scenarios that must pass
- Any metrics or benchmarks that must be met
- Definition of "done" for this task


# 2. Create the task with details
Use the sabin CLI to create a new task.

```bash
sabin task create --title "Your task title" --content "Detailed requirements"
```
