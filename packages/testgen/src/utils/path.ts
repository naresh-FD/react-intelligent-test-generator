import path from 'path';
import { SRC_DIR, TESTS_DIR_NAME } from '../config';
import { listFilesRecursive } from '../fs';

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
