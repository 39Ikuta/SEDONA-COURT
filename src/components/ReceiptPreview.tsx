import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Receipt } from '../types';
import { Printer, Check, ArrowLeft, CornerDownRight, ChefHat, RefreshCw, Zap, DollarSign, Ticket, FileText } from 'lucide-react';
import { formatStayDuration } from '../utils/pricing';
import { getKitchenOrdersByReceipt, printKitchenOrder, KitchenOrder } from '../api/kitchen';
import { PrintableGatePass, GatePassData } from './PrintableGatePass';
import { useToast } from './ui/Toast';
import { printBrowserReceipt } from '../utils/printBrowserReceipt';

interface ReceiptPreviewProps {
  receipt: Receipt | null;
  onClose: () => void;
  isPreliminary?: boolean;
}

export const ReceiptPreview: React.FC<ReceiptPreviewProps> = ({ receipt, onClose, isPreliminary }) => {
  const toast = useToast();
  const [kitchenOrders, setKitchenOrders] = useState<KitchenOrder[]>([]);
  const [printingOrderId, setPrintingOrderId] = useState<number | null>(null);
  const [isPrintingReceipt, setIsPrintingReceipt] = useState<boolean>(false);
  const [isPrintingGatePass, setIsPrintingGatePass] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'receipt' | 'gatepass'>('receipt');

  const isElectron = Boolean(window.electronAPI?.isElectron);
  const isPrelim = Boolean(isPreliminary || receipt?.receiptNo?.startsWith('PRE-'));

  useEffect(() => {
    if (!receipt?.receiptNo) {
      setKitchenOrders([]);
      return;
    }

    let isMounted = true;
    const fetchKitchenOrders = async () => {
      try {
        const orders = await getKitchenOrdersByReceipt(receipt.receiptNo);
        if (isMounted) {
          setKitchenOrders(orders);
        }
      } catch (err) {
        console.warn('Could not fetch receipt kitchen orders:', err);
      }
    };

    fetchKitchenOrders();
    const timer = setTimeout(fetchKitchenOrders, 1000);
    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [receipt?.receiptNo]);

  const handlePrintKitchen = async (orderId: number) => {
    setPrintingOrderId(orderId);
    try {
      const res = await printKitchenOrder(orderId);
      toast.success('Print Job Dispatched', res.message || 'Ticket sent to kitchen thermal printer');
      if (receipt?.receiptNo) {
        const updated = await getKitchenOrdersByReceipt(receipt.receiptNo);
        setKitchenOrders(updated);
      }
    } catch (err: any) {
      console.error('Kitchen print failed:', err);
      toast.error('Kitchen Print Failed', err.message || 'Failed to connect to kitchen thermal printer');
    } finally {
      setPrintingOrderId(null);
    }
  };

  if (!receipt) return null;

  const gatePassData: GatePassData = {
    ticketNo: receipt.receiptNo || `GP-${receipt.roomNumber}-${Date.now().toString().slice(-4)}`,
    roomNumber: receipt.roomNumber,
    roomType: receipt.roomType,
    guestName: receipt.guestName,
    checkIn: receipt.checkIn || new Date().toISOString(),
    checkOut: receipt.checkOut || receipt.dateTime || new Date().toISOString(),
    cashierName: receipt.cashierId,
  };

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

  const handlePrintGatePass = async () => {
    if (isElectron && window.electronAPI) {
      setIsPrintingGatePass(true);
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
            'Gate Pass Dispatched',
            `80mm Thermal Gate Pass sent${savedPrinter ? ` to ${savedPrinter}` : ''}`
          );
        } else {
          toast.error('Print Failed', res.error || 'Falling back to standard print dialog');
          printBrowserReceipt('printable-gate-pass');
        }
      } catch (err: any) {
        console.warn('Gate Pass print failed, falling back to browser print:', err);
        printBrowserReceipt('printable-gate-pass');
      } finally {
        setIsPrintingGatePass(false);
      }
    } else {
      printBrowserReceipt('printable-gate-pass');
    }
  };

  const handlePrintBoth = async () => {
    await handlePrint();
    setTimeout(async () => {
      await handlePrintGatePass();
    }, 600);
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
    <div className="flex-1 flex flex-col md:flex-row gap-8 max-w-4xl mx-auto py-6 px-4 items-start font-sans">
      {/* Hidden container to ensure both elements exist in DOM for printing */}
      <div className="hidden">
        <PrintableGatePass data={gatePassData} />
      </div>

      {/* Informative Side Bar */}
      <div className="w-full md:w-80 flex flex-col gap-6">
        <div className="bg-white p-5 rounded-2xl border border-secondary shadow-sm">
          <div className="w-10 h-10 rounded-full flex items-center justify-center mb-4 border bg-green-50 text-green-600 border-green-100">
            <Check size={20} />
          </div>
          <div className="flex items-center justify-between">
            <h2 className="font-display font-extrabold text-base tracking-tight text-charcoal">
              Transaction Finalized
            </h2>
            {isElectron && (
              <span className="bg-emerald-100 text-emerald-800 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                <Zap size={10} /> Electron HW
              </span>
            )}
          </div>
          <p className="text-xs text-charcoal/60 mt-1.5 leading-relaxed">
            Official billing statement and Gate Pass for Room {receipt.roomNumber}.
          </p>

          <div className="mt-4 pt-4 border-t border-secondary/40 space-y-2.5 text-xs font-mono text-charcoal/60">
            <div className="flex justify-between">
              <span>Receipt / Folio Ref:</span>
              <span className="font-bold text-primary">{receipt.receiptNo}</span>
            </div>
            <div className="flex justify-between">
              <span>Terminal Operator:</span>
              <span className="font-bold">{receipt.cashierId}</span>
            </div>
            <div className="flex justify-between">
              <span>Settlement:</span>
              <span className="font-bold bg-primary/5 text-primary px-1.5 py-0.5 rounded text-[10px]">
                {receipt.paymentMethod === 'MIXED'
                  ? `MIXED (₱${(receipt.cashAmount || 0).toLocaleString()} + ₱${(receipt.gcashAmount || 0).toLocaleString()})`
                  : receipt.paymentMethod || 'CASH'}
              </span>
            </div>
          </div>
        </div>

        {/* Tab switchers */}
        <div className="bg-white p-1 rounded-xl border border-secondary/60 flex gap-1">
          <button
            type="button"
            onClick={() => setActiveTab('receipt')}
            className={`flex-1 py-2 rounded-lg font-mono text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'receipt'
                ? 'bg-primary text-white shadow-xs'
                : 'text-charcoal/70 hover:bg-cream/40'
            }`}
          >
            <FileText size={13} />
            <span>Receipt</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('gatepass')}
            className={`flex-1 py-2 rounded-lg font-mono text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'gatepass'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-charcoal/70 hover:bg-cream/40'
            }`}
          >
            <Ticket size={13} className="text-amber-400" />
            <span>Gate Pass</span>
          </button>
        </div>

        <div className="flex flex-col gap-2.5">
          <button
            onClick={handlePrint}
            disabled={isPrintingReceipt}
            className="w-full bg-primary hover:bg-primary-light text-white font-sans text-xs font-bold py-3 rounded-xl cursor-pointer transition shadow-sm flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98]"
          >
            {isPrintingReceipt ? (
              <RefreshCw size={15} className="animate-spin" />
            ) : (
              <Printer size={15} />
            )}
            <span>
              {isPrintingReceipt
                ? 'Printing 80mm...'
                : isElectron
                ? 'Print 80mm Receipt (Silent)'
                : 'Print 80mm Thermal Receipt'}
            </span>
          </button>

          <button
            type="button"
            onClick={handlePrintGatePass}
            disabled={isPrintingGatePass}
            className="w-full bg-slate-900 hover:bg-slate-800 text-white font-sans text-xs font-bold py-3 rounded-xl cursor-pointer transition shadow-sm flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98]"
          >
            {isPrintingGatePass ? (
              <RefreshCw size={15} className="animate-spin text-amber-400" />
            ) : (
              <Ticket size={15} className="text-amber-400" />
            )}
            <span>
              {isPrintingGatePass ? 'Printing Gate Pass...' : 'Print Gate Pass (80mm Thermal)'}
            </span>
          </button>

          <button
            type="button"
            onClick={handlePrintBoth}
            disabled={isPrintingReceipt || isPrintingGatePass}
            className="w-full bg-amber-500 hover:bg-amber-600 text-slate-950 font-sans text-xs font-bold py-2.5 rounded-xl cursor-pointer transition shadow-xs flex items-center justify-center gap-1.5 active:scale-[0.98] disabled:opacity-50"
          >
            <Zap size={14} />
            <span>Print Both (Receipt + Gate Pass)</span>
          </button>

          {isElectron && (
            <button
              type="button"
              onClick={handleManualKickDrawer}
              className="w-full bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 font-sans text-xs font-bold py-2.5 rounded-xl cursor-pointer transition flex items-center justify-center gap-1.5 active:scale-[0.98]"
            >
              <DollarSign size={14} />
              <span>Kick Cash Drawer (RJ11)</span>
            </button>
          )}

          {kitchenOrders.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <div className="text-[10px] font-mono font-bold uppercase text-charcoal/50 px-1">
                Kitchen Food Order Ticket
              </div>
              {kitchenOrders.map((kOrder) => {
                const isPrinting = printingOrderId === kOrder.id || kOrder.print_status === 'printing';
                const isPrinted = kOrder.print_status === 'printed';
                const isFailed = kOrder.print_status === 'failed';

                return (
                  <button
                    key={kOrder.id}
                    type="button"
                    onClick={() => handlePrintKitchen(kOrder.id)}
                    disabled={isPrinting}
                    className={`w-full font-sans text-xs font-bold py-2.5 px-3 rounded-xl cursor-pointer transition shadow-sm flex items-center justify-between gap-2 border ${
                      isFailed
                        ? 'bg-red-50 hover:bg-red-100 text-red-700 border-red-300'
                        : isPrinted
                        ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-300'
                        : 'bg-amber-500 hover:bg-amber-600 text-slate-950 border-amber-500'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    <div className="flex items-center gap-2">
                      {isPrinting ? (
                        <RefreshCw size={14} className="animate-spin" />
                      ) : (
                        <ChefHat size={14} />
                      )}
                      <span>
                        {isPrinting
                          ? 'Sending to Kitchen...'
                          : isFailed
                          ? 'Retry Kitchen Print'
                          : isPrinted
                          ? 'Reprint Kitchen Ticket'
                          : 'Print to Kitchen'}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono font-extrabold uppercase">
                      {kOrder.order_number}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <button
            onClick={onClose}
            className="w-full bg-white hover:bg-cream/40 text-charcoal/80 border border-secondary/60 font-sans text-xs font-bold py-3 rounded-xl cursor-pointer transition flex items-center justify-center gap-1.5"
          >
            <ArrowLeft size={14} />
            Back to Frontdesk Board
          </button>
        </div>
      </div>

      {/* The 80mm Thermal Paper Roll View */}
      <div className="flex-1 w-full flex justify-center">
        {activeTab === 'gatepass' ? (
          <PrintableGatePass data={gatePassData} />
        ) : (
          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="w-[80mm] max-w-[80mm] min-w-[80mm] bg-white border border-secondary shadow-lg p-5 relative overflow-hidden flex-shrink-0 text-black print:text-black print:border-none print:shadow-none"
            style={{
              backgroundImage: 'radial-gradient(ellipse at top, #ebd5c61a 0%, transparent 80%)',
            }}
            id="printable-receipt"
          >
          {/* Serrated Cut/Tear Effect Top */}
          <div className="absolute top-0 left-0 right-0 h-1 flex justify-between overflow-hidden opacity-50 select-none pointer-events-none print:hidden">
            {Array.from({ length: 40 }).map((_, i) => (
              <div
                key={i}
                className="w-2.5 h-2.5 bg-cream rotate-45 flex-shrink-0 -translate-y-1.5 border-b border-r border-secondary"
              />
            ))}
          </div>

          {/* Receipt Body - High Contrast Monochrome Thermal Layout */}
          <div className="font-mono text-[11px] text-black pt-4 pb-2 space-y-4">
            {/* Header Brand */}
            <div className="text-center space-y-1.5">
              <h3 className="font-display font-extrabold text-sm tracking-tight text-black leading-none uppercase">
                Sedona Court
              </h3>
              <p className="text-[9px] text-black leading-relaxed uppercase">
                Doña Remedios Trinidad Hwy,<br />
                San Rafael, 3008 Bulacan<br />
                TEL: +63 (0939) 905-2816
              </p>
            </div>

            {/* Separator */}
            <div className="border-t border-dashed border-black my-2.5 print:border-black" />

            {/* Metadata Panel */}
            <div className="space-y-1 text-[10px] uppercase text-black">
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
              <div className="flex justify-between font-bold">
                <span>ROOM NUMBER:</span>
                <span>ROOM {receipt.roomNumber} ({receipt.roomType})</span>
              </div>
              <div className="flex justify-between items-start">
                <span className="shrink-0 pr-1">GUEST:</span>
                <span className="font-bold break-all text-right flex-1">{receipt.guestName}</span>
              </div>
              <div className="flex justify-between font-bold">
                <span>DECLARED STAY:</span>
                <span>{receipt.stayDuration || (receipt.rateSelected ? formatStayDuration(receipt.rateSelected) : 'Standard Stay')}</span>
              </div>
            </div>

            {/* Separator */}
            <div className="border-t border-dashed border-black my-2.5 print:border-black" />

            {/* Time stamps */}
            <div className="text-[10px] space-y-1 p-2 rounded border border-black text-black">
              <div className="flex items-start gap-1 justify-between">
                <span className="font-bold">IN:</span>
                <span className="font-medium">{formatDisplayDate(receipt.checkIn)}</span>
              </div>
              <div className="flex items-start gap-1 justify-between">
                <span className="font-bold">OUT:</span>
                <span className="font-medium">{formatDisplayDate(receipt.checkOut)}</span>
              </div>
              {receipt.stayDuration && (
                <div className="flex items-start gap-1 justify-between pt-0.5 border-t border-dashed border-black text-[9px]">
                  <span className="font-bold">RATE BLOCK:</span>
                  <span className="font-bold">{receipt.stayDuration}</span>
                </div>
              )}
            </div>

            {/* Separator */}
            <div className="border-t border-dashed border-black my-2.5 print:border-black" />

            {/* Tabular Bill List */}
            <div className="space-y-3 text-black">
              <div className="flex justify-between font-bold text-[10px]">
                <span>CHARGE DESCRIPTION / AMOUNT</span>
              </div>

              <div className="space-y-2">
                {receipt.items.map((item, idx) => (
                  <div key={idx} className="flex flex-col gap-0.5">
                    <div className="flex justify-between font-medium items-start">
                      <span className="flex-1 pr-2 break-words">{item.description}</span>
                      <span className="shrink-0 font-bold">
                        {item.amount < 0 ? '-' : ''}₱{Math.abs(item.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                    <span className="text-[10px] flex items-center gap-1 pl-1">
                      <CornerDownRight size={8} className="shrink-0" /> <span className="break-all">{item.subtext}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Separator */}
            <div className="border-t border-dashed border-black my-2.5 print:border-black" />

            {/* Totals */}
            <div className="space-y-1.5 uppercase text-xs text-black">
              <div className="flex justify-between">
                <span>SUBTOTAL:</span>
                <span>₱{receipt.subtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              {receipt.discount && receipt.discount > 0 && (
                <>
                  <div className="flex justify-between font-semibold">
                    <span>DISCOUNT ({receipt.discountType === 'DC' ? 'DISCOUNT CARD' : 'SENIOR / PWD'}):</span>
                    <span>-₱{receipt.discount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                  {receipt.discountIdRef && (
                    <div className="flex justify-between text-[10px]">
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
                <div className="space-y-0.5 border-l border-black pl-2 mt-0.5 text-[10px] lowercase font-mono">
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
                <div className="flex justify-between font-mono">
                  <span>GCASH REF NO:</span>
                  <span className="font-bold break-all">{receipt.gcashRef}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-extrabold border-t border-black pt-1.5">
                <span>TOTAL AMOUNT DUE:</span>
                <span className="font-display">₱{receipt.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              {receipt.depositBalance !== undefined && receipt.depositBalance > 0 && (
                <div className="flex justify-between text-xs font-bold border-t border-black pt-1.5 mt-1">
                  <span>DEPOSIT BALANCE:</span>
                  <span className="font-display">₱{receipt.depositBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              )}
            </div>

            {/* Separator */}
            <div className="border-t-2 border-double border-black my-2.5 print:border-black" />

            {/* Barcode & Footer */}
            <div className="text-center space-y-3 pt-2 text-black">
              <div className="flex flex-col items-center gap-1.5">
                {/* SVG High-Contrast Barcode */}
                <svg className="w-48 h-8" viewBox="0 0 100 20" preserveAspectRatio="none">
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
                        fill="#000000"
                      />
                    );
                  })}
                </svg>
                <span className="text-[9px] tracking-[0.3em] font-mono">
                  *{receipt.receiptNo}*
                </span>
              </div>

              <div className="space-y-1 text-[10px] italic leading-tight">
                <div className="flex flex-col items-center justify-center my-2">
                  <img src="/qr-fb.png" alt="Facebook QR Code" className="w-16 h-16 object-contain" />
                  <span className="text-[8px] font-bold mt-0.5 not-italic uppercase">Scan & Follow Us!</span>
                </div>
                <p>Thank you for choosing Sedona Court!</p>
                <p>Please visit us again soon.</p>
              </div>
            </div>
          </div>

          {/* Serrated Cut/Tear Effect Bottom */}
          <div className="absolute bottom-0 left-0 right-0 h-1 flex justify-between overflow-hidden opacity-50 select-none pointer-events-none print:hidden">
            {Array.from({ length: 40 }).map((_, i) => (
              <div
                key={i}
                className="w-2.5 h-2.5 bg-cream rotate-45 flex-shrink-0 translate-y-1.5 border-t border-l border-secondary"
              />
            ))}
          </div>
        </motion.div>
        )}
      </div>
    </div>
  );
};
