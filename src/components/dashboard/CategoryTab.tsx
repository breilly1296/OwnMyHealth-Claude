import React from 'react';

/**
 * Props for the CategoryTab component.
 * @property category - The display name of the category (e.g., "Blood Sugar", "Lipids")
 * @property icon - A Lucide React icon element to display next to the category name
 * @property isActive - Whether this tab is currently selected
 * @property onClick - Callback fired when the tab is clicked
 * @property count - Optional count of biomarkers in this category
 */
interface CategoryTabProps {
  category: string;
  icon: JSX.Element;
  isActive: boolean;
  onClick: () => void;
  count?: number;
}

/**
 * CategoryTab - A sidebar navigation tab for selecting biomarker categories.
 *
 * Renders a clickable button in the sidebar that represents a health category.
 * When active, displays with blue highlighting and a right border indicator.
 * Used in the Dashboard sidebar to switch between different biomarker views.
 *
 * @param props - The component props
 * @returns A styled button element for category navigation
 */
export default function CategoryTab({ category, icon, isActive, onClick, count }: CategoryTabProps) {
  return (
    <button
      onClick={onClick}
      className={`group flex items-center justify-between px-4 py-3 w-full rounded-xl transition-all duration-200 ${
        isActive
          ? 'bg-gradient-to-r from-brand-500 to-brand-600 text-white font-medium shadow-lg shadow-brand-500/25'
          : 'text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
      }`}
    >
      <div className="flex items-center space-x-3">
        <span className={`flex-shrink-0 transition-transform duration-200 ${isActive ? '' : 'group-hover:scale-110'}`}>
          {icon}
        </span>
        <span className="text-sm">{category}</span>
      </div>
      {count !== undefined && count > 0 && (
        <span
          className={`text-xs font-medium px-2 py-0.5 rounded-full ${
            isActive
              ? 'bg-white/20 text-white'
              : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}
