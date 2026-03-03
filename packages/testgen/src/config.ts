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
    '/mocks/browser', // MSW browser setup
    '/mocks/handlers/', // MSW handlers with ESM dependencies
    '/mocks/data/', // MSW mock data
  ],
};

/**
 * Patterns that identify state management store files.
 * These trigger the dedicated store test generator.
 */
export const STORE_FILE_PATTERNS = {
  /** Filename patterns that strongly suggest a store file */
  filenamePatterns: [
    /Store\.(ts|tsx)$/i,   // useCartStore.ts, authStore.ts
    /slice\.(ts|tsx)$/i,   // cartSlice.ts, userSlice.ts
    /reducer\.(ts|tsx)$/i, // cartReducer.ts (old Redux style)
    /atom\.(ts|tsx)$/i,    // counterAtom.ts (Jotai)
    /atoms\.(ts|tsx)$/i,   // atoms.ts (Jotai)
  ],
  /** Content patterns for Zustand stores */
  zustand: ["from 'zustand'", 'from "zustand"'],
  /** Content patterns for Redux Toolkit */
  rtk: ["from '@reduxjs/toolkit'", 'from "@reduxjs/toolkit"'],
  /** Content patterns for Jotai atoms */
  jotai: ["from 'jotai'", 'from "jotai"'],
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
  // Order matters: listed outermost-first (last in list = innermost wrapper around children)
  customContexts: [
    {
      name: 'Notification',
      hooks: ['useNotification'],
      contextName: 'NotificationContext',
      providerName: 'NotificationProvider',
    },
    // Expense-manager app contexts — hooks mapped to their provider so the wrapper generator
    // automatically nests the right providers when a hook depends on them.
    {
      name: 'Expense',
      hooks: ['useExpenseContext'],
      contextName: 'ExpenseContext',
      providerName: 'ExpenseProvider',
    },
    {
      name: 'Budget',
      hooks: ['useBudgetContext'],
      contextName: 'BudgetContext',
      providerName: 'BudgetProvider',
    },
    {
      name: 'Category',
      hooks: ['useCategoryContext'],
      contextName: 'CategoryContext',
      providerName: 'CategoryProvider',
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
    'set',
    'add',
    'remove',
    'update',
    'delete',
    'toggle',
    'fetch',
    'load',
    'save',
    'clear',
    'reset',
    'login',
    'logout',
    'register',
    'create',
    'edit',
    'submit',
    'handle',
    'dispatch',
    'notify',
  ],

  // Patterns for detecting state values in hook returns
  statePatterns: [
    'is',
    'has',
    'can',
    'should',
    'loading',
    'error',
    'data',
    'items',
    'list',
    'user',
    'token',
    'theme',
    'state',
    'count',
    'total',
    'current',
    'selected',
  ],
};
