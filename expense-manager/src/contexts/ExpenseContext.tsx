import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  type ReactNode,
} from 'react';
import type { Expense, ExpenseFilters, ExpenseSortOptions, PaginationMeta } from '@/types';

interface ExpenseState {
  expenses: Expense[];
  selectedExpenses: string[];
  filters: ExpenseFilters;
  sort: ExpenseSortOptions;
  pagination: PaginationMeta;
  isLoading: boolean;
  error: string | null;
}

type ExpenseAction =
  | { type: 'SET_EXPENSES'; payload: { expenses: Expense[]; pagination: PaginationMeta } }
  | { type: 'ADD_EXPENSE'; payload: Expense }
  | { type: 'UPDATE_EXPENSE'; payload: Expense }
  | { type: 'DELETE_EXPENSE'; payload: string }
  | { type: 'DELETE_EXPENSES'; payload: string[] }
  | { type: 'SELECT_EXPENSE'; payload: string }
  | { type: 'DESELECT_EXPENSE'; payload: string }
  | { type: 'SELECT_ALL_EXPENSES' }
  | { type: 'DESELECT_ALL_EXPENSES' }
  | { type: 'SET_FILTERS'; payload: ExpenseFilters }
  | { type: 'RESET_FILTERS' }
  | { type: 'SET_SORT'; payload: ExpenseSortOptions }
  | { type: 'SET_PAGE'; payload: number }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null };

interface ExpenseContextType extends ExpenseState {
  setExpenses: (expenses: Expense[], pagination: PaginationMeta) => void;
  addExpense: (expense: Expense) => void;
  updateExpense: (expense: Expense) => void;
  deleteExpense: (id: string) => void;
  deleteExpenses: (ids: string[]) => void;
  selectExpense: (id: string) => void;
  deselectExpense: (id: string) => void;
  selectAllExpenses: () => void;
  deselectAllExpenses: () => void;
  setFilters: (filters: ExpenseFilters) => void;
  resetFilters: () => void;
  setSort: (sort: ExpenseSortOptions) => void;
  setPage: (page: number) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  isExpenseSelected: (id: string) => boolean;
  hasSelectedExpenses: boolean;
  selectedCount: number;
}

const defaultFilters: ExpenseFilters = {
  search: '',
  type: 'all',
  categoryId: '',
  startDate: '',
  endDate: '',
};

const defaultSort: ExpenseSortOptions = {
  field: 'date',
  order: 'desc',
};

const defaultPagination: PaginationMeta = {
  page: 1,
  limit: 10,
  total: 0,
  totalPages: 0,
  hasNext: false,
  hasPrev: false,
};

const initialState: ExpenseState = {
  expenses: [],
  selectedExpenses: [],
  filters: defaultFilters,
  sort: defaultSort,
  pagination: defaultPagination,
  isLoading: false,
  error: null,
};

function expenseReducer(state: ExpenseState, action: ExpenseAction): ExpenseState {
  switch (action.type) {
    case 'SET_EXPENSES':
      return {
        ...state,
        expenses: action.payload.expenses,
        pagination: action.payload.pagination,
        isLoading: false,
        error: null,
      };
    case 'ADD_EXPENSE':
      return {
        ...state,
        expenses: [action.payload, ...state.expenses],
        pagination: {
          ...state.pagination,
          total: state.pagination.total + 1,
        },
      };
    case 'UPDATE_EXPENSE':
      return {
        ...state,
        expenses: state.expenses.map((expense) =>
          expense.id === action.payload.id ? action.payload : expense
        ),
      };
    case 'DELETE_EXPENSE':
      return {
        ...state,
        expenses: state.expenses.filter((expense) => expense.id !== action.payload),
        selectedExpenses: state.selectedExpenses.filter((id) => id !== action.payload),
        pagination: {
          ...state.pagination,
          total: state.pagination.total - 1,
        },
      };
    case 'DELETE_EXPENSES':
      return {
        ...state,
        expenses: state.expenses.filter((expense) => !action.payload.includes(expense.id)),
        selectedExpenses: [],
        pagination: {
          ...state.pagination,
          total: state.pagination.total - action.payload.length,
        },
      };
    case 'SELECT_EXPENSE':
      return {
        ...state,
        selectedExpenses: [...state.selectedExpenses, action.payload],
      };
    case 'DESELECT_EXPENSE':
      return {
        ...state,
        selectedExpenses: state.selectedExpenses.filter((id) => id !== action.payload),
      };
    case 'SELECT_ALL_EXPENSES':
      return {
        ...state,
        selectedExpenses: state.expenses.map((expense) => expense.id),
      };
    case 'DESELECT_ALL_EXPENSES':
      return {
        ...state,
        selectedExpenses: [],
      };
    case 'SET_FILTERS':
      return {
        ...state,
        filters: action.payload,
        pagination: { ...state.pagination, page: 1 },
      };
    case 'RESET_FILTERS':
      return {
        ...state,
        filters: defaultFilters,
        pagination: { ...state.pagination, page: 1 },
      };
    case 'SET_SORT':
      return {
        ...state,
        sort: action.payload,
      };
    case 'SET_PAGE':
      return {
        ...state,
        pagination: { ...state.pagination, page: action.payload },
      };
    case 'SET_LOADING':
      return {
        ...state,
        isLoading: action.payload,
      };
    case 'SET_ERROR':
      return {
        ...state,
        error: action.payload,
        isLoading: false,
      };
    default:
      return state;
  }
}

