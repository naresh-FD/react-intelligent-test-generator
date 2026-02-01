import type { ReactNode } from 'react';
import { ArrowUp, ArrowDown } from 'lucide-react';
import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/common/Card';
import { Skeleton } from '@/components/common/Skeleton';
import { formatCurrency, formatPercentage } from '@/utils/formatters';
import { cn } from '@/utils/helpers';

interface StatsCardProps {
  title: string;
  value: number;
  change?: number;
  changeLabel?: string;
  icon: ReactNode;
  variant?: 'default' | 'income' | 'expense' | 'balance';
  isCurrency?: boolean;
  isLoading?: boolean;
}

const variantStyles = {
  default: {
    iconBg: 'bg-primary/10',
    iconColor: 'text-primary',
    valueColor: 'text-foreground',
  },
  income: {
    iconBg: 'bg-success/10',
    iconColor: 'text-success',
    valueColor: 'text-success',
  },
  expense: {
    iconBg: 'bg-destructive/10',
    iconColor: 'text-destructive',
    valueColor: 'text-destructive',
  },
  balance: {
    iconBg: 'bg-primary/10',
    iconColor: 'text-primary',
    valueColor: 'text-foreground',
  },
};

export function StatsCard({
  title,
  value,
  change,
  changeLabel = 'vs last month',
  icon,
  variant = 'default',
  isCurrency = true,
  isLoading = false,
}: StatsCardProps) {
  const styles = variantStyles[variant];
  const isPositiveChange = change !== undefined && change >= 0;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-10 rounded-full" />
          </div>
          <Skeleton className="mt-4 h-8 w-32" />
          <Skeleton className="mt-2 h-3 w-20" />
        </CardContent>
      </Card>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="overflow-hidden">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <div className={cn('flex h-10 w-10 items-center justify-center rounded-full', styles.iconBg)}>
              <span className={styles.iconColor}>{icon}</span>
            </div>
          </div>

          <div className="mt-4">
            <p className={cn('text-2xl font-bold', styles.valueColor)}>
              {isCurrency ? formatCurrency(value) : value.toLocaleString()}
            </p>

            {change !== undefined && (
              <div className="mt-1 flex items-center gap-1">
                <span
                  className={cn(
                    'inline-flex items-center text-xs font-medium',
                    isPositiveChange ? 'text-success' : 'text-destructive'
                  )}
                >
                  {isPositiveChange ? (
                    <ArrowUp className="h-3 w-3" />
                  ) : (
                    <ArrowDown className="h-3 w-3" />
                  )}
                  {formatPercentage(Math.abs(change))}
                </span>
                <span className="text-xs text-muted-foreground">{changeLabel}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export default StatsCard;
