import path from 'path';
import fs from 'fs';
import { SRC_DIR, IGNORE_DIRS, IGNORE_PATTERNS } from '../config.mjs';

export function relativeImport(fromFile, toFile) {
  let rel = path.relative(path.dirname(fromFile), toFile);
  rel = rel.replace(/\\/g, '/').replace(/\.tsx?$/, '');
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel;
}

export function getTestFilePath(componentPath) {
  const dir = path.dirname(componentPath);
  const filename = path.basename(componentPath);
  const testFilename = filename.replace(/\.tsx?$/, '.test.tsx');
  const testDir = path.join(dir, '__tests__');
  return path.join(testDir, testFilename);
}

export function isSourceFile(filePath) {
  return /\.(tsx?|jsx?)$/.test(filePath) && !IGNORE_PATTERNS.some((p) => p.test(filePath));
}

export function scanSrcFiles() {
  const files = [];

  function scanDir(dir) {
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORE_DIRS.includes(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (isSourceFile(fullPath)) {
        files.push(fullPath);
      }
    }
  }

  scanDir(SRC_DIR);
  return files;
}

export function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
