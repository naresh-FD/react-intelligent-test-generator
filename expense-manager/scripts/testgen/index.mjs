#!/usr/bin/env node

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { ROOT_DIR, SRC_DIR, SCRIPTS_DIR } from './config.mjs';
import { scanSrcFiles, isSourceFile, getTestFilePath } from './utils/path.mjs';
import { loadTypeScript, getTS, createSourceFile } from './utils/tsconfig.mjs';
import { DeepComponentAnalyzer } from './analysis/tsxAnalyzer.mjs';
import { SmartTestGenerator } from './generation/testWriter.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'all';

  try {
    await loadTypeScript();

    switch (command) {
      case 'all':
        await processAllFiles();
        break;
      case 'file':
        if (!args[1]) {
          console.error('Please provide a file path: node index.mjs file <path>');
          process.exit(1);
        }
        await processFile(args[1]);
        break;
      case 'git-unstaged':
        await processGitUnstagedFiles();
        break;
      default:
        console.error(`Unknown command: ${command}`);
        console.error('Available commands: all, file <path>, git-unstaged');
        process.exit(1);
    }

    console.log('✅ Test generation completed successfully!');
  } catch (error) {
    console.error('❌ Error during test generation:', error.message);
    process.exit(1);
  }
}

async function processAllFiles() {
  console.log('📁 Scanning source files...');
  const files = scanSrcFiles();
  const sourceFiles = files.filter((f) => isSourceFile(f) && f.endsWith('.tsx'));

  if (sourceFiles.length === 0) {
    console.log('⚠️  No source files found.');
    return;
  }

  console.log(`📝 Found ${sourceFiles.length} source files. Generating tests...`);

  for (const file of sourceFiles) {
    try {
      await processFile(file);
    } catch (error) {
      console.warn(`⚠️  Skipped ${file}: ${error.message}`);
    }
  }
}

async function processGitUnstagedFiles() {
  console.log('🔍 Getting git-unstaged files...');

  try {
    const output = execSync('git diff --name-only --diff-filter=ACMTU', {
      cwd: ROOT_DIR,
      encoding: 'utf8',
    });

    const files = output
      .split('\n')
      .filter((f) => f && isSourceFile(f) && f.endsWith('.tsx'))
      .map((f) => {
        // Git returns paths relative to repo root, but we might be in a subdirectory
        // If path starts with expense-manager/, strip it (we're already in that dir)
        const cleanPath = f.replace(/^expense-manager[\/\\]/, '');
        return path.join(ROOT_DIR, cleanPath);
      });

    if (files.length === 0) {
      console.log('⚠️  No unstaged source files found. Nothing to generate.');
      return;
    }

    console.log(`📝 Found ${files.length} unstaged files. Generating tests...`);

    for (const file of files) {
      try {
        await processFile(file);
      } catch (error) {
        console.warn(`⚠️  Skipped ${file}: ${error.message}`);
      }
    }
  } catch (error) {
    // Git command failed - might not be in a git repo or git not installed
    console.warn('⚠️  Could not get git status. Skipping git-unstaged generation.');
    console.warn(`    Reason: ${error.message}`);
    // Don't throw - this is not a fatal error, just skip
    return;
  }
}

async function processFile(filePath) {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(ROOT_DIR, filePath);

  // Validate file exists and is a source file
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found: ${absolutePath}`);
  }

  if (!isSourceFile(absolutePath) || !absolutePath.endsWith('.tsx')) {
    throw new Error(`File must be a .tsx component: ${absolutePath}`);
  }

  const testFilePath = getTestFilePath(absolutePath);

  // Check if test file already exists
  if (fs.existsSync(testFilePath)) {
    console.log(`⏭️  Skipping ${path.relative(ROOT_DIR, absolutePath)} (test file exists)`);
    return;
  }

  console.log(`🔍 Analyzing ${path.relative(ROOT_DIR, absolutePath)}...`);

  try {
    // Read source file
    const sourceCode = fs.readFileSync(absolutePath, 'utf-8');

    // Analyze component
    const analyzer = new DeepComponentAnalyzer(sourceCode, absolutePath);
    const components = analyzer.analyze();

    if (components.length === 0) {
      console.log(`⏭️  No components found in ${path.relative(ROOT_DIR, absolutePath)}`);
      return;
    }

    // Generate tests
    const generator = new SmartTestGenerator(components, absolutePath, testFilePath);
    const testContent = generator.generate();

    // Ensure test directory exists
    const testDir = path.dirname(testFilePath);
    fs.mkdirSync(testDir, { recursive: true });

    // Write test file
    fs.writeFileSync(testFilePath, testContent, 'utf8');

    console.log(`✅ Generated ${path.relative(ROOT_DIR, testFilePath)}`);
  } catch (error) {
    throw new Error(`Failed to generate test for ${path.basename(absolutePath)}: ${error.message}`);
  }
}

main();
