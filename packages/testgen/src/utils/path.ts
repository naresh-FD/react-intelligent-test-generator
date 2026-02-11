import path from 'path';
import { SRC_DIR, TESTS_DIR_NAME } from '../config';
import { exists, listFilesRecursive } from '../fs';

export function isTestFile(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, '/');
    return normalized.includes(`/${TESTS_DIR_NAME}/`) || normalized.endsWith('.test.tsx');
}

export function scanSourceFiles(): string[] {
    const files = listFilesRecursive(SRC_DIR);
    return files.filter(
        (file) => file.endsWith('.tsx') && !isTestFile(file)
    );
}

export function getTestFilePath(sourceFilePath: string): string {
    const dir = path.dirname(sourceFilePath);
    const base = path.basename(sourceFilePath, path.extname(sourceFilePath));
    return path.join(dir, TESTS_DIR_NAME, `${base}.test.tsx`);
}

export function relativeImport(fromFile: string, toFile: string): string {
    const fromDir = path.dirname(fromFile);
    let rel = path.relative(fromDir, toFile).replace(/\\/g, '/');
    if (!rel.startsWith('.')) rel = `./${rel}`;
    return rel.replace(/\.tsx?$/, '');
}

export function resolveRenderWithProvidersPath(sourceFilePath: string): string {
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

    return path.join(SRC_DIR, 'test-utils', 'renderWithProviders.tsx');
}
