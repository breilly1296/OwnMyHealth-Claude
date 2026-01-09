/**
 * DashboardSidebar - Navigation sidebar for the dashboard
 *
 * Renders both mobile (drawer overlay) and desktop (fixed) sidebars.
 * Uses CollapsibleNavGroup for organized category navigation.
 */

import React from 'react';
import { Heart, Zap, X } from 'lucide-react';
import CollapsibleNavGroup from './CollapsibleNavGroup';
import type { BiomarkerCategory, NavGroup } from '../../types';

interface DashboardSidebarProps {
  navGroups: NavGroup[];
  categories: BiomarkerCategory[];
  selectedCategory: string;
  onCategorySelect: (category: string) => void;
  categoryCounts: Record<string, number>;
  showMobileSidebar: boolean;
  onCloseMobileSidebar: () => void;
}

/**
 * Dashboard sidebar with mobile drawer and desktop fixed variants
 *
 * @example
 * <DashboardSidebar
 *   navGroups={navGroups}
 *   categories={categories}
 *   selectedCategory={selectedCategory}
 *   onCategorySelect={(cat) => {
 *     setSelectedCategory(cat);
 *     setSelectedBiomarker(null);
 *   }}
 *   categoryCounts={categoryCounts}
 *   showMobileSidebar={modals.isOpen('mobileSidebar')}
 *   onCloseMobileSidebar={() => modals.close('mobileSidebar')}
 * />
 */
export function DashboardSidebar({
  navGroups,
  categories,
  selectedCategory,
  onCategorySelect,
  categoryCounts,
  showMobileSidebar,
  onCloseMobileSidebar,
}: DashboardSidebarProps) {
  const handleMobileCategorySelect = (category: string) => {
    onCategorySelect(category);
    onCloseMobileSidebar();
  };

  const renderNavigation = (onSelect: (category: string) => void) => (
    <nav className="space-y-1">
      {navGroups.map((group) => {
        const groupCategories = categories.filter(cat => cat.group === group.id);
        return (
          <CollapsibleNavGroup
            key={group.id}
            group={group}
            categories={groupCategories}
            selectedCategory={selectedCategory}
            onCategorySelect={onSelect}
            defaultExpanded={group.id === 'overview' || group.id === 'insurance'}
            categoryCounts={categoryCounts}
          />
        );
      })}
    </nav>
  );

  return (
    <>
      {/* Mobile Sidebar Overlay */}
      {showMobileSidebar && (
        <div className="fixed inset-0 z-50 md:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={onCloseMobileSidebar}
          />
          {/* Drawer */}
          <aside className="absolute left-0 top-0 h-full w-72 max-w-[85vw] bg-white dark:bg-slate-900 shadow-xl animate-slide-in-left overflow-y-auto">
            <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-gradient-to-br from-brand-500 to-brand-600 rounded-xl flex items-center justify-center">
                  <Heart className="w-4 h-4 text-white" />
                </div>
                <span className="text-lg font-bold text-slate-900 dark:text-white">Menu</span>
              </div>
              <button
                onClick={onCloseMobileSidebar}
                className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                aria-label="Close menu"
              >
                <X className="w-5 h-5 text-slate-600 dark:text-slate-300" />
              </button>
            </div>
            <div className="p-4">
              {renderNavigation(handleMobileCategorySelect)}
            </div>
          </aside>
        </div>
      )}

      {/* Desktop Sidebar - Hidden on Mobile */}
      <aside className="hidden md:block w-72 bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm border-r border-slate-200/60 dark:border-slate-700/60 h-[calc(100vh-4rem)] sticky top-16 overflow-y-auto sidebar-scroll">
        <div className="p-5 pb-8">
          {renderNavigation(onCategorySelect)}

          {/* Pro Tip Card */}
          <div className="mt-6 p-4 bg-gradient-to-br from-brand-50 to-brand-100/50 dark:from-slate-800 dark:to-slate-800 rounded-2xl border border-brand-200/50 dark:border-slate-700">
            <div className="flex items-center space-x-3 mb-3">
              <div className="w-8 h-8 bg-brand-500 rounded-lg flex items-center justify-center">
                <Zap className="w-4 h-4 text-white" />
              </div>
              <span className="text-sm font-semibold text-brand-900 dark:text-white">Pro Tip</span>
            </div>
            <p className="text-xs text-brand-700 dark:text-slate-300 leading-relaxed">
              Upload your lab reports to automatically extract and track biomarkers over time.
            </p>
          </div>
        </div>
      </aside>
    </>
  );
}

export default DashboardSidebar;
