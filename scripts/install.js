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

  console.log('\nSabin installation complete!');
  console.log('\nNext steps:');
  console.log('  1. Run "sabin skill install" so your agent knows the workflow');
  console.log('  2. Run "sabin init" inside a repo to set it up');
  console.log('  3. Run "sabin --help" to see available commands');
  console.log('  4. Run "sabin open" to see the board in VS Code');
}

install().catch(error => {
  console.error('Installation failed:', error);
  process.exit(1);
});