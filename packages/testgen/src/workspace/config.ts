import fs from 'node:fs';
import path from 'node:path';

import { ROOT_DIR } from '../config';

export type FrameworkMode = 'auto' | 'jest' | 'vitest';
export type GenerationKind = 'components' | 'hooks' | 'utils';
export type GenerationMode = 'git-unstaged' | 'changed-since' | 'all' | 'file';

/**
 * Controls behavior when a test file already exists for a source file.
 * - 'merge':   Preserve existing tests, append only missing generated blocks (default).
 * - 'replace': Overwrite the entire test file with a fresh generation.
 * - 'skip':    Do not touch existing test files at all.
 */
export type ExistingTestStrategy = 'merge' | 'replace' | 'skip';

// ---------------------------------------------------------------------------
// Test output location configuration
// ---------------------------------------------------------------------------

export type TestSuffix = '.test' | '.spec';

/**
 * Configures where generated test files are placed.
 *
 * Strategies:
 * - "colocated": Test file next to the source (Button.tsx → Button.test.tsx)
 * - "subfolder": Test file in a subdirectory (Button.tsx → __tests__/Button.test.tsx)
 * - "mirror":    Test files in a separate root, mirroring source structure
 *                (src/components/Button.tsx → tests/components/Button.test.tsx)
 */
export interface TestOutputConfig {
  strategy: 'colocated' | 'subfolder' | 'mirror';
  /** Folder name for "subfolder" or root dir for "mirror". Default: "__tests__" */
  directory?: string;
  /** Source root to strip when mirroring. Default: "src". Only used with "mirror". */
  srcRoot?: string;
  /** File suffix before extension. Default: ".test" */
  suffix?: TestSuffix;
}

/** Fully resolved test output config — all optionals filled with defaults. */
export interface ResolvedTestOutput {
  strategy: 'colocated' | 'subfolder' | 'mirror';
  directory: string;
  srcRoot: string;
  suffix: TestSuffix;
}

/** Default test output config — matches current behavior (subfolder + __tests__ + .test) */
export const DEFAULT_TEST_OUTPUT: ResolvedTestOutput = {
  strategy: 'subfolder',
  directory: '__tests__',
  srcRoot: 'src',
  suffix: '.test',
};

/**
 * Resolve a partial TestOutputConfig into a fully-filled ResolvedTestOutput.
 * When input is undefined, returns the backwards-compatible default.
 */
export function resolveTestOutput(raw?: TestOutputConfig): ResolvedTestOutput {
  if (!raw) return { ...DEFAULT_TEST_OUTPUT };

  switch (raw.strategy) {
    case 'colocated':
      return {
        strategy: 'colocated',
        directory: '',
        srcRoot: raw.srcRoot ?? 'src',
        suffix: raw.suffix ?? '.test',
      };
    case 'subfolder':
      return {
        strategy: 'subfolder',
        directory: raw.directory ?? '__tests__',
        srcRoot: raw.srcRoot ?? 'src',
        suffix: raw.suffix ?? '.test',
      };
    case 'mirror':
      return {
        strategy: 'mirror',
        directory: raw.directory ?? 'tests',
        srcRoot: raw.srcRoot ?? 'src',
        suffix: raw.suffix ?? '.test',
      };
    default:
      return { ...DEFAULT_TEST_OUTPUT };
  }
}

export interface TestgenDefaults {
  include: string[];
  exclude: string[];
  framework: FrameworkMode;
  renderHelper: string | 'auto';
  generateFor: GenerationKind[];
  mode: GenerationMode;
  testOutput?: TestOutputConfig;
  existingTestStrategy: ExistingTestStrategy;
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
  testOutput?: TestOutputConfig;
  existingTestStrategy?: ExistingTestStrategy;
}

export interface TestgenConfig {
  version: 1;
  defaults: TestgenDefaults;
  packages: TestgenPackageConfig[];
}

const DEFAULTS: TestgenDefaults = {
  include: ['src/**/*.{js,jsx,ts,tsx}'],
  exclude: ['**/__tests__/**', '**/*.test.*', '**/dist/**', '**/build/**', '**/coverage/**'],
  framework: 'auto',
  renderHelper: 'auto',
  generateFor: ['components', 'hooks', 'utils'],
  mode: 'git-unstaged',
  existingTestStrategy: 'merge',
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
    existingTestStrategy: pkg.existingTestStrategy ?? defaults.existingTestStrategy,
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

function defaultSinglePackageConfig(_rootDir: string): TestgenConfig {
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
        existingTestStrategy: DEFAULTS.existingTestStrategy,
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
    throw new Error(
      `"defaults.mode" must be one of git-unstaged|changed-since|all|file in ${configPath}.`
    );
  }
  if (defaults.generateFor && !isValidGenerateFor(defaults.generateFor)) {
    throw new Error(`"defaults.generateFor" contains invalid values in ${configPath}.`);
  }
  validateTestOutput((defaults as Record<string, unknown>).testOutput, 'defaults.testOutput', configPath);
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
    throw new Error(
      `"packages[].mode" must be one of git-unstaged|changed-since|all|file in ${configPath}.`
    );
  }
  if (pkg.generateFor && !isValidGenerateFor(pkg.generateFor)) {
    throw new Error(`"packages[].generateFor" contains invalid values in ${configPath}.`);
  }
}

function isValidGenerateFor(values: unknown[]): boolean {
  return values.every((v) => v === 'components' || v === 'hooks' || v === 'utils');
}

// ---------------------------------------------------------------------------
// testOutput validation
// ---------------------------------------------------------------------------

const VALID_STRATEGIES = ['subfolder', 'colocated', 'mirror'];
const VALID_SUFFIXES = ['.test', '.spec'];

function validateTestOutput(
  testOutput: unknown,
  fieldPath: string,
  configPath: string,
): void {
  if (testOutput === undefined || testOutput === null) return;
  if (typeof testOutput !== 'object') {
    throw new Error(`"${fieldPath}" must be an object in ${configPath}.`);
  }

  const obj = testOutput as Record<string, unknown>;

  if (!obj.strategy || !VALID_STRATEGIES.includes(obj.strategy as string)) {
    throw new Error(
      `"${fieldPath}.strategy" must be one of ${VALID_STRATEGIES.join('|')} in ${configPath}.`
    );
  }

  if (obj.suffix !== undefined && !VALID_SUFFIXES.includes(obj.suffix as string)) {
    throw new Error(
      `"${fieldPath}.suffix" must be one of ${VALID_SUFFIXES.join('|')} in ${configPath}.`
    );
  }

  if (obj.directory !== undefined) {
    if (typeof obj.directory !== 'string' || (obj.directory as string).length === 0) {
      throw new Error(`"${fieldPath}.directory" must be a non-empty string in ${configPath}.`);
    }
  }

  if (obj.srcRoot !== undefined) {
    if (typeof obj.srcRoot !== 'string' || (obj.srcRoot as string).length === 0) {
      throw new Error(`"${fieldPath}.srcRoot" must be a non-empty string in ${configPath}.`);
    }
  }

  if (obj.strategy === 'mirror' && !obj.directory) {
    // For mirror, directory defaults to "tests" — this is fine (resolveTestOutput fills it).
    // But if explicitly provided as empty string, that's caught above.
  }
}
