import { useEffect, useRef, type RefObject } from 'react';

// Selector for tabbable elements used by the focus trap.
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * WAI-ARIA dialog a11y behavior for any modal-like overlay: Escape to close, a
 * Tab focus trap, initial focus into the container, focus restoration to the
 * opener on close, and body scroll-lock while open.
 *
 * Extracted from `common/Modal` so bespoke overlays (the mobile nav drawer,
 * delete confirmations, hand-rolled data-entry dialogs) get the same behavior
 * without re-importing the full Modal chrome. Apply the returned ref to the
 * dialog container together with `role="dialog"`, `aria-modal="true"`, an
 * accessible name (`aria-label` or `aria-labelledby`), and `tabIndex={-1}`.
 *
 * @param isOpen whether the overlay is currently shown
 * @param onClose called on Escape. Kept in a ref so a new identity each render
 *   does NOT re-run the effect and run its cleanup (restoring focus) while the
 *   overlay is still open.
 * @returns a ref to attach to the dialog container
 */
export function useFocusTrap<T extends HTMLElement = HTMLDivElement>(
  isOpen: boolean,
  onClose: () => void
): RefObject<T> {
  const containerRef = useRef<T>(null);

  // Keep onClose in a ref so the effect depends only on `isOpen`. A new onClose
  // identity each render would otherwise re-run the effect, whose cleanup
  // restores focus to the opener — stealing focus mid-open.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';

    const container = containerRef.current;
    // Move focus into the container so screen readers announce it (via its
    // accessible name) and keyboard focus starts inside the trap.
    container?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !container) return;

      const focusables = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) {
        // Nothing tabbable — keep focus on the container.
        e.preventDefault();
        container.focus();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === container)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'unset';
      // Restore focus to whatever opened the overlay.
      previouslyFocused?.focus?.();
    };
  }, [isOpen]);

  return containerRef;
}
