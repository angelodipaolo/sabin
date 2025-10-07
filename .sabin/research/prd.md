Sabin is a set of claude code commands, CLI commands, and a VS code interface that power a workflow management system for agentic coding. The primary feature will be managing prompt files in VS code. It will also include some prompts that manage a workflow with various prompt and context files.

# PRD

## Features:

- Text-based data sources, all information is in files and organized by directories
- CLI for managing workflow
- VS code extension for managing workflow
- Manage work items as tickets
- Standard convention for directory structure
- AI prompts and sub agents for managing workflow
- Supports claude code but designed to support other tools

## Components

### TODO.md

A file for managing high-level todo items. This is where work is planned before it is turned into tickets. This file lives at `.sabin/TODO.md`. 

#### Workflow

A user should be able to write a todo item in the file. Every line in the file with no indentation that starts with `-` is considered a "todo item". The text on this line should be considered the short description of the ticket. Any lines indented are details for a particular "todo item". For example, given the content below, there are two work items "remove liabilities from side menu" and "set up CloudKit syncing". the "clean up liabilities views that are not in use" and "add tests to verify" lines are additional details for the "remove liabilities from side menu" item.

**Example work item structure**:
```markdown
- remove liabilities from side menu
    - clean up liabilities views that are not in use
    - add tests to verify
- set up CloudKit syncing
```

A tool (CLI) should be exposed to the agent that enables the agent to the following:
- extract a work item and its details from the todo file
- create a new ticket file with the information
- remove the work item and its details from the todo file after the ticket file is created

#### Example

```markdown
# TODO

- add option to hide old assets that have zero balance
- remove liabilities from side menu
    - clean up liabilities views that are not in use
- set up CloudKit syncing
- asset details needs some design attention
```

### Ticket

A unit of work to complete represented as a markdown file.

- Includes a set of requirements
- Could be a bug to fix or a feature to implement
- Written by user to specify what work needs to be done by AI coding agent
- Ticket is open when it is located in `.sabin/tickets/open`
- ticket is resolved when it is located in `.sabin/tickets/resolved`
- Agent uses ticket to either:
    - Implement changes without planning (bug fix or small feature)
    - Create an implementation plan 
- Does not need to follow a specific format for content in file(other than frontmatter data), up to user to structure it how they want
- Frontmatter
    - `status`: status of ticket (open/ready/review/resolved)
    - `title`: title of the ticket
    - `description`: an optional description of the requirements


#### Ticket Statuses

- Used to indicate if the ticket is ready to implement
- `status` values:
    - `open`: Initial set of requirements but not ready to be implemented
    - `ready`: Ready for implementation. ticket has enough detail in the ticket or a corresponding plan that the agent can use to implement
    - `review`: Changes have been made and are ready for user or AI review. This also includes testing
    - `resolved`: Changes have been tested, approved, and committed to the repo
- A ticket remains in  `.sabin/tickets/open` for all statuses except `resolved`. When a ticket is marked as resolved it it moved to `.sabin/tickets/resolved`

#### Example

```markdown
---
plan: 'path/to/plan-file.md'
status: 'open'
title: 'Implement delete item'
description 'Update the item screen so a user can delete items'
---

Requirements go here...
```

### Plan

A comprehensive document with enough details that a coding agent can read to implement a plan.

### Research

A file that contains context that the model can read during planning.

## Workflow

The workflow that this system powers:

1. User plans high-level work in TODO.md
2. User writes a ticket with a set of requirements based on a TODO item. (`status: open`)
3. User hands ticket off to AI to plan work (`/plan TICKET-NUMBER`)
    1. AI finds ticket file and reads file
    2. AI uses `/plan` prompt to interactively plan with user
    3. Plan is written to `.sabin/plans` when AI is complete with plan
    4. User iterates on plan with AI before it is approved
    5. After approval ticket status is changed to `ready`
4. User asks AI to implement plan with `/implement TICKET-NUMBER`.  (`status: ready`)
    1. AI implements and asks user to review and test
    2. User approves or asks AI to continue
    3. After approval, user is free to commit changes or use `/commit`
    4. AI resolves ticket, ticket is changed to `resolved`

## Data Source

The data source is simply markdown files on disk. Frontmatter is used to store metadata in files for information like ticket status.

Directory structure:
- `.sabin`: home for all docs, local to user's project directory
- `.sabin/research`: location for research files
- `.sabin/plans`: location for plans
- `.sabin/tickets/open` open tickets (open/ready/review status)
- `.sabin/tickets/resolved` resolved tickets (resolved status)

## Interfaces

How the user interacts with the workflow.

### claude slash commands

- Slash commands have prompts for plan and implementation phases
- Prompts manage reading tickets, moving tickets, creating plans, and implementing based on a plan
- Prompts use CLI to do workflow tasks

**Slash commands**:
- `/create-ticket`
    - Takes information from prompt and creates a ticket file
    - Uses
- `/plan`
- `/implement`
- `/commit`

### UI

VS code extension for easily managing tickets. The UI should give an overview of the project status to make it easy to plan at high level and to write and manage tickets. The user should see a list of tickets and statuses, a text editor window with todo.md for project planning, a new ticket button.


- toggle between tickets view and planning view

- tickets view (main view)
    - view columns of tickets
    - column for each ticket
    - tickets displayed as card with number, title, and description limited at 200 characters
    - badge/flag to show if ticket has plan associated with it
        - clicking badge should open plan with markdown preview
    - should display new ticket button at top

- planning view
    - displays todo.md in text editor
    - should display new ticket button at top
- `New Ticket` button
    - Creates new file in the expected directory and names the file with an incremented ticket number
    - displayed at the top of all views

#### CLI

The CLI provides functionality to agents to manage the workflow. The CLI should provide commands for:

- creating a new ticket from input passed to the command
- update ticket statuses
- get all tickets (returns files) with option to filter by status


## Installation

- Need an installation solution that will install the sub agents, prompts, cli, vs code extension
