import path from 'path';
import fs from 'fs';

export const ROOT_DIR = process.cwd();
export const TESTS_DIR_NAME = '__tests__';
export const COVERAGE_DIR = path.join(ROOT_DIR, 'coverage');

/**
 * Auto-detect the source directory.
 * Checks common patterns: src/, lib/, app/, source/
 */
export const SRC_DIR = detectSrcDir();

export function detectSrcDir(root: string = ROOT_DIR): string {
    const candidates = ['src', 'lib', 'app', 'source'];
    for (const dir of candidates) {
        const fullPath = path.join(root, dir);
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
            return fullPath;
        }
    }
    // Fallback to src
    return path.join(root, 'src');
}

/**
 * Test utility patterns - files to exclude from test generation.
 * These are testing infrastructure files, not application code.
 */
export const TEST_UTILITY_PATTERNS = {
    directories: ['/test-utils/', '/test-helpers/', '/_test-utils_/'],
    filenamePatterns: [/^(renderWithProviders|customRender|test-?helpers?|test-?utils?)/i],
};

/**
 * Untestable patterns - files that cannot run in Node.js/Jest.
 * These are browser-only files (MSW, Service Workers, ESM-only modules).
 */
export const UNTESTABLE_PATTERNS = {
    directories: [
        '/mocks/browser',   // MSW browser setup
        '/mocks/handlers/', // MSW handlers with ESM dependencies
        '/mocks/data/',     // MSW mock data
    ],
};

/**
 * Context detection configuration.
 * Centralised config for detecting React Router, React Query, and custom context providers.
 * Customize this to match your app's contexts.
 */
export const CONTEXT_DETECTION_CONFIG = {
    // React Router detection
    router: {
        hooks: ['useNavigate', 'useLocation', 'useParams', 'useSearchParams'],
        imports: ['react-router', 'react-router-dom'],
    },

    // React Query detection
    reactQuery: {
        hooks: ['useQuery', 'useMutation', 'useQueryClient', 'useInfiniteQuery'],
        imports: ['@tanstack/react-query', 'react-query'],
    },

    // Custom context providers specific to your app
    customContexts: [
        {
            name: 'Notification',
            hooks: ['useNotification'],
            contextName: 'NotificationContext',
            providerName: 'NotificationProvider',
        },
        {
            name: 'Api',
            hooks: ['useApi'],
            contextName: 'ApiContext',
            providerName: 'ApiProvider',
            providerProps: {
                baseUrl: 'http://localhost',
                channel: 'test',
                contextId: 'test-context',
                authReceipt: 'test-auth',
            },
        },
    ] as Array<{
        name: string;
        hooks: string[];
        contextName: string;
        providerName: string;
        providerProps?: Record<string, string>;
    }>,

    // Patterns for detecting methods in hook returns (action verbs)
    methodPatterns: [
        'set', 'add', 'remove', 'update', 'delete', 'toggle',
        'fetch', 'load', 'save', 'clear', 'reset', 'login',
        'logout', 'register', 'create', 'edit', 'submit',
        'handle', 'dispatch', 'notify',
    ],

    // Patterns for detecting state values in hook returns
    statePatterns: [
        'is', 'has', 'can', 'should', 'loading', 'error',
        'data', 'items', 'list', 'user', 'token', 'theme',
        'state', 'count', 'total', 'current', 'selected',
    ],
};
