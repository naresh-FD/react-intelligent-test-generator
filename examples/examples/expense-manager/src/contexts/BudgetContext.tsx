import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { expenseService } from '@/services';
import { useNotification } from './NotificationContext';
import type { Budget, BudgetFormData } from '@/types';
import { QUERY_KEYS } from '@/utils/constants';

interface BudgetAlert {
  budgetId: string;
  categoryName: string;
  percentage: number;
  amount: number;
  spent: number;
}

interface BudgetContextType {
  budgets: Budget[];
  isLoading: boolean;
  error: string | null;
  alerts: BudgetAlert[];
  getBudgetById: (id: string) => Budget | undefined;
  getBudgetByCategory: (categoryId: string) => Budget | undefined;
  createBudget: (data: BudgetFormData) => Promise<Budget>;
  updateBudget: (id: string, data: Partial<BudgetFormData>) => Promise<Budget>;
  deleteBudget: (id: string) => Promise<void>;
  refreshBudgets: () => void;
  checkBudgetAlerts: () => void;
}

const BudgetContext = createContext<BudgetContextType | undefined>(undefined);

interface BudgetProviderProps {
  children: ReactNode;
}

export function BudgetProvider({ children }: BudgetProviderProps) {
  const queryClient = useQueryClient();
  const { success, error: showError, warning } = useNotification();
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [alerts, setAlerts] = useState<BudgetAlert[]>([]);

  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: [QUERY_KEYS.BUDGETS],
    queryFn: () => expenseService.getBudgets(),
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (data) {
      setBudgets(data);
    }
  }, [data]);

  const checkBudgetAlerts = useCallback(() => {
    const newAlerts: BudgetAlert[] = [];

    budgets.forEach((budget) => {
      if (!budget.isActive) return;

      const percentage = (budget.spent / budget.amount) * 100;
      if (percentage >= budget.alertThreshold) {
        newAlerts.push({
          budgetId: budget.id,
          categoryName: budget.category,
          percentage,
          amount: budget.amount,
          spent: budget.spent,
        });
      }
    });

    setAlerts(newAlerts);

    newAlerts.forEach((alert) => {
      if (alert.percentage >= 100) {
        warning(
          `Budget exceeded for ${alert.categoryName}`,
          `You've spent ${alert.percentage.toFixed(0)}% of your budget`
        );
      } else if (alert.percentage >= 90) {
        warning(
          `Budget warning for ${alert.categoryName}`,
          `You've spent ${alert.percentage.toFixed(0)}% of your budget`
        );
      }
    });
  }, [budgets, warning]);

  useEffect(() => {
    if (budgets.length > 0) {
      checkBudgetAlerts();
    }
  }, [budgets, checkBudgetAlerts]);

  const createMutation = useMutation({
    mutationFn: (data: BudgetFormData) => expenseService.createBudget(data),
    onSuccess: (newBudget) => {
      setBudgets((prev) => [...prev, newBudget]);
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.BUDGETS] });
      success('Budget created successfully');
    },
    onError: (err) => {
      showError('Failed to create budget', err instanceof Error ? err.message : undefined);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<BudgetFormData> }) =>
      expenseService.updateBudget(id, data),
    onSuccess: (updatedBudget) => {
      setBudgets((prev) =>
        prev.map((budget) => (budget.id === updatedBudget.id ? updatedBudget : budget))
      );
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.BUDGETS] });
      success('Budget updated successfully');
    },
    onError: (err) => {
      showError('Failed to update budget', err instanceof Error ? err.message : undefined);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => expenseService.deleteBudget(id),
    onSuccess: (_, id) => {
      setBudgets((prev) => prev.filter((budget) => budget.id !== id));
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.BUDGETS] });
      success('Budget deleted successfully');
    },
    onError: (err) => {
      showError('Failed to delete budget', err instanceof Error ? err.message : undefined);
    },
  });

  const getBudgetById = useCallback(
    (id: string) => budgets.find((budget) => budget.id === id),
    [budgets]
  );

  const getBudgetByCategory = useCallback(
    (categoryId: string) => budgets.find((budget) => budget.categoryId === categoryId),
    [budgets]
  );

  const createBudget = useCallback(
    async (data: BudgetFormData) => {
      return createMutation.mutateAsync(data);
    },
    [createMutation]
  );

  const updateBudget = useCallback(
    async (id: string, data: Partial<BudgetFormData>) => {
      return updateMutation.mutateAsync({ id, data });
    },
    [updateMutation]
  );

  const deleteBudget = useCallback(
    async (id: string) => {
      return deleteMutation.mutateAsync(id);
    },
    [deleteMutation]
  );

  const refreshBudgets = useCallback(() => {
    refetch();
  }, [refetch]);

  const value: BudgetContextType = {
    budgets,
    isLoading,
    error: error instanceof Error ? error.message : null,
    alerts,
    getBudgetById,
    getBudgetByCategory,
    createBudget,
    updateBudget,
    deleteBudget,
    refreshBudgets,
    checkBudgetAlerts,
  };

  return <BudgetContext.Provider value={value}>{children}</BudgetContext.Provider>;
}

export function useBudgetContext(): BudgetContextType {
  const context = useContext(BudgetContext);
  if (context === undefined) {
    throw new Error('useBudgetContext must be used within a BudgetProvider');
  }
  return context;
}

export default BudgetContext;
