/**
 * SuccessToast - Dismissible success notification component
 *
 * Displays success messages with auto-dismiss capability and manual close button.
 * Uses fixed positioning to overlay content.
 */

import React from 'react';
import { CheckCircle, X } from 'lucide-react';

interface SuccessToastProps {
  message: string | null;
  isVisible: boolean;
  onDismiss: () => void;
}

/**
 * Success toast notification component
 *
 * @example
 * <SuccessToast
 *   message={successMessage}
 *   isVisible={showSuccess}
 *   onDismiss={() => setShowSuccess(false)}
 * />
 */
export function SuccessToast({ message, isVisible, onDismiss }: SuccessToastProps) {
  if (!isVisible || !message) {
    return null;
  }

  return (
    <div className="fixed top-4 right-4 z-50 max-w-md animate-slide-in-right">
      <div className="bg-emerald-50 dark:bg-emerald-900/50 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4 shadow-lg backdrop-blur-sm">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0">
            <CheckCircle className="w-5 h-5 text-emerald-500 dark:text-emerald-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
              {message}
            </p>
          </div>
          <button
            onClick={onDismiss}
            className="flex-shrink-0 p-1 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-800 transition-colors"
            aria-label="Dismiss notification"
          >
            <X className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default SuccessToast;
