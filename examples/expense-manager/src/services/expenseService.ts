import type {
  Expense,
  ExpenseFormData,
  ExpenseFilters,
  Category,
  Budget,
  BudgetFormData,
  PaginatedResponse,
  BulkDeleteResponse,
  AnalyticsSummary,
  AnalyticsTrends,
  CategoryAnalytics,
} from '@/types';
import { generateId } from '@/utils/helpers';
import { localDb, localDbHelpers } from './localDb';

interface ExpenseQueryParams extends ExpenseFilters {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

const nowIso = (): string => localDbHelpers.nowIso();

const toDate = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

const withinDateRange = (date: string, startDate?: string, endDate?: string): boolean => {
  const target = toDate(date).getTime();

  if (startDate && target < toDate(startDate).getTime()) {
    return false;
  }

  if (endDate && target > toDate(endDate).getTime()) {
    return false;
  }

  return true;
};

const applyExpenseFilters = (expenses: Expense[], filters: ExpenseFilters): Expense[] => {
  return expenses.filter((expense) => {
    if (filters.search) {
      const value = filters.search.toLowerCase();
      const inDescription = expense.description.toLowerCase().includes(value);
      const inCategory = expense.category.toLowerCase().includes(value);
      if (!inDescription && !inCategory) {
        return false;
      }
    }

    if (filters.type && filters.type !== 'all' && expense.type !== filters.type) {
      return false;
    }

    if (filters.categoryId && expense.categoryId !== filters.categoryId) {
      return false;
    }

    if (!withinDateRange(expense.date, filters.startDate, filters.endDate)) {
      return false;
    }

    if (typeof filters.minAmount === 'number' && expense.amount < filters.minAmount) {
      return false;
    }

    if (typeof filters.maxAmount === 'number' && expense.amount > filters.maxAmount) {
      return false;
    }

    if (filters.tags && filters.tags.length > 0) {
      const tags = expense.tags || [];
      const matchesTags = filters.tags.some((tag) => tags.includes(tag));
      if (!matchesTags) {
        return false;
      }
    }

    return true;
  });
};

const sortExpenses = (expenses: Expense[], sortBy = 'date', sortOrder: 'asc' | 'desc' = 'desc'): Expense[] => {
  const sorted = [...expenses].sort((left, right) => {
    if (sortBy === 'amount') {
      return left.amount - right.amount;
    }

    if (sortBy === 'category') {
      return left.category.localeCompare(right.category);
    }

    if (sortBy === 'createdAt') {
      return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    }

    return toDate(left.date).getTime() - toDate(right.date).getTime();
  });

  return sortOrder === 'desc' ? sorted.reverse() : sorted;
};

const toPagination = <T>(items: T[], page = 1, limit = 10): { data: T[]; meta: PaginatedResponse<T>['pagination'] } => {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const boundedPage = Math.min(Math.max(page, 1), totalPages);
  const start = (boundedPage - 1) * limit;

  return {
    data: items.slice(start, start + limit),
    meta: {
      page: boundedPage,
      limit,
      total,
      totalPages,
      hasNext: boundedPage < totalPages,
      hasPrev: boundedPage > 1,
    },
  };
};

const sumByType = (expenses: Expense[], type: 'income' | 'expense'): number => {
  return expenses.filter((expense) => expense.type === type).reduce((total, expense) => total + expense.amount, 0);
};

const safePercentChange = (current: number, previous: number): number => {
  if (previous === 0) {
    return current > 0 ? 100 : 0;
  }
  return ((current - previous) / Math.abs(previous)) * 100;
};

const normalizeBudgets = (): Budget[] => {
  const budgets = localDb.getBudgets();
  const expenses = localDb.getExpenses();

  return budgets.map((budget) => {
    const spent = expenses
      .filter((expense) => expense.type === 'expense' && expense.categoryId === budget.categoryId)
      .filter((expense) => withinDateRange(expense.date, budget.startDate, budget.endDate))
      .reduce((total, expense) => total + expense.amount, 0);

    if (spent === budget.spent) {
      return budget;
    }

    const updated: Budget = {
      ...budget,
      spent,
      updatedAt: nowIso(),
    };

    localDb.upsertBudget(updated);
    return updated;
  });
};

const createMonthKey = (date: string): string => {
  const parsed = toDate(date);
  const month = parsed.getUTCMonth() + 1;
  return `${parsed.getUTCFullYear()}-${String(month).padStart(2, '0')}`;
};

const createDailySeries = (expenses: Expense[]): AnalyticsTrends['daily'] => {
  const map = new Map<string, { income: number; expenses: number }>();

  expenses.forEach((expense) => {
    const item = map.get(expense.date) || { income: 0, expenses: 0 };
    if (expense.type === 'income') {
      item.income += expense.amount;
    } else {
      item.expenses += expense.amount;
    }
    map.set(expense.date, item);
  });

  return [...map.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, totals]) => ({
      date,
      income: totals.income,
      expenses: totals.expenses,
      balance: totals.income - totals.expenses,
    }));
};

