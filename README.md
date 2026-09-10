# Sabin

A worktree command center for agentic coding. Write up a task, hand it to an
agent in its own worktree, review what comes back - from the terminal, with VS
Code and iTerm2 alongside.

Everything is text. A task is a markdown file; its notes are a directory; its
plan is `plan.md` in that directory. The CLI owns the parts the filesystem
cannot know - ID allocation, status transitions, branches and worktrees - and
ordinary file tools own the rest.

## The workflow

```bash
sabin task create "Add telemetry to uploads" --open   # task file + notes dir - no worktree yet
sabin plan SABIN-0012                                  # an agent works the problem through with you
sabin implement SABIN-0012                             # an agent does the work
sabin review SABIN-0012                                # an agent reviews what came back
sabin task list                                        # what is in flight
sabin open                                             # board, notes and prompts in one VS Code window
```

Drafting a task makes no worktree - it is a file you keep editing until the
idea is whole. The three step verbs do: each creates the branch and worktree
if they are not there and starts the agent inside them, in a new iTerm2 tab.

The agent follows the **sabin skill**: it orients with `sabin context --json`,
reads the ticket's notes, writes plans and research there, and moves the task
to `review` when the work is done and verified - **uncommitted**, so a fresh
reviewer reads the working tree rather than a sealed diff. `sabin review`
starts that reviewer; it writes what it finds to one `feedback.md` in the
ticket's notes, and `/sabin address feedback` works through it and ticks items
off. Every later pass - a different model, another day, comments pulled down
from a pull request with `gh` - appends a round to that same file, so the
worklist survives the session that found it.

You say `/sabin complete`. That is where the one commit happens, and where the
task moves to `completed` and your project's completion hook runs - "push and
open a PR", say. Worktrees are never removed for you.

Optional steps in between, all via the skill: `/sabin create` to expand a
rough idea into a task, `/sabin plan` to write a plan.

### Statuses

| Status | Meaning |
| --- | --- |
| `open` | Requirements captured |
| `ready` | Planned, ready to implement |
| `in_progress` | An agent (or you) is on it |
| `review` | Finished and verified, uncommitted, waiting on a review |
| `completed` | Approved; file moves to `tasks/completed/` |

## Layout

Sabin data lives **outside the repo** so every worktree sees the same board:

```
~/notes/myproject/.sabin/
  config.json
  tasks/open/SABIN-0012.md          # the task; filename is the stable ID
  tasks/completed/
  notes/SABIN-0012-add-telemetry/   # agent-readable context, plan.md lives here
  prompts/SABIN-0012-add-telemetry.md   # your prompt scratchpad; agents are denied
  hooks/completed.md                # instructions printed on `task update ... completed`
  research/
```

The repo gets a `.sabin` link file pointing there, ignored via
`.git/info/exclude`. One suffix, derived from the title, names the branch,
worktree, notes directory and scratchpad alike:

```
SABIN-0012 "Add telemetry to uploads"
  branch     angelo/SABIN-0012-add-telemetry-uploads
  worktree   ../myproject-worktrees/SABIN-0012-add-telemetry-uploads
  notes      notes/SABIN-0012-add-telemetry-uploads/
```

## Install

```bash
git clone https://github.com/angelodipaolo/sabin.git && cd sabin
npm install && npm run build
(cd packages/cli && npm link)          # puts `sabin` on your PATH
sabin skill install                    # ~/.claude/skills/sabin (or --agent codex)
```

VS Code extension:

```bash
cd packages/vscode-extension && npx @vscode/vsce package
code --install-extension sabin-vscode-0.1.0.vsix
```

Set up a project from inside its repo:

```bash
sabin init                             # asks where the Sabin directory goes and the ID prefix
sabin init --shared ~/notes/myproject/.sabin -p MYPROJECT -b angelo   # or say it all at once
```

## CLI

```
sabin init | link <path>               set up a repo
sabin task create "<title>"            [-c body] [-n JIRA-123] [--open] [--json]
sabin task list                        [-s status] [--all] [--json]
sabin task show [id]
sabin task update <id> <status>        prints hooks/<status>.md afterwards
sabin plan [ticket]                    put an agent on a ticket to plan it, with you
sabin implement [ticket]               put an agent on a ticket to do the work
sabin review [ticket]                  put an agent on a ticket to review its changes
                                       all three: [--claude|--codex|-a name] [--tab|--here]
                                       [--yolo|--supervised] [--print] [--no-launch]
sabin sessions [ticket]                live terminals, grouped by ticket [-a] [--json]
sabin jump [ticket]                    focus a ticket's terminal, or pick one
                                       [--any] [--picker]
                                       [--install-hotkey [--key opt+space]]
sabin term [ticket]                    a shell in the ticket's worktree [--window]
sabin open [ticket]                    [--worktree|--notes|--prompt|--plan|--task|--sabin]
sabin context --json                   [-t ticket] the agent's orienting call
sabin where [ticket]                   [--notes|--prompt|--plan|--worktree|--task|--sabin|--code-workspace]
sabin notes new <name>                 [-t ticket] [--template plan]
sabin skill install                    [--agent claude|codex]
```

Tickets are inferred from the current branch when omitted. A branch with no
ticket is an error, never a guess - and so is a bare number: a ticket is named
in full or not at all. A ticket you *name* has to have a task: resolving one
that does not exist would hand back a plausible path to a directory nothing
else will ever look in.

