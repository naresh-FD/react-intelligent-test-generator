import path from 'node:path';
import fs from 'node:fs';
import { ROOT_DIR, detectSrcDir } from '../config';
import { exists, listFilesRecursive } from '../fs';
import { ResolvedTestOutput, DEFAULT_TEST_OUTPUT } from '../workspace/config';

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
export interface ResolvedRenderHelper {
  path: string;
  exportName: string;
  isAsync: boolean;
}

const _cachedRenderHelper = new Map<string, ResolvedRenderHelper | null>();

function normalizeSlashes(value: string): string {
  return value.split('\\').join('/');
}

export function setPathResolutionContext(context: GenerationContext | null): void {
  _activeContext = context;
}

export function isTestFile(filePath: string, output?: ResolvedTestOutput): boolean {
  const normalized = normalizeSlashes(filePath);
  const cfg = output ?? DEFAULT_TEST_OUTPUT;
  const suffix = cfg.suffix; // '.test' or '.spec'

  // Check suffix-based detection (.test.tsx, .spec.ts, etc.)
  if (
    normalized.endsWith(`${suffix}.tsx`) ||
    normalized.endsWith(`${suffix}.ts`) ||
    normalized.endsWith(`${suffix}.jsx`) ||
    normalized.endsWith(`${suffix}.js`)
  ) {
    return true;
  }

  // Check directory-based detection (e.g. /__tests__/, /specs/, /tests/)
  if (cfg.strategy === 'subfolder' || cfg.strategy === 'mirror') {
    const dir = cfg.directory || '__tests__';
    if (normalized.includes(`/${dir}/`)) return true;
  }

  // Backwards compat: always recognise __tests__ and .test files
  if (normalized.includes('/__tests__/')) return true;
  if (
    normalized.endsWith('.test.tsx') ||
    normalized.endsWith('.test.ts') ||
    normalized.endsWith('.test.jsx') ||
    normalized.endsWith('.test.js')
  ) {
    return true;
  }

  return false;
}

export function scanSourceFiles(options: ScanSourceFilesOptions = {}): string[] {
  const packageRoot = options.packageRoot ?? ROOT_DIR;
  const srcDir = detectSrcDir(packageRoot);
  const scanRoot = fs.existsSync(srcDir) ? srcDir : packageRoot;
  if (!fs.existsSync(scanRoot)) return [];

  const files = listFilesRecursive(scanRoot);
  const include = options.include ?? ['src/**/*.{js,jsx,ts,tsx}'];
  const exclude = options.exclude ?? [
    '**/__tests__/**',
    '**/*.test.*',
    '**/dist/**',
    '**/build/**',
    '**/coverage/**',
  ];

  return files.filter((filePath) => {
    if (isTestFile(filePath)) return false;
    const ext = path.extname(filePath).toLowerCase();
    if (!['.js', '.jsx', '.ts', '.tsx'].includes(ext)) return false;
    const rel = normalizeSlashes(path.relative(packageRoot, filePath));
    const includeMatch = include.length === 0 || include.some((pattern) => matchGlob(rel, pattern));
    if (!includeMatch) return false;
    return !exclude.some((pattern) => matchGlob(rel, pattern));
  });
}

/**
 * Compute the test file path for a given source file.
 *
 * Supports three strategies via `output`:
 *   - **colocated**: test file next to source  (Button.tsx → Button.test.tsx)
 *   - **subfolder**: test in a subdirectory     (Button.tsx → __tests__/Button.test.tsx)
 *   - **mirror**:    separate root mirroring src structure
 *                    (src/components/Button.tsx → tests/components/Button.test.tsx)
 *
 * When called without `output`, defaults to subfolder + __tests__ + .test (backwards compatible).
 */
