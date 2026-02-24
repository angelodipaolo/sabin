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

# If sabin CLI is not installed yet, bypass preflight check
/path/to/sabin/.codex-skill/install.sh --force ~/projects/my-app
```

By default, install fails fast if `sabin` CLI is missing from PATH. Use `--force` to bypass this check.

Install uses marker-bounded blocks in `AGENTS.md`:
- `<!-- SABIN_SKILL_START -->`
- `<!-- SABIN_SKILL_END -->`

Re-running install performs an in-place upgrade by replacing the existing marked block with fresh content.

## Uninstall

```bash
# Remove from current directory
/path/to/sabin/.codex-skill/uninstall.sh

# Remove from a specific project
/path/to/sabin/.codex-skill/uninstall.sh ~/projects/my-app
```

## What Gets Added

The install script adds a marker-bounded `# Sabin Workflow Skill` section to `AGENTS.md` containing:

- Task lifecycle documentation
- CLI command reference
- Planning and implementation workflow
- Conventions for file organization and commits
