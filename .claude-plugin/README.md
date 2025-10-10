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
