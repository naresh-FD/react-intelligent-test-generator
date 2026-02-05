import * as React from 'react';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { MemoryRouter, BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  AuthProvider,
  ThemeProvider,
  NotificationProvider,
  ExpenseProvider,
  CategoryProvider,
  BudgetProvider,
} from '@/contexts';

/**
 * Options for renderWithProviders
 */
export interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  /**
   * Initial route for MemoryRouter (if using router)
   */
  initialRoute?: string;

  /**
   * Whether to include router wrapper
   * @default true
   */
  withRouter?: boolean;

  /**
   * Use MemoryRouter instead of BrowserRouter (recommended for tests)
   * @default true
   */
  useMemoryRouter?: boolean;

  /**
   * Custom QueryClient for React Query
   */
  queryClient?: QueryClient;

  /**
   * Preloaded state for providers (for future use)
   */
  preloadedState?: Record<string, unknown>;
}

/**
 * Creates a new QueryClient for testing
 */
function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 0,
        gcTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

// Track active query clients for cleanup
const activeQueryClients = new Set<QueryClient>();

afterEach(() => {
  // Clean up all active query clients to prevent Jest from hanging
  activeQueryClients.forEach((client) => {
    client.clear();
  });
  activeQueryClients.clear();
});

/**
 * All app providers wrapper for testing
 */
function AllProviders({
  children,
  queryClient,
}: {
  children: React.ReactNode;
  queryClient: QueryClient;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <NotificationProvider>
          <AuthProvider>
            <CategoryProvider>
              <ExpenseProvider>
                <BudgetProvider>{children}</BudgetProvider>
              </ExpenseProvider>
            </CategoryProvider>
          </AuthProvider>
        </NotificationProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

/**
 * Render a component with all app providers
 *
 * @example
 * ```tsx
 * // Basic usage
 * const { getByText } = renderWithProviders(<MyComponent />);
 *
 * // With initial route
 * renderWithProviders(<MyComponent />, { initialRoute: "/dashboard" });
 *
 * // Without router
 * renderWithProviders(<MyComponent />, { withRouter: false });
 * ```
 */
export function renderWithProviders(
  ui: React.ReactElement,
  options: RenderWithProvidersOptions = {}
): RenderResult & { queryClient: QueryClient } {
  const {
    initialRoute = '/',
    withRouter = true,
    useMemoryRouter = true,
    queryClient = createTestQueryClient(),
    ...renderOptions
  } = options;

  // Track for cleanup to prevent Jest from hanging
  activeQueryClients.add(queryClient);

  function Wrapper({ children }: { children: React.ReactNode }) {
    const wrapped = <AllProviders queryClient={queryClient}>{children}</AllProviders>;

    if (!withRouter) {
      return wrapped;
    }

    if (useMemoryRouter) {
      return <MemoryRouter initialEntries={[initialRoute]}>{wrapped}</MemoryRouter>;
    }

    return <BrowserRouter>{wrapped}</BrowserRouter>;
  }

  const result = render(ui, { wrapper: Wrapper, ...renderOptions });

  return {
    ...result,
    queryClient,
  };
}

/**
 * Re-export everything from @testing-library/react for convenience
 */
export * from '@testing-library/react';
