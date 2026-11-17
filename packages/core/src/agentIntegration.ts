import fs from 'fs/promises';
import path from 'path';
import { homePaths } from './home';
import { writeFileAtomic } from './fs';
import { UnparsableFileError } from './errors';

/** What every activity hook runs. The payload arrives on stdin. */
export const AGENT_STATE_COMMAND = 'sabin agent-state';

/**
 * The events each agent reports activity through. Claude Code signals a
 * permission or idle wait with `Notification`; Codex has no Notification
 * event and uses `PermissionRequest` instead.
 */
export const CLAUDE_HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'Notification', 'PostToolUse', 'Stop', 'SessionEnd'] as const;
export const CODEX_HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PermissionRequest', 'PostToolUse', 'Stop', 'SessionEnd'] as const;

export interface MergeResult {
  /** The file merged into */
  path: string;
  /** Whether the file was written */
  changed: boolean;
  /** What was added: deny rules or hook event names */
  added: string[];
}

/**
 * Claude Code's permission rule that denies reading every task's prompt.md.
 * `//` anchors at the filesystem root; a single `/` would anchor at the
 * settings file's directory.
 */
export function promptDenyRule(home: string): string {
  const tasksDir = homePaths(home).tasksDir.replace(/^\/+/, '');
  return `Read(//${tasksDir}/**/prompt.md)`;
}

/**
 * Read a JSON settings file for merging. Missing is an empty object;
 * unparsable throws, because writing over a file we could not read would
 * destroy someone's settings.
 */
async function readJsonObject(file: string): Promise<Record<string, any>> {
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (error: any) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
  if (!text.trim()) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error: any) {
    throw new UnparsableFileError(file, error.message);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new UnparsableFileError(file, 'expected a JSON object');
  }
  return parsed as Record<string, any>;
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Add the prompt.md deny rule to a Claude Code settings.json (normally
 * ~/.claude/settings.json). Everything already there is kept.
 */
export async function mergeClaudePromptDeny(settingsPath: string, home: string): Promise<MergeResult> {
  const settings = await readJsonObject(settingsPath);
  const rule = promptDenyRule(home);

  if (!settings.permissions || typeof settings.permissions !== 'object') settings.permissions = {};
  if (!Array.isArray(settings.permissions.deny)) settings.permissions.deny = [];
  const deny: unknown[] = settings.permissions.deny;

  if (deny.includes(rule)) return { path: settingsPath, changed: false, added: [] };

  deny.push(rule);
  await writeJson(settingsPath, settings);
  return { path: settingsPath, changed: true, added: [rule] };
}

/**
 * Merge `{ hooks: { <Event>: [{ hooks: [{ type: 'command', command }] }] } }`
 * entries into an object, skipping events that already run `command`.
 * Claude Code and Codex share this shape. No matcher: omitted matches all.
 */
function mergeHooks(settings: Record<string, any>, events: readonly string[], command: string): string[] {
  if (!settings.hooks || typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)) settings.hooks = {};
  const added: string[] = [];

  for (const event of events) {
    if (!Array.isArray(settings.hooks[event])) settings.hooks[event] = [];
    const groups: any[] = settings.hooks[event];

    const already = groups.some(group =>
      Array.isArray(group?.hooks) && group.hooks.some((hook: any) => hook?.command === command)
    );
    if (already) continue;

    groups.push({ hooks: [{ type: 'command', command }] });
    added.push(event);
  }

  return added;
}

/**
 * Add the activity hooks to a Claude Code settings.json. Existing hooks for
 * the same events are kept beside ours. Idempotent.
 */
export async function mergeClaudeActivityHooks(settingsPath: string, command = AGENT_STATE_COMMAND): Promise<MergeResult> {
  const settings = await readJsonObject(settingsPath);
  const added = mergeHooks(settings, CLAUDE_HOOK_EVENTS, command);
  if (added.length === 0) return { path: settingsPath, changed: false, added };
  await writeJson(settingsPath, settings);
  return { path: settingsPath, changed: true, added };
}

/**
 * Add the activity hooks to a Codex hooks.json (normally
 * ~/.codex/hooks.json). Existing hooks are kept. Idempotent.
 */
export async function mergeCodexActivityHooks(hooksPath: string, command = AGENT_STATE_COMMAND): Promise<MergeResult> {
  const settings = await readJsonObject(hooksPath);
  const added = mergeHooks(settings, CODEX_HOOK_EVENTS, command);
  if (added.length === 0) return { path: hooksPath, changed: false, added };
  await writeJson(hooksPath, settings);
  return { path: hooksPath, changed: true, added };
}
