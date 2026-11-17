# Migrate an old Sabin directory

Move one old, per-repo Sabin directory into the global home. Run it once per
old directory. Ask the user which ones to migrate; do not search their disk
for them.

**Copy, never move. Never delete or edit the old directory**, nor any worktree
or branch, except the branch renames in step 4 that the user approves. The old
directory stays as the backup until the user removes it themselves.

## 0. Find what you are migrating

An old directory is one of:

- `<repo>/.sabin/` - a directory inside the repo, or
- `<repo>/.sabin` - a **file** holding `{"sabinDir": "<path>"}`; the directory
  is that path, resolved against the repo.

Either way, `<repo>` (its main clone) is the repo the old directory belonged
to. Old layout:

```
<old>/
  config.json                 projectPrefix, taskNumberPadding, branch, worktrees, agents, ...
  tasks/open/<ID>.md          status open, ready, in_progress, review
  tasks/completed/<ID>.md     status completed (or legacy `resolved`)
  notes/<ID>-<slug>/          plan.md, feedback.md, any other notes
  prompts/<ID>-<slug>.md      the user's scratchpad
  hooks/<status>.md
  research/                   free-form files
  state/                      old agent activity
  <name>.code-workspace
```

Check the new CLI is installed: `sabin --help` lists `setup`, `new`, `work`.
The home is `$SABIN_HOME`, else `~/sabin`. Run `sabin setup` first if
`<home>/config.json` does not exist.

## 1. Mapping

| Old | New |
| --- | --- |
| `tasks/open/<ID>.md`, `tasks/completed/<ID>.md` | `tasks/<ID>/task.md` |
| `notes/<ID>-<slug>/plan.md` | `tasks/<ID>/plan.md` |
| `notes/<ID>-<slug>/feedback.md` | `tasks/<ID>/review.md` (same round format) |
| `notes/<ID>-<slug>/<anything else>` | `tasks/<ID>/<same name>`; subdirectories copied as they are |
| `prompts/<ID>-<slug>.md` | `tasks/<ID>/prompt.md` (replacing the template) |
| `hooks/<status>.md` | `hooks/<repo>/<status>.md` (per-repo: the old hooks were this repo's) |
| `research/<ID>.md` (named for a task) | `tasks/<ID>/research.md` |
| `research/<other>` | not migrated; list it for the user |
| `config.json` | merged into `<home>/config.json` (see step 5) |
| `state/`, `*.code-workspace` | not migrated |

A note whose name is reserved in the new layout (`task.md`, `prompt.md`,
`log.md`) is copied as `old-<name>`.

**Frontmatter of `task.md`:**

- keep `status` and `title`; `resolved` becomes `completed`;
- drop `slug`, `branch` and `worktree` - workspaces are found from git now;
- set `created: <YYYY-MM-DD>` to the old file's date when you can tell it
  (its git history, or `stat -f %SB -t %F <file>` on macOS); else keep today;
- add `project: <slug>` only if the user asks for one;
- keep the body unchanged.

## 2. ID collisions

IDs must be unique across the whole home. A collision happens when the ID
already exists in `<home>/tasks/`, typically because two old directories both
used the same prefix (both have `TASK-0001`).

Resolve each collision by renaming the incoming task with a per-repo prefix:
`TASK-0012` from repo `web` becomes `WEB-0012` (the repo name uppercased, with
anything that is not a letter or digit removed; it must match
`^[A-Z][A-Z0-9]*-\d+$`). Keep the number. Ask the user before choosing the
prefix, and ask which directory keeps the original IDs.

A renamed task's **existing worktree** is found by its branch name, which still
says `TASK-0012`. To keep it discovered, rename the local branch so it contains
the new ID, in that worktree:

```bash
git -C <worktree> branch -m <old-branch> <old-branch with TASK-0012 replaced by WEB-0012>
```

The worktree directory, its commits and its upstream setting stay as they are;
only the local branch name changes. If the branch was pushed, the remote branch
keeps its old name - pushes still go to the configured upstream. Rename only
with the user's approval; if they decline, the task migrates without its
worktree showing until one is created with `sabin work`.

Update the ID inside the copied files too: the `# ID - title` line of
`prompt.md`, and headings such as `# Review: TASK-0012`. Do not rewrite the
body text of notes.

## 3. Dry run - always first

Before writing anything, show the user a complete listing and wait for a yes:

```
Old directory:  /path/to/repo/.sabin  (repo: web, /path/to/repo)
Home:           /Users/me/sabin

Tasks (14)
  SABIN-0001  completed  -> tasks/SABIN-0001/  task.md, plan.md, prompt.md
  SABIN-0012  review     -> tasks/WEB-0012/    RENAMED (collision)  task.md, plan.md, review.md, prompt.md
  ...
Branch renames (1)
  /path/to/repo-worktrees/SABIN-0012-foo: me/SABIN-0012-foo -> me/WEB-0012-foo
Hooks
  hooks/completed.md -> hooks/web/completed.md
Config
  register repo web -> /path/to/repo
  repos.web.worktreesRoot = "../repo-worktrees"   (from worktrees.root)
  repos.web.postCreate = ["npm install"]          (from worktrees.postCreate)
  branch.prefix = "me"                            (unchanged / new / CONFLICT)
Not migrated
  research/prd.md, state/, repo.code-workspace
```

## 4. Write

For each task, in order:

1. Create it through the CLI, so the ID is validated and the write is locked:
   `sabin new "<title>" --id <ID> --json`.
2. Replace the body of `tasks/<ID>/task.md` (below the frontmatter) with the
   old body. Set `created` (and `project`, if asked) in the frontmatter by
   hand; leave the other keys as `sabin new` wrote them.
3. `sabin status <ID> <status>` with the old status. Ignore the hook it prints:
   this is a migration, not a transition.
4. Copy the notes, plan, feedback and prompt per the mapping.

Then copy the hooks, and make the approved branch renames.

## 5. Config and repo

1. `sabin repo add <repo>` registers the repo (its main clone). Note the name
   it prints.
2. Edit `<home>/config.json` by hand, keeping valid JSON:
   - `worktrees.root` -> `repos.<name>.worktreesRoot` (still relative to the
     repo) - only when it differs from the default `../<repo>-worktrees`;
   - `worktrees.postCreate` -> `repos.<name>.postCreate`;
   - `branch.prefix` -> `branch.prefix`, and `branch.template` ->
     `branch.template` with `{ticket}` replaced by `{id}`. These are global
     now: if another directory already set a different value, ask;
   - `projectPrefix` -> `idPrefix` and `taskNumberPadding` -> `idPadding`, only
     for the directory whose IDs should continue the sequence. Ask.
   - `agents`, `editor`, `slug`, `notesDir`, `promptsDir`: dropped.

## 6. Verify

- `sabin ls --all --json` lists every migrated task, with the old status.
- For each task that had a worktree, `sabin context <ID> --json` shows it in
  `workspaces`.
- Spot-check two tasks: `task.md` frontmatter, `plan.md`, `prompt.md`.

## 7. Report, and what is left for the user

Report the counts, the renames, and anything not migrated. Then list what only
the user should remove, once they are satisfied:

- the old directory itself;
- the repo's `.sabin` link file, and its `.sabin` line in `.git/info/exclude`;
- in the repo's `.claude/settings.local.json`: the old prompts deny rule, and
  the `sabin agent-state busy|waiting|idle|gone` hooks from `sabin init
  --hooks`. Those hooks still work (the new command ignores the argument) but
  duplicate the global ones from `sabin setup --hooks`.
