// ---------------------------------------------------------------------------
// Eligibility Engine — AST-based Signal Detection
// ---------------------------------------------------------------------------
//
// Inspects a source file using ts-morph AST and file metadata to produce
// a FileSignals object. This is the raw data layer — no classification
// or scoring decisions happen here.
// ---------------------------------------------------------------------------

import path from 'node:path';
import fs from 'node:fs';
import { SourceFile, SyntaxKind } from 'ts-morph';
import type { FileSignals } from './types';
import { getTestFilePath } from '../utils/path';
import type { ResolvedTestOutput } from '../workspace/config';
import { DEFAULT_TEST_OUTPUT } from '../workspace/config';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract all signals from a source file.
 * This is a pure analysis step — no decisions are made here.
 */
export function extractSignals(
    sourceFile: SourceFile,
    filePath: string,
    testOutput: ResolvedTestOutput = DEFAULT_TEST_OUTPUT,
    packageRoot: string = process.cwd(),
): FileSignals {
    const content = sourceFile.getFullText();
    const lines = content.split('\n');
    const ext = path.extname(filePath);
    const basename = path.basename(filePath, ext);
    const basenameWithExt = path.basename(filePath);

    // Check for existing test file
    const testFilePath = getTestFilePath(filePath, testOutput, packageRoot);
    const hasExistingTestFile = fs.existsSync(testFilePath);

    return {
        // --- File metadata ---
        fileName: basenameWithExt,
        filePath,
        extension: ext,
        lineCount: lines.length,
        isDeclarationFile: filePath.endsWith('.d.ts'),
        isTestFile: detectTestFile(filePath),
        isStoryFile: detectStoryFile(filePath),
        isMockFile: detectMockFile(filePath),
        isGeneratedFile: detectGeneratedFile(content),
        isConfigFile: detectConfigFile(filePath),

        // --- Exports ---
        ...extractExportSignals(sourceFile, content),

        // --- JSX ---
        hasJsx: detectJsx(sourceFile, content),
        jsxElementCount: countJsxElements(sourceFile),

        // --- React ---
        hasReactImport: detectReactImport(content),
        usesCreateContext: content.includes('createContext'),
        usesUseContext: content.includes('useContext'),
        usesProvider: detectProvider(content),
        hookNames: extractHookDefinitions(sourceFile),
        reactHookCallCount: countReactHookCalls(content),
        usesForwardRef: content.includes('forwardRef'),
        usesPortal: content.includes('createPortal'),
        usesMemo: /\buseMemo\b/.test(content),
        usesCallback: /\buseCallback\b/.test(content),

        // --- State management ---
        usesZustand: detectImportFrom(content, 'zustand'),
        usesReduxToolkit: detectImportFrom(content, '@reduxjs/toolkit'),
        usesJotai: detectImportFrom(content, 'jotai'),
        usesReduxHooks: /\b(useSelector|useDispatch)\b/.test(content),

        // --- Router ---
        usesRouter: detectRouter(content),

        // --- HTTP/Service ---
        usesAxios: detectImportFrom(content, 'axios'),
        usesFetch: /\bfetch\s*\(/.test(content),
        usesHttpClient: detectHttpClient(content),
        asyncFunctionCount: countAsyncFunctions(content),

        // --- Third-party ---
        thirdPartyImportCount: countThirdPartyImports(sourceFile),
        serviceImportCount: countServiceImports(sourceFile),
        totalImportCount: sourceFile.getImportDeclarations().length,

        // --- Side effects ---
        usesLocalStorage: /\blocalStorage\b/.test(content),
        usesSessionStorage: /\bsessionStorage\b/.test(content),
        usesWindow: /\bwindow\./.test(content),
        usesDocument: /\bdocument\./.test(content),
        usesDynamicImport: /\bimport\s*\(/.test(content),
        hasTopLevelSideEffects: detectTopLevelSideEffects(sourceFile),

        // --- Complexity ---
        importCount: sourceFile.getImportDeclarations().length,
        exportCount: countTotalExports(sourceFile),

        // --- Existing test ---
        hasExistingTestFile,
        existingTestFilePath: hasExistingTestFile ? testFilePath : null,

        // --- Naming ---
        isPascalCase: /^[A-Z]/.test(basename),
        startsWithUse: /^use[A-Z]/.test(basename),
        isIndexFile: /^index\.(ts|tsx)$/.test(basenameWithExt),
        isAppEntry: detectAppEntry(filePath, basenameWithExt),
    };
}

// ---------------------------------------------------------------------------
// File metadata detectors
// ---------------------------------------------------------------------------

function detectTestFile(filePath: string): boolean {
    const normalized = filePath.replaceAll('\\', '/');
    return (
        /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(filePath) ||
        normalized.includes('/__tests__/') ||
        normalized.includes('/specs/')
    );
}

function detectStoryFile(filePath: string): boolean {
    return /\.(stories|story)\.(ts|tsx|js|jsx|mdx)$/.test(filePath);
}

function detectMockFile(filePath: string): boolean {
    const normalized = filePath.replaceAll('\\', '/');
    return (
        normalized.includes('/__mocks__/') ||
        normalized.includes('/mocks/') ||
        normalized.includes('/fixtures/') ||
        /\.mock\.(ts|tsx|js|jsx)$/.test(filePath) ||
        /\.fixture\.(ts|tsx|js|jsx)$/.test(filePath)
    );
}

function detectGeneratedFile(content: string): boolean {
    const head = content.slice(0, 500);
    return (
        head.includes('@generated') ||
        head.includes('auto-generated') ||
        head.includes('DO NOT EDIT') ||
        head.includes('This file is generated')
    );
}

function detectConfigFile(filePath: string): boolean {
    const basename = path.basename(filePath, path.extname(filePath));
    return /^(jest\.config|vitest\.config|webpack\.config|vite\.config|tsconfig|babel\.config|postcss\.config|tailwind\.config|eslint\.config|prettier\.config|setupTests|jest\.setup|vitest\.setup)/i.test(
        basename,
    );
}

function detectAppEntry(filePath: string, basenameWithExt: string): boolean {
    const normalized = filePath.replaceAll('\\', '/');
    // main.tsx / index.tsx at src root, or App.tsx
    if (/^(main|App)\.(ts|tsx)$/.test(basenameWithExt)) return true;
    // index.tsx directly under src/ (not deeply nested)
    if (basenameWithExt === 'index.tsx') {
        const parts = normalized.split('/');
        const srcIndex = parts.lastIndexOf('src');
        if (srcIndex >= 0 && parts.length - srcIndex <= 2) return true;
    }
    return false;
}

// ---------------------------------------------------------------------------
// Export analysis
// ---------------------------------------------------------------------------

interface ExportSignals {
    totalExports: number;
    namedExports: string[];
    hasDefaultExport: boolean;
    reExportCount: number;
    typeOnlyExportCount: number;
    constantExportCount: number;
    functionExportCount: number;
    classExportCount: number;
}

function extractExportSignals(sourceFile: SourceFile, content: string): ExportSignals {
    const exportedDecls = sourceFile.getExportedDeclarations();
    const namedExports: string[] = [];

    let functionExportCount = 0;
    let classExportCount = 0;
    let constantExportCount = 0;
    let typeOnlyExportCount = 0;

    for (const [name, decls] of exportedDecls) {
        namedExports.push(name);
        for (const decl of decls) {
            const kind = decl.getKind();
            if (kind === SyntaxKind.FunctionDeclaration || kind === SyntaxKind.ArrowFunction) {
                functionExportCount++;
            } else if (kind === SyntaxKind.ClassDeclaration) {
                classExportCount++;
            } else if (kind === SyntaxKind.InterfaceDeclaration || kind === SyntaxKind.TypeAliasDeclaration || kind === SyntaxKind.EnumDeclaration) {
                typeOnlyExportCount++;
            } else if (kind === SyntaxKind.VariableDeclaration) {
                // Check if the initializer is a function or a constant literal
                const varDecl = decl.asKind(SyntaxKind.VariableDeclaration);
                const init = varDecl?.getInitializer();
                if (init) {
                    const initKind = init.getKind();
                    if (initKind === SyntaxKind.ArrowFunction || initKind === SyntaxKind.FunctionExpression) {
                        functionExportCount++;
                    } else {
                        constantExportCount++;
                    }
                } else {
                    constantExportCount++;
                }
            }
        }
    }

    const hasDefaultExport = sourceFile.getDefaultExportSymbol() !== undefined;

    // Count re-exports: export { ... } from '...'
    const reExportMatches = content.match(/export\s+\{[^}]*\}\s+from\s+['"][^'"]+['"]/g);
    const reExportStarMatches = content.match(/export\s+\*\s+from\s+['"][^'"]+['"]/g);
    const reExportCount = (reExportMatches?.length ?? 0) + (reExportStarMatches?.length ?? 0);

    return {
        totalExports: namedExports.length,
        namedExports,
        hasDefaultExport,
        reExportCount,
        typeOnlyExportCount,
        constantExportCount,
        functionExportCount,
        classExportCount,
    };
}

function countTotalExports(sourceFile: SourceFile): number {
    const decls = sourceFile.getExportedDeclarations();
    let count = 0;
    for (const [, d] of decls) count += d.length;
    return count;
}

// ---------------------------------------------------------------------------
// JSX detection
// ---------------------------------------------------------------------------

function detectJsx(sourceFile: SourceFile, content: string): boolean {
    // Fast path: check file extension
    if (sourceFile.getFilePath().endsWith('.tsx')) {
        // .tsx files might still not have JSX — verify via content
        return /<[A-Z]/.test(content) || /<[a-z]+[\s>]/.test(content) || content.includes('React.createElement');
    }
    return content.includes('React.createElement');
}

function countJsxElements(sourceFile: SourceFile): number {
    try {
        const jsxElements = sourceFile.getDescendantsOfKind(SyntaxKind.JsxElement);
        const jsxSelfClosing = sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement);
        return jsxElements.length + jsxSelfClosing.length;
    } catch {
        return 0;
    }
}

