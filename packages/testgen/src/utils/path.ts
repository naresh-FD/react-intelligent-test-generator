import path from 'node:path';
import fs from 'node:fs';
import { ROOT_DIR, TESTS_DIR_NAME, detectSrcDir } from '../config';
import type { ResolvedTestOutput } from '../workspace/config';
import { DEFAULT_TEST_OUTPUT } from '../workspace/config';
import { exists, listFilesRecursive } from '../fs';

export interface ScanSourceFilesOptions {
  packageRoot?: string;
  include?: string[];
  exclude?: string[];
}

interface GenerationContext {
  packageRoot: string;
  renderHelperOverride: string;
}

let _activeContext: GenerationContext | null = null;
const _cachedRenderHelper = new Map<string, { path: string; exportName: string } | null>();

function normalizeSlashes(value: string): string {
  return value.split('\\').join('/');
}

export function setPathResolutionContext(context: GenerationContext | null): void {
  _activeContext = context;
}

export function isTestFile(filePath: string): boolean {
  const normalized = normalizeSlashes(filePath);
  return (
    normalized.includes(`/${TESTS_DIR_NAME}/`) ||
    normalized.endsWith('.test.tsx') ||
    normalized.endsWith('.test.ts')
  );
}

export function scanSourceFiles(options: ScanSourceFilesOptions = {}): string[] {
  const packageRoot = options.packageRoot ?? ROOT_DIR;
  const srcDir = detectSrcDir(packageRoot);
  const scanRoot = fs.existsSync(srcDir) ? srcDir : packageRoot;
  if (!fs.existsSync(scanRoot)) return [];

  const files = listFilesRecursive(scanRoot);
  const include = options.include ?? ['src/**/*.{ts,tsx}'];
  const exclude = options.exclude ?? [
    '**/__tests__/**',
    '**/*.test.*',
    '**/dist/**',
    '**/build/**',
    '**/coverage/**',
  ];

  return files.filter((filePath) => {
    if (isTestFile(filePath)) return false;
    if (!filePath.endsWith('.ts') && !filePath.endsWith('.tsx')) return false;
    const rel = normalizeSlashes(path.relative(packageRoot, filePath));
    const includeMatch = include.length === 0 || include.some((pattern) => matchGlob(rel, pattern));
    if (!includeMatch) return false;
    return !exclude.some((pattern) => matchGlob(rel, pattern));
  });
}

export function getTestFilePath(
  sourceFilePath: string,
  testOutput: ResolvedTestOutput = DEFAULT_TEST_OUTPUT,
  packageRoot: string = ROOT_DIR,
): string {
  const dir = path.dirname(sourceFilePath);
  const ext = path.extname(sourceFilePath);
  const base = path.basename(sourceFilePath, ext);
  const testFileName = `${base}${testOutput.suffix}${ext}`;

  switch (testOutput.strategy) {
    case 'colocated':
      return path.join(dir, testFileName);
    case 'mirror': {
      const sourceRoot = path.join(packageRoot, testOutput.srcRoot);
      const relativeSourceDir = path.relative(sourceRoot, dir);
      return path.join(packageRoot, testOutput.directory, relativeSourceDir, testFileName);
    }
    case 'subfolder':
    default: {
      const outputDir = testOutput.directory || TESTS_DIR_NAME;
      return path.join(dir, outputDir, testFileName);
    }
  }
}

export function relativeImport(fromFile: string, toFile: string): string {
  const fromDir = path.dirname(fromFile);
  let rel = normalizeSlashes(path.relative(fromDir, toFile));
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel.replace(/\.(tsx?|jsx?)$/, '');
}

/**
 * Searches for a custom render helper (renderWithProviders or similar) in the active package.
 * If an explicit helper path is configured, it is used first.
 */
export function resolveRenderHelper(
  sourceFilePath: string
): { path: string; exportName: string } | null {
  const packageRoot = _activeContext?.packageRoot ?? ROOT_DIR;
  const override = _activeContext?.renderHelperOverride ?? 'auto';

  if (override !== 'auto') {
    const abs = path.isAbsolute(override) ? override : path.join(packageRoot, override);
    if (exists(abs)) {
      const exportName = detectRenderExport(abs);
      if (exportName) return { path: abs, exportName };
    }
  }

  const cacheKey = `${packageRoot}::${sourceFilePath}`;
  if (_cachedRenderHelper.has(cacheKey)) {
    return _cachedRenderHelper.get(cacheKey) ?? null;
  }

  const result = findRenderHelper(packageRoot);
  _cachedRenderHelper.set(cacheKey, result);
  return result;
}

function findRenderHelper(packageRoot: string): { path: string; exportName: string } | null {
  const srcDir = detectSrcDir(packageRoot);
  const dirsToCheck = getRenderHelperDirsToCheck(srcDir, packageRoot);
  const directMatch = findRenderHelperInDirs(dirsToCheck);
  if (directMatch) return directMatch;
  return findRenderHelperBySourceScan(srcDir);
}

function getRenderHelperDirsToCheck(srcDir: string, packageRoot: string): string[] {
  const dirsToCheck = [srcDir];
  collectRenderHelperDirs(dirsToCheck, srcDir);
  collectRenderHelperDirs(dirsToCheck, packageRoot);
  return dirsToCheck;
}

function collectRenderHelperDirs(dirsToCheck: string[], baseDir: string): void {
  for (const dirName of RENDER_HELPER_DIRS) {
    const dirPath = path.join(baseDir, dirName);
    if (exists(dirPath) && !dirsToCheck.includes(dirPath)) {
      dirsToCheck.push(dirPath);
    }
  }
}

