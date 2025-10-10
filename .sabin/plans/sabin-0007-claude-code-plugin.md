# Implementation Plan: Claude Code Plugin Support (SABIN-0007)

## Overview

Transform Sabin into a Claude Code plugin to enable seamless installation and integration with Claude Code. This will package all existing Sabin workflow prompts (task-create, plan, task-implement, task-complete) as slash commands accessible directly from Claude Code.

## Current State

Sabin currently exists as:
- **CLI tool** (`@sabin/cli`) - Command-line interface for task management
- **VS Code extension** (`sabin-vscode`) - Task visualization and management UI
- **Core library** (`@sabin/core`) - Shared types and utilities
- **Workflow prompts** (`prompts/` directory) - Markdown files with workflow guidance for Claude Code
  - `task-create.md` - Creating new tasks
  - `plan.md` - Creating implementation plans
  - `task-implement.md` - Implementing tasks
  - `task-complete.md` - Completing and committing tasks

The prompts currently require users to manually invoke them. There's no standardized way to distribute and install Sabin for Claude Code users.

## Desired End State

Sabin will be installable as a Claude Code plugin with:

1. **Plugin structure** with standard Claude Code plugin format:
   - `.claude-plugin/plugin.json` manifest
   - `.claude-plugin/marketplace.json` for local development
   - `commands/` directory containing Sabin slash commands
   - Proper metadata and versioning

2. **Slash commands** mapped from existing prompts:
   - `/sabin-create` - Create a new task (from `task-create.md`)
   - `/sabin-plan` - Create implementation plan (from `plan.md`)
   - `/sabin-implement` - Implement a task (from `task-implement.md`)
   - `/sabin-complete` - Complete and commit a task (from `task-complete.md`)

3. **Installation via Claude Code marketplace system**:
   - Local marketplace for development: `/plugin marketplace add /path/to/sabin`
   - Install command: `/plugin install sabin@sabin-local`

4. **Documentation** explaining:
   - Prerequisites (Sabin CLI must be installed separately)
   - How to install the plugin using marketplace commands
   - Available commands and their usage
   - How the plugin uses the CLI via bash commands

## What We're NOT Doing

