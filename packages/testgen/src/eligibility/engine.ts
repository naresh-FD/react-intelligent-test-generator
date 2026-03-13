// ---------------------------------------------------------------------------
// Eligibility Engine — Main Orchestrator
// ---------------------------------------------------------------------------
//
// Ties together signals → classifier → scoring → action decision.
// This is the single entry point for determining what to do with a file.
// ---------------------------------------------------------------------------

import { SourceFile } from 'ts-morph';
import type {
    FileEligibilityResult,
    EligibilityAction,
    FileKind,
    FileSignals,
} from './types';
import { extractSignals } from './signals';
import { classifyFileKind } from './classifier';
import { computeTestabilityScore, computeComplexityScore, computeConfidence } from './scoring';
import type { ResolvedTestOutput } from '../workspace/config';
import { DEFAULT_TEST_OUTPUT } from '../workspace/config';

// ---------------------------------------------------------------------------
// Thresholds (tunable)
// ---------------------------------------------------------------------------

/** Complexity above this triggers manual-review instead of full generation */
const COMPLEXITY_MANUAL_REVIEW_THRESHOLD = 75;

/** Complexity above this downgrades from full to minimal generation */
const COMPLEXITY_MINIMAL_THRESHOLD = 55;

/** Confidence below this triggers manual-review for testable files */
const CONFIDENCE_MANUAL_REVIEW_THRESHOLD = 25;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate a single file and return a complete eligibility result.
 */
export function evaluateFile(
    sourceFile: SourceFile,
    filePath: string,
    testOutput: ResolvedTestOutput = DEFAULT_TEST_OUTPUT,
    packageRoot: string = process.cwd(),
): FileEligibilityResult {
    const signals = extractSignals(sourceFile, filePath, testOutput, packageRoot);
    const classification = classifyFileKind(signals);
    const { kind: fileKind, confidence: classifierConfidence, matchedSignals } = classification;

    const testabilityScore = computeTestabilityScore(signals, fileKind);
    const complexityScore = computeComplexityScore(signals);

    const { action, reasons } = determineAction(
        fileKind,
        signals,
        testabilityScore,
        complexityScore,
        classifierConfidence,
    );

    const confidence = computeConfidence(classifierConfidence, testabilityScore, complexityScore);

    return {
        filePath,
        fileKind,
        action,
        confidence,
        testabilityScore,
        complexityScore,
        reasons,
        detectedSignals: matchedSignals,
    };
}

/**
 * Evaluate multiple files in batch.
 */
export function evaluateFiles(
    files: Array<{ sourceFile: SourceFile; filePath: string }>,
    testOutput: ResolvedTestOutput = DEFAULT_TEST_OUTPUT,
    packageRoot: string = process.cwd(),
): FileEligibilityResult[] {
    return files.map(({ sourceFile, filePath }) =>
        evaluateFile(sourceFile, filePath, testOutput, packageRoot),
    );
}

// ---------------------------------------------------------------------------
// Action determination logic
// ---------------------------------------------------------------------------

interface ActionDecision {
    action: EligibilityAction;
    reasons: string[];
}

