/**
 * Modal Component
 *
 * A reusable modal dialog component with consistent styling and behavior.
 * Provides a standard layout for popup content throughout the application.
 *
 * Features:
 * - Multiple size options: sm, md, lg, xl, full
 * - Escape key closes the modal
 * - Body scroll is disabled while modal is open
 * - Click event propagation stopped to prevent closing on content click
 * - Optional icon in the header
 * - Subtitle support below the title
 * - Configurable close button visibility
 * - Scrollable content area with fixed header
 *
 * Props:
 * - isOpen: Controls visibility
 * - onClose: Callback when modal should close
 * - title: Header text
 * - subtitle: Optional description below title
 * - icon: Optional icon element for header
 * - size: Width preset ('sm' | 'md' | 'lg' | 'xl' | 'full')
 * - showCloseButton: Whether to show X button (default: true)
 *
 * @module components/common/Modal
 */

import { ReactNode, useEffect } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  showCloseButton?: boolean;
}

const sizeClasses = {
  sm: 'max-w-md',
  md: 'max-w-2xl',
  lg: 'max-w-4xl',
  xl: 'max-w-6xl',
  full: 'max-w-7xl',
};

export default function Modal({
  isOpen,
  onClose,
  title,
  subtitle,
  icon,
  children,
  size = 'md',
  showCloseButton = true,
}: ModalProps) {
  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end md:items-center justify-center z-50 p-0 md:p-4">
      <div
        className={`bg-white dark:bg-slate-800 rounded-t-2xl md:rounded-lg w-full ${sizeClasses[size]} max-h-[95vh] md:max-h-[90vh] overflow-hidden flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center p-4 md:p-6 border-b border-gray-200 dark:border-slate-700">
          <div className="flex items-center min-w-0">
            {icon && <div className="mr-3 flex-shrink-0">{icon}</div>}
            <div className="min-w-0">
              <h2 className="text-lg md:text-xl font-semibold text-gray-900 dark:text-white truncate">{title}</h2>
              {subtitle && (
                <p className="text-sm text-gray-600 dark:text-slate-400 mt-1 truncate">{subtitle}</p>
              )}
            </div>
          </div>
          {showCloseButton && (
            <button
              onClick={onClose}
              className="p-2 -mr-2 text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors flex-shrink-0"
              aria-label="Close modal"
            >
              <X className="w-5 h-5 md:w-6 md:h-6" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
}
