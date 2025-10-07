# Sabin Workflow Management System

Sabin gives your AI agent a structured workflow system, right in your codebase. Sabin is composed of a CLI, a VS code extension, and a set of prompts that power a workflow for planning and managing agentic tasks.

## Features

Sabin manages work through simple markdown files with YAML frontmatter, organized in a .sabin directory:
```bash
.sabin/
  tasks/
    open/TASK-0001.md       # Initial requirements
    open/TASK-0002.md       # Ready for implementation
    completed/TASK-0003.md  # Done and committed
  plans/                    # Implementation plans
  research/                 # Context and research
```
Each task moves through a clear lifecycle:
- open → Initial requirements, needs planning
- ready → Planned and ready for implementation
- review → Implementation done, needs testing/review
- completed → Approved and committed

### File-Based = Agent-Friendly

Because tasks are just markdown files in your repo:
- AI agents can read and write them directly - no API required
- Version controlled with your code - full history in git
- Edit in your local editor - VS Code, Vim, whatever you use
- No web UI context switching - everything stays in your workspace
- Works across all your projects - same simple structure everywhere

### CLI for Programmatic Control

The Sabin CLI gives AI agents tools to manage the workflow:
```bash
sabin task create -t "Add authentication" -c "Implement JWT-based auth"
sabin task list --status ready
sabin task update TASK-0001 review
```

Your AI agent can use these commands to:
- Create tasks as it discovers work
- Track what it's currently implementing
- Mark tasks for your review
- Query its backlog

### VS Code Integration

The VS Code extension visualizes your workflow without leaving the editor:
- Sidebar view showing tasks by status
- Zero configuration - activates when .sabin directory detected
- Create 

### Perfect for AI-Driven Development

Traditional project management tools were built for humans coordinating with humans. Sabin is built for the developer+AI workflow:

- Prompt files live with tasks - plans and research right in .sabin
- Agents track their own work - no manual status updates needed
- Simple file format - easy for AI to parse and generate

## Installation

### Prerequisites

- Node.js v16 or higher
- npm v7 or higher
- VS Code (for the extension)

### Install from Source

1. Clone the repository:
```bash
git clone https://github.com/yourusername/sabin.git
cd sabin
```

2. Install dependencies:
```bash
npm install
```

3. Build all packages:
```bash
npm run build
```

### Install VS Code Extension

#### Option 1: Install from VSIX (Recommended for Testing)

1. Build the extension:
```bash
cd packages/vscode-extension
npm run compile
npx @vscode/vsce package
```

2. Install the generated VSIX file in VS Code:
   - Open VS Code
   - Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
   - Type "Extensions: Install from VSIX..."
   - Select the `sabin-vscode-0.1.0.vsix` file from `packages/vscode-extension/`

#### Option 2: Development Mode

1. Open the project in VS Code:
```bash
code .
```

2. Navigate to the extension directory:
```bash
cd packages/vscode-extension
```

3. Press `F5` to launch a new VS Code window with the extension loaded in development mode

#### Uninstall Extension

```bash
code --uninstall-extension sabin.sabin-vscode
```

### Install CLI

```bash
cd packages/cli
npm link
```

Now you can use the `sabin` command globally:
```bash
sabin --help
```

## Configuration

Sabin uses a configuration file at `.sabin/config.json` to customize project settings.

### Project Prefix

You can configure a custom prefix for auto-generated task IDs:

```bash
# Initialize with custom prefix
sabin init --prefix MYPROJECT

# Or initialize with default prefix (TASK)
sabin init
```

The configuration file (`.sabin/config.json`) has the following structure:
```json
{
  "projectPrefix": "TASK",
  "taskNumberPadding": 4
}
```

**Examples:**
- Default: `TASK-0001`, `TASK-0002`, etc.
- Custom: `MYPROJECT-0001`, `MYPROJECT-0002`, etc.

### External Task IDs

You can link tasks from external systems (JIRA, Linear, Notion, etc.) by providing custom task IDs:

```bash
# Create task with external JIRA ID
sabin task create -t "Fix authentication bug" -n JIRA-12345

# Create task with Notion ID
sabin task create -t "Architecture review" -n NTVARCH-23252
```

## Usage

### VS Code Extension

- View tasks organized by status in the sidebar
- Create new tasks with the "New Task" button
- Update task status by clicking on a task

### CLI Commands

The Sabin CLI provides file-based workflow commands that enable AI agents to manage their own task lifecycle. Agents can create tasks with sabin task create, track work across statuses (open → ready → review → completed) using sabin task update, and query current work with sabin task list. The file-based architecture using markdown with YAML frontmatter allows agents to both use structured CLI commands and directly read/write task files, giving them flexible programmatic access to the entire workflow state.

```bash
# Initialize project
sabin init                           # Default prefix (TASK)
sabin init --prefix MYPROJECT        # Custom prefix

# Create a new task
sabin task create -t "Title" -c "Content"
sabin task create -t "Title" -n JIRA-123    # With external ID
sabin task create                           # Interactive mode (prompts for input)

# List all tasks
sabin task list

# List tasks by status
sabin task list -s open

# Update task status
sabin task update TASK-0001 ready
```

## License

MIT