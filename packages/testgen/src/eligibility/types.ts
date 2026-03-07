// ---------------------------------------------------------------------------
// Eligibility Engine — Core Types
// ---------------------------------------------------------------------------

/**
 * Detected "kind" of a source file based on AST signals and file metadata.
 */
export type FileKind =
    | 'component'
    | 'hook'
    | 'context'
    | 'util'
    | 'service'
    | 'barrel'
    | 'types'
    | 'constants'
    | 'store'
    | 'entry'
    | 'storybook'
    | 'mock'
    | 'test'
    | 'config'
    | 'unknown';

/**
 * Action to take for a file after eligibility analysis.
 */
export type EligibilityAction =
    | 'generate-full-test'
    | 'generate-minimal-test'
    | 'merge-with-existing-test'
    | 'skip-safe'
    | 'manual-review';

/**
 * Raw signals detected from AST analysis and file metadata.
 * Each boolean/number field represents a specific signal about the file.
 */
export interface FileSignals {
    // --- File metadata signals ---
    fileName: string;
    filePath: string;
    extension: string;
    lineCount: number;
    isDeclarationFile: boolean;     // .d.ts
    isTestFile: boolean;            // .test.ts, .spec.ts, __tests__/
    isStoryFile: boolean;           // .stories.tsx, .story.tsx
    isMockFile: boolean;            // __mocks__/, *.mock.ts, fixtures/
    isGeneratedFile: boolean;       // auto-generated markers in content
    isConfigFile: boolean;          // config/setup filenames

    // --- Export signals ---
    totalExports: number;
    namedExports: string[];
    hasDefaultExport: boolean;
    reExportCount: number;          // export { x } from './y'
    typeOnlyExportCount: number;    // export type { ... } / export interface
    constantExportCount: number;    // export const X = literal
    functionExportCount: number;    // export function / export const fn = () =>
    classExportCount: number;

    // --- JSX signals ---
    hasJsx: boolean;
    jsxElementCount: number;

    // --- React signals ---
    hasReactImport: boolean;
    usesCreateContext: boolean;
    usesUseContext: boolean;
    usesProvider: boolean;          // exports or renders a Provider
    hookNames: string[];            // all use* function definitions
    reactHookCallCount: number;     // useState, useEffect, useMemo, etc.
    usesForwardRef: boolean;
    usesPortal: boolean;
    usesMemo: boolean;
    usesCallback: boolean;

    // --- State management signals ---
    usesZustand: boolean;
    usesReduxToolkit: boolean;
    usesJotai: boolean;
    usesReduxHooks: boolean;        // useSelector, useDispatch

    // --- Router signals ---
    usesRouter: boolean;            // react-router imports/hooks

    // --- HTTP/Service signals ---
    usesAxios: boolean;
    usesFetch: boolean;
    usesHttpClient: boolean;        // any HTTP library
    asyncFunctionCount: number;

    // --- Third-party signals ---
    thirdPartyImportCount: number;
    serviceImportCount: number;     // imports from services/api/client dirs
    totalImportCount: number;

    // --- Side effect signals ---
    usesLocalStorage: boolean;
    usesSessionStorage: boolean;
    usesWindow: boolean;
    usesDocument: boolean;
    usesDynamicImport: boolean;
    hasTopLevelSideEffects: boolean;

    // --- Complexity signals ---
    /** Number of import declarations */
    importCount: number;
    /** Number of exported symbols */
    exportCount: number;
    /** Whether a matching test file already exists */
    hasExistingTestFile: boolean;
    /** Path to existing test file, if any */
    existingTestFilePath: string | null;

    // --- Naming signals ---
    isPascalCase: boolean;          // filename starts with uppercase
    startsWithUse: boolean;         // filename starts with 'use'
    isIndexFile: boolean;           // index.ts / index.tsx
    isAppEntry: boolean;            // App.tsx, main.tsx, index.tsx at root
}

/**
 * Complete eligibility result for a single file.
 */
export interface FileEligibilityResult {
    filePath: string;
    fileKind: FileKind;
    action: EligibilityAction;
    /** 0-100 confidence in the classification */
    confidence: number;
    /** 0-100 how testable this file is */
    testabilityScore: number;
    /** 0-100 how complex the file's dependencies are */
    complexityScore: number;
    /** Human-readable reasons for the action */
    reasons: string[];
    /** Raw signal names that contributed to the decision */
    detectedSignals: string[];
}

/**
 * Aggregated scan report from the eligibility engine.
 */
export interface EligibilityScanReport {
    timestamp: string;
    totalFiles: number;
    results: FileEligibilityResult[];
    summary: {
        generateFullTest: string[];
        generateMinimalTest: string[];
        mergeWithExistingTest: string[];
        skipSafe: SkipEntry[];
        manualReview: ManualReviewEntry[];
    };
}

export interface SkipEntry {
    filePath: string;
    reason: string;
}

export interface ManualReviewEntry {
    filePath: string;
    reason: string;
    complexityScore: number;
}
