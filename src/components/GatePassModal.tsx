import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { PrintableGatePass, GatePassData } from './PrintableGatePass';
import { Printer, X, ArrowLeft, RefreshCw, Zap, ShieldCheck } from 'lucide-react';
import { useToast } from './ui/Toast';
import { printBrowserReceipt } from '../utils/printBrowserReceipt';
import { useModalEscape } from '../hooks/useModalEscape';

interface GatePassModalProps {
  data: GatePassData | null;
  isOpen: boolean;
  onClose: () => void;
}

export const GatePassModal: React.FC<GatePassModalProps> = ({
  data,
  isOpen,
  onClose,
}) => {
  const toast = useToast();
  const [isPrinting, setIsPrinting] = useState<boolean>(false);

  useModalEscape(isOpen && Boolean(data), onClose);

  if (!isOpen || !data) return null;

  const isElectron = Boolean(window.electronAPI?.isElectron);

  const handlePrint = async () => {
    if (isElectron && window.electronAPI) {
      setIsPrinting(true);
      try {
        const gatePassElement = document.getElementById('printable-gate-pass');
        if (!gatePassElement) {
          printBrowserReceipt('printable-gate-pass');
          return;
        }

        const savedPrinter = localStorage.getItem('scti_hw_receipt_printer') || undefined;
        const savedDensity = (localStorage.getItem('scti_hw_print_density') as 'normal' | 'high' | 'ultra') || 'high';

        const res = await window.electronAPI.printReceiptSilent({
          html: gatePassElement.innerHTML,
          deviceName: savedPrinter,
          density: savedDensity,
          kickDrawer: false,
        });

        if (res.success) {
          toast.success(
            'Gate Pass Printed',
            `80mm Gate Pass dispatched${savedPrinter ? ` to ${savedPrinter}` : ''}`
          );
        } else {
          toast.error('Print Failed', res.error || 'Falling back to standard print dialog');
          printBrowserReceipt('printable-gate-pass');
        }
      } catch (err: any) {
        console.warn('Electron silent print failed, falling back to browser print:', err);
        printBrowserReceipt('printable-gate-pass');
      } finally {
        setIsPrinting(false);
      }
    } else {
      printBrowserReceipt('printable-gate-pass');
    }
  };

  return (
    <AnimatePresence>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="gate-pass-title"
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-charcoal/60 backdrop-blur-xs overflow-y-auto"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          className="bg-cream-light border border-secondary rounded-2xl shadow-2xl max-w-2xl w-full p-6 relative overflow-hidden my-8 max-h-[90vh] flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b border-secondary/60">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-800">
                <ShieldCheck size={20} />
              </div>
              <div>
                <h3 id="gate-pass-title" className="font-display font-extrabold text-lg text-charcoal flex items-center gap-2">
                  <span>Exit Gate Pass</span>
                  <span className="text-xs font-mono font-bold bg-amber-100 text-amber-900 px-2 py-0.5 rounded-full">
                    Room {data.roomNumber}
                  </span>
                </h3>
                <p className="text-xs text-charcoal/60">
                  Thermal ticket for exit clearance verification at the gate
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-charcoal/50 hover:text-charcoal hover:bg-white/60 transition"
            >
              <X size={18} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto py-6 flex flex-col md:flex-row items-center md:items-start justify-center gap-6">
            {/* 80mm Gate Pass Preview */}
            <div className="flex justify-center shadow-xl rounded-lg overflow-hidden">
              <PrintableGatePass data={data} />
            </div>

            {/* Sidebar Actions & Info */}
            <div className="w-full md:w-64 flex flex-col gap-4">
              <div className="bg-white p-4 rounded-xl border border-secondary/60 space-y-2.5 text-xs">
                <div className="font-bold text-charcoal text-xs uppercase tracking-wide flex items-center justify-between">
                  <span>Pass Details</span>
                  {isElectron && (
                    <span className="text-[10px] bg-emerald-100 text-emerald-800 font-mono px-1.5 py-0.5 rounded">
                      <Zap size={9} className="inline mr-0.5" /> Direct HW
                    </span>
                  )}
                </div>
                <div className="space-y-1.5 text-charcoal/70 font-mono text-[11px] pt-1">
                  <div className="flex justify-between">
                    <span>Ticket #:</span>
                    <span className="font-bold text-charcoal">{data.ticketNo}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Room:</span>
                    <span className="font-bold text-charcoal">{data.roomNumber}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Guest:</span>
                    <span className="font-bold text-charcoal truncate max-w-[120px]">{data.guestName || 'Walk-in'}</span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={handlePrint}
                disabled={isPrinting}
                className="w-full bg-primary hover:bg-primary-light text-white font-sans text-xs font-bold py-3.5 rounded-xl cursor-pointer transition shadow-sm flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50"
              >
                {isPrinting ? (
                  <RefreshCw size={15} className="animate-spin" />
                ) : (
                  <Printer size={15} />
                )}
                <span>{isPrinting ? 'Printing Gate Pass...' : 'Print 80mm Gate Pass'}</span>
              </button>

              <button
                type="button"
                onClick={onClose}
                className="w-full bg-white hover:bg-cream/40 text-charcoal border border-secondary font-sans text-xs font-bold py-3 rounded-xl cursor-pointer transition flex items-center justify-center gap-1.5 active:scale-[0.98]"
              >
                <ArrowLeft size={14} />
                <span>Close</span>
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export default GatePassModal;