const ExpenseContext = createContext<ExpenseContextType | undefined>(undefined);

interface ExpenseProviderProps {
  children: ReactNode;
}

export function ExpenseProvider({ children }: ExpenseProviderProps) {
  const [state, dispatch] = useReducer(expenseReducer, initialState);

  const setExpenses = useCallback((expenses: Expense[], pagination: PaginationMeta) => {
    dispatch({ type: 'SET_EXPENSES', payload: { expenses, pagination } });
  }, []);

  const addExpense = useCallback((expense: Expense) => {
    dispatch({ type: 'ADD_EXPENSE', payload: expense });
  }, []);

  const updateExpense = useCallback((expense: Expense) => {
    dispatch({ type: 'UPDATE_EXPENSE', payload: expense });
  }, []);

  const deleteExpense = useCallback((id: string) => {
    dispatch({ type: 'DELETE_EXPENSE', payload: id });
  }, []);

  const deleteExpenses = useCallback((ids: string[]) => {
    dispatch({ type: 'DELETE_EXPENSES', payload: ids });
  }, []);

  const selectExpense = useCallback((id: string) => {
    dispatch({ type: 'SELECT_EXPENSE', payload: id });
  }, []);

  const deselectExpense = useCallback((id: string) => {
    dispatch({ type: 'DESELECT_EXPENSE', payload: id });
  }, []);

  const selectAllExpenses = useCallback(() => {
    dispatch({ type: 'SELECT_ALL_EXPENSES' });
  }, []);

  const deselectAllExpenses = useCallback(() => {
    dispatch({ type: 'DESELECT_ALL_EXPENSES' });
  }, []);

  const setFilters = useCallback((filters: ExpenseFilters) => {
    dispatch({ type: 'SET_FILTERS', payload: filters });
  }, []);

  const resetFilters = useCallback(() => {
    dispatch({ type: 'RESET_FILTERS' });
  }, []);

  const setSort = useCallback((sort: ExpenseSortOptions) => {
    dispatch({ type: 'SET_SORT', payload: sort });
  }, []);

  const setPage = useCallback((page: number) => {
    dispatch({ type: 'SET_PAGE', payload: page });
  }, []);

  const setLoading = useCallback((loading: boolean) => {
    dispatch({ type: 'SET_LOADING', payload: loading });
  }, []);

  const setError = useCallback((error: string | null) => {
    dispatch({ type: 'SET_ERROR', payload: error });
  }, []);

  const isExpenseSelected = useCallback(
    (id: string) => state.selectedExpenses.includes(id),
    [state.selectedExpenses]
  );

  const value: ExpenseContextType = {
    ...state,
    setExpenses,
    addExpense,
    updateExpense,
    deleteExpense,
    deleteExpenses,
    selectExpense,
    deselectExpense,
    selectAllExpenses,
    deselectAllExpenses,
    setFilters,
    resetFilters,
    setSort,
    setPage,
    setLoading,
    setError,
    isExpenseSelected,
    hasSelectedExpenses: state.selectedExpenses.length > 0,
    selectedCount: state.selectedExpenses.length,
  };

  return <ExpenseContext.Provider value={value}>{children}</ExpenseContext.Provider>;
}

export function useExpenseContext(): ExpenseContextType {
  const context = useContext(ExpenseContext);
  if (context === undefined) {
    throw new Error('useExpenseContext must be used within an ExpenseProvider');
  }
  return context;
}

export default ExpenseContext;
