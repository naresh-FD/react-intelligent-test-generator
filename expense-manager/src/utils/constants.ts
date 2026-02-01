import type { Category, SelectOption } from '@/types';

export const APP_NAME = 'Expense Manager';
export const APP_VERSION = '1.0.0';

export const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000/api';
export const API_TIMEOUT = Number(process.env.REACT_APP_API_TIMEOUT) || 30000;

export const TOKEN_KEY = 'expense_manager_token';
export const REFRESH_TOKEN_KEY = 'expense_manager_refresh_token';
export const USER_KEY = 'expense_manager_user';
export const THEME_KEY = 'expense_manager_theme';
export const PREFERENCES_KEY = 'expense_manager_preferences';

export const DEFAULT_PAGE_SIZE = 10;
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export const DEFAULT_CURRENCY = 'USD';
export const SUPPORTED_CURRENCIES: SelectOption[] = [
  { value: 'USD', label: 'US Dollar ($)' },
  { value: 'EUR', label: 'Euro (€)' },
  { value: 'GBP', label: 'British Pound (£)' },
  { value: 'JPY', label: 'Japanese Yen (¥)' },
  { value: 'INR', label: 'Indian Rupee (₹)' },
  { value: 'CAD', label: 'Canadian Dollar (C$)' },
  { value: 'AUD', label: 'Australian Dollar (A$)' },
  { value: 'CHF', label: 'Swiss Franc (CHF)' },
];

export const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  INR: '₹',
  CAD: 'C$',
  AUD: 'A$',
  CHF: 'CHF',
};

export const DEFAULT_CATEGORIES: Omit<Category, 'id' | 'createdAt' | 'updatedAt'>[] = [
  { name: 'Salary', icon: 'Wallet', color: '#22c55e', type: 'income', isDefault: true },
  { name: 'Freelance', icon: 'Laptop', color: '#3b82f6', type: 'income', isDefault: true },
  { name: 'Investment', icon: 'TrendingUp', color: '#8b5cf6', type: 'income', isDefault: true },
  { name: 'Other Income', icon: 'Plus', color: '#06b6d4', type: 'income', isDefault: true },
  { name: 'Food & Dining', icon: 'Utensils', color: '#f97316', type: 'expense', isDefault: true },
  { name: 'Transportation', icon: 'Car', color: '#3b82f6', type: 'expense', isDefault: true },
  { name: 'Shopping', icon: 'ShoppingBag', color: '#ec4899', type: 'expense', isDefault: true },
  { name: 'Entertainment', icon: 'Film', color: '#8b5cf6', type: 'expense', isDefault: true },
  { name: 'Bills & Utilities', icon: 'Receipt', color: '#f59e0b', type: 'expense', isDefault: true },
  { name: 'Healthcare', icon: 'Heart', color: '#ef4444', type: 'expense', isDefault: true },
  { name: 'Education', icon: 'GraduationCap', color: '#06b6d4', type: 'expense', isDefault: true },
  { name: 'Travel', icon: 'Plane', color: '#14b8a6', type: 'expense', isDefault: true },
  { name: 'Personal Care', icon: 'Sparkles', color: '#d946ef', type: 'expense', isDefault: true },
  { name: 'Groceries', icon: 'ShoppingCart', color: '#84cc16', type: 'expense', isDefault: true },
  { name: 'Other Expense', icon: 'Minus', color: '#6b7280', type: 'expense', isDefault: true },
];

export const RECURRENCE_OPTIONS: SelectOption[] = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

export const BUDGET_PERIOD_OPTIONS: SelectOption[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

export const DATE_FORMAT_OPTIONS: SelectOption[] = [
  { value: 'MM/dd/yyyy', label: 'MM/DD/YYYY' },
  { value: 'dd/MM/yyyy', label: 'DD/MM/YYYY' },
  { value: 'yyyy-MM-dd', label: 'YYYY-MM-DD' },
  { value: 'MMMM dd, yyyy', label: 'Month DD, YYYY' },
];

export const CHART_COLORS = [
  '#3b82f6', // blue
  '#22c55e', // green
  '#f97316', // orange
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#f59e0b', // amber
  '#06b6d4', // cyan
  '#ef4444', // red
  '#84cc16', // lime
  '#14b8a6', // teal
];

export const ROUTES = {
  HOME: '/',
  LOGIN: '/login',
  REGISTER: '/register',
  FORGOT_PASSWORD: '/forgot-password',
  RESET_PASSWORD: '/reset-password',
  DASHBOARD: '/dashboard',
  EXPENSES: '/expenses',
  EXPENSE_NEW: '/expenses/new',
  EXPENSE_EDIT: '/expenses/:id/edit',
  CATEGORIES: '/categories',
  BUDGETS: '/budgets',
  ANALYTICS: '/analytics',
  PROFILE: '/profile',
  SETTINGS: '/settings',
} as const;

export const QUERY_KEYS = {
  USER: 'user',
  EXPENSES: 'expenses',
  EXPENSE: 'expense',
  CATEGORIES: 'categories',
  BUDGETS: 'budgets',
  ANALYTICS_SUMMARY: 'analytics-summary',
  ANALYTICS_TRENDS: 'analytics-trends',
  ANALYTICS_CATEGORIES: 'analytics-categories',
} as const;

export const TOAST_DURATION = 5000;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/;
