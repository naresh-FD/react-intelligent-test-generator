import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { APP_NAME, ROUTES } from '@/utils/constants';

interface AuthLayoutProps {
  children: ReactNode;
  title: string;
  subtitle?: string;
}

export function AuthLayout({ children, title, subtitle }: AuthLayoutProps) {
  return (
    <div className="flex min-h-screen">
      {/* Left side - Branding */}
      <div className="hidden w-1/2 bg-primary lg:flex lg:flex-col lg:justify-between lg:p-12">
        <Link to={ROUTES.HOME} className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-foreground text-primary font-bold text-xl">
            E
          </div>
          <span className="text-2xl font-bold text-primary-foreground">
            {APP_NAME}
          </span>
        </Link>

        <div className="space-y-6">
          <h1 className="text-4xl font-bold text-primary-foreground">
            Take control of your finances
          </h1>
          <p className="text-lg text-primary-foreground/80">
            Track your income and expenses, set budgets, and achieve your financial goals
            with our intuitive expense management platform.
          </p>
          <div className="flex gap-8">
            <div>
              <p className="text-3xl font-bold text-primary-foreground">10K+</p>
              <p className="text-sm text-primary-foreground/70">Active Users</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-primary-foreground">$2M+</p>
              <p className="text-sm text-primary-foreground/70">Tracked</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-primary-foreground">98%</p>
              <p className="text-sm text-primary-foreground/70">Satisfaction</p>
            </div>
          </div>
        </div>

        <p className="text-sm text-primary-foreground/60">
          &copy; {new Date().getFullYear()} {APP_NAME}. All rights reserved.
        </p>
      </div>

      {/* Right side - Auth form */}
      <div className="flex w-full flex-col justify-center px-4 py-12 lg:w-1/2 lg:px-8">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-8 text-center lg:hidden">
            <Link to={ROUTES.HOME} className="inline-flex items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-xl">
                E
              </div>
              <span className="text-2xl font-bold">{APP_NAME}</span>
            </Link>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-bold">{title}</h2>
            {subtitle && (
              <p className="mt-2 text-muted-foreground">{subtitle}</p>
            )}
          </div>

          {children}
        </div>
      </div>
    </div>
  );
}

export default AuthLayout;
