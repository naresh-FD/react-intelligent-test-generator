import { useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CalendarIcon, DollarSign } from 'lucide-react';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { Select } from '@/components/common/Select';
import { Modal } from '@/components/common/Modal';
import { useCategoryContext } from '@/contexts';
import { expenseSchema, type ExpenseFormData } from '@/utils/validators';
import { RECURRENCE_OPTIONS } from '@/utils/constants';
import { formatDateForInput } from '@/utils/formatters';
import type { Expense, TransactionType } from '@/types';

interface ExpenseFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: ExpenseFormData) => Promise<void>;
  expense?: Expense | null;
  defaultType?: TransactionType;
  isLoading?: boolean;
}

export function ExpenseForm({
  isOpen,
  onClose,
  onSubmit,
  expense,
  defaultType = 'expense',
  isLoading = false,
}: ExpenseFormProps) {
  const { incomeCategories, expenseCategories } = useCategoryContext();

  const {
    register,
    handleSubmit,
    control,
    watch,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ExpenseFormData>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      amount: 0,
      categoryId: '',
      type: defaultType,
      description: '',
      date: formatDateForInput(new Date()),
      isRecurring: false,
      recurrence: 'none',
    },
  });

  const transactionType = watch('type');
  const isRecurring = watch('isRecurring');

  const categories = transactionType === 'income' ? incomeCategories : expenseCategories;
  const categoryOptions = categories.map((cat) => ({
    value: cat.id,
    label: cat.name,
  }));

  useEffect(() => {
    if (expense) {
      reset({
        amount: expense.amount,
        categoryId: expense.categoryId,
        type: expense.type,
        description: expense.description,
        date: formatDateForInput(expense.date),
        isRecurring: expense.isRecurring,
        recurrence: expense.recurrence,
      });
    } else {
      reset({
        amount: 0,
        categoryId: '',
        type: defaultType,
        description: '',
        date: formatDateForInput(new Date()),
        isRecurring: false,
        recurrence: 'none',
      });
    }
  }, [expense, defaultType, reset]);

  useEffect(() => {
    setValue('categoryId', '');
  }, [transactionType, setValue]);

  const handleFormSubmit = async (data: ExpenseFormData) => {
    await onSubmit(data);
    onClose();
  };

  const isSubmittingForm = isSubmitting || isLoading;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={expense ? 'Edit Transaction' : 'Add Transaction'}
      size="md"
    >
      <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2 sm:col-span-1">
            <Controller
              name="type"
              control={control}
              render={({ field }) => (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Type</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => field.onChange('expense')}
                      className={`flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                        field.value === 'expense'
                          ? 'border-destructive bg-destructive/10 text-destructive'
                          : 'border-border hover:bg-muted'
                      }`}
                    >
                      Expense
                    </button>
                    <button
                      type="button"
                      onClick={() => field.onChange('income')}
                      className={`flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                        field.value === 'income'
                          ? 'border-success bg-success/10 text-success'
                          : 'border-border hover:bg-muted'
                      }`}
                    >
                      Income
                    </button>
                  </div>
                </div>
              )}
            />
          </div>

          <div className="col-span-2 sm:col-span-1">
            <Input
              label="Amount"
              type="number"
              step="0.01"
              min="0"
              leftIcon={<DollarSign className="h-4 w-4" />}
              error={errors.amount?.message}
              {...register('amount', { valueAsNumber: true })}
            />
          </div>
        </div>

        <Select
          label="Category"
          options={categoryOptions}
          placeholder="Select a category"
          error={errors.categoryId?.message}
          {...register('categoryId')}
        />

        <Input
          label="Date"
          type="date"
          leftIcon={<CalendarIcon className="h-4 w-4" />}
          error={errors.date?.message}
          {...register('date')}
        />

        <Input
          label="Description (optional)"
          placeholder="What was this for?"
          error={errors.description?.message}
          {...register('description')}
        />

        <div className="space-y-2">
          <Controller
            name="isRecurring"
            control={control}
            render={({ field }) => (
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={field.value}
                  onChange={(e) => field.onChange(e.target.checked)}
                  className="h-4 w-4 rounded border-border"
                />
                <span className="text-sm">This is a recurring transaction</span>
              </label>
            )}
          />

          {isRecurring && (
            <Select
              label="Recurrence"
              options={RECURRENCE_OPTIONS}
              error={errors.recurrence?.message}
              {...register('recurrence')}
            />
          )}
        </div>

        <div className="flex justify-end gap-2 pt-4">
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmittingForm}>
            Cancel
          </Button>
          <Button type="submit" isLoading={isSubmittingForm}>
            {expense ? 'Update' : 'Add'} Transaction
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default ExpenseForm;
