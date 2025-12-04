import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { BiomarkerCategory, NavGroup } from '../../types';
import CategoryTab from './CategoryTab';
import { getIcon } from './getIcon';

interface CollapsibleNavGroupProps {
  group: NavGroup;
  categories: BiomarkerCategory[];
  selectedCategory: string;
  onCategorySelect: (category: string) => void;
  defaultExpanded?: boolean;
}

/**
 * CollapsibleNavGroup - A collapsible navigation group for the sidebar.
 *
 * Groups related navigation items together with an expandable/collapsible header.
 * Non-collapsible groups (like Overview) always show their items.
 */
export default function CollapsibleNavGroup({
  group,
  categories,
  selectedCategory,
  onCategorySelect,
  defaultExpanded = true,
}: CollapsibleNavGroupProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  // Check if any category in this group is currently selected
  const hasActiveChild = categories.some(cat => cat.name === selectedCategory);

  // Auto-expand if a child is selected (intentionally not including isExpanded to avoid loop)
  React.useEffect(() => {
    if (hasActiveChild && !isExpanded) {
      setIsExpanded(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasActiveChild]);

  const toggleExpanded = () => {
    if (group.collapsible) {
      setIsExpanded(!isExpanded);
    }
  };

  // For non-collapsible groups with single item (like Dashboard), render directly
  if (!group.collapsible && categories.length === 1) {
    return (
      <div className="mb-2">
        {categories.map((category) => (
          <CategoryTab
            key={category.name}
            category={category.name}
            icon={getIcon(category.icon)}
            isActive={selectedCategory === category.name}
            onClick={() => onCategorySelect(category.name)}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="mb-2">
      {/* Group Header */}
      <button
        onClick={toggleExpanded}
        className={`w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold uppercase tracking-wider rounded-lg transition-all duration-200 ${
          group.collapsible
            ? 'hover:bg-slate-100 cursor-pointer'
            : 'cursor-default'
        } ${
          hasActiveChild && !isExpanded
            ? 'text-brand-600 bg-brand-50'
            : 'text-slate-400'
        }`}
      >
        <div className="flex items-center gap-2">
          <span className={`transition-colors duration-200 ${hasActiveChild ? 'text-brand-500' : 'text-slate-400'}`}>
            {getIcon(group.icon)}
          </span>
          <span>{group.label}</span>
          {!isExpanded && hasActiveChild && (
            <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
          )}
        </div>
        {group.collapsible && (
          <span className="text-slate-400 transition-transform duration-200">
            {isExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </span>
        )}
      </button>

      {/* Group Items */}
      <div
        className={`overflow-hidden transition-all duration-300 ease-in-out ${
          isExpanded ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="mt-1 ml-2 space-y-1 border-l-2 border-slate-100 pl-2">
          {categories.map((category) => (
            <CategoryTab
              key={category.name}
              category={category.name}
              icon={getIcon(category.icon)}
              isActive={selectedCategory === category.name}
              onClick={() => onCategorySelect(category.name)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
