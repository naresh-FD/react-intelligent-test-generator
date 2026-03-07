// ---------------------------------------------------------------------------
// Eligibility Engine — File Kind Classifier
// ---------------------------------------------------------------------------
//
// Deterministic classification of files into FileKind categories using
// the signals extracted by signals.ts.  Each classifier is a small
// focused function that returns a confidence (0‑100) for one kind.
// The kind with the highest confidence wins.
// ---------------------------------------------------------------------------

import type { FileKind, FileSignals } from './types';

interface KindCandidate {
    kind: FileKind;
    confidence: number;
    matchedSignals: string[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify a file into a FileKind based on extracted signals.
 * Returns the best candidate with its confidence and matched signals.
 */
export function classifyFileKind(signals: FileSignals): KindCandidate {
    const candidates: KindCandidate[] = [
        classifyAsTest(signals),
        classifyAsStory(signals),
        classifyAsMock(signals),
        classifyAsDeclaration(signals),
        classifyAsConfig(signals),
        classifyAsBarrel(signals),
        classifyAsTypes(signals),
        classifyAsConstants(signals),
        classifyAsContext(signals),
        classifyAsStore(signals),
        classifyAsHook(signals),
        classifyAsService(signals),
        classifyAsComponent(signals),
        classifyAsUtil(signals),
        classifyAsEntry(signals),
    ];

    // Sort by confidence descending, take the best match
    candidates.sort((a, b) => b.confidence - a.confidence);
    const best = candidates[0];

    // If no candidate has confidence > 0, fall back to unknown
    if (best.confidence <= 0) {
        return { kind: 'unknown', confidence: 10, matchedSignals: ['no-strong-signal'] };
    }

    return best;
}

// ---------------------------------------------------------------------------
// Individual classifiers
// ---------------------------------------------------------------------------

function classifyAsTest(s: FileSignals): KindCandidate {
    const signals: string[] = [];
    let confidence = 0;

    if (s.isTestFile) {
        signals.push('is-test-file');
        confidence = 95;
    }

    return { kind: 'test', confidence, matchedSignals: signals };
}

function classifyAsStory(s: FileSignals): KindCandidate {
    const signals: string[] = [];
    let confidence = 0;

    if (s.isStoryFile) {
        signals.push('is-story-file');
        confidence = 95;
    }

    return { kind: 'storybook', confidence, matchedSignals: signals };
}

function classifyAsMock(s: FileSignals): KindCandidate {
    const signals: string[] = [];
    let confidence = 0;

    if (s.isMockFile) {
        signals.push('is-mock-file');
        confidence = 90;
    }

    return { kind: 'mock', confidence, matchedSignals: signals };
}

function classifyAsDeclaration(s: FileSignals): KindCandidate {
    const signals: string[] = [];
    let confidence = 0;

    if (s.isDeclarationFile) {
        signals.push('is-declaration-file');
        confidence = 95;
    }

    return { kind: 'types', confidence, matchedSignals: signals };
}

function classifyAsConfig(s: FileSignals): KindCandidate {
    const signals: string[] = [];
    let confidence = 0;

    if (s.isConfigFile) {
        signals.push('is-config-file');
        confidence = 85;
    }
    if (s.isGeneratedFile) {
        signals.push('is-generated-file');
        confidence = Math.max(confidence, 80);
    }

    return { kind: 'config', confidence, matchedSignals: signals };
}

function classifyAsBarrel(s: FileSignals): KindCandidate {
    const signals: string[] = [];
    let confidence = 0;

    if (!s.isIndexFile) return { kind: 'barrel', confidence: 0, matchedSignals: [] };

    // An index file with mostly re-exports and no runtime logic
    const totalStatements = s.totalExports + s.reExportCount;
    if (totalStatements === 0) return { kind: 'barrel', confidence: 0, matchedSignals: [] };

    const reExportRatio = s.reExportCount / Math.max(totalStatements, 1);

    if (reExportRatio >= 0.7) {
        signals.push('high-reexport-ratio');
        confidence = 90;
    } else if (reExportRatio >= 0.5) {
        signals.push('moderate-reexport-ratio');
        confidence = 60;
    }

    if (s.functionExportCount === 0 && s.classExportCount === 0 && !s.hasJsx) {
        signals.push('no-runtime-logic');
        confidence = Math.min(confidence + 10, 95);
    }

    // index.tsx with JSX is likely a component, not a barrel
    if (s.hasJsx) {
        signals.push('has-jsx-weakens-barrel');
        confidence = Math.max(confidence - 40, 0);
    }

    return { kind: 'barrel', confidence, matchedSignals: signals };
}

function classifyAsTypes(s: FileSignals): KindCandidate {
    const signals: string[] = [];
    let confidence = 0;

    if (s.totalExports === 0) return { kind: 'types', confidence: 0, matchedSignals: [] };

    // File only exports types/interfaces/enums
    const runtimeExports = s.functionExportCount + s.classExportCount + s.constantExportCount;
    if (runtimeExports === 0 && s.typeOnlyExportCount > 0) {
        signals.push('type-only-exports');
        confidence = 90;
    } else if (runtimeExports === 0 && s.totalExports > 0) {
        // Might be re-exporting types
        signals.push('no-runtime-exports');
        confidence = 70;
    }

    // .d.ts files are always types
    if (s.isDeclarationFile) {
        signals.push('declaration-file');
        confidence = 95;
    }

    if (s.hasJsx) {
        confidence = 0; // Types files don't have JSX
    }

    return { kind: 'types', confidence, matchedSignals: signals };
}

function classifyAsConstants(s: FileSignals): KindCandidate {
    const signals: string[] = [];
    let confidence = 0;

    if (s.totalExports === 0) return { kind: 'constants', confidence: 0, matchedSignals: [] };

    // File only exports constant literals (no functions, classes, or JSX)
    if (s.constantExportCount > 0 && s.functionExportCount === 0 && s.classExportCount === 0 && !s.hasJsx) {
        signals.push('constant-only-exports');
        confidence = 80;

        if (s.typeOnlyExportCount > 0 && s.constantExportCount > 0) {
            // Constants + types is still "constants"
            signals.push('constants-with-types');
        }

        if (s.reactHookCallCount === 0 && s.importCount <= 2) {
            signals.push('no-react-hooks');
            confidence = 88;
        }
    }

    return { kind: 'constants', confidence, matchedSignals: signals };
}

function classifyAsContext(s: FileSignals): KindCandidate {
    const signals: string[] = [];
    let confidence = 0;

    if (s.usesCreateContext) {
        signals.push('uses-createContext');
        confidence = 70;

        if (s.usesProvider) {
            signals.push('exports-provider');
            confidence = 90;
        }

        if (s.usesUseContext) {
            signals.push('uses-useContext');
            confidence = Math.max(confidence, 85);
        }
    }

    // Filename hint
    const nameLC = s.fileName.toLowerCase();
    if (nameLC.includes('context') || nameLC.includes('provider')) {
        signals.push('context-in-filename');
        confidence = Math.max(confidence, 60);
        if (s.usesCreateContext) confidence = 92;
    }

    return { kind: 'context', confidence, matchedSignals: signals };
}

function classifyAsStore(s: FileSignals): KindCandidate {
    const signals: string[] = [];
    let confidence = 0;

    if (s.usesZustand) {
        signals.push('uses-zustand');
        confidence = 90;
    }
    if (s.usesReduxToolkit) {
        signals.push('uses-redux-toolkit');
        confidence = Math.max(confidence, 90);
    }
    if (s.usesJotai) {
        signals.push('uses-jotai');
        confidence = Math.max(confidence, 85);
    }

    // Filename hint
    const nameLC = s.fileName.toLowerCase();
    if (/store|slice|reducer|atom/i.test(nameLC)) {
        signals.push('store-in-filename');
        confidence = Math.max(confidence, 50);
        if (s.usesZustand || s.usesReduxToolkit || s.usesJotai) {
            confidence = 95;
        }
    }

    return { kind: 'store', confidence, matchedSignals: signals };
}

function classifyAsHook(s: FileSignals): KindCandidate {
    const signals: string[] = [];
    let confidence = 0;

    // Primary signal: file defines use* functions
    if (s.hookNames.length > 0) {
        signals.push(`defines-hooks: ${s.hookNames.join(', ')}`);
        confidence = 85;
    }

    // Filename starts with "use"
    if (s.startsWithUse) {
        signals.push('filename-starts-with-use');
        confidence = Math.max(confidence, 80);
        if (s.hookNames.length > 0) confidence = 92;
    }

    // Uses React hooks internally
    if (s.reactHookCallCount > 0 && s.hookNames.length > 0) {
        signals.push('calls-react-hooks');
        confidence = Math.max(confidence, 88);
    }

    // If it also has JSX, it's more component than hook (but hooks can return JSX)
    if (s.hasJsx && s.jsxElementCount > 3) {
        signals.push('significant-jsx-weakens-hook');
        confidence = Math.max(confidence - 20, 0);
    }

    return { kind: 'hook', confidence, matchedSignals: signals };
}

function classifyAsService(s: FileSignals): KindCandidate {
    const signals: string[] = [];
    let confidence = 0;

    // HTTP client usage
    if (s.usesHttpClient) {
        signals.push('uses-http-client');
        confidence = 60;
    }

    // Filename hint
    const nameLC = s.fileName.toLowerCase();
    if (/service|api|client|repository|gateway|adapter/i.test(nameLC)) {
        signals.push('service-in-filename');
        confidence = Math.max(confidence, 70);
        if (s.usesHttpClient) confidence = 90;
    }

    // Multiple async functions with HTTP
    if (s.asyncFunctionCount >= 2 && s.usesHttpClient) {
        signals.push('multiple-async-with-http');
        confidence = Math.max(confidence, 85);
    }

    // No JSX — services shouldn't render
    if (!s.hasJsx && s.usesHttpClient) {
        signals.push('no-jsx');
        confidence = Math.min(confidence + 5, 95);
    }

    return { kind: 'service', confidence, matchedSignals: signals };
}

function classifyAsComponent(s: FileSignals): KindCandidate {
    const signals: string[] = [];
    let confidence = 0;

    // JSX is the strongest component signal
    if (s.hasJsx) {
        signals.push('has-jsx');
        confidence = 70;

        if (s.hasReactImport) {
            signals.push('has-react-import');
            confidence = 80;
        }

        if (s.isPascalCase) {
            signals.push('pascal-case-filename');
            confidence = Math.max(confidence, 85);
        }

        if (s.hasDefaultExport) {
            signals.push('has-default-export');
            confidence = Math.min(confidence + 5, 95);
        }

        if (s.jsxElementCount >= 3) {
            signals.push('multiple-jsx-elements');
            confidence = Math.min(confidence + 5, 95);
        }
    }

    // React import + default export + PascalCase without JSX (React.createElement)
    if (!s.hasJsx && s.hasReactImport && s.isPascalCase && s.hasDefaultExport) {
        signals.push('react-import-pascal-default');
        confidence = Math.max(confidence, 60);
    }

    return { kind: 'component', confidence, matchedSignals: signals };
}

function classifyAsUtil(s: FileSignals): KindCandidate {
    const signals: string[] = [];
    let confidence = 0;

    // Pure functions with no JSX, no React hooks
    if (s.functionExportCount > 0 && !s.hasJsx && s.reactHookCallCount === 0) {
        signals.push('pure-function-exports');
        confidence = 60;

        if (s.totalImportCount <= 3) {
            signals.push('low-import-count');
            confidence = 70;
        }

        if (s.thirdPartyImportCount === 0) {
            signals.push('no-third-party');
            confidence = Math.min(confidence + 5, 85);
        }
    }

    // Filename hints
    const nameLC = s.fileName.toLowerCase();
    if (/util|helper|format|parse|validate|transform|convert|sanitize|normalize/i.test(nameLC)) {
        signals.push('utility-in-filename');
        confidence = Math.max(confidence, 65);
        if (s.functionExportCount > 0) confidence = Math.max(confidence, 80);
    }

    return { kind: 'util', confidence, matchedSignals: signals };
}

function classifyAsEntry(s: FileSignals): KindCandidate {
    const signals: string[] = [];
    let confidence = 0;

    if (s.isAppEntry) {
        signals.push('is-app-entry');
        confidence = 70;

        // If it's just ReactDOM.render / createRoot, very likely entry
        if (s.lineCount < 30) {
            signals.push('small-entry-file');
            confidence = 85;
        }
    }

    return { kind: 'entry', confidence, matchedSignals: signals };
}
