import path from 'path';
import fs from 'fs';

export const ROOT_DIR = process.cwd();
export const TESTS_DIR_NAME = '__tests__';
export const COVERAGE_DIR = path.join(ROOT_DIR, 'coverage');

/**
 * Auto-detect the source directory.
 * Checks common patterns: src/, lib/, app/, source/
 */
export const SRC_DIR = detectSrcDir();

function detectSrcDir(): string {
    const candidates = ['src', 'lib', 'app', 'source'];
    for (const dir of candidates) {
        const fullPath = path.join(ROOT_DIR, dir);
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
            return fullPath;
        }
    }
    // Fallback to src
    return path.join(ROOT_DIR, 'src');
}
