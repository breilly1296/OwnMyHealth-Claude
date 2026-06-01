/**
 * URL <-> sidebar-category mapping for the dashboard's lightweight router.
 *
 * Top-level nav only — biomarker subcategories (Blood, Hormones, etc.)
 * stay state-only and don't appear here. Extracted from Dashboard.tsx so
 * the sidebar can compute proper `href` values for nav links without
 * duplicating the table.
 */

export const pathToCategoryMap: Record<string, string> = {
  '/insurance': 'Insurance',
  '/knowledge-base': 'Knowledge Base',
  '/files': 'Files',
  '/trends': 'Trends',
  '/goals': 'Goals',
  '/needs': 'Needs',
  '/health-guide': 'Health Guide',
  '/care-team': 'Care Team',
  '/my-patients': 'My Patients',
  '/admin': 'Admin',
  '/settings': 'Account Settings',
};

export const categoryToPathMap: Record<string, string> = {
  Overview: '/',
  Dashboard: '/',
  Insurance: '/insurance',
  'Knowledge Base': '/knowledge-base',
  Files: '/files',
  Trends: '/trends',
  Goals: '/goals',
  Needs: '/needs',
  'Health Guide': '/health-guide',
  'Care Team': '/care-team',
  'My Patients': '/my-patients',
  Admin: '/admin',
  'Account Settings': '/settings',
};

/**
 * Resolve the SPA path for a given sidebar category. Falls back to '/'
 * for unknown categories (biomarker subcategories that aren't routed).
 */
export function pathForCategory(category: string): string {
  return categoryToPathMap[category] ?? '/';
}
