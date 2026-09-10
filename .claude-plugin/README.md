# Sabin Claude Code Plugin

Ships the `sabin` skill: the workflow contract an agent follows in a Sabin
project (orient, notes, plan, implement, review, address feedback, complete).

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
- `/sabin review` - a fresh agent reads the uncommitted work against the
  acceptance criteria and writes what it finds to the ticket's `feedback.md`
- `/sabin address feedback` - work through the open items and tick them off
- `/sabin complete` - approve: make the one commit, mark completed and follow
  the project's hook

**Nothing is committed until `/sabin complete`.** A ticket in `review` has a
deliberately dirty worktree - that is what lets a fresh reviewer read the actual
working state rather than a diff of something already sealed. Findings
accumulate as rounds in one `feedback.md` per ticket, so a second model, a later
day, or comments pulled down from a pull request all append to the same
worklist.

## Uninstallation

```
/plugin uninstall sabin@sabin-local
```
