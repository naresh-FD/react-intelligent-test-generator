import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Badge } from '@/components/common/Badge';
import { Skeleton } from '@/components/common/Skeleton';
import { useCategoryContext } from '@/contexts';
import { formatCurrency, formatDate } from '@/utils/formatters';
import { ROUTES } from '@/utils/constants';
import { cn } from '@/utils/helpers';
import type { Expense } from '@/types';

interface RecentTransactionsProps {
  transactions: Expense[];
  isLoading?: boolean;
  limit?: number;
}

export function RecentTransactions({
  transactions,
  isLoading = false,
  limit = 5,
}: RecentTransactionsProps) {
  const { getCategoryById } = useCategoryContext();

  const displayTransactions = transactions.slice(0, limit);

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-8 w-20" />
        </CardHeader>
        <CardContent className="space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle>Recent Transactions</CardTitle>
        <Link to={ROUTES.EXPENSES}>
          <Button variant="ghost" size="sm" rightIcon={<ArrowRight className="h-4 w-4" />}>
            View all
          </Button>
        </Link>
      </CardHeader>
      <CardContent>
        {displayTransactions.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground">
            No recent transactions
          </div>
        ) : (
          <div className="space-y-4">
            {displayTransactions.map((transaction, index) => {
              const category = getCategoryById(transaction.categoryId);
              const isIncome = transaction.type === 'income';

              return (
                <motion.div
                  key={transaction.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="flex items-center gap-4"
                >
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-full shrink-0"
                    style={{ backgroundColor: category?.color + '20' }}
                  >
                    <div
                      className="h-5 w-5 rounded-full"
                      style={{ backgroundColor: category?.color }}
                    />
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">
                      {transaction.description || category?.name || 'Transaction'}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {formatDate(transaction.date)}
                    </p>
                  </div>

                  <div className="text-right shrink-0">
                    <p
                      className={cn(
                        'font-semibold',
                        isIncome ? 'text-success' : 'text-destructive'
                      )}
                    >
                      {isIncome ? '+' : '-'}
                      {formatCurrency(transaction.amount)}
                    </p>
                    <Badge variant="secondary" className="text-xs">
                      {category?.name}
                    </Badge>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default RecentTransactions;