function findRenderHelperInDirs(
  dirsToCheck: string[]
): { path: string; exportName: string } | null {
  for (const dir of dirsToCheck) {
    for (const fileName of RENDER_HELPER_FILE_NAMES) {
      for (const ext of ['.tsx', '.ts', '.jsx', '.js']) {
        const filePath = path.join(dir, `${fileName}${ext}`);
        if (!exists(filePath)) continue;
        const exportName = detectRenderExport(filePath);
        if (exportName) return { path: filePath, exportName };
      }
    }
  }
  return null;
}

function isEligibleRenderHelperCandidate(filePath: string): boolean {
  if (isTestFile(filePath)) return false;
  const ext = path.extname(filePath);
  if (!['.ts', '.tsx', '.js', '.jsx'].includes(ext)) return false;
  const normalized = normalizeSlashes(filePath);
  return (
    !normalized.includes('/node_modules/') &&
    !normalized.includes('/dist/') &&
    !normalized.includes('/build/')
  );
}

function findRenderHelperBySourceScan(srcDir: string): { path: string; exportName: string } | null {
  if (!exists(srcDir)) return null;

  try {
    const allFiles = listFilesRecursive(srcDir);
    const candidates = allFiles.filter(isEligibleRenderHelperCandidate);
    for (const filePath of candidates) {
      const exportName = detectRenderExport(filePath);
      if (exportName) return { path: filePath, exportName };
    }
  } catch {
    return null;
  }

  return null;
}

function detectRenderExport(filePath: string): string | null {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const exportPatterns = [
      /export\s+(?:async\s+)?function\s+(renderWithProviders|customRender|renderWithWrapper|renderWithContext)\b/,
      /export\s+const\s+(renderWithProviders|customRender|renderWithWrapper|renderWithContext)\b/,
      /export\s*\{[^}]*(renderWithProviders|customRender|renderWithWrapper|renderWithContext)[^}]*\}/,
      /(?:module\.)?exports\.(renderWithProviders|customRender|renderWithWrapper|renderWithContext)\b/,
    ];

    for (const pattern of exportPatterns) {
      const match = pattern.exec(content);
      if (match) return match[1];
    }

    if (
      content.includes('@testing-library/react') &&
      (content.includes('export function render') ||
        content.includes('export const render') ||
        content.includes('export { render') ||
        content.includes('export default'))
    ) {
      const customExportMatch = /export\s+(?:const|function)\s+(render\w+)/.exec(content);
      if (customExportMatch) {
        // Skip async render helpers — our generator doesn't handle async render functions
        const asyncCheck = new RegExp(
          `export\\s+const\\s+${customExportMatch[1]}\\s*=\\s*async\\b|` +
          `export\\s+async\\s+function\\s+${customExportMatch[1]}\\b`
        );
        if (asyncCheck.test(content)) return null;
        return customExportMatch[1];
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Legacy API - Searches for a renderWithProviders utility file.
 * @deprecated Use resolveRenderHelper() instead
 */
export function resolveRenderWithProvidersPath(sourceFilePath: string): string | null {
  const helper = resolveRenderHelper(sourceFilePath);
  return helper ? helper.path : null;
}

/** Reset the cached render helper (useful for testing) */
export function _resetRenderHelperCache(): void {
  _cachedRenderHelper.clear();
}

const RENDER_HELPER_FILE_NAMES = [
  'renderWithProviders',
  'render-with-providers',
  'testHelpers',
  'test-helpers',
  'testUtils',
  'test-utils',
  'testing-utils',
  'testingUtils',
  'render-helpers',
  'renderHelpers',
  'customRender',
  'custom-render',
  'wrapper',
  'test-wrapper',
];

const RENDER_HELPER_DIRS = [
  'test-utils',
  'testUtils',
  'util',
  'utils',
  'helpers',
  'test-helpers',
  'testHelpers',
  'testing',
  'test',
  'lib',
  'common',
  'shared',
  'support',
  '__test-utils__',
];

function matchGlob(relativePath: string, pattern: string): boolean {
  const slashNormalized = normalizeSlashes(pattern);
  const normalizedPattern = slashNormalized.startsWith('./')
    ? slashNormalized.slice(2)
    : slashNormalized;
  const regex = globToRegex(normalizedPattern);
  return regex.test(relativePath);
}

function globToRegex(pattern: string): RegExp {
  let out = '^';
  let index = 0;
  while (index < pattern.length) {
    const char = pattern[index];
    const next = pattern[index + 1];

    if (char === '*' && next === '*') {
      out += '.*';
      index += 2;
      continue;
    }
    if (char === '*') {
      out += '[^/]*';
      index++;
      continue;
    }
    if (char === '?') {
      out += '[^/]';
      index++;
      continue;
    }
    if (char === '{') {
      const close = pattern.indexOf('}', index);
      if (close > index) {
        const options = pattern
          .slice(index + 1, close)
          .split(',')
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
          .map((item) => escapeRegex(item));
        out += `(${options.join('|')})`;
        index = close + 1;
        continue;
      }
    }
    out += escapeRegex(char);
    index++;
  }
  out += '$';
  return new RegExp(out);
}

function escapeRegex(value: string): string {
  const specialChars = new Set(['.', '+', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\']);
  let escaped = '';
  for (const char of value) {
    escaped += specialChars.has(char) ? `\\${char}` : char;
  }
  return escaped;
}
