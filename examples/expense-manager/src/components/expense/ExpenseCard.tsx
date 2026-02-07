import { memo } from 'react';
import { Edit, Trash2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/common/Button';
import { Badge } from '@/components/common/Badge';
import { useCategoryContext } from '@/contexts';
import { formatCurrency, formatDate } from '@/utils/formatters';
import { cn } from '@/utils/helpers';
import type { Expense } from '@/types';

interface ExpenseCardProps {
  expense: Expense;
  onEdit: (expense: Expense) => void;
  onDelete: (expense: Expense) => void;
  isSelected?: boolean;
  onSelect?: (id: string) => void;
  showCheckbox?: boolean;
}

export const ExpenseCard = memo(function ExpenseCard({
  expense,
  onEdit,
  onDelete,
  isSelected = false,
  onSelect,
  showCheckbox = false,
}: ExpenseCardProps) {
  const { getCategoryById } = useCategoryContext();
  const category = getCategoryById(expense.categoryId);

  const isIncome = expense.type === 'income';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className={cn(
        'group relative rounded-lg border border-border bg-card p-4 transition-all hover:shadow-md',
        isSelected && 'border-primary bg-primary/5'
      )}
    >
      <div className="flex items-start gap-3">
        {showCheckbox && (
          <div className="pt-1">
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onSelect?.(expense.id)}
              className="h-4 w-4 rounded border-border"
              aria-label={`Select transaction ${expense.description || expense.category}`}
            />
          </div>
        )}

        <div
          className="flex h-10 w-10 items-center justify-center rounded-full"
          style={{ backgroundColor: category?.color + '20' }}
        >
          <div
            className="h-5 w-5 rounded-full"
            style={{ backgroundColor: category?.color }}
          />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium truncate">
                {expense.description || category?.name || 'Transaction'}
              </p>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="secondary" className="text-xs">
                  {category?.name}
                </Badge>
                {expense.isRecurring && (
                  <Badge variant="outline" className="text-xs">
                    Recurring
                  </Badge>
                )}
              </div>
            </div>

            <div className="text-right shrink-0">
              <p
                className={cn(
                  'font-semibold',
                  isIncome ? 'text-success' : 'text-destructive'
                )}
              >
                {isIncome ? '+' : '-'}
                {formatCurrency(expense.amount)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {formatDate(expense.date)}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onEdit(expense)}
            aria-label="Edit transaction"
          >
            <Edit className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onDelete(expense)}
            aria-label="Delete transaction"
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </motion.div>
  );
});

export default ExpenseCard;