const createWeeklySeries = (expenses: Expense[]): AnalyticsTrends['weekly'] => {
  const map = new Map<string, { income: number; expenses: number; week: number; year: number; startDate: string; endDate: string }>();

  expenses.forEach((expense) => {
    const date = toDate(expense.date);
    const start = new Date(date);
    const day = start.getUTCDay() || 7;
    start.setUTCDate(start.getUTCDate() - day + 1);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);

    const key = `${start.getUTCFullYear()}-${start.getUTCMonth()}-${start.getUTCDate()}`;
    const existing = map.get(key) || {
      income: 0,
      expenses: 0,
      week: Math.ceil(start.getUTCDate() / 7),
      year: start.getUTCFullYear(),
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
    };

    if (expense.type === 'income') {
      existing.income += expense.amount;
    } else {
      existing.expenses += expense.amount;
    }

    map.set(key, existing);
  });

  return [...map.values()]
    .sort((left, right) => left.startDate.localeCompare(right.startDate))
    .map((item) => ({
      ...item,
      balance: item.income - item.expenses,
    }));
};

const createMonthlySeries = (expenses: Expense[]): AnalyticsTrends['monthly'] => {
  const map = new Map<string, { income: number; expenses: number; month: number; year: number; monthName: string }>();

  expenses.forEach((expense) => {
    const date = toDate(expense.date);
    const key = createMonthKey(expense.date);
    const existing = map.get(key) || {
      income: 0,
      expenses: 0,
      month: date.getUTCMonth() + 1,
      year: date.getUTCFullYear(),
      monthName: date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }),
    };

    if (expense.type === 'income') {
      existing.income += expense.amount;
    } else {
      existing.expenses += expense.amount;
    }

    map.set(key, existing);
  });

  return [...map.values()]
    .sort((left, right) => (left.year === right.year ? left.month - right.month : left.year - right.year))
    .map((item) => ({
      ...item,
      balance: item.income - item.expenses,
    }));
};

const makeExpenseCsv = (expenses: Expense[]): string => {
  const rows = [
    ['id', 'date', 'type', 'category', 'description', 'amount', 'tags'],
    ...expenses.map((expense) => [
      expense.id,
      expense.date,
      expense.type,
      expense.category,
      expense.description.replace(/,/g, ' '),
      expense.amount.toFixed(2),
      (expense.tags || []).join('|'),
    ]),
  ];

  return rows.map((row) => row.join(',')).join('\n');
};

const addPeriod = (startDate: string, period: 'weekly' | 'monthly' | 'yearly'): string => {
  const end = toDate(startDate);
  if (period === 'weekly') {
    end.setUTCDate(end.getUTCDate() + 6);
  } else if (period === 'monthly') {
    end.setUTCMonth(end.getUTCMonth() + 1);
    end.setUTCDate(end.getUTCDate() - 1);
  } else {
    end.setUTCFullYear(end.getUTCFullYear() + 1);
    end.setUTCDate(end.getUTCDate() - 1);
  }
  return end.toISOString().slice(0, 10);
};

