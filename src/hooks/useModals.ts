/**
 * useModals - Custom hook for managing multiple modal states
 *
 * Consolidates multiple useState pairs into a single state object,
 * reducing boilerplate and simplifying modal management.
 */

import { useState, useCallback, useMemo } from 'react';

/**
 * Modal names used in the Dashboard component
 */
export type ModalName =
  | 'addMeasurement'
  | 'pdfUpload'
  | 'labUpload'
  | 'clinicalUpload'
  | 'trend'
  | 'sbcUpload'
  | 'enhancedUpload'
  | 'insuranceViewer'
  | 'knowledgeBase'
  | 'userMenu'
  | 'mobileSidebar';

type ModalState = Record<ModalName, boolean>;

const initialModalState: ModalState = {
  addMeasurement: false,
  pdfUpload: false,
  labUpload: false,
  clinicalUpload: false,
  trend: false,
  sbcUpload: false,
  enhancedUpload: false,
  insuranceViewer: false,
  knowledgeBase: false,
  userMenu: false,
  mobileSidebar: false,
};

/**
 * Hook for managing multiple modal open/close states
 *
 * @example
 * const { isOpen, open, close, toggle } = useModals();
 *
 * // Check if modal is open
 * if (isOpen('addMeasurement')) { ... }
 *
 * // Open a modal
 * <button onClick={() => open('addMeasurement')}>Add</button>
 *
 * // Close a modal
 * <Modal onClose={() => close('addMeasurement')} />
 *
 * // Toggle a modal
 * <button onClick={() => toggle('userMenu')}>Menu</button>
 */
export function useModals() {
  const [modals, setModals] = useState<ModalState>(initialModalState);

  const isOpen = useCallback((name: ModalName): boolean => {
    return modals[name];
  }, [modals]);

  const open = useCallback((name: ModalName) => {
    setModals(prev => ({ ...prev, [name]: true }));
  }, []);

  const close = useCallback((name: ModalName) => {
    setModals(prev => ({ ...prev, [name]: false }));
  }, []);

  const toggle = useCallback((name: ModalName) => {
    setModals(prev => ({ ...prev, [name]: !prev[name] }));
  }, []);

  const closeAll = useCallback(() => {
    setModals(initialModalState);
  }, []);

  return useMemo(() => ({
    isOpen,
    open,
    close,
    toggle,
    closeAll,
  }), [isOpen, open, close, toggle, closeAll]);
}
