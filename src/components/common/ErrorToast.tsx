/**
 * ErrorToast - Dismissible error notification component
 *
 * Displays error messages with auto-dismiss capability and manual close button.
 * Uses fixed positioning to overlay content.
 */

import { AlertCircle, X } from 'lucide-react';

interface ErrorToastProps {
  message: string | null;
  isVisible: boolean;
  onDismiss: () => void;
}

/**
 * Error toast notification component
 *
 * @example
 * <ErrorToast
 *   message={errorMessage}
 *   isVisible={showError}
 *   onDismiss={() => setShowError(false)}
 * />
 */
export function ErrorToast({ message, isVisible, onDismiss }: ErrorToastProps) {
  if (!isVisible || !message) {
    return null;
  }

  return (
    <div className="fixed top-4 right-4 z-50 max-w-md animate-slide-in-right">
      <div className="bg-red-50 dark:bg-red-900/50 border border-red-200 dark:border-red-800 rounded-xl p-4 shadow-lg backdrop-blur-sm">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0">
            <AlertCircle className="w-5 h-5 text-red-500 dark:text-red-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-red-800 dark:text-red-200">
              {message}
            </p>
          </div>
          <button
            onClick={onDismiss}
            className="flex-shrink-0 p-1 rounded-lg hover:bg-red-100 dark:hover:bg-red-800 transition-colors"
            aria-label="Dismiss error"
          >
            <X className="w-4 h-4 text-red-500 dark:text-red-400" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default ErrorToast;
