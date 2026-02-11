import path from 'path';
import { exists, readFile } from '../fs';
import { ROOT_DIR } from '../config';

export type TestFramework = 'jest' | 'vitest';

let _cachedFramework: TestFramework | null = null;

/**
 * Detects whether the project uses Jest or Vitest.
 * Checks package.json dependencies and config files.
 */
export function detectTestFramework(): TestFramework {
    if (_cachedFramework) return _cachedFramework;

    // Check for vitest config files
    const vitestConfigs = [
        'vitest.config.ts',
        'vitest.config.js',
        'vitest.config.mts',
        'vitest.config.mjs',
    ];
    for (const config of vitestConfigs) {
        if (exists(path.join(ROOT_DIR, config))) {
            _cachedFramework = 'vitest';
            return 'vitest';
        }
    }

    // Check package.json
    const pkgPath = path.join(ROOT_DIR, 'package.json');
    if (exists(pkgPath)) {
        try {
            const pkg = JSON.parse(readFile(pkgPath));
            const allDeps = {
                ...pkg.dependencies,
                ...pkg.devDependencies,
            };
            if (allDeps['vitest']) {
                _cachedFramework = 'vitest';
                return 'vitest';
            }
        } catch {
            // ignore parse errors
        }
    }

    // Default to jest
    _cachedFramework = 'jest';
    return 'jest';
}

/**
 * Returns the mock function call for the detected framework.
 * jest.fn() for Jest, vi.fn() for Vitest.
 */
export function mockFn(): string {
    return detectTestFramework() === 'vitest' ? 'vi.fn()' : 'jest.fn()';
}
