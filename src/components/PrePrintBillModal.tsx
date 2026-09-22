import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Receipt } from '../types';
import { Printer, X, Check, ArrowLeft, CornerDownRight, RefreshCw, Zap, DollarSign } from 'lucide-react';
import { formatStayDuration } from '../utils/pricing';
import { useToast } from './ui/Toast';
import { printBrowserReceipt } from '../utils/printBrowserReceipt';

interface PrePrintBillModalProps {
  receipt: Receipt | null;
  isOpen: boolean;
  onClose: () => void;
}

export const PrePrintBillModal: React.FC<PrePrintBillModalProps> = ({
  receipt,
  isOpen,
  onClose,
}) => {
  const toast = useToast();
  const [isPrintingReceipt, setIsPrintingReceipt] = useState<boolean>(false);

  if (!isOpen || !receipt) return null;

  const isElectron = Boolean(window.electronAPI?.isElectron);

  const handlePrint = async () => {
    if (isElectron && window.electronAPI) {
      setIsPrintingReceipt(true);
      try {
        const receiptElement = document.getElementById('printable-receipt');
        if (!receiptElement) {
          printBrowserReceipt('printable-receipt');
          return;
        }

        const savedPrinter = localStorage.getItem('scti_hw_receipt_printer') || undefined;
        const savedDensity = (localStorage.getItem('scti_hw_print_density') as 'normal' | 'high' | 'ultra') || 'high';
        const autoKickDrawer = localStorage.getItem('scti_hw_auto_kick_drawer') !== 'false';
        const isCashOrMixed = receipt.paymentMethod === 'CASH' || receipt.paymentMethod === 'MIXED';

        const res = await window.electronAPI.printReceiptSilent({
          html: receiptElement.innerHTML,
          deviceName: savedPrinter,
          density: savedDensity,
          kickDrawer: autoKickDrawer && isCashOrMixed,
          drawerPin: (parseInt(localStorage.getItem('scti_hw_drawer_pin') || '2', 10) as 2 | 5) || 2,
        });

        if (res.success) {
          toast.success(
            'Thermal Print Dispatched',
            `Ultra-high quality 80mm print job sent${savedPrinter ? ` to ${savedPrinter}` : ''}${autoKickDrawer && isCashOrMixed ? ' • Cash drawer opened' : ''}`
          );
        } else {
          toast.error('Silent Print Failed', res.error || 'Falling back to standard print dialog');
          printBrowserReceipt('printable-receipt');
        }
      } catch (err: any) {
        console.warn('Electron silent print failed, falling back to browser print:', err);
        printBrowserReceipt('printable-receipt');
      } finally {
        setIsPrintingReceipt(false);
      }
    } else {
      printBrowserReceipt('printable-receipt');
    }
  };

  const handleManualKickDrawer = async () => {
    if (isElectron && window.electronAPI) {
      try {
        const savedPrinter = localStorage.getItem('scti_hw_receipt_printer') || undefined;
        const pin = (parseInt(localStorage.getItem('scti_hw_drawer_pin') || '2', 10) as 2 | 5) || 2;
        const res = await window.electronAPI.openCashDrawer({ printerName: savedPrinter, drawerPin: pin });
        if (res.success) {
          toast.success('Cash Drawer Opened', 'RJ11 kick pulse dispatched');
        } else {
          toast.error('Drawer Error', res.error || 'Could not kick cash drawer');
        }
      } catch (err: any) {
        toast.error('Drawer Error', err.message);
      }
    }
  };

  const formatDisplayDate = (val?: string) => {
    if (!val || val === 'N/A') return 'N/A';
    const d = new Date(val.includes(' ') && !val.includes('T') ? val.replace(' ', 'T') : val);
    if (!isNaN(d.getTime())) {
      return d.toLocaleString('en-US', {
        month: 'numeric',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      });
    }
    return val;
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          transition={{ duration: 0.2 }}
          className="bg-[#f7f5f2] rounded-3xl border border-secondary/60 shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col md:flex-row my-auto max-h-[92vh]"
        >
          {/* Left Action & Status Column */}
          <div className="w-full md:w-72 bg-white p-5 md:p-6 border-b md:border-b-0 md:border-r border-secondary/50 flex flex-col justify-between shrink-0">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="w-10 h-10 rounded-2xl bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center justify-center shadow-xs">
                  <Check size={20} />
                </div>
                {isElectron && (
                  <span className="bg-emerald-100 text-emerald-800 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                    <Zap size={10} /> Electron HW
                  </span>
                )}
                <button
                  onClick={onClose}
                  className="p-2 text-charcoal/50 hover:text-charcoal hover:bg-slate-100 rounded-xl transition cursor-pointer md:hidden"
                >
                  <X size={18} />
                </button>
              </div>

              <div>
                <h2 className="font-display font-extrabold text-lg text-charcoal tracking-tight leading-tight">
                  Transaction Finalized
                </h2>
                <p className="text-xs text-charcoal/60 mt-1 leading-relaxed">
                  Pre-print billing folio for Room {receipt.roomNumber}. Deliver this bill to the customer's room before settling final checkout.
                </p>
              </div>

              <div className="pt-3 border-t border-secondary/40 space-y-2 text-xs font-mono text-charcoal/70">
                <div className="flex justify-between">
                  <span>Folio Ref:</span>
                  <span className="font-bold text-primary">{receipt.receiptNo}</span>
                </div>
                <div className="flex justify-between">
                  <span>Room:</span>
                  <span className="font-bold">Room {receipt.roomNumber} ({receipt.roomType})</span>
                </div>
                <div className="flex justify-between">
                  <span>Cashier:</span>
                  <span className="font-bold">{receipt.cashierId}</span>
                </div>
                <div className="flex justify-between">
                  <span>Payment:</span>
                  <span className="font-bold bg-primary/10 text-primary px-1.5 py-0.5 rounded text-[10px]">
                    {receipt.paymentMethod || 'CASH'}
                  </span>
                </div>
                <div className="flex justify-between border-t border-secondary/30 pt-1.5 text-sm font-bold text-primary">
                  <span>Amount Due:</span>
                  <span>₱{receipt.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
            </div>

            <div className="space-y-2.5 pt-6">
              <button
                type="button"
                onClick={handlePrint}
                disabled={isPrintingReceipt}
                className="w-full bg-primary hover:bg-primary-light text-white font-sans text-xs font-bold py-3.5 rounded-xl transition cursor-pointer shadow-md shadow-primary/10 flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50"
              >
                {isPrintingReceipt ? (
                  <RefreshCw size={16} className="animate-spin" />
                ) : (
                  <Printer size={16} />
                )}
                <span>
                  {isPrintingReceipt
                    ? 'Printing 80mm...'
                    : isElectron
                    ? 'Silent Print 80mm (High-DPI)'
                    : 'Print 80mm Receipt'}
                </span>
              </button>

              {isElectron && (
                <button
                  type="button"
                  onClick={handleManualKickDrawer}
                  className="w-full bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 font-sans text-xs font-bold py-2.5 rounded-xl cursor-pointer transition flex items-center justify-center gap-1.5"
                >
                  <DollarSign size={14} />
                  <span>Kick Cash Drawer (RJ11)</span>
                </button>
              )}

              <button
                type="button"
                onClick={onClose}
                className="w-full bg-white hover:bg-cream/40 text-charcoal/80 border border-secondary font-sans text-xs font-bold py-3 rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5 active:scale-[0.98]"
              >
                <ArrowLeft size={14} />
                <span>Return to Room Sidebar</span>
              </button>
            </div>
          </div>

          {/* Right Scrollable Thermal Receipt Preview Container */}
          <div className="flex-1 p-4 md:p-6 overflow-y-auto flex justify-center bg-[#eae6df]">
            <div
              className="w-[80mm] max-w-[80mm] min-w-[80mm] bg-white border border-secondary shadow-lg p-5 relative overflow-hidden flex-shrink-0 my-auto text-black print:text-black print:border-none print:shadow-none"
              style={{
                backgroundImage: 'radial-gradient(ellipse at top, #ebd5c61a 0%, transparent 80%)',
              }}
              id="printable-receipt"
            >
              {/* Receipt Body */}
              <div className="font-mono text-[11px] text-charcoal/90 pt-2 pb-2 space-y-4">
                {/* Header Brand */}
                <div className="text-center space-y-1.5">
                  <h3 className="font-display font-extrabold text-sm tracking-tight text-primary leading-none uppercase">
                    Sedona Court
                  </h3>
                  <p className="text-[9px] text-charcoal/50 leading-relaxed uppercase">
                    Doña Remedios Trinidad Hwy,<br />
                    San Rafael, 3008 Bulacan<br />
                    TEL: +63 (0939) 905-2816
                  </p>
                </div>

                {/* Separator */}
                <div className="border-t border-dashed border-charcoal/20 my-2.5 print:border-black" />

                {/* Metadata Panel */}
                <div className="space-y-1 text-[10px] uppercase">
                  <div className="flex justify-between">
                    <span>RECEIPT NO:</span>
                    <span className="font-bold">{receipt.receiptNo}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>DATE/TIME:</span>
                    <span>{formatDisplayDate(receipt.dateTime)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>CASHIER OPERATOR:</span>
                    <span className="font-bold">{receipt.cashierId} // FD-01</span>
                  </div>
                  <div className="flex justify-between text-primary font-bold">
                    <span>ROOM NUMBER:</span>
                    <span>ROOM {receipt.roomNumber} ({receipt.roomType})</span>
                  </div>
                  <div className="flex justify-between items-start">
                    <span className="shrink-0 pr-1">GUEST:</span>
                    <span className="font-bold break-all text-right flex-1">{receipt.guestName}</span>
                  </div>
                  <div className="flex justify-between text-emerald-800 font-bold">
                    <span>DECLARED STAY:</span>
                    <span>{receipt.stayDuration || (receipt.rateSelected ? formatStayDuration(receipt.rateSelected) : 'Standard Stay')}</span>
                  </div>
                </div>

                {/* Separator */}
                <div className="border-t border-dashed border-charcoal/20 my-2.5 print:border-black" />

                {/* Timestamps */}
                <div className="text-[10px] space-y-1 bg-cream/30 p-2 rounded border border-secondary/40">
                  <div className="flex items-start gap-1 justify-between">
                    <span className="text-emerald-700 font-bold">IN:</span>
                    <span className="text-charcoal/80 font-medium">{formatDisplayDate(receipt.checkIn)}</span>
                  </div>
                  <div className="flex items-start gap-1 justify-between">
                    <span className="text-rose-700 font-bold">OUT:</span>
                    <span className="text-charcoal/80 font-medium">{formatDisplayDate(receipt.checkOut)}</span>
                  </div>
                  {receipt.stayDuration && (
                    <div className="flex items-start gap-1 justify-between pt-0.5 border-t border-secondary/30 text-[9px]">
                      <span className="text-primary font-bold">RATE BLOCK:</span>
                      <span className="font-bold text-primary">{receipt.stayDuration}</span>
                    </div>
                  )}
                </div>

                {/* Separator */}
                <div className="border-t border-dashed border-charcoal/20 my-2.5 print:border-black" />

                {/* Tabular Bill List */}
                <div className="space-y-3">
                  <div className="flex justify-between font-bold text-[10px] text-charcoal/50">
                    <span>CHARGE DESCRIPTION / AMOUNT</span>
                  </div>

                  <div className="space-y-2">
                    {receipt.items.map((item, idx) => (
                      <div key={idx} className="flex flex-col gap-0.5">
                        <div className="flex justify-between font-medium items-start">
                          <span className="flex-1 pr-2 break-words">{item.description}</span>
                          <span className={`shrink-0 font-bold ${item.amount < 0 ? 'text-emerald-700' : ''}`}>
                            {item.amount < 0 ? '-' : ''}₱{Math.abs(item.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                        <span className="text-[10px] text-charcoal/40 flex items-center gap-1 pl-1">
                          <CornerDownRight size={8} className="shrink-0" /> <span className="break-all">{item.subtext}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Separator */}
                <div className="border-t border-dashed border-charcoal/20 my-2.5 print:border-black" />

                {/* Totals */}
                <div className="space-y-1.5 uppercase text-xs">
                  <div className="flex justify-between">
                    <span>SUBTOTAL:</span>
                    <span>₱{receipt.subtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                  {receipt.discount && receipt.discount > 0 && (
                    <>
                      <div className="flex justify-between text-emerald-800 font-semibold">
                        <span>DISCOUNT ({receipt.discountType === 'DC' ? 'DISCOUNT CARD' : 'SENIOR / PWD'}):</span>
                        <span>-₱{receipt.discount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                      {receipt.discountIdRef && (
                        <div className="flex justify-between text-[10px] text-charcoal/50">
                          <span>{receipt.discountType === 'DC' ? 'DISCOUNT CARD #:' : 'SC/PWD ID REF:'}</span>
                          <span className="font-bold break-all">{receipt.discountIdRef}</span>
                        </div>
                      )}
                    </>
                  )}
                  <div className="flex justify-between">
                    <span>SETTLEMENT METHOD:</span>
                    <span className="font-bold">{receipt.paymentMethod || 'CASH'}</span>
                  </div>
                  {receipt.paymentMethod === 'MIXED' && (
                    <div className="space-y-0.5 border-l border-charcoal/20 pl-2 mt-0.5 text-[10px] lowercase font-mono">
                      <div className="flex justify-between">
                        <span>- cash paid:</span>
                        <span>₱{(receipt.cashAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>- gcash paid:</span>
                        <span>₱{(receipt.gcashAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                    </div>
                  )}
                  {receipt.gcashRef && (
                    <div className="flex justify-between font-mono text-primary/80 print:text-black">
                      <span>GCASH REF NO:</span>
                      <span className="font-bold break-all">{receipt.gcashRef}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-extrabold border-t border-charcoal/20 pt-1.5 text-primary print:text-black">
                    <span>TOTAL AMOUNT DUE:</span>
                    <span className="font-display">₱{receipt.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                  {receipt.depositBalance !== undefined && receipt.depositBalance > 0 && (
                    <div className="flex justify-between text-xs font-bold text-emerald-800 border-t border-charcoal/20 pt-1.5 mt-1">
                      <span>DEPOSIT BALANCE:</span>
                      <span className="font-display">₱{receipt.depositBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                  )}
                </div>

                {/* Separator */}
                <div className="border-t-2 border-double border-charcoal/30 my-2.5 print:border-black" />

                {/* Barcode & Footer */}
                <div className="text-center space-y-3 pt-2">
                  <div className="flex flex-col items-center gap-1.5">
                    <svg className="w-48 h-8 opacity-75" viewBox="0 0 100 20" preserveAspectRatio="none">
                      {Array.from({ length: 42 }).map((_, i) => {
                        const width = (i % 3 === 0) ? '2' : (i % 2 === 0) ? '1' : '0.5';
                        const x = i * 2.3;
                        return (
                          <rect
                            key={i}
                            x={x}
                            y="0"
                            width={width}
                            height="20"
                            fill="#221c1d"
                          />
                        );
                      })}
                    </svg>
                    <span className="text-[9px] tracking-[0.3em] font-mono text-charcoal/40">
                      *{receipt.receiptNo}*
                    </span>
                  </div>

                  <div className="space-y-1 text-[10px] italic text-charcoal/50 leading-tight">
                    <div className="flex flex-col items-center justify-center my-2">
                      <img src="/qr-fb.png" alt="Facebook QR Code" className="w-16 h-16 object-contain grayscale opacity-80 mix-blend-multiply" />
                      <span className="text-[8px] font-bold mt-0.5 not-italic uppercase opacity-75">Scan & Follow Us!</span>
                    </div>
                    <p>Thank you for choosing Sedona Court!</p>
                    <p>Please visit us again soon.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
