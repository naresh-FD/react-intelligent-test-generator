export * from './expense.types';
export * from './user.types';
export * from './api.types';

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message?: string;
  duration?: number;
}

export interface ModalState {
  isOpen: boolean;
  type: 'create' | 'edit' | 'delete' | 'confirm' | null;
  data?: unknown;
}

export interface SelectOption {
  value: string;
  label: string;
  icon?: string;
  color?: string;
  disabled?: boolean;
}

export interface DateRange {
  startDate: Date | null;
  endDate: Date | null;
}

export interface TableColumn<T> {
  key: keyof T | string;
  header: string;
  width?: string;
  sortable?: boolean;
  render?: (value: unknown, row: T) => React.ReactNode;
}

export interface ChartDataPoint {
  name: string;
  value: number;
  color?: string;
}

export interface LineChartDataPoint {
  name: string;
  [key: string]: string | number;
}
