/**
 * Props for the CategoryTab component.
 * @property category - The display name of the category (e.g., "Blood Sugar", "Lipids")
 * @property icon - A Lucide React icon element to display next to the category name
 * @property isActive - Whether this tab is currently selected
 * @property onClick - Callback fired when the tab is clicked
 * @property count - Optional count of biomarkers in this category
 * @property href - SPA path this tab navigates to. When provided, the tab
 *                  renders as an `<a>` so middle-click / right-click /
 *                  cmd-click work the way users expect from a link.
 */
interface CategoryTabProps {
  category: string;
  icon: JSX.Element;
  isActive: boolean;
  onClick: () => void;
  count?: number;
  href?: string;
}

/**
 * CategoryTab - A sidebar navigation tab for selecting biomarker categories.
 *
 * When `href` is provided, this is a real `<a>` tag — middle-click and
 * "Open in new tab" work, and screen readers announce it as a link.
 * The plain click is intercepted to do client-side navigation via
 * `onClick` instead of a full page load.
 */
export default function CategoryTab({ category, icon, isActive, onClick, count, href }: CategoryTabProps) {
  const className = `group flex items-center justify-between px-4 py-3 w-full rounded-xl transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 ${
    isActive
      ? 'bg-gradient-to-r from-brand-500 to-brand-600 text-white font-medium shadow-lg shadow-brand-500/25'
      : 'text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
  }`;

  const inner = (
    <>
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
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        aria-current={isActive ? 'page' : undefined}
        onClick={(e) => {
          // Honor modifier keys (cmd/ctrl/shift/middle-click) — let the
          // browser open in a new tab/window. Only intercept the plain
          // left-click to do SPA navigation.
          if (e.defaultPrevented) return;
          if (e.button !== 0) return;
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          onClick();
        }}
        className={className}
      >
        {inner}
      </a>
    );
  }

  return (
    <button onClick={onClick} className={className}>
      {inner}
    </button>
  );
}
