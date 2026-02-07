import { z } from 'zod';
import { PASSWORD_MIN_LENGTH, PASSWORD_REGEX } from './constants';

export const emailSchema = z
  .string()
  .min(1, 'Email is required')
  .email('Please enter a valid email address');

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .regex(
    PASSWORD_REGEX,
    'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'
  );

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
});

export const registerSchema = z
  .object({
    name: z
      .string()
      .min(2, 'Name must be at least 2 characters')
      .max(50, 'Name must be less than 50 characters'),
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, 'Please confirm your new password'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'New password must be different from current password',
    path: ['newPassword'],
  });

export const updateProfileSchema = z.object({
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(50, 'Name must be less than 50 characters')
    .optional(),
  email: emailSchema.optional(),
  avatar: z.string().url('Please enter a valid URL').optional().or(z.literal('')),
  currency: z.string().optional(),
  timezone: z.string().optional(),
  language: z.string().optional(),
});

export const expenseSchema = z.object({
  amount: z
    .number({ message: 'Amount must be a number' })
    .positive('Amount must be greater than 0')
    .max(999999999, 'Amount is too large'),
  categoryId: z.string().min(1, 'Please select a category'),
  type: z.enum(['income', 'expense'], { message: 'Please select a transaction type' }),
  description: z
    .string()
    .max(500, 'Description must be less than 500 characters')
    .default(''),
  date: z.string().min(1, 'Please select a date'),
  isRecurring: z.boolean().default(false),
  recurrence: z.enum(['none', 'daily', 'weekly', 'monthly', 'yearly']).default('none'),
  tags: z.array(z.string()).optional(),
});

export const categorySchema = z.object({
  name: z
    .string()
    .min(1, 'Category name is required')
    .max(50, 'Category name must be less than 50 characters'),
  icon: z.string().min(1, 'Please select an icon'),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Please enter a valid hex color'),
  type: z.enum(['income', 'expense'], { message: 'Please select a category type' }),
});

export const budgetSchema = z.object({
  categoryId: z.string().min(1, 'Please select a category'),
  amount: z
    .number({ message: 'Amount must be a number' })
    .positive('Amount must be greater than 0')
    .max(999999999, 'Amount is too large'),
  period: z.enum(['weekly', 'monthly', 'yearly'], { message: 'Please select a budget period' }),
  alertThreshold: z
    .number()
    .min(0, 'Alert threshold must be at least 0')
    .max(100, 'Alert threshold must be at most 100')
    .default(80),
});

export const filtersSchema = z.object({
  search: z.string().optional(),
  type: z.enum(['income', 'expense', 'all']).optional(),
  categoryId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  minAmount: z.number().optional(),
  maxAmount: z.number().optional(),
});

export type LoginFormData = z.infer<typeof loginSchema>;
export type RegisterFormData = z.infer<typeof registerSchema>;
export type ChangePasswordFormData = z.infer<typeof changePasswordSchema>;
export type UpdateProfileFormData = z.infer<typeof updateProfileSchema>;
export type ExpenseFormData = z.infer<typeof expenseSchema>;
export type CategoryFormData = z.infer<typeof categorySchema>;
export type BudgetFormData = z.infer<typeof budgetSchema>;
export type FiltersFormData = z.infer<typeof filtersSchema>;
