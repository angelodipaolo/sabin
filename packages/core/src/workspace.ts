import fs from 'fs/promises';
import path from 'path';
import { SabinConfig } from './types';
import { currentBranch, mainWorktreeRoot, repoRoot } from './git';

export const DEFAULT_NOTES_DIR = 'notes';
export const DEFAULT_PROMPTS_DIR = 'prompts';
export const DEFAULT_BRANCH_TEMPLATE = '{prefix}/{ticket}-{slug}';

export interface WorkspacePaths {
  ticket: string;
  /** Descriptive suffix, e.g. "update-telemetry". Null when the ticket has none. */
  slug: string | null;
  /** <TICKET>-<slug>, or just <TICKET> - the directory name used everywhere */
  name: string;
  sabinDir: string;
  notesDir: string;
  promptFile: string;
  worktreeDir: string;
}

export interface TicketRef {
  ticket: string;
  slug: string | null;
}

export interface Workspace extends WorkspacePaths {
  branch: string | null;
  mainRoot: string | null;
  taskFile: string | null;
}

/**
 * Extract a ticket ID from a branch name.
 *
 * Tries the project's own prefix first, then any uppercase JIRA-style key.
 * Returns null rather than guessing - resolving to the wrong ticket's notes
 * is the worst failure mode in this design.
 */
export function ticketFromBranch(branch: string, config: SabinConfig): string | null {
  if (!branch) return null;

  const prefix = config.projectPrefix;
  if (prefix) {
    const own = branch.match(new RegExp(`(?:^|[^A-Za-z0-9])(${escapeRegex(prefix)}-\\d+)(?![0-9])`, 'i'));
    if (own) return own[1].toUpperCase();
  }

  // External keys such as JIRA-12345. Uppercase-only, so lowercase branch
  // slugs like "add-2fa" are not mistaken for tickets.
  const external = branch.match(/(?:^|[^A-Za-z0-9])([A-Z][A-Z0-9]+-\d+)(?![0-9])/);
  return external ? external[1] : null;
}

/**
 * The directory name for a ticket: <TICKET>-<slug>, or bare <TICKET> when
 * there is no descriptive suffix.
 */
export function workspaceName(ticket: string, slug?: string | null): string {
  return slug ? `${ticket}-${slug}` : ticket;
}

/**
 * Split a command-line ticket argument into its ID and descriptive suffix.
 *
 * "JIRA-12345-update-telemetry" -> { ticket: 'JIRA-12345', slug: 'update-telemetry' }
 * "SABIN-0004"                  -> { ticket: 'SABIN-0004', slug: null }
 */
export function parseTicketArg(arg: string): TicketRef | null {
  const match = arg.trim().match(/^([A-Za-z][A-Za-z0-9]*-\d+)(?:[-_/](.+))?$/);
  if (!match) return null;

  return {
    ticket: match[1].toUpperCase(),
    slug: match[2] ? slugify(match[2], EXPLICIT_SLUG_MAX_LENGTH) : null
  };
}

/**
 * Recover the descriptive suffix from a branch name, given its ticket.
 *
 * Used only as a fallback - the task file is the source of truth.
 */
export function slugFromBranch(branch: string, ticket: string): string | null {
  const index = branch.toUpperCase().indexOf(ticket.toUpperCase());
  if (index === -1) return null;

  const remainder = branch.slice(index + ticket.length).replace(/^[-_/]/, '');
  return remainder ? slugify(remainder) : null;
}

/** Filler words that carry no meaning in a directory name */
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from',
  'in', 'into', 'is', 'it', 'of', 'on', 'or', 'per', 'that', 'the', 'this',
  'to', 'via', 'with'
]);

export const DEFAULT_SLUG_MAX_LENGTH = 32;
/** Explicit suffixes are the user's own words, so they get more room */
export const EXPLICIT_SLUG_MAX_LENGTH = 50;

/**
 * Normalise text into a directory-safe suffix.
 *
 * Truncation lands on a word boundary rather than mid-word, and never leaves
 * a trailing filler word - "support-for-multiple-plans-per" reads like a bug.
 */
export function slugify(text: string, maxLength: number = EXPLICIT_SLUG_MAX_LENGTH): string {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return assembleSlug(words, maxLength);
}

/**
 * Derive a suffix from a task title, honouring the project's slug config.
 *
 * Returns null when derivation is switched off or the title yields nothing.
 */
export function slugFromTitle(title: string, config: SabinConfig): string | null {
  if (!title || config.slug?.from === 'none') return null;

  const maxLength = config.slug?.maxLength ?? DEFAULT_SLUG_MAX_LENGTH;
  const useStopWords = config.slug?.stopWords ?? true;

  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return null;

  // Fall back to the full set when stripping would leave nothing
  const stripped = useStopWords ? words.filter(word => !STOP_WORDS.has(word)) : words;
  const slug = assembleSlug(stripped.length > 0 ? stripped : words, maxLength);

  return slug || null;
}

