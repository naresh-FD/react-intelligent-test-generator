import { MainLayout } from '@/components/layout/MainLayout';
import { ExpenseList } from '@/components/expense/ExpenseList';

export function Expenses() {
  return (
    <MainLayout>
      <ExpenseList />
    </MainLayout>
  );
}

export default Expenses;
