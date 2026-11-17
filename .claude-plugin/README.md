# Sabin Claude Code plugin

Ships the `sabin` skill: what an agent does on a Sabin task - orient, plan,
implement, review, hand off, complete, and migrate an old `.sabin` directory.

## Prerequisites

The `sabin` CLI must be on your PATH; the skill drives everything through it.

```bash
npm run build && cd packages/cli && npm link
sabin --version
```

## Installation

`sabin setup` installs the same skill for Claude Code
(`~/.claude/skills/sabin`) and Codex (`~/.agents/skills/sabin`). Use the plugin
only if you prefer Claude Code's plugin system. From the repository root, in
Claude Code:

```
/plugin marketplace add /absolute/path/to/sabin
/plugin install sabin@sabin-local
```

Do not use both: two copies of the skill would compete.

## Usage

The skill triggers on a task ID, "the plan", "write the handoff", "review
this", "complete it", or `/sabin`. It orients with `sabin context --json`, keeps
durable output in the task directory, changes status only with `sabin status`,
stops at `review`, and never reads `prompt.md`.

## Uninstallation

```
/plugin uninstall sabin@sabin-local
```