// ---------------------------------------------------------------------------
// React detection
// ---------------------------------------------------------------------------

function detectReactImport(content: string): boolean {
    return (
        /from\s+['"]react['"]/.test(content) ||
        /from\s+['"]react\//.test(content) ||
        /require\s*\(\s*['"]react['"]\s*\)/.test(content)
    );
}

function detectProvider(content: string): boolean {
    return (
        /export\s+(?:const|function|class)\s+\w*Provider/i.test(content) ||
        /export\s*\{[^}]*Provider[^}]*\}/i.test(content) ||
        /\.Provider\s+value=/.test(content)
    );
}

function extractHookDefinitions(sourceFile: SourceFile): string[] {
    const hooks: string[] = [];
    // Function declarations starting with "use"
    for (const fn of sourceFile.getFunctions()) {
        const name = fn.getName();
        if (name && /^use[A-Z]/.test(name)) hooks.push(name);
    }
    // Exported variable declarations that are arrow functions starting with "use"
    for (const stmt of sourceFile.getVariableStatements()) {
        if (!stmt.isExported()) continue;
        for (const decl of stmt.getDeclarations()) {
            const name = decl.getName();
            const init = decl.getInitializer();
            if (
                name &&
                /^use[A-Z]/.test(name) &&
                init &&
                (init.getKind() === SyntaxKind.ArrowFunction || init.getKind() === SyntaxKind.FunctionExpression)
            ) {
                hooks.push(name);
            }
        }
    }
    return hooks;
}

function countReactHookCalls(content: string): number {
    const builtinHooks = [
        'useState', 'useEffect', 'useContext', 'useReducer', 'useCallback',
        'useMemo', 'useRef', 'useLayoutEffect', 'useImperativeHandle',
        'useDebugValue', 'useDeferredValue', 'useTransition', 'useId',
        'useSyncExternalStore', 'useInsertionEffect',
    ];
    let count = 0;
    for (const hook of builtinHooks) {
        const regex = new RegExp(`\\b${hook}\\s*\\(`, 'g');
        const matches = content.match(regex);
        if (matches) count += matches.length;
    }
    return count;
}

// ---------------------------------------------------------------------------
// Router / HTTP / import detection
// ---------------------------------------------------------------------------

function detectRouter(content: string): boolean {
    return (
        detectImportFrom(content, 'react-router') ||
        detectImportFrom(content, 'react-router-dom') ||
        /\b(useNavigate|useLocation|useParams|useSearchParams|useMatch)\b/.test(content)
    );
}

function detectHttpClient(content: string): boolean {
    return (
        detectImportFrom(content, 'axios') ||
        detectImportFrom(content, 'ky') ||
        detectImportFrom(content, 'got') ||
        /\bfetch\s*\(/.test(content)
    );
}

function detectImportFrom(content: string, packageName: string): boolean {
    return (
        content.includes(`from '${packageName}'`) ||
        content.includes(`from "${packageName}"`) ||
        content.includes(`from '${packageName}/`) ||
        content.includes(`from "${packageName}/`)
    );
}

function countThirdPartyImports(sourceFile: SourceFile): number {
    let count = 0;
    for (const imp of sourceFile.getImportDeclarations()) {
        const specifier = imp.getModuleSpecifierValue();
        if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
            count++;
        }
    }
    return count;
}

function countServiceImports(sourceFile: SourceFile): number {
    let count = 0;
    for (const imp of sourceFile.getImportDeclarations()) {
        const specifier = imp.getModuleSpecifierValue();
        if (/\b(service|api|client|gateway|adapter|repository)\b/i.test(specifier)) {
            count++;
        }
    }
    return count;
}

function countAsyncFunctions(content: string): number {
    const matches = content.match(/\basync\s+(function\b|\(|[a-zA-Z_$])/g);
    return matches?.length ?? 0;
}

// ---------------------------------------------------------------------------
// Side-effect detection
// ---------------------------------------------------------------------------

function detectTopLevelSideEffects(sourceFile: SourceFile): boolean {
    // Look for top-level statements that are expression statements (not declarations)
    for (const stmt of sourceFile.getStatements()) {
        const kind = stmt.getKind();
        if (kind === SyntaxKind.ExpressionStatement) {
            const text = stmt.getText().trim();
            // Skip common safe top-level expressions
            if (text.startsWith('export')) continue;
            if (text.startsWith('//') || text.startsWith('/*')) continue;
            // Likely a side effect
            return true;
        }
    }
    return false;
}
