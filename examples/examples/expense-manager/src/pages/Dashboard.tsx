import { useState } from 'react';
import { Wallet, TrendingUp, TrendingDown, DollarSign } from 'lucide-react';
import { MainLayout } from '@/components/layout/MainLayout';
import {
  StatsCard,
  ExpenseChart,
  CategoryPieChart,
  RecentTransactions,
  QuickActions,
  BudgetProgress,
} from '@/components/dashboard';
import { ExpenseForm } from '@/components/expense/ExpenseForm';
import { useDashboardData, useExpenses } from '@/hooks';
import { useBudgetContext } from '@/contexts';
import type { TransactionType, ExpenseFormData } from '@/types';

export function Dashboard() {
  const { summary, chartData, pieChartData, isLoading } = useDashboardData();
  const { expenses, createExpense, isCreating } = useExpenses();
  const { budgets, isLoading: isBudgetsLoading } = useBudgetContext();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [defaultType, setDefaultType] = useState<TransactionType>('expense');

  const handleAddExpense = () => {
    setDefaultType('expense');
    setIsFormOpen(true);
  };

  const handleAddIncome = () => {
    setDefaultType('income');
    setIsFormOpen(true);
  };

  const handleFormSubmit = async (data: ExpenseFormData) => {
    await createExpense(data);
    setIsFormOpen(false);
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Dashboard</h1>
            <p className="text-muted-foreground">
              Welcome back! Here's your financial overview.
            </p>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatsCard
            title="Total Income"
            value={summary?.totalIncome || 0}
            change={summary?.incomeChange}
            icon={<TrendingUp className="h-5 w-5" />}
            variant="income"
            isLoading={isLoading}
          />
          <StatsCard
            title="Total Expenses"
            value={summary?.totalExpenses || 0}
            change={summary?.expenseChange}
            icon={<TrendingDown className="h-5 w-5" />}
            variant="expense"
            isLoading={isLoading}
          />
          <StatsCard
            title="Balance"
            value={summary?.balance || 0}
            change={summary?.balanceChange}
            icon={<Wallet className="h-5 w-5" />}
            variant="balance"
            isLoading={isLoading}
          />
          <StatsCard
            title="Transactions"
            value={summary?.transactionCount || 0}
            icon={<DollarSign className="h-5 w-5" />}
            isCurrency={false}
            isLoading={isLoading}
          />
        </div>

        {/* Charts Row */}
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ExpenseChart
              data={chartData.monthly}
              isLoading={isLoading}
              title="Monthly Overview"
            />
          </div>
          <div>
            <CategoryPieChart
              data={pieChartData}
              isLoading={isLoading}
              title="Expenses by Category"
            />
          </div>
        </div>

        {/* Bottom Row */}
        <div className="grid gap-6 lg:grid-cols-3">
          <div>
            <QuickActions
              onAddExpense={handleAddExpense}
              onAddIncome={handleAddIncome}
            />
          </div>
          <div>
            <BudgetProgress budgets={budgets} isLoading={isBudgetsLoading} />
          </div>
          <div>
            <RecentTransactions
              transactions={expenses.slice(0, 5)}
              isLoading={isLoading}
            />
          </div>
        </div>
      </div>

      <ExpenseForm
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        onSubmit={handleFormSubmit}
        defaultType={defaultType}
        isLoading={isCreating}
      />
    </MainLayout>
  );
}

export default Dashboard;