function determineAction(
    fileKind: FileKind,
    signals: FileSignals,
    testability: number,
    complexity: number,
    classifierConfidence: number,
): ActionDecision {
    const reasons: string[] = [];

    // ── Step 1: Always-skip kinds ─────────────────────────────────────────
    if (fileKind === 'test') {
        reasons.push('Test file — not a candidate for generation');
        return { action: 'skip-safe', reasons };
    }
    if (fileKind === 'storybook') {
        reasons.push('Storybook file — test generation not applicable');
        return { action: 'skip-safe', reasons };
    }
    if (fileKind === 'mock') {
        reasons.push('Mock/fixture file — testing infrastructure, not application code');
        return { action: 'skip-safe', reasons };
    }
    if (fileKind === 'types') {
        reasons.push('Type-only module — no executable logic to test');
        return { action: 'skip-safe', reasons };
    }
    if (fileKind === 'config') {
        if (signals.isGeneratedFile) {
            reasons.push('Generated file — should not be tested');
        } else {
            reasons.push('Configuration/setup file — not a test candidate');
        }
        return { action: 'skip-safe', reasons };
    }

    // ── Step 2: Barrel files ──────────────────────────────────────────────
    if (fileKind === 'barrel') {
        reasons.push('Barrel export file — re-exports only, no runtime logic');
        return { action: 'skip-safe', reasons };
    }

    // ── Step 3: Constants ─────────────────────────────────────────────────
    if (fileKind === 'constants') {
        // Constants with exported functions should still get tests
        if (signals.functionExportCount > 0) {
            reasons.push('Constants module with exported functions — generating minimal test');
            return { action: 'generate-minimal-test', reasons };
        }
        reasons.push('Constant-only module — no executable logic');
        return { action: 'skip-safe', reasons };
    }

    // ── Step 4: Declaration files ─────────────────────────────────────────
    if (signals.isDeclarationFile) {
        reasons.push('.d.ts declaration file — no runtime code');
        return { action: 'skip-safe', reasons };
    }

    // ── Step 5: Check for existing test file → merge mode ─────────────────
    if (signals.hasExistingTestFile) {
        reasons.push(`Existing test file found: ${signals.existingTestFilePath ?? 'unknown'}`);
        reasons.push('Switching to merge mode — preserve existing tests, append gaps');
        return { action: 'merge-with-existing-test', reasons };
    }

    // ── Step 6: Entry files ───────────────────────────────────────────────
    if (fileKind === 'entry') {
        if (signals.lineCount < 30 && signals.jsxElementCount <= 2) {
            reasons.push('Small app entry file (main.tsx / index.tsx) — minimal bootstrap logic');
            return { action: 'generate-minimal-test', reasons };
        }
        reasons.push('App entry file with significant content');
        // Fall through to complexity check
    }

    // ── Step 7: Manual review for very complex files ──────────────────────
    if (complexity >= COMPLEXITY_MANUAL_REVIEW_THRESHOLD) {
        const complexityDetails = buildComplexityDetails(signals);
        reasons.push(`High dependency complexity (score: ${complexity})`);
        reasons.push(complexityDetails);
        return { action: 'manual-review', reasons };
    }

    // ── Step 8: Manual review for low confidence ──────────────────────────
    const overallConfidence = computeConfidence(classifierConfidence, testability, complexity);
    if (overallConfidence < CONFIDENCE_MANUAL_REVIEW_THRESHOLD) {
        reasons.push(`Low confidence in safe auto-generation (score: ${overallConfidence})`);
        reasons.push('File may require manual test design');
        return { action: 'manual-review', reasons };
    }

    // ── Step 9: Determine full vs minimal generation ──────────────────────
    if (fileKind === 'unknown') {
        reasons.push('Unknown file type — generating minimal safety test');
        return { action: 'generate-minimal-test', reasons };
    }

    // Moderate complexity → minimal test
    if (complexity >= COMPLEXITY_MINIMAL_THRESHOLD) {
        reasons.push(`Moderate complexity (score: ${complexity}) — generating minimal stable tests`);
        reasons.push(buildComplexityDetails(signals));
        return { action: 'generate-minimal-test', reasons };
    }

    // ── Step 10: Full generation for well-classified, testable files ──────
    const kindLabel = formatFileKind(fileKind);
    reasons.push(`${kindLabel} detected — generating full test suite`);

    if (fileKind === 'component') {
        reasons.push('RTL render + interaction + variant tests');
    } else if (fileKind === 'hook') {
        reasons.push('renderHook + state/action tests');
    } else if (fileKind === 'context') {
        reasons.push('Provider + consumer + state transition tests');
    } else if (fileKind === 'store') {
        reasons.push('Store action + state mutation tests');
    } else if (fileKind === 'service') {
        reasons.push('Mock boundary + async operation tests');
    } else if (fileKind === 'util') {
        reasons.push('Pure function unit tests');
    }

    return { action: 'generate-full-test', reasons };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildComplexityDetails(signals: FileSignals): string {
    const parts: string[] = [];
    if (signals.usesRouter) parts.push('router');
    if (signals.usesCreateContext || signals.usesUseContext) parts.push('context');
    if (signals.usesZustand || signals.usesReduxToolkit || signals.usesJotai || signals.usesReduxHooks) {
        parts.push('state management');
    }
    if (signals.serviceImportCount > 0) parts.push(`${signals.serviceImportCount} service imports`);
    if (signals.asyncFunctionCount > 0) parts.push(`${signals.asyncFunctionCount} async functions`);
    if (signals.usesLocalStorage || signals.usesSessionStorage) parts.push('browser storage');
    if (signals.usesWindow || signals.usesDocument) parts.push('browser APIs');
    if (signals.usesDynamicImport) parts.push('dynamic imports');
    if (signals.thirdPartyImportCount > 5) parts.push(`${signals.thirdPartyImportCount} third-party imports`);

    return parts.length > 0 ? `Complexity factors: ${parts.join(' + ')}` : 'General complexity';
}

function formatFileKind(kind: FileKind): string {
    const labels: Record<FileKind, string> = {
        component: 'React component',
        hook: 'React hook',
        context: 'Context/Provider',
        util: 'Utility module',
        service: 'Service/API module',
        barrel: 'Barrel export',
        types: 'Type-only module',
        constants: 'Constants module',
        store: 'State management store',
        entry: 'App entry point',
        storybook: 'Storybook file',
        mock: 'Mock/fixture file',
        test: 'Test file',
        config: 'Config file',
        unknown: 'Unknown file type',
    };
    return labels[kind];
}
