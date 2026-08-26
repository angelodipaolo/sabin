# Sabin Claude Code Plugin

Ships the `sabin` skill: the workflow contract an agent follows in a Sabin
project (orient, notes, plan, implement, review, complete).

## Prerequisites

The Sabin CLI must be on your PATH - the skill drives everything through it.

```bash
cd packages/cli && npm link
sabin --version
```

## Installation

From the Sabin repository root, in Claude Code:

```
/plugin marketplace add /absolute/path/to/sabin
/plugin install sabin@sabin-local
```

Or, without the plugin system, `sabin skill install` copies the same skill to
`~/.claude/skills/sabin`.

## Usage

The skill is invoked as `/sabin <what>` or picked up implicitly in any repo
with a `.sabin` link:

- `/sabin create` - expand a rough idea into a task
- `/sabin plan` - write the ticket's plan
- `/sabin implement` - do the work, end in `review`
- `/sabin review` - review the diff against the acceptance criteria
- `/sabin complete` - approve: mark completed and follow the project's hook

## Uninstallation

```
/plugin uninstall sabin@sabin-local
```
