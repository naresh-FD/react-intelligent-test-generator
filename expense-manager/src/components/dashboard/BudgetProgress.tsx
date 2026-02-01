import { Link } from 'react-router-dom';
import { ArrowRight, AlertTriangle } from 'lucide-react';
import { motion } from 'framer-motion';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Skeleton } from '@/components/common/Skeleton';
import { useCategoryContext } from '@/contexts';
import { formatCurrency } from '@/utils/formatters';
import { cn } from '@/utils/helpers';
import type { Budget } from '@/types';

interface BudgetProgressProps {
  budgets: Budget[];
  isLoading?: boolean;
  limit?: number;
}

export function BudgetProgress({
  budgets,
  isLoading = false,
  limit = 4,
}: BudgetProgressProps) {
  const { getCategoryById } = useCategoryContext();

  const displayBudgets = budgets
    .filter((b) => b.isActive)
    .slice(0, limit);

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-8 w-20" />
        </CardHeader>
        <CardContent className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="flex justify-between">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-20" />
              </div>
              <Skeleton className="h-2 w-full" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle>Budget Progress</CardTitle>
        <Link to="/budgets">
          <Button variant="ghost" size="sm" rightIcon={<ArrowRight className="h-4 w-4" />}>
            Manage
          </Button>
        </Link>
      </CardHeader>
      <CardContent>
        {displayBudgets.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground">
            No active budgets
          </div>
        ) : (
          <div className="space-y-4">
            {displayBudgets.map((budget, index) => {
              const category = getCategoryById(budget.categoryId);
              const percentage = Math.min((budget.spent / budget.amount) * 100, 100);
              const isOverBudget = budget.spent > budget.amount;
              const isWarning = percentage >= budget.alertThreshold && !isOverBudget;

              return (
                <motion.div
                  key={budget.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: category?.color }}
                      />
                      <span className="font-medium">{budget.category}</span>
                      {(isOverBudget || isWarning) && (
                        <AlertTriangle
                          className={cn(
                            'h-4 w-4',
                            isOverBudget ? 'text-destructive' : 'text-warning'
                          )}
                        />
                      )}
                    </div>
                    <div className="text-right text-sm">
                      <span className={cn(isOverBudget && 'text-destructive')}>
                        {formatCurrency(budget.spent)}
                      </span>
                      <span className="text-muted-foreground">
                        {' / '}
                        {formatCurrency(budget.amount)}
                      </span>
                    </div>
                  </div>

                  <div className="relative h-2 overflow-hidden rounded-full bg-muted">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${percentage}%` }}
                      transition={{ duration: 0.5, delay: index * 0.1 }}
                      className={cn(
                        'absolute inset-y-0 left-0 rounded-full',
                        isOverBudget
                          ? 'bg-destructive'
                          : isWarning
                          ? 'bg-warning'
                          : 'bg-primary'
                      )}
                    />
                  </div>

                  <p className="text-xs text-muted-foreground">
                    {isOverBudget
                      ? `Over budget by ${formatCurrency(budget.spent - budget.amount)}`
                      : `${formatCurrency(budget.amount - budget.spent)} remaining`}
                  </p>
                </motion.div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default BudgetProgress;
