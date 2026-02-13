import path from 'path';
import fs from 'fs';
import { SRC_DIR, ROOT_DIR, TESTS_DIR_NAME } from '../config';
import { exists, listFilesRecursive } from '../fs';

export function isTestFile(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, '/');
    return normalized.includes(`/${TESTS_DIR_NAME}/`) || normalized.endsWith('.test.tsx') || normalized.endsWith('.test.ts');
}

export function scanSourceFiles(): string[] {
    const files = listFilesRecursive(SRC_DIR);
    return files.filter(
        (file) => (file.endsWith('.tsx') || file.endsWith('.ts')) && !isTestFile(file)
    );
}

export function getTestFilePath(sourceFilePath: string): string {
    const dir = path.dirname(sourceFilePath);
    const ext = path.extname(sourceFilePath);
    const base = path.basename(sourceFilePath, ext);
    // Use .test.tsx for .tsx files, .test.ts for .ts files
    const testExt = ext === '.ts' ? '.test.ts' : '.test.tsx';
    return path.join(dir, TESTS_DIR_NAME, `${base}${testExt}`);
}

export function relativeImport(fromFile: string, toFile: string): string {
    const fromDir = path.dirname(fromFile);
    let rel = path.relative(fromDir, toFile).replace(/\\/g, '/');
    if (!rel.startsWith('.')) rel = `./${rel}`;
    return rel.replace(/\.tsx?$/, '');
}

/** Cache for resolved render helper to avoid repeated filesystem scans */
let _cachedRenderHelper: { path: string; exportName: string } | null | undefined = undefined;

/**
 * Common file names that typically contain a custom render helper.
 * We look for these exact file basenames (without extension).
 */
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

/**
 * Common directory names where test utilities live.
 */
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

/**
 * Searches for a custom render helper (renderWithProviders or similar) in the project.
 *
 * Strategy:
 * 1. First, check well-known directories for well-known file names (fast path)
 * 2. If not found, scan all .ts/.tsx files in src dir for exports of renderWithProviders
 * 3. Cache the result for the session
 *
 * Returns { path, exportName } or null if not found.
 */
export function resolveRenderHelper(sourceFilePath: string): { path: string; exportName: string } | null {
    // Return cached result if available
    if (_cachedRenderHelper !== undefined) return _cachedRenderHelper;

    const result = _findRenderHelper(sourceFilePath);
    _cachedRenderHelper = result;
    return result;
}

function _findRenderHelper(_sourceFilePath: string): { path: string; exportName: string } | null {
    // Determine the source root directory
    const srcDir = SRC_DIR;
    const rootDir = ROOT_DIR;

    // Strategy 1: Check well-known directories for well-known file names
    const dirsToCheck = [srcDir];
    // Also check these dirs relative to the src directory
    for (const dirName of RENDER_HELPER_DIRS) {
        const dirPath = path.join(srcDir, dirName);
        if (exists(dirPath)) dirsToCheck.push(dirPath);
    }
    // Also check dirs at root level (outside src)
    for (const dirName of RENDER_HELPER_DIRS) {
        const dirPath = path.join(rootDir, dirName);
        if (exists(dirPath) && !dirsToCheck.includes(dirPath)) dirsToCheck.push(dirPath);
    }

    for (const dir of dirsToCheck) {
        for (const fileName of RENDER_HELPER_FILE_NAMES) {
            for (const ext of ['.tsx', '.ts', '.jsx', '.js']) {
                const filePath = path.join(dir, `${fileName}${ext}`);
                if (exists(filePath)) {
                    // Verify this file actually exports a render function
                    const exportName = detectRenderExport(filePath);
                    if (exportName) {
                        return { path: filePath, exportName };
                    }
                }
            }
        }
    }

    // Strategy 2: Recursive scan of src directory for any file exporting renderWithProviders
    if (exists(srcDir)) {
        try {
            const allFiles = listFilesRecursive(srcDir);
            const candidates = allFiles.filter(f => {
                if (isTestFile(f)) return false;
                const ext = path.extname(f);
                if (!['.ts', '.tsx', '.js', '.jsx'].includes(ext)) return false;
                // Skip node_modules and build dirs
                const normalized = f.replace(/\\/g, '/');
                if (normalized.includes('/node_modules/') || normalized.includes('/dist/') || normalized.includes('/build/')) return false;
                return true;
            });

            for (const filePath of candidates) {
                const exportName = detectRenderExport(filePath);
                if (exportName) {
                    return { path: filePath, exportName };
                }
            }
        } catch {
            // If recursive scan fails (permissions, etc.), just return null
        }
    }

    return null;
}

/**
 * Reads a file and checks if it exports a custom render function.
 * Returns the export name (e.g., 'renderWithProviders', 'customRender') or null.
 */
function detectRenderExport(filePath: string): string | null {
    try {
        const content = fs.readFileSync(filePath, 'utf8');

        // Look for common render helper export patterns
        const exportPatterns = [
            // export function renderWithProviders
            /export\s+(?:async\s+)?function\s+(renderWithProviders|customRender|renderWithWrapper|renderWithContext)\b/,
            // export const renderWithProviders
            /export\s+const\s+(renderWithProviders|customRender|renderWithWrapper|renderWithContext)\b/,
            // export { renderWithProviders }
            /export\s*\{[^}]*(renderWithProviders|customRender|renderWithWrapper|renderWithContext)[^}]*\}/,
            // module.exports or exports.renderWithProviders
            /(?:module\.)?exports\.(renderWithProviders|customRender|renderWithWrapper|renderWithContext)\b/,
        ];

        for (const pattern of exportPatterns) {
            const match = content.match(pattern);
            if (match) {
                return match[1];
            }
        }

        // Also check for a file that wraps RTL's render and re-exports it
        // e.g., files that import { render } from '@testing-library/react' and export a custom render
        if (
            content.includes('@testing-library/react') &&
            (content.includes('export function render') || content.includes('export const render') ||
             content.includes('export { render') || content.includes('export default'))
        ) {
            // Check if there's a named export that looks like a custom render
            const customExportMatch = content.match(/export\s+(?:const|function)\s+(render\w+)/);
            if (customExportMatch) {
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
 * Returns null if not found (caller should fall back to plain render).
 * @deprecated Use resolveRenderHelper() instead
 */
export function resolveRenderWithProvidersPath(sourceFilePath: string): string | null {
    const helper = resolveRenderHelper(sourceFilePath);
    return helper ? helper.path : null;
}

/** Reset the cached render helper (useful for testing) */
export function _resetRenderHelperCache(): void {
    _cachedRenderHelper = undefined;
}