`plan`, `implement` and `review` are one command with three prompts. Each
builds the workspace if it is missing and launches the agent in it;
`--no-launch` stops after the workspace. Only `implement` marks the task
`in_progress` - planning happens before a task is `ready`, and reviewing
happens when it is already in `review`.

### Letting agents work unattended

Agents launch supervised: they ask before acting. `--yolo` drops that for one
run, and

```json
{ "agents": { "autonomous": true } }
```

makes it the default, with `--supervised` to override. It is off by default on
purpose - the worktree isolates your other work, not your machine.

## VS Code

The Sabin activity bar has two views. **Workspace** shows the focused task -
its scratchpad, task file and notes - above every open task grouped by status.
Focus follows the checked-out branch until you click a task, which pins it.
**Board** is the same tasks as cards with a status menu.

- `⌥⌘T` focus a task (searchable by ID or title)
- `⌥⌘P` open the focused task's prompt scratchpad
- `⌥⌘L` open its plan

Opened via `sabin open` (the generated `.code-workspace`), focusing a task also
swaps the Explorer to that ticket's worktree and notes, so `Cmd+P` is scoped to
what you are working on.

## iTerm2

**One window per ticket.** The step verbs open a new tab so the shell you typed
the command in stays yours - and they open it in the window that already holds
that ticket's terminals, provided that window is the ticket's *alone*. A window
shared with another ticket is never reused, so if everything you have is
currently in one big window, each ticket moves out to its own the next time you
open a tab for it, rather than needing a clean slate. So `plan`,
`implement`, `review` and `term` on SABIN-0017 end up side by side, ⌘1-⌘9 walks
one ticket's terminals, and the tab bar stops being a flat list of everything
you have open. `--here` takes over the current tab; `--window` forces a new
window.

```bash
sabin term SABIN-0017      # a shell in its worktree, in its window
sabin sessions             # everything live, grouped by ticket
sabin jump SABIN-0017      # go to its terminal from anywhere
sabin jump                 # or pick from every worktree
```

Sabin works out which ticket a terminal belongs to from its working directory,
so a tab you opened by hand and `cd`'d into a worktree is found too - there is
nothing to register.

### Knowing which agent needs you

```bash
sabin init --hooks
```

Installs four Claude Code hooks that report what the agent is doing, so
`sabin sessions`, the picker and the VS Code sidebar can show **waiting for
you** / **busy** / **idle** instead of just "an agent is running here". They
are merged into `.claude/settings.local.json`, which is not committed, and
running it twice changes nothing.

It is opt-in rather than part of `sabin init` because hooks run a command on
every turn of every agent in that project - your call, not a side effect of
setting Sabin up. Without them nothing breaks: agents simply show no badge,
because an agent with no hooks is unknown rather than idle.

Codex has an equivalent `notify` setting, but it lives in the global
`~/.codex/config.toml` rather than in the project, so Sabin does not write it
for you. The command it would run is `sabin agent-state waiting`.

### A global picker

```bash
sabin jump --install-hotkey            # or --key ctrl+space, cmd+shift+j...
```

This writes an iTerm2 Dynamic Profile for a dedicated hotkey window that runs
the picker: press the key anywhere on the machine, type to filter, Enter to
jump, and the window hides itself the moment it hands focus over. iTerm2 loads
the profile immediately; delete
`~/Library/Application Support/iTerm2/DynamicProfiles/sabin.json` to remove it.

Tabs are titled `SABIN-0017 · claude`, which also makes iTerm2's own Open
Quickly (⇧⌘O) find them. A shell that rewrites the title on every prompt will
overwrite that - the tab is also tagged with a `user.sabinTicket` variable,
which nothing else writes to, and which you can put in a profile's title format
as `\(user.sabinTicket)`.

## Configuration

`config.json` in the Sabin directory. Everything after `taskNumberPadding` is optional.

```json
{
  "projectPrefix": "MYPROJECT",
  "taskNumberPadding": 4,
  "branch":    { "prefix": "angelo", "template": "{prefix}/{ticket}-{slug}" },
  "worktrees": { "root": "../myproject-worktrees", "postCreate": ["npm ci"] },
  "slug":      { "from": "title", "maxLength": 32, "stopWords": true },
  "agents":    { "default": "claude", "definitions": {} },
  "editor":    "code"
}
```

`claude` and `codex` launch out of the box. Anything else is a definition;
arguments may use `{prompt}`, `{ticket}`, `{notesDir}`, `{worktree}` and
`{taskFile}`, and `{prompt}` is appended when a definition never mentions it:

```json
"agents": {
  "default": "codex",
  "definitions": {
    "codex": { "command": "codex", "args": ["--full-auto", "{prompt}"] },
    "aider": { "command": "aider", "args": ["--message", "{prompt}"] }
  }
}
```

### Hooks

`hooks/<status>.md` holds project instructions for an agent moving a task to
that status. `sabin task update` prints the file after the change lands, so
it reaches the agent from the command it had to run anyway.

```
# hooks/completed.md
Push the branch and open a pull request with `gh pr create --fill`.
```

## Claude Code plugin

The repo is also a Claude Code plugin that ships the skill:

```
/plugin marketplace add /path/to/sabin
/plugin install sabin@sabin-local
```

## License

MIT
