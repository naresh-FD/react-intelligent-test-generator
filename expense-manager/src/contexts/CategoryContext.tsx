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
import type { Category } from '@/types';
import { QUERY_KEYS } from '@/utils/constants';

interface CategoryContextType {
  categories: Category[];
  incomeCategories: Category[];
  expenseCategories: Category[];
  isLoading: boolean;
  error: string | null;
  getCategoryById: (id: string) => Category | undefined;
  getCategoryByName: (name: string) => Category | undefined;
  createCategory: (data: Omit<Category, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Category>;
  updateCategory: (id: string, data: Partial<Category>) => Promise<Category>;
  deleteCategory: (id: string) => Promise<void>;
  refreshCategories: () => void;
}

const CategoryContext = createContext<CategoryContextType | undefined>(undefined);

interface CategoryProviderProps {
  children: ReactNode;
}

export function CategoryProvider({ children }: CategoryProviderProps) {
  const queryClient = useQueryClient();
  const { success, error: showError } = useNotification();
  const [categories, setCategories] = useState<Category[]>([]);

  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: [QUERY_KEYS.CATEGORIES],
    queryFn: () => expenseService.getCategories(),
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (data) {
      setCategories(data);
    }
  }, [data]);

  const createMutation = useMutation({
    mutationFn: (data: Omit<Category, 'id' | 'createdAt' | 'updatedAt'>) =>
      expenseService.createCategory(data),
    onSuccess: (newCategory) => {
      setCategories((prev) => [...prev, newCategory]);
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.CATEGORIES] });
      success('Category created successfully');
    },
    onError: (err) => {
      showError('Failed to create category', err instanceof Error ? err.message : undefined);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Category> }) =>
      expenseService.updateCategory(id, data),
    onSuccess: (updatedCategory) => {
      setCategories((prev) =>
        prev.map((cat) => (cat.id === updatedCategory.id ? updatedCategory : cat))
      );
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.CATEGORIES] });
      success('Category updated successfully');
    },
    onError: (err) => {
      showError('Failed to update category', err instanceof Error ? err.message : undefined);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => expenseService.deleteCategory(id),
    onSuccess: (_, id) => {
      setCategories((prev) => prev.filter((cat) => cat.id !== id));
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.CATEGORIES] });
      success('Category deleted successfully');
    },
    onError: (err) => {
      showError('Failed to delete category', err instanceof Error ? err.message : undefined);
    },
  });

  const incomeCategories = categories.filter((cat) => cat.type === 'income');
  const expenseCategories = categories.filter((cat) => cat.type === 'expense');

  const getCategoryById = useCallback(
    (id: string) => categories.find((cat) => cat.id === id),
    [categories]
  );

  const getCategoryByName = useCallback(
    (name: string) => categories.find((cat) => cat.name.toLowerCase() === name.toLowerCase()),
    [categories]
  );

  const createCategory = useCallback(
    async (data: Omit<Category, 'id' | 'createdAt' | 'updatedAt'>) => {
      return createMutation.mutateAsync(data);
    },
    [createMutation]
  );

  const updateCategory = useCallback(
    async (id: string, data: Partial<Category>) => {
      return updateMutation.mutateAsync({ id, data });
    },
    [updateMutation]
  );

  const deleteCategory = useCallback(
    async (id: string) => {
      return deleteMutation.mutateAsync(id);
    },
    [deleteMutation]
  );

  const refreshCategories = useCallback(() => {
    refetch();
  }, [refetch]);

  const value: CategoryContextType = {
    categories,
    incomeCategories,
    expenseCategories,
    isLoading,
    error: error instanceof Error ? error.message : null,
    getCategoryById,
    getCategoryByName,
    createCategory,
    updateCategory,
    deleteCategory,
    refreshCategories,
  };

  return <CategoryContext.Provider value={value}>{children}</CategoryContext.Provider>;
}

export function useCategoryContext(): CategoryContextType {
  const context = useContext(CategoryContext);
  if (context === undefined) {
    throw new Error('useCategoryContext must be used within a CategoryProvider');
  }
  return context;
}

export default CategoryContext;
