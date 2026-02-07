import { useState } from 'react';
import { Search, Filter, X, Calendar } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { Select } from '@/components/common/Select';
import { useCategoryContext } from '@/contexts';
import { useDebounce } from '@/hooks';
import { useExpenseFilters } from '@/hooks/useExpenses';
import type { TransactionType } from '@/types';

interface ExpenseFiltersProps {
  onSearch: (search: string) => void;
  className?: string;
}

const typeOptions = [
  { value: 'all', label: 'All Types' },
  { value: 'income', label: 'Income' },
  { value: 'expense', label: 'Expense' },
];

export function ExpenseFilters({ onSearch, className }: ExpenseFiltersProps) {
  const { categories } = useCategoryContext();
  const { filters, updateFilter, resetFilters } = useExpenseFilters();
  const [isExpanded, setIsExpanded] = useState(false);
  const [searchValue, setSearchValue] = useState(filters.search || '');

  // Debounce search value for API calls
  useDebounce(searchValue, 300);

  const categoryOptions = [
    { value: '', label: 'All Categories' },
    ...categories.map((cat) => ({ value: cat.id, label: cat.name })),
  ];

  const handleSearchChange = (value: string) => {
    setSearchValue(value);
    onSearch(value);
  };

  const handleReset = () => {
    setSearchValue('');
    resetFilters();
  };

  const hasActiveFilters =
    filters.type !== 'all' ||
    filters.categoryId ||
    filters.startDate ||
    filters.endDate ||
    filters.minAmount ||
    filters.maxAmount;

  return (
    <div className={className}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Input
            placeholder="Search transactions..."
            value={searchValue}
            onChange={(e) => handleSearchChange(e.target.value)}
            leftIcon={<Search className="h-4 w-4" />}
            rightIcon={
              searchValue && (
                <button
                  onClick={() => handleSearchChange('')}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )
            }
          />
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant={hasActiveFilters ? 'default' : 'outline'}
            onClick={() => setIsExpanded(!isExpanded)}
            leftIcon={<Filter className="h-4 w-4" />}
          >
            Filters
            {hasActiveFilters && (
              <span className="ml-1 rounded-full bg-primary-foreground/20 px-1.5 text-xs">
                {Object.values(filters).filter((v) => v && v !== 'all').length}
              </span>
            )}
          </Button>

          {hasActiveFilters && (
            <Button variant="ghost" onClick={handleReset} size="sm">
              Reset
            </Button>
          )}
        </div>
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-4 grid grid-cols-1 gap-4 rounded-lg border border-border p-4 sm:grid-cols-2 lg:grid-cols-4">
              <Select
                label="Type"
                options={typeOptions}
                value={filters.type || 'all'}
                onChange={(e) => updateFilter('type', e.target.value as TransactionType | 'all')}
              />

              <Select
                label="Category"
                options={categoryOptions}
                value={filters.categoryId || ''}
                onChange={(e) => updateFilter('categoryId', e.target.value)}
              />

              <Input
                label="Start Date"
                type="date"
                value={filters.startDate || ''}
                onChange={(e) => updateFilter('startDate', e.target.value)}
                leftIcon={<Calendar className="h-4 w-4" />}
              />

              <Input
                label="End Date"
                type="date"
                value={filters.endDate || ''}
                onChange={(e) => updateFilter('endDate', e.target.value)}
                leftIcon={<Calendar className="h-4 w-4" />}
              />

              <Input
                label="Min Amount"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={filters.minAmount || ''}
                onChange={(e) => updateFilter('minAmount', Number(e.target.value) || undefined)}
              />

              <Input
                label="Max Amount"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={filters.maxAmount || ''}
                onChange={(e) => updateFilter('maxAmount', Number(e.target.value) || undefined)}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default ExpenseFilters;
