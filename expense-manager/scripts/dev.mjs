#!/usr/bin/env node
/**
 * Development Server with Auto Test Generation
 *
 * This script:
 * 1. Generates tests for unstaged files (one-time at startup)
 * 2. Starts webpack dev server for your app
 *
 * Usage:
 *   node scripts/dev.mjs              - Run server + generate tests for unstaged
 *   node scripts/dev.mjs --no-testgen - Run only the dev server
 */

import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const noTestgen = args.includes('--no-testgen');

const isWindows = process.platform === 'win32';

// Color codes for output
const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  dim: '\x1b[2m',
};

function log(prefix, color, message) {
  const timestamp = new Date().toLocaleTimeString();
  console.log(
    `${colors.dim}[${timestamp}]${colors.reset} ${color}[${prefix}]${colors.reset} ${message}`
  );
}

/**
 * Spawn a child process with output prefixing
 */
function spawnWithPrefix(command, args, prefix, color) {
  const proc = spawn(command, args, {
    cwd: ROOT_DIR,
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: isWindows,
  });

  proc.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean);
    lines.forEach((line) => log(prefix, color, line));
  });

  proc.stderr.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean);
    lines.forEach((line) => log(prefix, colors.red, line));
  });

  proc.on('error', (err) => {
    log(prefix, colors.red, `Error: ${err.message}`);
  });

  return proc;
}

console.log(`
${colors.green}╔═══════════════════════════════════════════════════════════╗
║              Development Server with Test Generation        ║
╚═══════════════════════════════════════════════════════════╝${colors.reset}
`);

const processes = [];

// Generate tests for unstaged files (one-time at startup)
if (!noTestgen) {
  try {
    log('TEST', colors.yellow, 'Generating tests for unstaged files...');
    execSync('node scripts/testgen/index.mjs git-unstaged', {
      cwd: ROOT_DIR,
      stdio: 'inherit',
    });
  } catch (error) {
    // Non-fatal - just warn but continue
    log('TEST', colors.dim, 'No unstaged files or test generation skipped');
  }
} else {
  log('TEST', colors.dim, 'Test generation disabled (--no-testgen)');
}

// Start Webpack Dev Server (use start:raw to avoid recursion since "start" calls this script)
log('DEV', colors.cyan, 'Starting webpack dev server...');
const npmCmd = isWindows ? 'npm.cmd' : 'npm';
const devServer = spawnWithPrefix(npmCmd, ['run', 'start:raw'], 'DEV', colors.cyan);
processes.push(devServer);

devServer.on('close', (code) => {
  if (code !== null) {
    log('DEV', colors.yellow, `Dev server exited with code ${code}`);
  }
});

// Cleanup function to kill child processes
function cleanup() {
  processes.forEach((proc) => {
    if (!proc.killed) {
      proc.kill('SIGTERM');
    }
  });
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', cleanup);

// Keep the process running
process.stdin.resume();
