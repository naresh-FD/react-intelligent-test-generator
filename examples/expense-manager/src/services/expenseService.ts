import api from './api';
import type {
  Expense,
  ExpenseFormData,
  ExpenseFilters,
  Category,
  Budget,
  BudgetFormData,
  ApiResponse,
  PaginatedResponse,
  BulkDeleteResponse,
  AnalyticsSummary,
  AnalyticsTrends,
  CategoryAnalytics,
} from '@/types';
import { buildQueryString } from '@/utils/helpers';

interface ExpenseQueryParams extends ExpenseFilters {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export const expenseService = {
  async getExpenses(params: ExpenseQueryParams = {}): Promise<PaginatedResponse<Expense>> {
    const queryString = buildQueryString(params as Record<string, string | number | boolean | undefined>);
    const response = await api.get<PaginatedResponse<Expense>>(`/expenses?${queryString}`);
    return response.data;
  },

  async getExpense(id: string): Promise<Expense> {
    const response = await api.get<ApiResponse<Expense>>(`/expenses/${id}`);
    return response.data.data;
  },

  async createExpense(data: ExpenseFormData): Promise<Expense> {
    const response = await api.post<ApiResponse<Expense>>('/expenses', data);
    return response.data.data;
  },

  async updateExpense(id: string, data: Partial<ExpenseFormData>): Promise<Expense> {
    const response = await api.put<ApiResponse<Expense>>(`/expenses/${id}`, data);
    return response.data.data;
  },

  async deleteExpense(id: string): Promise<void> {
    await api.delete(`/expenses/${id}`);
  },

  async bulkDeleteExpenses(ids: string[]): Promise<BulkDeleteResponse> {
    const response = await api.delete<ApiResponse<BulkDeleteResponse>>('/expenses/bulk', {
      data: { ids },
    });
    return response.data.data;
  },

  async getCategories(): Promise<Category[]> {
    const response = await api.get<ApiResponse<Category[]>>('/categories');
    return response.data.data;
  },

  async createCategory(data: Omit<Category, 'id' | 'createdAt' | 'updatedAt'>): Promise<Category> {
    const response = await api.post<ApiResponse<Category>>('/categories', data);
    return response.data.data;
  },

  async updateCategory(id: string, data: Partial<Category>): Promise<Category> {
    const response = await api.put<ApiResponse<Category>>(`/categories/${id}`, data);
    return response.data.data;
  },

  async deleteCategory(id: string): Promise<void> {
    await api.delete(`/categories/${id}`);
  },

  async getBudgets(): Promise<Budget[]> {
    const response = await api.get<ApiResponse<Budget[]>>('/budgets');
    return response.data.data;
  },

  async getBudget(id: string): Promise<Budget> {
    const response = await api.get<ApiResponse<Budget>>(`/budgets/${id}`);
    return response.data.data;
  },

  async createBudget(data: BudgetFormData): Promise<Budget> {
    const response = await api.post<ApiResponse<Budget>>('/budgets', data);
    return response.data.data;
  },

  async updateBudget(id: string, data: Partial<BudgetFormData>): Promise<Budget> {
    const response = await api.put<ApiResponse<Budget>>(`/budgets/${id}`, data);
    return response.data.data;
  },

  async deleteBudget(id: string): Promise<void> {
    await api.delete(`/budgets/${id}`);
  },

  async getAnalyticsSummary(params: { startDate?: string; endDate?: string } = {}): Promise<AnalyticsSummary> {
    const queryString = buildQueryString(params);
    const response = await api.get<ApiResponse<AnalyticsSummary>>(`/analytics/summary?${queryString}`);
    return response.data.data;
  },

  async getAnalyticsTrends(params: { startDate?: string; endDate?: string } = {}): Promise<AnalyticsTrends> {
    const queryString = buildQueryString(params);
    const response = await api.get<ApiResponse<AnalyticsTrends>>(`/analytics/trends?${queryString}`);
    return response.data.data;
  },

  async getCategoryAnalytics(params: { startDate?: string; endDate?: string } = {}): Promise<CategoryAnalytics[]> {
    const queryString = buildQueryString(params);
    const response = await api.get<ApiResponse<CategoryAnalytics[]>>(`/analytics/categories?${queryString}`);
    return response.data.data;
  },

  async exportExpenses(params: ExpenseFilters & { format: 'csv' | 'pdf' }): Promise<Blob> {
    const queryParams: Record<string, string | number | boolean | undefined> = {
      search: params.search,
      type: params.type,
      categoryId: params.categoryId,
      startDate: params.startDate,
      endDate: params.endDate,
      minAmount: params.minAmount,
      maxAmount: params.maxAmount,
      format: params.format,
    };
    const queryString = buildQueryString(queryParams);
    const response = await api.get(`/expenses/export?${queryString}`, {
      responseType: 'blob',
    });
    return response.data;
  },
};

export default expenseService;
