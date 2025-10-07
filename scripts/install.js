#!/usr/bin/env node
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

async function install() {
  console.log('Installing Sabin workflow management system...');

  // Install CLI globally
  console.log('\nInstalling CLI...');
  try {
    execSync('npm install -g @sabin/cli', { stdio: 'inherit' });
  } catch (error) {
    console.error('Failed to install CLI globally. You may need to run with sudo.');
    console.error('Alternatively, you can install it locally by running: npm link');
  }

  // Install VS Code extension
  console.log('\nInstalling VS Code extension...');
  try {
    const vsixPath = path.join(__dirname, '..', 'packages', 'vscode-extension', 'sabin-vscode-0.1.0.vsix');
    if (fs.existsSync(vsixPath)) {
      execSync(`code --install-extension "${vsixPath}"`, { stdio: 'inherit' });
    } else {
      console.log('VSIX file not found. Please run "npm run package:vscode" first.');
    }
  } catch (error) {
    console.error('Failed to install VS Code extension. Make sure VS Code CLI is available.');
  }

  // Create .sabin directory structure
  console.log('\nCreating .sabin directory structure...');
  const sabinDirs = [
    '.sabin/tickets/open',
    '.sabin/tickets/resolved',
    '.sabin/plans',
    '.sabin/research'
  ];

  for (const dir of sabinDirs) {
    const fullPath = path.join(process.cwd(), dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
      console.log(`  Created: ${dir}`);
    } else {
      console.log(`  Already exists: ${dir}`);
    }
  }

  // Create initial TODO.md if it doesn't exist
  const todoPath = path.join(process.cwd(), '.sabin', 'TODO.md');
  if (!fs.existsSync(todoPath)) {
    fs.writeFileSync(todoPath, '# TODO\n\n');
    console.log('  Created: .sabin/TODO.md');
  }

  console.log('\nSabin installation complete!');
  console.log('\nNext steps:');
  console.log('  1. Run "sabin --help" to see available commands');
  console.log('  2. Open VS Code and look for the Sabin activity bar icon');
  console.log('  3. Create your first ticket with "sabin create-ticket"');
}

install().catch(error => {
  console.error('Installation failed:', error);
  process.exit(1);
});