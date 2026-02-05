import { useState, useCallback } from 'react';
import { Plus, Trash2, Download } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { Button } from '@/components/common/Button';
import { ConfirmModal } from '@/components/common/Modal';
import { Pagination } from '@/components/common/Pagination';
import { EmptyState } from '@/components/common/EmptyState';
import { SkeletonCard } from '@/components/common/Skeleton';
import { ExpenseCard } from './ExpenseCard';
import { ExpenseForm } from './ExpenseForm';
import { ExpenseFilters } from './ExpenseFilters';
import { useExpenses } from '@/hooks';
import { useExpenseContext, useNotification } from '@/contexts';
import { expenseService } from '@/services';
import type { Expense, ExpenseFormData } from '@/types';

export function ExpenseList() {
  const {
    expenses,
    pagination,
    isLoading,
    createExpense,
    updateExpense,
    deleteExpense,
    bulkDeleteExpenses,
    isCreating,
    isUpdating,
    isDeleting,
  } = useExpenses();

  const {
    selectedExpenses,
    selectExpense,
    deselectExpense,
    selectAllExpenses,
    deselectAllExpenses,
    isExpenseSelected,
    hasSelectedExpenses,
    selectedCount,
    setPage,
    setFilters,
    filters,
  } = useExpenseContext();

  const { success, error: showError } = useNotification();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [deletingExpense, setDeletingExpense] = useState<Expense | null>(null);
  const [isConfirmBulkDelete, setIsConfirmBulkDelete] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const handleAddNew = useCallback(() => {
    setEditingExpense(null);
    setIsFormOpen(true);
  }, []);
  console.log('dg bmnb   j  gchgchgc');

  const handleEdit = useCallback((expense: Expense) => {
    setEditingExpense(expense);
    setIsFormOpen(true);
  }, []);

  const handleDelete = useCallback((expense: Expense) => {
    setDeletingExpense(expense);
  }, []);

  const handleFormSubmit = useCallback(
    async (data: ExpenseFormData) => {
      if (editingExpense) {
        await updateExpense(editingExpense.id, data);
      } else {
        await createExpense(data);
      }
      setIsFormOpen(false);
      setEditingExpense(null);
    },
    [editingExpense, createExpense, updateExpense]
  );

  const handleConfirmDelete = useCallback(async () => {
    if (deletingExpense) {
      await deleteExpense(deletingExpense.id);
      setDeletingExpense(null);
    }
  }, [deletingExpense, deleteExpense]);

  const handleBulkDelete = useCallback(async () => {
    await bulkDeleteExpenses(selectedExpenses);
    setIsConfirmBulkDelete(false);
    deselectAllExpenses();
  }, [selectedExpenses, bulkDeleteExpenses, deselectAllExpenses]);

  const handleToggleSelect = useCallback(
    (id: string) => {
      if (isExpenseSelected(id)) {
        deselectExpense(id);
      } else {
        selectExpense(id);
      }
    },
    [isExpenseSelected, selectExpense, deselectExpense]
  );

  const handleToggleSelectAll = useCallback(() => {
    if (selectedCount === expenses.length) {
      deselectAllExpenses();
    } else {
      selectAllExpenses();
    }
  }, [selectedCount, expenses.length, selectAllExpenses, deselectAllExpenses]);

  const handleSearch = useCallback(
    (search: string) => {
      setFilters({ ...filters, search });
    },
    [filters, setFilters]
  );

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      const blob = await expenseService.exportExpenses({ ...filters, format: 'csv' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `expenses-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      success('Expenses exported successfully');
    } catch (err) {
      showError('Failed to export expenses');
    } finally {
      setIsExporting(false);
    }
  }, [filters, success, showError]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  console.log('vhjvhjjjvjbkj');

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">Transactions</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleExport}
            isLoading={isExporting}
            leftIcon={<Download className="h-4 w-4" />}
          >
            Export
          </Button>
          <Button onClick={handleAddNew} leftIcon={<Plus className="h-4 w-4" />}>
            Add Transaction
          </Button>
        </div>
      </div>

      <ExpenseFilters onSearch={handleSearch} />

      {hasSelectedExpenses && (
        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/50 p-4">
          <div className="flex items-center gap-4">
            <input
              type="checkbox"
              checked={selectedCount === expenses.length}
              onChange={handleToggleSelectAll}
              className="h-4 w-4 rounded border-border"
              aria-label="Select all transactions"
            />
            <span className="text-sm">
              {selectedCount} transaction{selectedCount > 1 ? 's' : ''} selected
            </span>
          </div>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setIsConfirmBulkDelete(true)}
            leftIcon={<Trash2 className="h-4 w-4" />}
          >
            Delete Selected
          </Button>
        </div>
      )}

      {expenses.length === 0 ? (
        <EmptyState
          title="No transactions yet"
          description="Start tracking your income and expenses by adding your first transaction."
          action={{
            label: 'Add Transaction',
            onClick: handleAddNew,
          }}
        />
      ) : (
        <div className="space-y-3">
          <AnimatePresence mode="popLayout">
            {expenses.map((expense) => (
              <ExpenseCard
                key={expense.id}
                expense={expense}
                onEdit={handleEdit}
                onDelete={handleDelete}
                isSelected={isExpenseSelected(expense.id)}
                onSelect={handleToggleSelect}
                showCheckbox={hasSelectedExpenses}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      {pagination && pagination.totalPages > 1 && (
        <Pagination pagination={pagination} onPageChange={setPage} />
      )}

      <ExpenseForm
        isOpen={isFormOpen}
        onClose={() => {
          setIsFormOpen(false);
          setEditingExpense(null);
        }}
        onSubmit={handleFormSubmit}
        expense={editingExpense}
        isLoading={isCreating || isUpdating}
      />

      <ConfirmModal
        isOpen={!!deletingExpense}
        onClose={() => setDeletingExpense(null)}
        onConfirm={handleConfirmDelete}
        title="Delete Transaction"
        message="Are you sure you want to delete this transaction? This action cannot be undone."
        confirmText="Delete"
        isLoading={isDeleting}
      />

      <ConfirmModal
        isOpen={isConfirmBulkDelete}
        onClose={() => setIsConfirmBulkDelete(false)}
        onConfirm={handleBulkDelete}
        title="Delete Selected Transactions"
        message={`Are you sure you want to delete ${selectedCount} transaction${selectedCount > 1 ? 's' : ''}? This action cannot be undone.`}
        confirmText="Delete All"
        isLoading={isDeleting}
      />
    </div>
  );
}

export default ExpenseList;
