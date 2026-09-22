/**
 * src/components/ui/Toast.tsx
 * Premium toast notification system with auto-dismiss, stacking, and variants.
 * Uses React context so any component can trigger toasts via useToast().
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  variant: ToastVariant;
  title: string;
  message?: string;
  duration?: number; // ms, default 4000
}

interface ToastContextValue {
  addToast: (toast: Omit<ToastItem, 'id'>) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const useToast = (): ToastContextValue => {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Return no-op fallback if used outside provider (prevents crashes)
    return {
      addToast: () => {},
      success: () => {},
      error: () => {},
      warning: () => {},
      info: () => {},
    };
  }
  return ctx;
};

const VARIANT_CONFIG: Record<ToastVariant, {
  icon: React.ElementType;
  bg: string;
  border: string;
  iconColor: string;
  titleColor: string;
  msgColor: string;
  progressColor: string;
}> = {
  success: {
    icon: CheckCircle2,
    bg: 'bg-white',
    border: 'border-emerald-200',
    iconColor: 'text-emerald-600',
    titleColor: 'text-charcoal',
    msgColor: 'text-charcoal/70',
    progressColor: 'bg-emerald-500',
  },
  error: {
    icon: XCircle,
    bg: 'bg-white',
    border: 'border-rose-200',
    iconColor: 'text-rose-600',
    titleColor: 'text-charcoal',
    msgColor: 'text-charcoal/70',
    progressColor: 'bg-rose-500',
  },
  warning: {
    icon: AlertTriangle,
    bg: 'bg-white',
    border: 'border-amber-200',
    iconColor: 'text-amber-600',
    titleColor: 'text-charcoal',
    msgColor: 'text-charcoal/70',
    progressColor: 'bg-amber-500',
  },
  info: {
    icon: Info,
    bg: 'bg-white',
    border: 'border-blue-200',
    iconColor: 'text-blue-600',
    titleColor: 'text-charcoal',
    msgColor: 'text-charcoal/70',
    progressColor: 'bg-blue-500',
  },
};

const SingleToast: React.FC<{
  toast: ToastItem;
  onDismiss: (id: string) => void;
}> = ({ toast, onDismiss }) => {
  const config = VARIANT_CONFIG[toast.variant];
  const Icon = config.icon;
  const duration = toast.duration ?? 4000;
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    timerRef.current = setTimeout(() => onDismiss(toast.id), duration);
    return () => clearTimeout(timerRef.current);
  }, [toast.id, duration, onDismiss]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 80, scale: 0.9 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 80, scale: 0.9, transition: { duration: 0.2 } }}
      transition={{ type: 'spring', stiffness: 400, damping: 28 }}
      className={`relative w-80 ${config.bg} border ${config.border} rounded-2xl shadow-lg shadow-black/5 overflow-hidden`}
    >
      <div className="flex items-start gap-3 p-4">
        <div className={`mt-0.5 shrink-0 ${config.iconColor}`}>
          <Icon size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold ${config.titleColor} leading-snug`}>
            {toast.title}
          </p>
          {toast.message && (
            <p className={`text-xs ${config.msgColor} mt-0.5 leading-relaxed`}>
              {toast.message}
            </p>
          )}
        </div>
        <button
          onClick={() => onDismiss(toast.id)}
          className="shrink-0 p-0.5 rounded-lg hover:bg-charcoal/5 text-charcoal/30 hover:text-charcoal/60 transition cursor-pointer"
        >
          <X size={14} />
        </button>
      </div>

      {/* Auto-dismiss progress bar */}
      <motion.div
        initial={{ scaleX: 1 }}
        animate={{ scaleX: 0 }}
        transition={{ duration: duration / 1000, ease: 'linear' }}
        className={`h-0.5 ${config.progressColor} origin-left`}
      />
    </motion.div>
  );
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((toast: Omit<ToastItem, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    setToasts((prev) => [...prev.slice(-4), { ...toast, id }]); // Keep max 5 toasts
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const success = useCallback((title: string, message?: string) => {
    addToast({ variant: 'success', title, message });
  }, [addToast]);

  const error = useCallback((title: string, message?: string) => {
    addToast({ variant: 'error', title, message, duration: 6000 });
  }, [addToast]);

  const warning = useCallback((title: string, message?: string) => {
    addToast({ variant: 'warning', title, message, duration: 5000 });
  }, [addToast]);

  const info = useCallback((title: string, message?: string) => {
    addToast({ variant: 'info', title, message });
  }, [addToast]);

  return (
    <ToastContext.Provider value={{ addToast, success, error, warning, info }}>
      {children}

      {/* Toast container — fixed to top-right */}
      <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2.5 pointer-events-none">
        <AnimatePresence mode="popLayout">
          {toasts.map((toast) => (
            <div key={toast.id} className="pointer-events-auto">
              <SingleToast toast={toast} onDismiss={dismissToast} />
            </div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
};
