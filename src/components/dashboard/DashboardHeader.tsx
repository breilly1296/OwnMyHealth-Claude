/**
 * DashboardHeader - Top navigation bar for the dashboard
 *
 * Contains branding, user menu with dropdown, and mobile menu toggle.
 * Handles logout and navigation to account settings.
 */

import { useState, useRef, useEffect } from 'react';
import { Heart, LogOut, User, ChevronDown, Settings, Menu } from 'lucide-react';

interface DashboardHeaderProps {
  user: { id: string; email: string; role: string } | null;
  onLogout: () => void;
  onOpenMobileSidebar: () => void;
  onOpenAccountSettings: () => void;
}

/**
 * Dashboard header with user menu and mobile navigation toggle
 *
 * @example
 * <DashboardHeader
 *   user={currentUser}
 *   onLogout={handleLogout}
 *   onOpenMobileSidebar={() => setShowMobileSidebar(true)}
 * />
 */
export function DashboardHeader({
  user,
  onLogout,
  onOpenMobileSidebar,
  onOpenAccountSettings,
}: DashboardHeaderProps) {
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Close user menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className="sticky top-0 z-40 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-b border-slate-200/60 dark:border-slate-700/60">
      <div className="flex items-center justify-between px-4 md:px-6 h-16">
        {/* Left: Logo and Mobile Menu */}
        <div className="flex items-center space-x-3">
          {/* Mobile Menu Button */}
          <button
            onClick={onOpenMobileSidebar}
            className="md:hidden p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5 text-slate-600 dark:text-slate-300" />
          </button>

          {/* Logo */}
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 bg-gradient-to-br from-brand-500 to-brand-600 rounded-xl flex items-center justify-center shadow-lg shadow-brand-500/20">
              <Heart className="w-5 h-5 text-white" />
            </div>
            <div className="hidden sm:block">
              <h1 className="text-lg font-bold text-slate-900 dark:text-white">
                OwnMyHealth
              </h1>
              <p className="text-2xs text-slate-500 dark:text-slate-400 -mt-0.5">
                Your Health Dashboard
              </p>
            </div>
          </div>
        </div>

        {/* Right: User Menu */}
        <div className="flex items-center space-x-3">
          {user ? (
            <div className="relative" ref={userMenuRef}>
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex items-center space-x-2 px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <div className="w-8 h-8 bg-gradient-to-br from-brand-400 to-brand-600 rounded-lg flex items-center justify-center">
                  <User className="w-4 h-4 text-white" />
                </div>
                <span className="hidden sm:block text-sm font-medium text-slate-700 dark:text-slate-200 max-w-[150px] truncate">
                  {user.email}
                </span>
                <ChevronDown
                  className={`w-4 h-4 text-slate-400 transition-transform ${
                    showUserMenu ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {/* Dropdown Menu */}
              {showUserMenu && (
                <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 py-2 animate-fade-in">
                  <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-700">
                    <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                      {user.email}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 capitalize">
                      {user.role.toLowerCase()}
                    </p>
                  </div>

                  <button
                    onClick={() => {
                      setShowUserMenu(false);
                      onOpenAccountSettings();
                    }}
                    className="w-full flex items-center space-x-3 px-4 py-2.5 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                  >
                    <Settings className="w-4 h-4" />
                    <span>Account Settings</span>
                  </button>

                  <button
                    onClick={() => {
                      setShowUserMenu(false);
                      onLogout();
                    }}
                    className="w-full flex items-center space-x-3 px-4 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Sign Out</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-slate-500 dark:text-slate-400">
              Demo Mode
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

export default DashboardHeader;
