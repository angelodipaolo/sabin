---
status: completed
title: Update install script and add CLI command for installing agent prompts
---
## Requirements

### Install Script Updates
- **Remove `.sabin` directory initialization**: The `install.js` script currently creates the `.sabin` directory structure (tasks/open, tasks/completed, plans, research). This should be removed since users will run `sabin init` themselves after installation.
- **Remove TODO.md creation**: The script creates an initial `TODO.md` file which is no longer part of the Sabin workflow. This should be removed.
- **Keep core installation features**: The script should continue to:
  - Install the CLI globally via `npm install -g @sabin/cli`
  - Install the VS Code extension from the VSIX file
- **Update directory references**: Change any references from old "tickets" terminology to current "tasks" terminology in comments/documentation within the script.

### New CLI Command for Installing Prompts
- **Command design**: Create a new CLI command `sabin prompts install` that installs workflow prompts as slash commands for AI coding agents
- **Agent flexibility**: Design the command to support multiple agents in the future:
  - Default agent: Claude Code (installs to `~/.claude/commands/`)
  - Future support for other agents via a `--agent` flag (e.g., `--agent cursor`, `--agent cody`)
- **Prompts to install**: The command should install these prompts:
  - `create-ticket.md` → `/sabin-create-ticket`
  - `plan.md` → `/sabin-plan`
  - `implement.md` → `/sabin-implement`
  - `commit.md` → `/sabin-commit`
- **Functionality**: 
  - Copy prompt files from the package's `prompts/` directory to the agent's commands directory
  - Add `sabin-` prefix to installed command names
  - Create the commands directory if it doesn't exist
  - Provide clear feedback on installation success/failure
  - Handle errors gracefully (missing source files, permission issues, etc.)

### User Stories
1. As a developer installing Sabin, I want the install script to only handle global installation so I can run `sabin init` in my chosen project directory
2. As a developer using Sabin with Claude Code, I want to install workflow prompts as slash commands using `sabin prompts install`
3. As a developer, I want the prompt installation to be extensible so it can support other AI coding agents in the future

### Non-functional Requirements
- **Backward compatibility**: Existing `install-claude-commands.js` script should remain functional during transition
- **User experience**: Provide clear console output with spinners and colored messages (using chalk/ora like other commands)
- **Error handling**: Gracefully handle missing directories, permission errors, and missing source files
- **Documentation**: Update help text and success messages to guide users on next steps

### Edge Cases
- Commands directory doesn't exist (should create it)
- Source prompt files are missing (should report error)
- Insufficient permissions to write to commands directory (should provide helpful error message)
- Prompts already installed (should overwrite with confirmation or skip with message)

## Acceptance Criteria

### Install Script (install.js)
- [ ] Script no longer creates `.sabin` directory structure
- [ ] Script no longer creates `TODO.md` file
- [ ] Script still installs CLI globally with `npm install -g @sabin/cli`
- [ ] Script still installs VS Code extension from VSIX file
- [ ] All references updated from "tickets" to "tasks" terminology
- [ ] Console output guides users to run `sabin init` after installation

### CLI Command (sabin prompts install)
- [ ] Command `sabin prompts install` successfully installs all 4 prompts to `~/.claude/commands/`
- [ ] Prompts are prefixed with `sabin-` (e.g., `/sabin-create-ticket`)
- [ ] Commands directory is created if it doesn't exist
- [ ] Console output shows success/failure for each prompt installation
- [ ] Command uses chalk/ora for consistent CLI styling
- [ ] Error handling works for missing source files and permission issues
- [ ] Command structure supports future `--agent <name>` flag (even if only Claude is implemented initially)
- [ ] Help text (`sabin prompts install --help`) clearly describes the command

### Testing
- [ ] Run `install.js` and verify it doesn't create `.sabin` directory
- [ ] Run `install.js` and verify it doesn't create `TODO.md`
- [ ] Run `sabin prompts install` and verify all 4 commands appear in `~/.claude/commands/`
- [ ] Test Claude Code can execute the installed slash commands
- [ ] Test error handling when source prompts are missing
- [ ] Test command works when `~/.claude/commands/` doesn't exist
- [ ] Verify console output is clear and helpful
- [ ] Run linter and tests pass

### Documentation
- [ ] Update README or installation docs to reflect new installation flow
- [ ] Document the new `sabin prompts install` command
- [ ] Update success messages in both scripts to guide users on next steps
