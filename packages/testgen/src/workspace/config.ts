import fs from 'fs';
import path from 'path';
import { ROOT_DIR } from '../config';

export type FrameworkMode = 'auto' | 'jest' | 'vitest';
export type GenerationKind = 'components' | 'hooks' | 'utils';
export type GenerationMode = 'git-unstaged' | 'changed-since' | 'all' | 'file';

export interface TestgenDefaults {
    include: string[];
    exclude: string[];
    framework: FrameworkMode;
    renderHelper: string | 'auto';
    generateFor: GenerationKind[];
    mode: GenerationMode;
}

export interface TestgenPackageConfig {
    name: string;
    root: string;
    include?: string[];
    exclude?: string[];
    framework?: FrameworkMode;
    renderHelper?: string | 'auto';
    generateFor?: GenerationKind[];
    mode?: GenerationMode;
}

export interface TestgenConfig {
    version: 1;
    defaults: TestgenDefaults;
    packages: TestgenPackageConfig[];
}

const DEFAULTS: TestgenDefaults = {
    include: ['src/**/*.{ts,tsx}'],
    exclude: ['**/__tests__/**', '**/*.test.*', '**/dist/**', '**/build/**', '**/coverage/**'],
    framework: 'auto',
    renderHelper: 'auto',
    generateFor: ['components', 'hooks', 'utils'],
    mode: 'git-unstaged',
};

export function loadConfig(rootDir: string = ROOT_DIR, explicitConfigPath?: string): TestgenConfig {
    const configPath = explicitConfigPath
        ? resolveConfigPath(rootDir, explicitConfigPath)
        : path.join(rootDir, 'react-testgen.config.json');

    if (!fs.existsSync(configPath)) {
        return defaultSinglePackageConfig(rootDir);
    }

    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Partial<TestgenConfig>;
    validateConfig(raw, configPath);

    const defaults: TestgenDefaults = {
        ...DEFAULTS,
        ...raw.defaults,
        include: raw.defaults?.include ?? DEFAULTS.include,
        exclude: raw.defaults?.exclude ?? DEFAULTS.exclude,
        generateFor: raw.defaults?.generateFor ?? DEFAULTS.generateFor,
    };

    const packages = (raw.packages ?? []).map((pkg) => ({
        ...pkg,
        include: pkg.include ?? defaults.include,
        exclude: pkg.exclude ?? defaults.exclude,
        framework: pkg.framework ?? defaults.framework,
        renderHelper: pkg.renderHelper ?? defaults.renderHelper,
        generateFor: pkg.generateFor ?? defaults.generateFor,
        mode: pkg.mode ?? defaults.mode,
    }));

    return {
        version: 1,
        defaults,
        packages,
    };
}

function resolveConfigPath(rootDir: string, configPath: string): string {
    return path.isAbsolute(configPath) ? configPath : path.join(rootDir, configPath);
}

function defaultSinglePackageConfig(rootDir: string): TestgenConfig {
    return {
        version: 1,
        defaults: { ...DEFAULTS },
        packages: [
            {
                name: 'default',
                root: '.',
                include: DEFAULTS.include,
                exclude: DEFAULTS.exclude,
                framework: DEFAULTS.framework,
                renderHelper: DEFAULTS.renderHelper,
                generateFor: DEFAULTS.generateFor,
                mode: DEFAULTS.mode,
            },
        ],
    };
}

function validateConfig(config: Partial<TestgenConfig>, configPath: string): void {
    if (config.version !== 1) {
        throw new Error(`Invalid config version in ${configPath}. Expected "version": 1.`);
    }
    if (!config.defaults) {
        throw new Error(`Missing "defaults" in ${configPath}.`);
    }
    if (!Array.isArray(config.packages) || config.packages.length === 0) {
        throw new Error(`Missing non-empty "packages" in ${configPath}.`);
    }

    validateDefaults(config.defaults, configPath);
    const names = new Set<string>();
    config.packages.forEach((pkg, index) => {
        if (!pkg || typeof pkg !== 'object') {
            throw new Error(`Invalid package at index ${index} in ${configPath}.`);
        }
        if (!pkg.name || typeof pkg.name !== 'string') {
            throw new Error(`Package at index ${index} is missing "name" in ${configPath}.`);
        }
        if (!pkg.root || typeof pkg.root !== 'string') {
            throw new Error(`Package "${pkg.name}" is missing "root" in ${configPath}.`);
        }
        if (names.has(pkg.name)) {
            throw new Error(`Duplicate package name "${pkg.name}" in ${configPath}.`);
        }
        names.add(pkg.name);
        validatePackage(pkg, configPath);
    });
}

function validateDefaults(defaults: Partial<TestgenDefaults>, configPath: string): void {
    if (defaults.include && !Array.isArray(defaults.include)) {
        throw new Error(`"defaults.include" must be an array in ${configPath}.`);
    }
    if (defaults.exclude && !Array.isArray(defaults.exclude)) {
        throw new Error(`"defaults.exclude" must be an array in ${configPath}.`);
    }
    if (defaults.framework && !['auto', 'jest', 'vitest'].includes(defaults.framework)) {
        throw new Error(`"defaults.framework" must be one of auto|jest|vitest in ${configPath}.`);
    }
    if (defaults.mode && !['git-unstaged', 'changed-since', 'all', 'file'].includes(defaults.mode)) {
        throw new Error(`"defaults.mode" must be one of git-unstaged|changed-since|all|file in ${configPath}.`);
    }
    if (defaults.generateFor && !isValidGenerateFor(defaults.generateFor)) {
        throw new Error(`"defaults.generateFor" contains invalid values in ${configPath}.`);
    }
}

function validatePackage(pkg: Partial<TestgenPackageConfig>, configPath: string): void {
    if (pkg.include && !Array.isArray(pkg.include)) {
        throw new Error(`"packages[].include" must be an array in ${configPath}.`);
    }
    if (pkg.exclude && !Array.isArray(pkg.exclude)) {
        throw new Error(`"packages[].exclude" must be an array in ${configPath}.`);
    }
    if (pkg.framework && !['auto', 'jest', 'vitest'].includes(pkg.framework)) {
        throw new Error(`"packages[].framework" must be one of auto|jest|vitest in ${configPath}.`);
    }
    if (pkg.mode && !['git-unstaged', 'changed-since', 'all', 'file'].includes(pkg.mode)) {
        throw new Error(`"packages[].mode" must be one of git-unstaged|changed-since|all|file in ${configPath}.`);
    }
    if (pkg.generateFor && !isValidGenerateFor(pkg.generateFor)) {
        throw new Error(`"packages[].generateFor" contains invalid values in ${configPath}.`);
    }
}

function isValidGenerateFor(values: unknown[]): boolean {
    return values.every((v) => v === 'components' || v === 'hooks' || v === 'utils');
}
