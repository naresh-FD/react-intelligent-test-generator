#!/usr/bin/env node
/**
 * Development Server with Auto Test Generation
 *
 * This script runs both:
 * 1. Webpack dev server (your app)
 * 2. Auto test generator in watch mode
 *
 * Usage:
 *   node scripts/dev.mjs              - Run both server + watcher
 *   node scripts/dev.mjs --no-testgen - Run only the dev server
 *   node scripts/dev.mjs --coverage   - Run with coverage enabled
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const noTestgen = args.includes('--no-testgen');
const withCoverage = args.includes('--coverage');

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
  console.log(`${colors.dim}[${timestamp}]${colors.reset} ${color}[${prefix}]${colors.reset} ${message}`);
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
║           Development Server + Auto Test Generator          ║
╚═══════════════════════════════════════════════════════════╝${colors.reset}
`);

const processes = [];

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

// Start Test Generator Watcher (unless --no-testgen)
if (!noTestgen) {
  log('TEST', colors.yellow, 'Starting auto test generator in watch mode...');

  const testgenArgs = ['scripts/auto-testgen.mjs', 'watch'];
  if (withCoverage) {
    testgenArgs.push('--coverage');
  }

  const testgen = spawnWithPrefix('node', testgenArgs, 'TEST', colors.yellow);
  processes.push(testgen);

  testgen.on('close', (code) => {
    if (code !== null) {
      log('TEST', colors.yellow, `Test generator exited with code ${code}`);
    }
  });
} else {
  log('TEST', colors.dim, 'Test generator disabled (--no-testgen)');
}

// Handle cleanup on exit
function cleanup() {
  console.log(`\n${colors.yellow}Shutting down...${colors.reset}`);
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
