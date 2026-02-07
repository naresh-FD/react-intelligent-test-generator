import fs from 'fs';
import path from 'path';

export function exists(filePath: string): boolean {
    return fs.existsSync(filePath);
}

export function ensureDir(dirPath: string): void {
    fs.mkdirSync(dirPath, { recursive: true });
}

export function readFile(filePath: string): string {
    return fs.readFileSync(filePath, 'utf8');
}

export function writeFile(filePath: string, content: string): void {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, content, 'utf8');
}

export function listFilesRecursive(dirPath: string): string[] {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            files.push(...listFilesRecursive(fullPath));
        } else {
            files.push(fullPath);
        }
    }

    return files;
}
