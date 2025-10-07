#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const os = require('os');

function installClaudeCommands() {
  console.log('Installing Sabin Claude commands...');

  const commandsDir = path.join(os.homedir(), '.claude', 'commands');
  const prompts = ['create-ticket', 'plan', 'implement', 'commit'];

  // Create .claude/commands directory if it doesn't exist
  if (!fs.existsSync(commandsDir)) {
    fs.mkdirSync(commandsDir, { recursive: true });
    console.log('Created .claude/commands directory');
  }

  let installedCount = 0;
  let skippedCount = 0;

  for (const prompt of prompts) {
    const source = path.join(__dirname, '..', 'prompts', `${prompt}.md`);
    const dest = path.join(commandsDir, `sabin-${prompt}.md`);

    if (!fs.existsSync(source)) {
      console.error(`  ERROR: Source file not found: ${source}`);
      continue;
    }

    try {
      fs.copyFileSync(source, dest);
      console.log(`  ✓ Installed: sabin-${prompt}`);
      installedCount++;
    } catch (error) {
      console.error(`  ERROR: Failed to install ${prompt}:`, error.message);
      skippedCount++;
    }
  }

  console.log('\nSummary:');
  console.log(`  Installed: ${installedCount} commands`);
  if (skippedCount > 0) {
    console.log(`  Skipped: ${skippedCount} commands`);
  }

  console.log('\nClaude commands installed successfully!');
  console.log('\nAvailable commands in Claude:');
  console.log('  /sabin-create-ticket - Create a new ticket');
  console.log('  /sabin-plan - Create an implementation plan');
  console.log('  /sabin-implement - Implement a ticket');
  console.log('  /sabin-commit - Create a commit for changes');
  console.log('\nNote: You may need to restart Claude for the commands to appear.');
}

try {
  installClaudeCommands();
} catch (error) {
  console.error('Installation failed:', error);
  process.exit(1);
}