# Sabin Codex Skill

Gives [Codex CLI](https://github.com/openai/codex) awareness of the Sabin task workflow so it follows the correct lifecycle when working in your project.

## How It Works

Codex reads `AGENTS.md` in your project root for workflow instructions. This skill appends Sabin-specific instructions that teach Codex to:

- Create tasks with proper requirements and acceptance criteria
- Write implementation plans in `.sabin/plans/`
- Follow the `open → ready → in_progress → review → completed` lifecycle
- Use `sabin` CLI commands instead of manual file edits
- Track progress via plan checkboxes
- Include task IDs in commit messages

## Prerequisites

Install the Sabin CLI first:

```bash
cd /path/to/sabin/packages/cli && npm link
```

## Install

From the sabin repo, install the skill into any project:

```bash
# Install to current directory
/path/to/sabin/.codex-skill/install.sh

# Install to a specific project
/path/to/sabin/.codex-skill/install.sh ~/projects/my-app
```

This appends the Sabin workflow instructions to your project's `AGENTS.md` (creates it if needed).

## Uninstall

```bash
# Remove from current directory
/path/to/sabin/.codex-skill/uninstall.sh

# Remove from a specific project
/path/to/sabin/.codex-skill/uninstall.sh ~/projects/my-app
```

## What Gets Added

The install script appends a `# Sabin Workflow Skill` section to `AGENTS.md` containing:

- Task lifecycle documentation
- CLI command reference
- Planning and implementation workflow
- Conventions for file organization and commits
