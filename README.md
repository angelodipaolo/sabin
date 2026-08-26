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
sabin task create "Add telemetry to uploads" --open   # task file + notes dir, opens in your editor
sabin run SABIN-0012                                   # worktree, branch, in_progress, agent launched in it
sabin run SABIN-0012 --tab                             # ...in a new iTerm2 tab, keeping this shell
sabin task list                                        # what is in flight
sabin open                                             # board, notes and prompts in one VS Code window
```

The agent follows the **sabin skill**: it orients with `sabin context --json`,
reads the ticket's notes, writes plans and research there, and moves the task
to `review` when it has committed. You review and say `/sabin complete`; the
agent marks it completed and follows your project's completion hook - "push
and open a PR", say. Worktrees are never removed for you.

Optional steps in between, all via the skill: `/sabin create` to expand a
rough idea into a task, `/sabin plan` to write a plan, `/sabin review` to have
a fresh agent review the diff.

### Statuses

| Status | Meaning |
| --- | --- |
| `open` | Requirements captured |
| `ready` | Planned, ready to implement |
| `in_progress` | An agent (or you) is on it |
| `review` | Finished and committed, waiting on you |
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
sabin start <ticket>[-suffix]          worktree + branch + notes, marks in_progress
sabin run [ticket]                     start, then launch an agent in the worktree
                                       [--claude|--codex|-a name] [--tab] [--print] [--no-start]
sabin open [ticket]                    [--worktree|--notes|--prompt|--plan|--task|--sabin]
sabin context --json                   the agent's orienting call
sabin where [ticket]                   [--notes|--prompt|--plan|--worktree|--task|--sabin|--code-workspace]
sabin notes new <name>                 [--template plan]
sabin skill install                    [--agent claude|codex]
```

Tickets are inferred from the current branch when omitted. A branch with no
ticket is an error, never a guess.

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

`sabin run` names the tab after the ticket and sets it as the badge, so a row
of agent tabs reads as tickets. `sabin run --tab` launches the agent in a new
tab of the current window instead of taking over your shell. For a plain shell
in a worktree:

```bash
scd() { cd "$(sabin where --worktree "$1")"; }
```

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
