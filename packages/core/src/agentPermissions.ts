import fs from 'fs/promises';
import path from 'path';

/**
 * Deny an agent read access to the prompt scratchpads.
 *
 * The scratchpad is where prompts get drafted before they are handed to an
 * agent, so an agent reading it sees half-formed instructions it was never
 * meant to act on. Living outside the repo keeps it out of the way; this rule
 * is what actually stops a read.
 *
 * Written to .claude/settings.local.json rather than the shared settings
 * file: the path is absolute and machine-specific, and Claude Code keeps the
 * local file out of git.
 */
export async function denyPromptsAccess(
  projectRoot: string,
  promptsDir: string
): Promise<{ path: string; added: boolean }> {
  const settingsPath = path.join(projectRoot, '.claude', 'settings.local.json');

  // Double slash anchors at the filesystem root; a single slash would anchor
  // at the settings file's own directory
  const rule = `Read(//${trimLeadingSlash(promptsDir)}/**)`;

  let settings: Record<string, any> = {};
  try {
    settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
  } catch {
    // No settings yet, or unreadable - start from an empty object rather than
    // destroying something we could not parse
    if (await fileExists(settingsPath)) {
      return { path: settingsPath, added: false };
    }
  }

  const permissions = settings.permissions ?? (settings.permissions = {});
  const deny: string[] = permissions.deny ?? (permissions.deny = []);

  if (deny.includes(rule)) {
    return { path: settingsPath, added: false };
  }

  deny.push(rule);

  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);

  return { path: settingsPath, added: true };
}

function trimLeadingSlash(target: string): string {
  return target.replace(/^\/+/, '');
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
