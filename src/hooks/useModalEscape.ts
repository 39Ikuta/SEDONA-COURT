import { useEffect } from 'react';

/**
 * useModalEscape
 * Accessible keyboard listener hook to close modals and dialogs when the Escape key is pressed.
 * 
 * @param isOpen - Whether the modal/dialog is currently visible
 * @param onClose - Callback invoked when the Escape key is pressed
 * @param enabled - Optional flag to disable escape listener (e.g. during pending submissions)
 */
export function useModalEscape(
  isOpen: boolean,
  onClose: () => void,
  enabled: boolean = true
): void {
  useEffect(() => {
    if (!isOpen || !enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Esc') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose, enabled]);
}

export default useModalEscape;