export function getTestFilePath(
  sourceFilePath: string,
  output?: ResolvedTestOutput,
  packageRoot?: string,
): string {
  const cfg = output ?? DEFAULT_TEST_OUTPUT;
  const dir = path.dirname(sourceFilePath);
  const ext = path.extname(sourceFilePath);
  const base = path.basename(sourceFilePath, ext);
  const testExt = ext === '.ts' || ext === '.js' ? `${cfg.suffix}.ts` : `${cfg.suffix}.tsx`;
  const testFileName = `${base}${testExt}`;

  switch (cfg.strategy) {
    case 'colocated':
      return path.join(dir, testFileName);

    case 'subfolder':
      return path.join(dir, cfg.directory || '__tests__', testFileName);

    case 'mirror': {
      const root = packageRoot ?? ROOT_DIR;
      const srcRootAbs = path.join(root, cfg.srcRoot);
      const rel = normalizeSlashes(path.relative(srcRootAbs, sourceFilePath));

      // Edge case: source file is NOT under srcRoot (relative path starts with ..)
      if (rel.startsWith('..')) {
        console.warn(
          `[testgen] Warning: "${sourceFilePath}" is outside srcRoot "${cfg.srcRoot}". Falling back to subfolder strategy.`
        );
        return path.join(dir, cfg.directory || '__tests__', testFileName);
      }

      // Strip the source filename, keep directory structure
      const relDir = path.dirname(rel);
      return path.join(root, cfg.directory || 'tests', relDir, testFileName);
    }

    default:
      return path.join(dir, cfg.directory || '__tests__', testFileName);
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
): ResolvedRenderHelper | null {
  const packageRoot = _activeContext?.packageRoot ?? ROOT_DIR;
  const override = _activeContext?.renderHelperOverride ?? 'auto';

  if (override !== 'auto') {
    const abs = path.isAbsolute(override) ? override : path.join(packageRoot, override);
    if (exists(abs)) {
      const helper = detectRenderExport(abs);
      if (helper) return { path: abs, exportName: helper.exportName, isAsync: helper.isAsync };
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

function findRenderHelper(packageRoot: string): ResolvedRenderHelper | null {
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
): ResolvedRenderHelper | null {
  for (const dir of dirsToCheck) {
    for (const fileName of RENDER_HELPER_FILE_NAMES) {
      for (const ext of ['.tsx', '.ts', '.jsx', '.js']) {
        const filePath = path.join(dir, `${fileName}${ext}`);
        if (!exists(filePath)) continue;
        const helper = detectRenderExport(filePath);
        if (helper) return { path: filePath, exportName: helper.exportName, isAsync: helper.isAsync };
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

function findRenderHelperBySourceScan(srcDir: string): ResolvedRenderHelper | null {
  if (!exists(srcDir)) return null;

  try {
    const allFiles = listFilesRecursive(srcDir);
    const candidates = allFiles.filter(isEligibleRenderHelperCandidate);
    for (const filePath of candidates) {
      const helper = detectRenderExport(filePath);
      if (helper) return { path: filePath, exportName: helper.exportName, isAsync: helper.isAsync };
    }
  } catch {
    return null;
  }

  return null;
}

function detectRenderExport(filePath: string): { exportName: string; isAsync: boolean } | null {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const exportPatterns = [
      /export\s+(async\s+)?function\s+(renderWithProviders|customRender|renderWithWrapper|renderWithContext)\b/,
      /export\s+const\s+(renderWithProviders|customRender|renderWithWrapper|renderWithContext)\s*=\s*(async\s*)?/,
      /export\s*\{[^}]*(renderWithProviders|customRender|renderWithWrapper|renderWithContext)[^}]*\}/,
      /(?:module\.)?exports\.(renderWithProviders|customRender|renderWithWrapper|renderWithContext)\b/,
    ];

    for (const pattern of exportPatterns) {
      const match = pattern.exec(content);
      if (match) {
        const exportName = match[2] ?? match[1];
        const isAsync = /\basync\b/.test(match[1] ?? '') || /\basync\b/.test(match[3] ?? '');
        return { exportName, isAsync: isAsync || isAsyncRenderExport(content, exportName) };
      }
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
        const exportName = customExportMatch[1];
        return { exportName, isAsync: isAsyncRenderExport(content, exportName) };
      }
    }

    return null;
  } catch {
    return null;
  }
}

function isAsyncRenderExport(content: string, exportName: string): boolean {
  const escaped = exportName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (
    new RegExp(`export\\s+async\\s+function\\s+${escaped}\\b`).test(content) ||
    new RegExp(`export\\s+const\\s+${escaped}\\s*=\\s*async\\b`).test(content) ||
    new RegExp(`const\\s+${escaped}\\s*=\\s*async\\b`).test(content)
  );
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