/**
 * Join words up to a length cap, breaking on word boundaries
 */
function assembleSlug(words: string[], maxLength: number): string {
  const kept: string[] = [];
  let length = 0;

  for (const word of words) {
    const cost = kept.length === 0 ? word.length : word.length + 1;
    if (length + cost > maxLength) break;
    kept.push(word);
    length += cost;
  }

  // A single oversized word still needs to produce something
  if (kept.length === 0) {
    return words.length > 0 ? words[0].slice(0, maxLength).replace(/-+$/g, '') : '';
  }

  while (kept.length > 1 && STOP_WORDS.has(kept[kept.length - 1])) {
    kept.pop();
  }

  return kept.join('-');
}

/**
 * Build a branch name from the configured template.
 *
 * Takes the already-resolved suffix so the branch always matches the
 * worktree and notes directory names.
 */
export function branchNameFor(
  ticket: string,
  slug: string | null,
  config: SabinConfig
): string {
  const template = config.branch?.template ?? DEFAULT_BRANCH_TEMPLATE;
  const prefix = config.branch?.prefix ?? '';
  const suffix = slug ? slugify(slug) : '';

  const name = template
    .replace('{prefix}', prefix)
    .replace('{ticket}', ticket)
    .replace('{slug}', suffix);

  // Collapse artifacts left behind by empty template values
  return name.replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '').replace(/-+$/g, '');
}

/**
 * Default worktree root for a repo: a sibling <repo>-worktrees directory
 */
export function defaultWorktreeRoot(mainRoot: string): string {
  return path.join(path.dirname(mainRoot), `${path.basename(mainRoot)}-worktrees`);
}

/**
 * Every path belonging to a ticket, derived purely from its ID
 */
export function workspacePaths(
  ref: TicketRef,
  sabinDir: string,
  mainRoot: string | null,
  config: SabinConfig
): WorkspacePaths {
  const { ticket, slug } = ref;
  const name = workspaceName(ticket, slug);
  const notesRoot = path.resolve(sabinDir, config.notesDir ?? DEFAULT_NOTES_DIR);
  const promptsRoot = path.resolve(sabinDir, config.promptsDir ?? DEFAULT_PROMPTS_DIR);

  let worktreeRoot: string;
  if (config.worktrees?.root) {
    worktreeRoot = path.resolve(mainRoot ?? sabinDir, config.worktrees.root);
  } else if (mainRoot) {
    worktreeRoot = defaultWorktreeRoot(mainRoot);
  } else {
    worktreeRoot = path.resolve(sabinDir, 'worktrees');
  }

  return {
    ticket,
    slug,
    name,
    sabinDir,
    notesDir: path.join(notesRoot, name),
    promptFile: path.join(promptsRoot, `${name}.md`),
    worktreeDir: path.join(worktreeRoot, name)
  };
}

/**
 * A ticket has exactly one plan, at a fixed name inside its notes directory.
 *
 * The path is derived rather than recorded, so there is nothing to attach and
 * nothing that can drift from the file it names.
 */
export const PLAN_FILENAME = 'plan.md';

export function planPath(notesDir: string): string {
  return path.join(notesDir, PLAN_FILENAME);
}

/**
 * The ticket's plan, or null when it has not been written yet
 */
export async function findPlan(notesDir: string): Promise<string | null> {
  const file = planPath(notesDir);
  try {
    await fs.access(file);
    return file;
  } catch {
    return null;
  }
}

/**
 * A ticket's descriptive suffix, resolved without touching git.
 *
 * The recorded value wins, then a directory already on disk, then the title.
 * Mirrors resolveWorkspace's precedence for callers that already hold a
 * parsed task and cannot afford a git call per ticket.
 */
export async function slugForTicket(
  ticket: string,
  recorded: string | null | undefined,
  title: string | null | undefined,
  sabinDir: string,
  config: SabinConfig
): Promise<string | null> {
  if (recorded) return slugify(recorded);

  const notesRoot = path.resolve(sabinDir, config.notesDir ?? DEFAULT_NOTES_DIR);
  const existing = await findWorkspaceDir(notesRoot, ticket);
  if (existing && existing.length > ticket.length) {
    return existing.slice(ticket.length + 1);
  }

  return title ? slugFromTitle(title, config) : null;
}

/**
 * Find a directory belonging to a ticket, whatever suffix it carries.
 *
 * Lets paths keep resolving when the task file is gone, and keeps
 * pre-suffix directories working.
 */
