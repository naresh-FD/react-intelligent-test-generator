import path from 'path';
import { SRC_DIR, TESTS_DIR_NAME } from '../config';
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

/**
 * Searches for a renderWithProviders utility file.
 * Returns null if not found (caller should fall back to plain render).
 */
export function resolveRenderWithProvidersPath(sourceFilePath: string): string | null {
    let current = path.dirname(sourceFilePath);
    while (true) {
        if (path.basename(current) === 'src') {
            const directTsx = path.join(current, 'test-utils', 'renderWithProviders.tsx');
            if (exists(directTsx)) return directTsx;
            const directTs = path.join(current, 'test-utils', 'renderWithProviders.ts');
            if (exists(directTs)) return directTs;
        }

        const nestedTsx = path.join(current, 'src', 'test-utils', 'renderWithProviders.tsx');
        if (exists(nestedTsx)) return nestedTsx;
        const nestedTs = path.join(current, 'src', 'test-utils', 'renderWithProviders.ts');
        if (exists(nestedTs)) return nestedTs;

        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
    }

    // Return null instead of a potentially non-existent path
    return null;
}
