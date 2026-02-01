export type TransactionType = 'income' | 'expense';

export type RecurrenceType = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  type: TransactionType;
  isDefault?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Expense {
  id: string;
  userId: string;
  amount: number;
  category: string;
  categoryId: string;
  type: TransactionType;
  description: string;
  date: string;
  isRecurring: boolean;
  recurrence: RecurrenceType;
  tags?: string[];
  attachments?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseFormData {
  amount: number;
  categoryId: string;
  type: TransactionType;
  description: string;
  date: string;
  isRecurring: boolean;
  recurrence: RecurrenceType;
  tags?: string[];
}

export interface ExpenseFilters {
  search?: string;
  type?: TransactionType | 'all';
  categoryId?: string;
  startDate?: string;
  endDate?: string;
  minAmount?: number;
  maxAmount?: number;
  tags?: string[];
}

export interface ExpenseSortOptions {
  field: 'date' | 'amount' | 'category' | 'createdAt';
  order: 'asc' | 'desc';
}

export interface Budget {
  id: string;
  userId: string;
  categoryId: string;
  category: string;
  amount: number;
  spent: number;
  period: 'weekly' | 'monthly' | 'yearly';
  startDate: string;
  endDate: string;
  alertThreshold: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetFormData {
  categoryId: string;
  amount: number;
  period: 'weekly' | 'monthly' | 'yearly';
  alertThreshold: number;
}

export interface ExpenseSummary {
  totalIncome: number;
  totalExpenses: number;
  balance: number;
  transactionCount: number;
  averageExpense: number;
  largestExpense: Expense | null;
  categoryBreakdown: CategoryBreakdown[];
}

export interface CategoryBreakdown {
  categoryId: string;
  categoryName: string;
  categoryColor: string;
  categoryIcon: string;
  total: number;
  percentage: number;
  count: number;
}

export interface MonthlyTrend {
  month: string;
  year: number;
  income: number;
  expenses: number;
  balance: number;
  transactionCount: number;
}

export interface DailyExpense {
  date: string;
  income: number;
  expenses: number;
  transactions: Expense[];
}
