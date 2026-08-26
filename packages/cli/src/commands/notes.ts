import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import { getWorkspace } from '../workspace-context';

interface NotesNewOptions {
  template?: string;
  ticket?: string;
}

const PLAN_TEMPLATE = `# Implementation Plan: {title}

## Overview

## Current State

## Desired End State

## What We're NOT Doing

## Implementation Phases

### Phase 1

**Success:**
`;

/**
 * Seed content for a new note.
 *
 * Notes hold any context an agent might read - JSON, YAML, CSV, logs - so
 * only formats with an obvious empty form get seeded. Everything else starts
 * empty rather than with a guess at its syntax.
 */
function seedFor(filename: string): string {
  switch (path.extname(filename).toLowerCase()) {
    case '.md':
    case '.markdown':
      return `# ${path.basename(filename, path.extname(filename))}\n\n`;
    case '.json':
      return '{}\n';
    default:
      return '';
  }
}

/**
 * Give a bare name the default extension, but never override one the user
 * already chose
 */
export function noteFilename(name: string): string {
  const trimmed = name.trim();
  return path.extname(trimmed) ? trimmed : `${trimmed}.md`;
}

/**
 * Scaffold a note in the ticket's notes directory and print its path.
 *
 * Deliberately the only notes command - reading, listing and editing notes
 * are better served by ordinary file tools once the path is known.
 */
export async function notesNew(name: string, options: NotesNewOptions): Promise<void> {
  const { workspace } = await getWorkspace(options.ticket);

  const filename = noteFilename(name);
  const target = path.join(workspace.notesDir, filename);

  await fs.mkdir(path.dirname(target), { recursive: true });

  try {
    await fs.access(target);
    console.log(target);
    return;
  } catch {
    // Does not exist yet, seed it below
  }

  const body = options.template === 'plan'
    ? PLAN_TEMPLATE.replace('{title}', workspace.ticket)
    : seedFor(filename);

  await fs.writeFile(target, body);
  console.error(chalk.green(`Created ${filename} in ${workspace.ticket} notes`));
  console.log(target);
}
