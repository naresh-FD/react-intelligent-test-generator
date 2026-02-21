import seedData from '@/data/local-db.json';
import type { Budget, Category, Expense, User } from '@/types';
import { USER_KEY } from '@/utils/constants';

const LOCAL_DB_KEY = 'expense_manager_local_db_v1';

type LocalUser = User & { password: string };

interface LocalDbSchema {
  users: LocalUser[];
  categories: Category[];
  expenses: Expense[];
  budgets: Budget[];
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const toLocalDb = (value: unknown): LocalDbSchema => {
  const parsed = value as Partial<LocalDbSchema> | null;
  if (!parsed) {
    return clone(seedData as LocalDbSchema);
  }

  if (
    !Array.isArray(parsed.users) ||
    !Array.isArray(parsed.categories) ||
    !Array.isArray(parsed.expenses) ||
    !Array.isArray(parsed.budgets)
  ) {
    return clone(seedData as LocalDbSchema);
  }

  return {
    users: parsed.users as LocalUser[],
    categories: parsed.categories as Category[],
    expenses: parsed.expenses as Expense[],
    budgets: parsed.budgets as Budget[],
  };
};

const read = (): LocalDbSchema => {
  const raw = localStorage.getItem(LOCAL_DB_KEY);
  if (!raw) {
    const initial = clone(seedData as LocalDbSchema);
    localStorage.setItem(LOCAL_DB_KEY, JSON.stringify(initial));
    return initial;
  }

  try {
    return toLocalDb(JSON.parse(raw));
  } catch {
    const fallback = clone(seedData as LocalDbSchema);
    localStorage.setItem(LOCAL_DB_KEY, JSON.stringify(fallback));
    return fallback;
  }
};

const write = (db: LocalDbSchema): LocalDbSchema => {
  localStorage.setItem(LOCAL_DB_KEY, JSON.stringify(db));
  return db;
};

const nowIso = (): string => new Date().toISOString();

const ensureUser = (): LocalUser => {
  const db = read();
  const storedUser = localStorage.getItem(USER_KEY);
  if (storedUser) {
    try {
      const parsed = JSON.parse(storedUser) as User;
      const existing = db.users.find((user) => user.id === parsed.id);
      if (existing) {
        return existing;
      }
    } catch {
      // Ignore parse errors and fall through to default user.
    }
  }
  return db.users[0];
};

const getCategoryName = (db: LocalDbSchema, categoryId: string): string => {
  return db.categories.find((category) => category.id === categoryId)?.name || 'Uncategorized';
};

export const localDb = {
  read,
  write,
  reset(): LocalDbSchema {
    const initial = clone(seedData as LocalDbSchema);
    localStorage.setItem(LOCAL_DB_KEY, JSON.stringify(initial));
    return initial;
  },
  getCurrentUser(): LocalUser {
    return ensureUser();
  },
  getUsers(): LocalUser[] {
    return read().users;
  },
  upsertUser(user: LocalUser): LocalUser {
    const db = read();
    const nextUsers = db.users.some((item) => item.id === user.id)
      ? db.users.map((item) => (item.id === user.id ? user : item))
      : [...db.users, user];

    write({ ...db, users: nextUsers });
    return user;
  },
  getCategories(): Category[] {
    return read().categories;
  },
  upsertCategory(category: Category): Category {
    const db = read();
    const nextCategories = db.categories.some((item) => item.id === category.id)
      ? db.categories.map((item) => (item.id === category.id ? category : item))
      : [...db.categories, category];

    write({ ...db, categories: nextCategories });
    return category;
  },
  removeCategory(id: string): void {
    const db = read();
    write({ ...db, categories: db.categories.filter((item) => item.id !== id) });
  },
  getExpenses(): Expense[] {
    return read().expenses;
  },
  addExpense(expense: Expense): Expense {
    const db = read();
    write({ ...db, expenses: [expense, ...db.expenses] });
    return expense;
  },
  updateExpense(id: string, data: Partial<Expense>): Expense {
    const db = read();
    const existing = db.expenses.find((item) => item.id === id);
    if (!existing) {
      throw new Error('Transaction not found');
    }

    const merged: Expense = {
      ...existing,
      ...data,
      category: data.categoryId ? getCategoryName(db, data.categoryId) : existing.category,
      updatedAt: nowIso(),
    };

    write({
      ...db,
      expenses: db.expenses.map((item) => (item.id === id ? merged : item)),
    });
    return merged;
  },
  removeExpense(id: string): void {
    const db = read();
    write({ ...db, expenses: db.expenses.filter((item) => item.id !== id) });
  },
  getBudgets(): Budget[] {
    return read().budgets;
  },
  upsertBudget(budget: Budget): Budget {
    const db = read();
    const nextBudgets = db.budgets.some((item) => item.id === budget.id)
      ? db.budgets.map((item) => (item.id === budget.id ? budget : item))
      : [...db.budgets, budget];

    write({ ...db, budgets: nextBudgets });
    return budget;
  },
  removeBudget(id: string): void {
    const db = read();
    write({ ...db, budgets: db.budgets.filter((item) => item.id !== id) });
  },
};

export const localDbHelpers = {
  getCategoryName,
  nowIso,
};
