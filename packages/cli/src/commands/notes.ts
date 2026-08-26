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
 * Scaffold a note in the ticket's notes directory and print its path.
 *
 * Deliberately the only notes command - reading, listing and editing notes
 * are better served by ordinary file tools once the path is known.
 */
export async function notesNew(name: string, options: NotesNewOptions): Promise<void> {
  const { workspace } = await getWorkspace(options.ticket);

  const filename = name.endsWith('.md') ? name : `${name}.md`;
  const target = path.join(workspace.notesDir, filename);

  await fs.mkdir(workspace.notesDir, { recursive: true });

  try {
    await fs.access(target);
    console.log(target);
    return;
  } catch {
    // Does not exist yet, seed it below
  }

  const body = options.template === 'plan'
    ? PLAN_TEMPLATE.replace('{title}', `${workspace.ticket}`)
    : `# ${filename.replace(/\.md$/, '')}\n`;

  await fs.writeFile(target, body);
  console.error(chalk.green(`Created ${filename} in ${workspace.ticket} notes`));
  console.log(target);
}