- NOT replacing the CLI or VS Code extension (they remain separate installations)
- NOT installing the CLI or VS Code extension via the plugin (plugin system cannot do this)
- NOT creating agents or hooks (can be added later)
- NOT bundling MCP servers (future enhancement)
- NOT changing the existing prompt files (they become the source for commands)
- NOT creating a separate npm package for the plugin (it's part of the monorepo)
- NOT publishing to a public plugin marketplace yet (local development first)

## Implementation Phases

### Phase 1: Create Plugin Structure ✅

**Files to create:**
- `.claude-plugin/plugin.json` - Plugin manifest
- `.claude-plugin/marketplace.json` - Local marketplace definition
- `commands/sabin-create.md` - Command wrapping `task-create.md`
- `commands/sabin-plan.md` - Command wrapping `plan.md`
- `commands/sabin-implement.md` - Command wrapping `task-implement.md`
- `commands/sabin-complete.md` - Command wrapping `task-complete.md`

**Changes:**
```json
// .claude-plugin/plugin.json
{
  "name": "sabin",
  "version": "0.1.0",
  "description": "File-based workflow management for agentic coding",
  "author": "Angelo",
  "homepage": "https://github.com/yourusername/sabin",
  "license": "MIT",
  "keywords": ["workflow", "task-management", "agentic", "coding"]
}
```

```json
// .claude-plugin/marketplace.json
{
  "name": "sabin-local",
  "owner": "Angelo",
  "plugins": [
    {
      "name": "sabin",
      "source": "."
    }
  ]
}
```

**Command file structure** (example for `commands/sabin-create.md`):
```markdown
---
description: Create a detailed task from high-level requirements
---

Create Task with Sabin CLI

[Content from prompts/task-create.md]
```

**Success criteria:**
- Plugin directory structure exists
- All 4 command files created with proper frontmatter
- Plugin manifest is valid JSON
- Marketplace manifest is valid JSON

**Testing:**
- Run `claude plugin validate .` to validate manifests
- Verify command files have required frontmatter

### Phase 2: Create Plugin README and Prerequisites Documentation ✅

**Files to create:**
- `.claude-plugin/README.md` - Plugin-specific documentation

**Changes:**
Create `.claude-plugin/README.md`:
```markdown
# Sabin Claude Code Plugin

File-based workflow management for agentic coding.

## Prerequisites

**IMPORTANT**: The Sabin CLI must be installed before using this plugin.

Install the CLI:
```bash
cd packages/cli
npm link
```

Verify installation:
```bash
sabin --version
```

## Installation

From the Sabin repository root:

```bash
# In Claude Code, add the local marketplace
/plugin marketplace add /absolute/path/to/sabin

# Install the plugin
/plugin install sabin@sabin-local
```

## Available Commands

- `/sabin-create` - Create a detailed task from high-level requirements
- `/sabin-plan` - Create an implementation plan for a task
- `/sabin-implement` - Implement a task based on its plan
- `/sabin-complete` - Complete and commit a task

## How It Works

The plugin provides slash commands that invoke the Sabin CLI via bash commands. All task management happens through the CLI, which operates on the `.sabin/` directory in your workspace.

## Uninstallation

```bash
/plugin uninstall sabin@sabin-local
```
```

**Success criteria:**
- README clearly documents CLI prerequisite
- Installation instructions use marketplace commands
- Command descriptions are clear and accurate

**Testing:**
- Follow README instructions from scratch
- Verify all steps work as documented

### Phase 3: Update Main README ✅

**Files to modify:**
- `README.md` - Add plugin installation section

**Changes:**
Add to main README.md:
```markdown
## Installation as Claude Code Plugin

Sabin can be installed as a Claude Code plugin for seamless workflow integration.

### Prerequisites

1. Install the Sabin CLI:
   ```bash
   cd packages/cli
   npm link
   sabin --version  # Verify installation
   ```

2. Install Claude Code (if not already installed)

### Plugin Installation

From Claude Code:
```bash
# Add the Sabin marketplace (use absolute path to your Sabin repo)
/plugin marketplace add /path/to/sabin

# Install the plugin
/plugin install sabin@sabin-local
```

### Available Plugin Commands

- `/sabin-create` - Create a new task from requirements
- `/sabin-plan` - Create an implementation plan for a task
- `/sabin-implement` - Implement a task based on its plan
- `/sabin-complete` - Complete and commit a task

See `.claude-plugin/README.md` for detailed plugin documentation.

**Note**: The plugin, CLI, and VS Code extension are separate installations that work together.
```

**Success criteria:**
- README clearly explains prerequisites
- Installation process uses marketplace commands
- Relationship between plugin, CLI, and VS Code extension is clear

**Testing:**
- Follow installation instructions from README
- Verify all steps work as documented

### Phase 4: Integration Testing ✅

**Testing approach:**
1. Ensure CLI is installed: `sabin --version`
2. Add local marketplace: `/plugin marketplace add /path/to/sabin`
3. Install plugin: `/plugin install sabin@sabin-local`
4. Start Claude Code with `claude --debug` to verify plugin loads
5. Test each slash command:
   - `/sabin-create` with various input formats
   - `/sabin-plan` with existing tasks
   - `/sabin-implement` workflow
   - `/sabin-complete` workflow
6. Verify commands interact correctly with CLI
7. Test error scenarios:
   - CLI not installed (commands should fail gracefully)
   - No .sabin directory (commands should provide clear guidance)
   - Invalid task numbers
8. Test with VS Code extension running (ensure no conflicts)

**Success criteria:**
- Plugin loads successfully (visible in `claude --debug` output)
- All 4 commands appear in `/help`
- All 4 commands execute successfully when CLI is installed
- Commands fail with clear error messages when CLI is missing
- Error messages are helpful and actionable
- No conflicts with existing CLI or VS Code workflows

## Dependencies

- Existing `prompts/*.md` files (already in place)
- Claude Code installed on development machine
- **Sabin CLI must be installed separately** (prerequisite for plugin functionality)
- Existing Sabin core functionality

## Risks and Mitigations

**Risk:** Users forget to install CLI before using plugin
**Mitigation:** Clear documentation in both main README and plugin README; commands fail gracefully with helpful error messages

**Risk:** Command content may need formatting adjustments for Claude Code
**Mitigation:** Test commands thoroughly, adjust formatting if needed

**Risk:** Marketplace path issues (relative vs absolute paths)
**Mitigation:** Document that absolute paths are required for marketplace add command

**Risk:** Users may not understand relationship between plugin, CLI, and VS Code extension
**Mitigation:** Clear documentation explaining that these are separate, complementary installations

## Success Criteria

Overall success means:
1. ✅ Plugin structure follows Claude Code plugin specification
2. ✅ Plugin and marketplace manifests are valid JSON (verified with `claude plugin validate .`)
3. ✅ All 4 Sabin workflow commands are accessible as slash commands
4. ✅ Plugin can be installed via marketplace system: `/plugin install sabin@sabin-local`
5. ✅ Documentation clearly explains:
   - CLI is a prerequisite
   - How to install via marketplace commands
   - Relationship between plugin, CLI, and VS Code extension
6. ✅ Commands integrate seamlessly with existing Sabin CLI
7. ✅ Commands fail gracefully with helpful messages when CLI is not installed
8. ✅ No conflicts with existing VS Code extension workflows
