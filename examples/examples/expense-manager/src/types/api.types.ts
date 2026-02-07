export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  timestamp: string;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, string[]>;
  };
  timestamp: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: PaginationMeta;
  timestamp: string;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface SortParams {
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface QueryParams extends PaginationParams, SortParams {
  [key: string]: string | number | boolean | undefined;
}

export interface BulkDeleteRequest {
  ids: string[];
}

export interface BulkDeleteResponse {
  success: boolean;
  deletedCount: number;
  failedIds: string[];
}

export interface AnalyticsSummary {
  totalIncome: number;
  totalExpenses: number;
  balance: number;
  incomeChange: number;
  expenseChange: number;
  balanceChange: number;
  transactionCount: number;
  averageTransaction: number;
}

export interface AnalyticsTrends {
  daily: DailyTrend[];
  weekly: WeeklyTrend[];
  monthly: MonthlyTrendData[];
}

export interface DailyTrend {
  date: string;
  income: number;
  expenses: number;
  balance: number;
}

export interface WeeklyTrend {
  week: number;
  year: number;
  startDate: string;
  endDate: string;
  income: number;
  expenses: number;
  balance: number;
}

export interface MonthlyTrendData {
  month: number;
  year: number;
  monthName: string;
  income: number;
  expenses: number;
  balance: number;
}

export interface CategoryAnalytics {
  categoryId: string;
  categoryName: string;
  categoryColor: string;
  categoryIcon: string;
  total: number;
  percentage: number;
  count: number;
  average: number;
  trend: 'up' | 'down' | 'stable';
  trendPercentage: number;
}
