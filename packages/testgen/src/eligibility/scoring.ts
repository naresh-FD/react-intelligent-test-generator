// ---------------------------------------------------------------------------
// Eligibility Engine — Scoring Functions
// ---------------------------------------------------------------------------
//
// Deterministic scoring for testability, complexity, and confidence.
// Each function produces a 0‑100 score from the extracted FileSignals.
// No magic numbers — every weight is declared as a named constant.
// ---------------------------------------------------------------------------

import type { FileSignals, FileKind } from './types';

// ---------------------------------------------------------------------------
// Weight constants
// ---------------------------------------------------------------------------

/** Testability — factors that make a file more testable */
const T_JSX_PRESENT = 15;
const T_FUNCTION_EXPORTS = 10;
const T_FEW_DEPS = 10;
const T_PURE_FUNCTIONS = 15;
const T_REACT_HOOKS = 5;
const T_SMALL_FILE = 10;
const T_HAS_DEFAULT_EXPORT = 5;
const T_PASCAL_CASE = 5;

/** Testability — factors that reduce testability */
const T_PEN_SIDE_EFFECTS = -10;
const T_PEN_DYNAMIC_IMPORT = -10;
const T_PEN_BROWSER_APIS = -5;
const T_PEN_NO_EXPORTS = -20;
const T_PEN_HIGH_IMPORT = -5;

/** Complexity — factors that increase complexity (tuned down to reduce over-skipping) */
const C_IMPORT_WEIGHT = 1.5;          // per import beyond 8 (was 5)
const C_SERVICE_IMPORT_WEIGHT = 5;    // per service import (was 8)
const C_ASYNC_WEIGHT = 3;             // per async function (was 5)
const C_ROUTER_WEIGHT = 6;            // (was 10)
const C_STATE_MGMT_WEIGHT = 6;        // zustand / redux / jotai (was 10)
const C_CONTEXT_WEIGHT = 5;           // (was 8)
const C_SIDE_EFFECT_WEIGHT = 5;       // (was 8)
const C_THIRD_PARTY_WEIGHT = 1.5;     // per third-party import beyond 5 (was 3)
const C_LINE_COUNT_WEIGHT = 0.03;     // per line beyond 150 (was 100)

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute a testability score (0‑100).
 * Higher = easier to test safely with auto-generation.
 */
export function computeTestabilityScore(signals: FileSignals, fileKind: FileKind): number {
    let score = 50; // base

    // Positive signals
    if (signals.hasJsx) score += T_JSX_PRESENT;
    if (signals.functionExportCount > 0) score += T_FUNCTION_EXPORTS;
    if (signals.totalImportCount <= 5) score += T_FEW_DEPS;
    if (signals.functionExportCount > 0 && !signals.hasJsx && signals.reactHookCallCount === 0) {
        score += T_PURE_FUNCTIONS;
    }
    if (signals.reactHookCallCount > 0) score += T_REACT_HOOKS;
    if (signals.lineCount <= 100) score += T_SMALL_FILE;
    if (signals.hasDefaultExport) score += T_HAS_DEFAULT_EXPORT;
    if (signals.isPascalCase) score += T_PASCAL_CASE;

    // Negative signals
    if (signals.hasTopLevelSideEffects) score += T_PEN_SIDE_EFFECTS;
    if (signals.usesDynamicImport) score += T_PEN_DYNAMIC_IMPORT;
    if (signals.usesWindow || signals.usesDocument || signals.usesLocalStorage || signals.usesSessionStorage) {
        score += T_PEN_BROWSER_APIS;
    }
    if (signals.totalExports === 0 && signals.functionExportCount === 0) {
        score += T_PEN_NO_EXPORTS;
    }
    if (signals.totalImportCount > 10) score += T_PEN_HIGH_IMPORT;

    // Kind-specific adjustments
    if (fileKind === 'barrel' || fileKind === 'types' || fileKind === 'constants') {
        score = Math.max(score - 20, 10);
    }
    if (fileKind === 'mock' || fileKind === 'test' || fileKind === 'storybook') {
        score = 0;
    }

    return clamp(score, 0, 100);
}

/**
 * Compute a complexity score (0‑100).
 * Higher = more complex dependencies, harder for safe auto-generation.
 */
export function computeComplexityScore(signals: FileSignals): number {
    let score = 0;

    // Import complexity (raised threshold from 5 to 8 — enterprise codebases have more imports)
    const excessImports = Math.max(signals.totalImportCount - 8, 0);
    score += excessImports * C_IMPORT_WEIGHT;

    // Service imports are heavy complexity
    score += signals.serviceImportCount * C_SERVICE_IMPORT_WEIGHT;

    // Async functions
    score += signals.asyncFunctionCount * C_ASYNC_WEIGHT;

    // Framework integrations
    if (signals.usesRouter) score += C_ROUTER_WEIGHT;
    if (signals.usesZustand || signals.usesReduxToolkit || signals.usesJotai || signals.usesReduxHooks) {
        score += C_STATE_MGMT_WEIGHT;
    }
    if (signals.usesCreateContext || signals.usesUseContext) score += C_CONTEXT_WEIGHT;

    // Side effects
    if (signals.usesLocalStorage || signals.usesSessionStorage) score += C_SIDE_EFFECT_WEIGHT;
    if (signals.usesWindow || signals.usesDocument) score += C_SIDE_EFFECT_WEIGHT;
    if (signals.usesDynamicImport) score += C_SIDE_EFFECT_WEIGHT;
    if (signals.hasTopLevelSideEffects) score += C_SIDE_EFFECT_WEIGHT;

    // Third-party density (raised threshold from 3 to 5)
    const excessThirdParty = Math.max(signals.thirdPartyImportCount - 5, 0);
    score += excessThirdParty * C_THIRD_PARTY_WEIGHT;

    // File size (raised threshold from 100 to 150 lines)
    const excessLines = Math.max(signals.lineCount - 150, 0);
    score += excessLines * C_LINE_COUNT_WEIGHT;

    return clamp(Math.round(score), 0, 100);
}

/**
 * Compute overall confidence (0‑100) that the chosen action will produce
 * a correct, passing test file on the first attempt.
 *
 * Takes the classifier confidence, testability, and complexity into account.
 */
export function computeConfidence(
    classifierConfidence: number,
    testability: number,
    complexity: number,
): number {
    // Weighted blend: classifier confidence matters most,
    // then testability (positively) and complexity (negatively).
    const score =
        classifierConfidence * 0.4 +
        testability * 0.35 +
        (100 - complexity) * 0.25;

    return clamp(Math.round(score), 0, 100);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}
