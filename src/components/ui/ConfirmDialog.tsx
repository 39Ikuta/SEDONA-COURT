/**
 * src/components/ui/ConfirmDialog.tsx
 * Premium confirmation modal that replaces window.confirm().
 * Supports destructive (red) and standard (primary) action styles.
 */

import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle, ShieldAlert, HelpCircle, X } from 'lucide-react';
import { useModalEscape } from '../../hooks/useModalEscape';

export type ConfirmVariant = 'danger' | 'warning' | 'default';

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
  onConfirm: () => void;
  onCancel: () => void;
}

const VARIANT_STYLES: Record<ConfirmVariant, {
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  confirmBg: string;
  confirmHover: string;
}> = {
  danger: {
    icon: ShieldAlert,
    iconBg: 'bg-rose-50',
    iconColor: 'text-rose-600',
    confirmBg: 'bg-rose-600',
    confirmHover: 'hover:bg-rose-700',
  },
  warning: {
    icon: AlertTriangle,
    iconBg: 'bg-amber-50',
    iconColor: 'text-amber-600',
    confirmBg: 'bg-amber-600',
    confirmHover: 'hover:bg-amber-700',
  },
  default: {
    icon: HelpCircle,
    iconBg: 'bg-primary/5',
    iconColor: 'text-primary',
    confirmBg: 'bg-primary',
    confirmHover: 'hover:bg-primary-light',
  },
};

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel,
}) => {
  const styles = VARIANT_STYLES[variant];
  const Icon = styles.icon;

  useModalEscape(isOpen, onCancel);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 bg-black/30 backdrop-blur-[2px] z-[9990]"
            onClick={onCancel}
          />

          {/* Dialog */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            initial={{ opacity: 0, scale: 0.92, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 16 }}
            transition={{ type: 'spring', stiffness: 400, damping: 28 }}
            className="fixed inset-0 z-[9991] flex items-center justify-center p-4"
          >
            <div className="bg-white rounded-2xl border border-secondary shadow-2xl w-full max-w-md overflow-hidden">
              {/* Header */}
              <div className="flex items-start gap-4 p-6 pb-4">
                <div className={`w-11 h-11 rounded-xl ${styles.iconBg} flex items-center justify-center shrink-0`}>
                  <Icon size={22} className={styles.iconColor} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 id="confirm-dialog-title" className="font-display font-bold text-base text-charcoal leading-snug">
                    {title}
                  </h3>
                  <p className="text-sm text-charcoal/60 mt-1.5 leading-relaxed">
                    {message}
                  </p>
                </div>
                <button
                  onClick={onCancel}
                  className="shrink-0 p-1 rounded-lg hover:bg-charcoal/5 text-charcoal/30 hover:text-charcoal/60 transition cursor-pointer -mt-1 -mr-1"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Footer actions */}
              <div className="flex items-center justify-end gap-2.5 px-6 py-4 bg-cream/30 border-t border-secondary/30">
                <button
                  onClick={onCancel}
                  className="px-4 py-2 rounded-xl text-sm font-semibold text-charcoal/70 bg-white border border-secondary/60 hover:bg-cream/60 transition cursor-pointer active:scale-[0.97]"
                >
                  {cancelLabel}
                </button>
                <button
                  onClick={onConfirm}
                  className={`px-5 py-2 rounded-xl text-sm font-bold text-white ${styles.confirmBg} ${styles.confirmHover} transition cursor-pointer shadow-sm active:scale-[0.97]`}
                >
                  {confirmLabel}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
