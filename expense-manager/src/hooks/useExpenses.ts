import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { expenseService } from '@/services';
import { useExpenseContext } from '@/contexts';
import { useNotification } from '@/contexts';
import type { ExpenseFormData, ExpenseFilters } from '@/types';
import { QUERY_KEYS } from '@/utils/constants';

interface UseExpensesOptions {
  enabled?: boolean;
}

export function useExpenses(options: UseExpensesOptions = {}) {
  const queryClient = useQueryClient();
  const { success, error: showError } = useNotification();
  const {
    filters,
    sort,
    pagination,
    setExpenses,
    addExpense,
    updateExpense: updateExpenseInContext,
    deleteExpense: deleteExpenseInContext,
    deleteExpenses: deleteExpensesInContext,
    setLoading,
    setError,
  } = useExpenseContext();

  const queryKey = [
    QUERY_KEYS.EXPENSES,
    {
      ...filters,
      page: pagination.page,
      limit: pagination.limit,
      sortBy: sort.field,
      sortOrder: sort.order,
    },
  ];

  const {
    data,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey,
    queryFn: () =>
      expenseService.getExpenses({
        ...filters,
        page: pagination.page,
        limit: pagination.limit,
        sortBy: sort.field,
        sortOrder: sort.order,
      }),
    enabled: options.enabled !== false,
    staleTime: 30000,
  });

  const createMutation = useMutation({
    mutationFn: (data: ExpenseFormData) => expenseService.createExpense(data),
    onMutate: () => {
      setLoading(true);
    },
    onSuccess: (newExpense) => {
      addExpense(newExpense);
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.EXPENSES] });
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.ANALYTICS_SUMMARY] });
      success('Transaction added successfully');
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to create expense');
      showError('Failed to add transaction', err instanceof Error ? err.message : undefined);
    },
    onSettled: () => {
      setLoading(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ExpenseFormData> }) =>
      expenseService.updateExpense(id, data),
    onMutate: () => {
      setLoading(true);
    },
    onSuccess: (updatedExpense) => {
      updateExpenseInContext(updatedExpense);
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.EXPENSES] });
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.ANALYTICS_SUMMARY] });
      success('Transaction updated successfully');
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to update expense');
      showError('Failed to update transaction', err instanceof Error ? err.message : undefined);
    },
    onSettled: () => {
      setLoading(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => expenseService.deleteExpense(id),
    onMutate: () => {
      setLoading(true);
    },
    onSuccess: (_, id) => {
      deleteExpenseInContext(id);
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.EXPENSES] });
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.ANALYTICS_SUMMARY] });
      success('Transaction deleted successfully');
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to delete expense');
      showError('Failed to delete transaction', err instanceof Error ? err.message : undefined);
    },
    onSettled: () => {
      setLoading(false);
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => expenseService.bulkDeleteExpenses(ids),
    onMutate: () => {
      setLoading(true);
    },
    onSuccess: (result, ids) => {
      deleteExpensesInContext(ids.filter((id) => !result.failedIds.includes(id)));
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.EXPENSES] });
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.ANALYTICS_SUMMARY] });
      success(`${result.deletedCount} transactions deleted successfully`);
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to delete expenses');
      showError('Failed to delete transactions', err instanceof Error ? err.message : undefined);
    },
    onSettled: () => {
      setLoading(false);
    },
  });

  if (data && !isLoading) {
    setExpenses(data.data, data.pagination);
  }

  const createExpense = useCallback(
    (data: ExpenseFormData) => createMutation.mutateAsync(data),
    [createMutation]
  );

  const updateExpense = useCallback(
    (id: string, data: Partial<ExpenseFormData>) => updateMutation.mutateAsync({ id, data }),
    [updateMutation]
  );

  const deleteExpense = useCallback(
    (id: string) => deleteMutation.mutateAsync(id),
    [deleteMutation]
  );

  const bulkDeleteExpenses = useCallback(
    (ids: string[]) => bulkDeleteMutation.mutateAsync(ids),
    [bulkDeleteMutation]
  );

  return {
    expenses: data?.data || [],
    pagination: data?.pagination,
    isLoading: isLoading || isFetching,
    error: error instanceof Error ? error.message : null,
    createExpense,
    updateExpense,
    deleteExpense,
    bulkDeleteExpenses,
    refetch,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending || bulkDeleteMutation.isPending,
  };
}

export function useExpense(id: string) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [QUERY_KEYS.EXPENSE, id],
    queryFn: () => expenseService.getExpense(id),
    enabled: !!id,
  });

  return {
    expense: data,
    isLoading,
    error: error instanceof Error ? error.message : null,
    refetch,
  };
}

export function useExpenseFilters() {
  const { filters, setFilters, resetFilters } = useExpenseContext();

  const updateFilter = useCallback(
    <K extends keyof ExpenseFilters>(key: K, value: ExpenseFilters[K]) => {
      setFilters({ ...filters, [key]: value });
    },
    [filters, setFilters]
  );

  return {
    filters,
    setFilters,
    updateFilter,
    resetFilters,
  };
}

export default useExpenses;