export const expenseService = {
  async getExpenses(params: ExpenseQueryParams = {}): Promise<PaginatedResponse<Expense>> {
    const filtered = applyExpenseFilters(localDb.getExpenses(), params);
    const sorted = sortExpenses(filtered, params.sortBy, params.sortOrder);
    const { data, meta } = toPagination(sorted, params.page, params.limit);

    return {
      success: true,
      data,
      pagination: meta,
      timestamp: nowIso(),
    };
  },

  async getExpense(id: string): Promise<Expense> {
    const expense = localDb.getExpenses().find((item) => item.id === id);
    if (!expense) {
      throw new Error('Transaction not found');
    }
    return expense;
  },

  async createExpense(data: ExpenseFormData): Promise<Expense> {
    const db = localDb.read();
    const user = localDb.getCurrentUser();
    const categoryName = localDbHelpers.getCategoryName(db, data.categoryId);
    const createdAt = nowIso();

    const expense: Expense = {
      id: generateId(),
      userId: user.id,
      amount: data.amount,
      categoryId: data.categoryId,
      category: categoryName,
      type: data.type,
      description: data.description,
      date: data.date,
      isRecurring: data.isRecurring,
      recurrence: data.recurrence,
      tags: data.tags || [],
      attachments: [],
      createdAt,
      updatedAt: createdAt,
    };

    localDb.addExpense(expense);
    normalizeBudgets();

    return expense;
  },

  async updateExpense(id: string, data: Partial<ExpenseFormData>): Promise<Expense> {
    const updated = localDb.updateExpense(id, data);
    normalizeBudgets();
    return updated;
  },

  async deleteExpense(id: string): Promise<void> {
    localDb.removeExpense(id);
    normalizeBudgets();
  },

  async bulkDeleteExpenses(ids: string[]): Promise<BulkDeleteResponse> {
    const existing = new Set(localDb.getExpenses().map((expense) => expense.id));
    const failedIds: string[] = [];
    let deletedCount = 0;

    ids.forEach((id) => {
      if (!existing.has(id)) {
        failedIds.push(id);
        return;
      }

      localDb.removeExpense(id);
      deletedCount += 1;
    });

    normalizeBudgets();

    return {
      success: failedIds.length === 0,
      deletedCount,
      failedIds,
    };
  },

  async getCategories(): Promise<Category[]> {
    return localDb.getCategories();
  },

  async createCategory(data: Omit<Category, 'id' | 'createdAt' | 'updatedAt'>): Promise<Category> {
    const timestamp = nowIso();
    const category: Category = {
      id: generateId(),
      ...data,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    localDb.upsertCategory(category);
    return category;
  },

  async updateCategory(id: string, data: Partial<Category>): Promise<Category> {
    const existing = localDb.getCategories().find((category) => category.id === id);
    if (!existing) {
      throw new Error('Category not found');
    }

    const updated: Category = {
      ...existing,
      ...data,
      id,
      updatedAt: nowIso(),
    };

    localDb.upsertCategory(updated);
    return updated;
  },

  async deleteCategory(id: string): Promise<void> {
    localDb.removeCategory(id);
  },

  async getBudgets(): Promise<Budget[]> {
    return normalizeBudgets();
  },

  async getBudget(id: string): Promise<Budget> {
    const budget = normalizeBudgets().find((item) => item.id === id);
    if (!budget) {
      throw new Error('Budget not found');
    }
    return budget;
  },

  async createBudget(data: BudgetFormData): Promise<Budget> {
    const db = localDb.read();
    const timestamp = nowIso();
    const today = timestamp.slice(0, 10);
    const categoryName = localDbHelpers.getCategoryName(db, data.categoryId);

    const budget: Budget = {
      id: generateId(),
      userId: localDb.getCurrentUser().id,
      categoryId: data.categoryId,
      category: categoryName,
      amount: data.amount,
      spent: 0,
      period: data.period,
      startDate: today,
      endDate: addPeriod(today, data.period),
      alertThreshold: data.alertThreshold,
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    localDb.upsertBudget(budget);
    return budget;
  },

  async updateBudget(id: string, data: Partial<BudgetFormData>): Promise<Budget> {
    const existing = normalizeBudgets().find((item) => item.id === id);
    if (!existing) {
      throw new Error('Budget not found');
    }

    const categoryName = data.categoryId
      ? localDbHelpers.getCategoryName(localDb.read(), data.categoryId)
      : existing.category;

    const updated: Budget = {
      ...existing,
      ...data,
      category: categoryName,
      updatedAt: nowIso(),
    };

    localDb.upsertBudget(updated);
    return updated;
  },

  async deleteBudget(id: string): Promise<void> {
    localDb.removeBudget(id);
  },

  async getAnalyticsSummary(params: { startDate?: string; endDate?: string } = {}): Promise<AnalyticsSummary> {
    const allExpenses = localDb.getExpenses();
    const filtered = applyExpenseFilters(allExpenses, params);

    const totalIncome = sumByType(filtered, 'income');
    const totalExpenses = sumByType(filtered, 'expense');
    const balance = totalIncome - totalExpenses;

    const firstDate = filtered.map((item) => toDate(item.date).getTime());
    const defaultStart = firstDate.length > 0 ? new Date(Math.min(...firstDate)) : new Date();
    const rangeStart = params.startDate ? toDate(params.startDate) : defaultStart;
    const rangeEnd = params.endDate ? toDate(params.endDate) : new Date();
    const diffDays = Math.max(1, Math.ceil((rangeEnd.getTime() - rangeStart.getTime()) / (1000 * 60 * 60 * 24)));

    const previousEnd = new Date(rangeStart);
    previousEnd.setUTCDate(previousEnd.getUTCDate() - 1);
    const previousStart = new Date(previousEnd);
    previousStart.setUTCDate(previousStart.getUTCDate() - diffDays);

    const previousFiltered = applyExpenseFilters(allExpenses, {
      startDate: previousStart.toISOString().slice(0, 10),
      endDate: previousEnd.toISOString().slice(0, 10),
    });

    const previousIncome = sumByType(previousFiltered, 'income');
    const previousExpense = sumByType(previousFiltered, 'expense');
    const previousBalance = previousIncome - previousExpense;

    return {
      totalIncome,
      totalExpenses,
      balance,
      incomeChange: safePercentChange(totalIncome, previousIncome),
      expenseChange: safePercentChange(totalExpenses, previousExpense),
      balanceChange: safePercentChange(balance, previousBalance),
      transactionCount: filtered.length,
      averageTransaction: filtered.length > 0 ? (totalIncome + totalExpenses) / filtered.length : 0,
    };
  },

  async getAnalyticsTrends(params: { startDate?: string; endDate?: string } = {}): Promise<AnalyticsTrends> {
    const filtered = applyExpenseFilters(localDb.getExpenses(), params);

    return {
      daily: createDailySeries(filtered),
      weekly: createWeeklySeries(filtered),
      monthly: createMonthlySeries(filtered),
    };
  },

  async getCategoryAnalytics(params: { startDate?: string; endDate?: string } = {}): Promise<CategoryAnalytics[]> {
    const categories = localDb.getCategories();
    const filteredExpenses = applyExpenseFilters(localDb.getExpenses(), params).filter(
      (expense) => expense.type === 'expense'
    );

    const total = filteredExpenses.reduce((sum, expense) => sum + expense.amount, 0);
    const grouped = new Map<string, Expense[]>();

    filteredExpenses.forEach((expense) => {
      const bucket = grouped.get(expense.categoryId) || [];
      bucket.push(expense);
      grouped.set(expense.categoryId, bucket);
    });

    return [...grouped.entries()].map(([categoryId, list]) => {
      const category = categories.find((item) => item.id === categoryId);
      const categoryTotal = list.reduce((sum, expense) => sum + expense.amount, 0);

      return {
        categoryId,
        categoryName: category?.name || 'Uncategorized',
        categoryColor: category?.color || '#6b7280',
        categoryIcon: category?.icon || 'Circle',
        total: categoryTotal,
        percentage: total > 0 ? (categoryTotal / total) * 100 : 0,
        count: list.length,
        average: list.length > 0 ? categoryTotal / list.length : 0,
        trend: 'stable',
        trendPercentage: 0,
      };
    });
  },

  async exportExpenses(params: ExpenseFilters & { format: 'csv' | 'pdf' }): Promise<Blob> {
    const filtered = applyExpenseFilters(localDb.getExpenses(), params);

    if (params.format === 'pdf') {
      throw new Error('PDF export is not available in local mode');
    }

    const content = makeExpenseCsv(filtered);
    return new Blob([content], { type: 'text/csv;charset=utf-8;' });
  },
};

export default expenseService;
