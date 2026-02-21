import path from 'path';
import { exists, readFile } from '../fs';
import { ROOT_DIR } from '../config';

export type TestFramework = 'jest' | 'vitest';

const _frameworkCache = new Map<string, TestFramework>();
let _activeFramework: TestFramework | null = null;

/**
 * Detects whether the project uses Jest or Vitest.
 * Checks package.json dependencies and config files.
 */
export function detectTestFramework(rootDir: string = ROOT_DIR): TestFramework {
    const normalizedRoot = path.resolve(rootDir);
    const cached = _frameworkCache.get(normalizedRoot);
    if (cached) return cached;

    // Check for vitest config files
    const vitestConfigs = [
        'vitest.config.ts',
        'vitest.config.js',
        'vitest.config.mts',
        'vitest.config.mjs',
    ];
    for (const config of vitestConfigs) {
        if (exists(path.join(normalizedRoot, config))) {
            _frameworkCache.set(normalizedRoot, 'vitest');
            return 'vitest';
        }
    }

    // Check package.json
    const pkgPath = path.join(normalizedRoot, 'package.json');
    if (exists(pkgPath)) {
        try {
            const pkg = JSON.parse(readFile(pkgPath));
            const allDeps = {
                ...pkg.dependencies,
                ...pkg.devDependencies,
            };
            if (allDeps['vitest']) {
                _frameworkCache.set(normalizedRoot, 'vitest');
                return 'vitest';
            }
        } catch {
            // ignore parse errors
        }
    }

    // Default to jest
    _frameworkCache.set(normalizedRoot, 'jest');
    return 'jest';
}

export function detectFrameworkForFile(_filePath: string, packageRoot: string): TestFramework {
    return detectTestFramework(packageRoot);
}

export function setActiveFramework(framework: TestFramework | null): void {
    _activeFramework = framework;
}

export function getActiveFramework(): TestFramework {
    return _activeFramework ?? detectTestFramework();
}

/**
 * Returns the mock function call for the detected framework.
 * jest.fn() for Jest, vi.fn() for Vitest.
 */
export function mockFn(): string {
    return getActiveFramework() === 'vitest' ? 'vi.fn()' : 'jest.fn()';
}

export function mockModuleFn(): string {
    return getActiveFramework() === 'vitest' ? 'vi.mock' : 'jest.mock';
}