export async function findWorkspaceDir(root: string, ticket: string): Promise<string | null> {
  let entries: string[];
  try {
    entries = (await fs.readdir(root, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
  } catch {
    return null;
  }

  const exact = entries.find(name => name.toUpperCase() === ticket.toUpperCase());
  if (exact) return exact;

  const prefixed = entries.filter(name => name.toUpperCase().startsWith(`${ticket.toUpperCase()}-`));
  return prefixed.length === 1 ? prefixed[0] : null;
}

/**
 * Locate a task file by ID across every tasks/<status> directory
 */
export async function findTaskFile(sabinDir: string, ticket: string): Promise<string | null> {
  const tasksDir = path.join(sabinDir, 'tasks');

  let entries: string[];
  try {
    entries = (await fs.readdir(tasksDir, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
  } catch {
    return null;
  }

  for (const dir of entries) {
    const candidate = path.join(tasksDir, dir, `${ticket}.md`);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try the next status directory
    }
  }

  return null;
}

export interface ResolveWorkspaceOptions {
  sabinDir: string;
  config: SabinConfig;
  cwd?: string;
  /** Explicit override, bypassing branch inference. May carry a suffix. */
  ticket?: string;
  /** Explicit suffix, overriding whatever the task file records */
  slug?: string | null;
}

/**
 * Resolve the workspace for the current checkout.
 *
 * Ticket resolution order: explicit argument, SABIN_TICKET, then the branch.
 */
export async function resolveWorkspace(options: ResolveWorkspaceOptions): Promise<Workspace> {
  const cwd = options.cwd ?? process.cwd();
  const { sabinDir, config } = options;

  const branch = await currentBranch(cwd);
  const mainRoot = await mainWorktreeRoot(cwd);

  const explicit = options.ticket ?? process.env.SABIN_TICKET;
  const parsed = explicit
    ? parseTicketArg(explicit)
    : branch
      ? refFromBranch(branch, config)
      : null;

  if (!parsed) {
    throw new NoTicketError(branch);
  }

  const taskFile = await findTaskFile(sabinDir, parsed.ticket);
  const slug = await resolveSlug(parsed, taskFile, sabinDir, config, options.slug);

  const paths = workspacePaths({ ticket: parsed.ticket, slug }, sabinDir, mainRoot, config);

  return { ...paths, branch, mainRoot, taskFile };
}

function refFromBranch(branch: string, config: SabinConfig): TicketRef | null {
  const ticket = ticketFromBranch(branch, config);
  return ticket ? { ticket, slug: slugFromBranch(branch, ticket) } : null;
}

/**
 * Settle on a ticket's descriptive suffix.
 *
 * The task file wins, so a workspace keeps the same paths for its whole life
 * even if someone types a different suffix later. Falls back to what was
 * asked for, then to whatever directory already exists on disk.
 */
async function resolveSlug(
  parsed: TicketRef,
  taskFile: string | null,
  sabinDir: string,
  config: SabinConfig,
  override?: string | null
): Promise<string | null> {
  if (override !== undefined && override !== null) return slugify(override);

  if (taskFile) {
    const recorded = await readTaskSlug(taskFile);
    if (recorded) return recorded;
  }

  if (parsed.slug) return parsed.slug;

  // An existing directory wins over derivation, so workspaces created before
  // title derivation was switched on keep resolving to their own paths
  const title = taskFile ? await readTaskTitle(taskFile) : null;
  return slugForTicket(parsed.ticket, null, title, sabinDir, config);
}

async function readTaskTitle(taskFile: string): Promise<string | null> {
  try {
    const content = await fs.readFile(taskFile, 'utf8');
    const match = content.match(/^title:\s*(.+)$/m);
    return match ? match[1].trim().replace(/^['"]|['"]$/g, '') : null;
  } catch {
    return null;
  }
}

async function readTaskSlug(taskFile: string): Promise<string | null> {
  try {
    const content = await fs.readFile(taskFile, 'utf8');
    const match = content.match(/^slug:\s*(.+)$/m);
    return match ? slugify(match[1].trim().replace(/^['"]|['"]$/g, '')) : null;
  } catch {
    return null;
  }
}

export class NoTicketError extends Error {
  constructor(public branch: string | null) {
    super(
      branch
        ? `No ticket found in branch "${branch}". Pass a ticket explicitly or set SABIN_TICKET.`
        : 'Not on a branch (detached HEAD). Pass a ticket explicitly or set SABIN_TICKET.'
    );
    this.name = 'NoTicketError';
  }
}

/**
 * Current worktree, when it is one of the repo's worktrees
 */
export async function currentWorktree(cwd: string): Promise<string | null> {
  return repoRoot(cwd);
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
