/**
 * useErrorNotification - Custom hook for managing error toast notifications
 *
 * Consolidates error state management with auto-dismissal and cleanup.
 * Prevents memory leaks by properly clearing timeouts on unmount.
 */

import { useState, useCallback, useRef, useEffect } from 'react';

interface ErrorNotification {
  message: string | null;
  isVisible: boolean;
  show: (message: string) => void;
  hide: () => void;
}

/**
 * Hook for managing error toast notifications with auto-dismiss
 *
 * @param autoDismissMs - Time in milliseconds before auto-hiding (default: 5000)
 * @returns Object with message, visibility state, and show/hide functions
 *
 * @example
 * const { message, isVisible, show, hide } = useErrorNotification();
 *
 * // Show an error
 * show('Failed to save data');
 *
 * // Manually hide
 * hide();
 *
 * // Render toast
 * {isVisible && <ErrorToast message={message} onClose={hide} />}
 */
export function useErrorNotification(autoDismissMs = 5000): ErrorNotification {
  const [message, setMessage] = useState<string | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearExistingTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const show = useCallback((msg: string) => {
    setMessage(msg);
    setIsVisible(true);

    // Clear any existing timeout to prevent overlapping dismissals
    clearExistingTimeout();

    // Auto-hide after specified duration
    timeoutRef.current = setTimeout(() => {
      setIsVisible(false);
      setMessage(null);
    }, autoDismissMs);
  }, [autoDismissMs, clearExistingTimeout]);

  const hide = useCallback(() => {
    clearExistingTimeout();
    setIsVisible(false);
    setMessage(null);
  }, [clearExistingTimeout]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      clearExistingTimeout();
    };
  }, [clearExistingTimeout]);

  return { message, isVisible, show, hide };
}
