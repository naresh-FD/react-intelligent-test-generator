import { ArrowUpRight, ArrowDownRight, Target, FileText } from 'lucide-react';
import { motion } from 'framer-motion';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/common/Card';
import { cn } from '@/utils/helpers';

interface QuickAction {
  label: string;
  description: string;
  icon: React.ReactNode;
  onClick: () => void;
  variant: 'default' | 'income' | 'expense';
}

interface QuickActionsProps {
  onAddExpense: () => void;
  onAddIncome: () => void;
  onSetBudget?: () => void;
  onExportData?: () => void;
}

export function QuickActions({
  onAddExpense,
  onAddIncome,
  onSetBudget,
  onExportData,
}: QuickActionsProps) {
  const actions: QuickAction[] = [
    {
      label: 'Add Expense',
      description: 'Record a new expense',
      icon: <ArrowDownRight className="h-5 w-5" />,
      onClick: onAddExpense,
      variant: 'expense',
    },
    {
      label: 'Add Income',
      description: 'Record a new income',
      icon: <ArrowUpRight className="h-5 w-5" />,
      onClick: onAddIncome,
      variant: 'income',
    },
    ...(onSetBudget
      ? [
          {
            label: 'Set Budget',
            description: 'Create a new budget',
            icon: <Target className="h-5 w-5" />,
            onClick: onSetBudget,
            variant: 'default' as const,
          },
        ]
      : []),
    ...(onExportData
      ? [
          {
            label: 'Export Data',
            description: 'Download your data',
            icon: <FileText className="h-5 w-5" />,
            onClick: onExportData,
            variant: 'default' as const,
          },
        ]
      : []),
  ];

  const variantStyles = {
    default: 'border-border hover:border-primary hover:bg-primary/5',
    income: 'border-success/30 bg-success/5 hover:border-success hover:bg-success/10',
    expense: 'border-destructive/30 bg-destructive/5 hover:border-destructive hover:bg-destructive/10',
  };

  const iconStyles = {
    default: 'bg-primary/10 text-primary',
    income: 'bg-success/10 text-success',
    expense: 'bg-destructive/10 text-destructive',
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Quick Actions</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3">
          {actions.map((action, index) => (
            <motion.button
              key={action.label}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.05 }}
              onClick={action.onClick}
              className={cn(
                'flex flex-col items-start gap-3 rounded-lg border p-4 text-left transition-all',
                variantStyles[action.variant]
              )}
            >
              <div className={cn('rounded-full p-2', iconStyles[action.variant])}>
                {action.icon}
              </div>
              <div>
                <p className="font-medium">{action.label}</p>
                <p className="text-xs text-muted-foreground">{action.description}</p>
              </div>
            </motion.button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default QuickActions;
