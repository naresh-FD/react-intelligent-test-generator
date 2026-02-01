import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Menu,
  X,
  Sun,
  Moon,
  Bell,
  LogOut,
  User,
  Settings,
  ChevronDown,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useClickOutside } from '@/hooks';
import { Button } from '@/components/common/Button';
import { Avatar } from '@/components/common/Avatar';
import { ROUTES, APP_NAME } from '@/utils/constants';
import { cn } from '@/utils/helpers';

interface HeaderProps {
  onMenuClick: () => void;
  isSidebarOpen: boolean;
}

export function Header({ onMenuClick, isSidebarOpen }: HeaderProps) {
  const { user, logout } = useAuth();
  const { resolvedTheme, toggleTheme } = useTheme();
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const location = useLocation();

  const profileMenuRef = useClickOutside<HTMLDivElement>(() => setIsProfileOpen(false), isProfileOpen);

  const handleLogout = async () => {
    setIsProfileOpen(false);
    await logout();
  };

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex w-full items-center justify-between px-4 lg:px-6">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={onMenuClick}
            className="lg:hidden"
            aria-label={isSidebarOpen ? 'Close menu' : 'Open menu'}
          >
            {isSidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>

          <Link to={ROUTES.DASHBOARD} className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold">
              E
            </div>
            <span className="hidden text-lg font-semibold sm:inline-block">
              {APP_NAME}
            </span>
          </Link>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            aria-label={`Switch to ${resolvedTheme === 'light' ? 'dark' : 'light'} mode`}
          >
            {resolvedTheme === 'light' ? (
              <Moon className="h-5 w-5" />
            ) : (
              <Sun className="h-5 w-5" />
            )}
          </Button>

          <Button variant="ghost" size="icon" aria-label="Notifications">
            <Bell className="h-5 w-5" />
          </Button>

          <div className="relative" ref={profileMenuRef}>
            <button
              onClick={() => setIsProfileOpen(!isProfileOpen)}
              className={cn(
                'flex items-center gap-2 rounded-lg p-1.5 transition-colors hover:bg-muted',
                isProfileOpen && 'bg-muted'
              )}
              aria-expanded={isProfileOpen}
              aria-haspopup="true"
            >
              <Avatar src={user?.avatar} name={user?.name} size="sm" />
              <span className="hidden text-sm font-medium md:inline-block">
                {user?.name}
              </span>
              <ChevronDown
                className={cn(
                  'hidden h-4 w-4 text-muted-foreground transition-transform md:block',
                  isProfileOpen && 'rotate-180'
                )}
              />
            </button>

            <AnimatePresence>
              {isProfileOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-full mt-2 w-56 rounded-lg border border-border bg-background shadow-lg"
                >
                  <div className="border-b border-border p-4">
                    <p className="font-medium">{user?.name}</p>
                    <p className="text-sm text-muted-foreground">{user?.email}</p>
                  </div>
                  <div className="p-2">
                    <Link
                      to={ROUTES.PROFILE}
                      onClick={() => setIsProfileOpen(false)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted',
                        location.pathname === ROUTES.PROFILE && 'bg-muted'
                      )}
                    >
                      <User className="h-4 w-4" />
                      Profile
                    </Link>
                    <Link
                      to={ROUTES.SETTINGS}
                      onClick={() => setIsProfileOpen(false)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted',
                        location.pathname === ROUTES.SETTINGS && 'bg-muted'
                      )}
                    >
                      <Settings className="h-4 w-4" />
                      Settings
                    </Link>
                  </div>
                  <div className="border-t border-border p-2">
                    <button
                      onClick={handleLogout}
                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-destructive transition-colors hover:bg-destructive/10"
                    >
                      <LogOut className="h-4 w-4" />
                      Log out
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </header>
  );
}

export default Header;
