import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { expenseService } from '@/services';
import { QUERY_KEYS } from '@/utils/constants';

interface DateRangeParams {
  startDate?: string;
  endDate?: string;
}

export function useAnalyticsSummary(params: DateRangeParams = {}) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [QUERY_KEYS.ANALYTICS_SUMMARY, params],
    queryFn: () => expenseService.getAnalyticsSummary(params),
    staleTime: 5 * 60 * 1000,
  });

  return {
    summary: data,
    isLoading,
    error: error instanceof Error ? error.message : null,
    refetch,
  };
}

export function useAnalyticsTrends(params: DateRangeParams = {}) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [QUERY_KEYS.ANALYTICS_TRENDS, params],
    queryFn: () => expenseService.getAnalyticsTrends(params),
    staleTime: 5 * 60 * 1000,
  });

  const chartData = useMemo(() => {
    if (!data) return { daily: [], weekly: [], monthly: [] };

    return {
      daily: data.daily.map((item) => ({
        name: item.date,
        income: item.income,
        expenses: item.expenses,
        balance: item.balance,
      })),
      weekly: data.weekly.map((item) => ({
        name: `Week ${item.week}`,
        income: item.income,
        expenses: item.expenses,
        balance: item.balance,
      })),
      monthly: data.monthly.map((item) => ({
        name: item.monthName,
        income: item.income,
        expenses: item.expenses,
        balance: item.balance,
      })),
    };
  }, [data]);

  return {
    trends: data,
    chartData,
    isLoading,
    error: error instanceof Error ? error.message : null,
    refetch,
  };
}

export function useCategoryAnalytics(params: DateRangeParams = {}) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [QUERY_KEYS.ANALYTICS_CATEGORIES, params],
    queryFn: () => expenseService.getCategoryAnalytics(params),
    staleTime: 5 * 60 * 1000,
  });

  const pieChartData = useMemo(() => {
    if (!data) return [];

    return data.map((item) => ({
      name: item.categoryName,
      value: item.total,
      color: item.categoryColor,
      percentage: item.percentage,
    }));
  }, [data]);

  return {
    categoryAnalytics: data || [],
    pieChartData,
    isLoading,
    error: error instanceof Error ? error.message : null,
    refetch,
  };
}

export function useDashboardData(params: DateRangeParams = {}) {
  const summary = useAnalyticsSummary(params);
  const trends = useAnalyticsTrends(params);
  const categories = useCategoryAnalytics(params);

  return {
    summary: summary.summary,
    trends: trends.trends,
    chartData: trends.chartData,
    categoryAnalytics: categories.categoryAnalytics,
    pieChartData: categories.pieChartData,
    isLoading: summary.isLoading || trends.isLoading || categories.isLoading,
    error: summary.error || trends.error || categories.error,
    refetch: () => {
      summary.refetch();
      trends.refetch();
      categories.refetch();
    },
  };
}

export default useDashboardData;
