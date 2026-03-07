/**
 * Interfaces and types for the incremental test patching system.
 *
 * These abstractions structure the pipeline from coverage analysis
 * to test generation, enabling coverage-gap-driven updates in a
 * future phase. For now, they define the contract so modules can
 * be plugged in incrementally.
 */

// ---------------------------------------------------------------------------
// Existing test analysis
// ---------------------------------------------------------------------------

/** Summary of a single test case found in an existing test file. */
export interface ExistingTestInfo {
    /** The full title string passed to `it()` / `test()` */
    title: string;
    /** The enclosing `describe()` block title, if any */
    describeBlock?: string;
    /** Whether this test was auto-generated (contains @generated marker) */
    isGenerated: boolean;
}

/** Result of analyzing an existing test file's AST. */
export interface ExistingTestAnalysis {
    /** Absolute path to the test file */
    testFilePath: string;
    /** All tests found in the file */
    tests: ExistingTestInfo[];
    /** Top-level describe block names */
    describeBlocks: string[];
    /** Whether the file contains the @generated-repair-block marker */
    hasRepairBlock: boolean;
    /** Imports detected at the top of the file */
    importPaths: string[];
}

// ---------------------------------------------------------------------------
// Coverage gap model
// ---------------------------------------------------------------------------

/** Categories of uncovered behavior that drive test generation. */
export type GapCategory =
    | 'conditional-render-branch'
    | 'event-handler'
    | 'async-success-path'
    | 'async-error-path'
    | 'effect-branch'
    | 'callback-path'
    | 'context-transition'
    | 'utility-edge-case';

/** A group of uncovered lines mapped to a behavior intent. */
export interface CoverageGap {
    /** Which source file the gap belongs to */
    sourceFilePath: string;
    /** Uncovered line numbers (1-based) */
    lines: number[];
    /** Inferred behavior category */
    category: GapCategory;
    /** Human-readable description of the uncovered behavior */
    description: string;
}

// ---------------------------------------------------------------------------
// Patch planning
// ---------------------------------------------------------------------------

/** Patch safety levels — controls how aggressively a repair is applied. */
export enum PatchLevel {
    /** Append missing tests inside the matching `describe` block */
    AppendInsideDescribe = 1,
    /** Append a generated repair block at the end of the file */
    AppendRepairBlock = 2,
    /** Append an isolated sibling `describe` block */
    AppendSiblingDescribe = 3,
    /** Fallback smoke test only (must be explicitly enabled) */
    FallbackSmoke = 4,
}

/** A planned patch operation for a test file. */
export interface PatchPlan {
    /** Absolute path to the test file to patch */
    testFilePath: string;
    /** Gaps this patch addresses */
    gaps: CoverageGap[];
    /** Safety level for this patch */
    level: PatchLevel;
    /** The test code to insert */
    content: string;
    /** Where to insert (describe block name or end-of-file) */
    insertTarget: string | 'eof';
}

// ---------------------------------------------------------------------------
// Coverage artifact reader interface
// ---------------------------------------------------------------------------

/** Minimal interface for reading coverage-final.json or lcov.info artifacts. */
export interface CoverageArtifactReader {
    /** Read uncovered lines for a given source file path. Returns line numbers (1-based). */
    getUncoveredLines(sourceFilePath: string): number[];
    /** Check if coverage data is available at all. */
    isAvailable(): boolean;
}
