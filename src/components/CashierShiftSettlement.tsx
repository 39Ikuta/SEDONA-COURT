import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Wallet,
  ArrowDownRight,
  Receipt as ReceiptIcon,
  Plus,
  Trash2,
  RefreshCw,
  Calendar,
  Clock,
  User,
  DollarSign,
  AlertCircle,
  CheckCircle2,
  FileSpreadsheet,
  ArrowRight,
  Coins,
  Calculator,
  RotateCcw,
  Check,
  FileText,
  Download,
  ArrowRightLeft
} from 'lucide-react';
import {
  getShiftSettlementSummary,
  addShiftExpense,
  deleteShiftExpense,
  ShiftSettlementSummary,
  ShiftExpense
} from '../api/shift-settlement';
import { getRoomTransfers } from '../api/rooms';
import { RoomTransferRecord } from '../types';
import { downloadShiftForms } from '../api/reportExports';
import { useToast } from './ui/Toast';

interface CashierShiftSettlementProps {
  activeCashier: string;
}

const COMMON_EXPENSE_PRESETS = [
  'Drinking Water / Wilkins',
  'Ice Bag / Tube Ice',
  'Market / Groceries',
  'Emergency Laundry / Linen',
  'Cleaning Supplies / Zonrox',
  'Hardware / Maintenance Parts',
  'Garbage / Utility Fee',
  'Petty Cash Miscellaneous'
];

export const DENOMINATIONS = [1000, 500, 200, 100, 50, 20, 10, 5, 1] as const;

interface DenomConfig {
  value: number;
  label: string;
  type: 'bill' | 'coin';
  badgeClass: string;
}

const DENOM_CONFIGS: DenomConfig[] = [
  { value: 1000, label: '₱1,000', type: 'bill', badgeClass: 'bg-blue-100/80 text-blue-900 border-blue-300' },
  { value: 500, label: '₱500', type: 'bill', badgeClass: 'bg-amber-100/80 text-amber-900 border-amber-300' },
  { value: 200, label: '₱200', type: 'bill', badgeClass: 'bg-emerald-100/80 text-emerald-900 border-emerald-300' },
  { value: 100, label: '₱100', type: 'bill', badgeClass: 'bg-purple-100/80 text-purple-900 border-purple-300' },
  { value: 50, label: '₱50', type: 'bill', badgeClass: 'bg-rose-100/80 text-rose-900 border-rose-300' },
  { value: 20, label: '₱20', type: 'bill', badgeClass: 'bg-orange-100/80 text-orange-900 border-orange-300' },
  { value: 10, label: '₱10', type: 'coin', badgeClass: 'bg-stone-200/90 text-stone-800 border-stone-400' },
  { value: 5, label: '₱5', type: 'coin', badgeClass: 'bg-stone-200/90 text-stone-800 border-stone-400' },
  { value: 1, label: '₱1', type: 'coin', badgeClass: 'bg-stone-200/90 text-stone-800 border-stone-400' },
];

export const CashierShiftSettlement: React.FC<CashierShiftSettlementProps> = ({ activeCashier }) => {
  const toast = useToast();
  const [summary, setSummary] = useState<ShiftSettlementSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Filter states
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [selectedShift, setSelectedShift] = useState<'DAY' | 'NIGHT'>('DAY');
  const [isAutoShift, setIsAutoShift] = useState(true);

  // New Expense form
  const [expenseDesc, setExpenseDesc] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');

  // Denomination breakdown state
  const [counts, setCounts] = useState<Record<number, string>>({
    1000: '',
    500: '',
    200: '',
    100: '',
    50: '',
    20: '',
    10: '',
    5: '',
    1: '',
  });
  const [checkedBy, setCheckedBy] = useState('');
  const [isPrintingMoneyCount, setIsPrintingMoneyCount] = useState(false);
  const [exportingForms, setExportingForms] = useState(false);
  const [shiftTransfers, setShiftTransfers] = useState<RoomTransferRecord[]>([]);

  const handleExportShiftForms = async (sheets: 'both' | 'transfer' = 'both') => {
    const date = summary?.shiftDate || selectedDate;
    const shift = summary?.shiftType || selectedShift;
    if (!date || (shift !== 'DAY' && shift !== 'NIGHT')) {
      toast.warning('No Shift', 'Select a shift date first.');
      return;
    }
    setExportingForms(true);
    try {
      await downloadShiftForms(date, shift, sheets);
      toast.success('Export Ready', sheets === 'transfer'
        ? `Shift transfer form for ${date} ${shift} downloaded.`
        : `Shift forms for ${date} ${shift} downloaded.`);
    } catch (err: any) {
      toast.error('Export Failed', err?.message || 'Could not generate shift forms.');
    } finally {
      setExportingForms(false);
    }
  };

  const fetchSummary = async () => {
    setLoading(true);
    try {
      const data = isAutoShift
        ? await getShiftSettlementSummary()
        : await getShiftSettlementSummary(selectedDate, selectedShift);
      setSummary(data);
      const targetDate = isAutoShift ? data.shiftDate : selectedDate;
      if (isAutoShift) {
        setSelectedDate(data.shiftDate);
        setSelectedShift(data.shiftType);
      }
      try {
        const transfers = await getRoomTransfers(targetDate);
        setShiftTransfers(transfers);
      } catch (tErr) {
        console.warn('Failed to load shift room transfers:', tErr);
      }
    } catch (err: any) {
      console.error('Failed to load shift settlement summary:', err);
      toast.error('Error', err.message || 'Could not load shift settlement summary.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSummary();
  }, [selectedDate, selectedShift, isAutoShift]);

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    const desc = expenseDesc.trim();
    const amt = parseFloat(expenseAmount);

    if (!desc) {
      toast.warning('Description Required', 'Please enter a description for the operating expense.');
      return;
    }
    if (isNaN(amt) || amt <= 0) {
      toast.warning('Invalid Amount', 'Please enter a valid positive expense amount.');
      return;
    }

    setSaving(true);
    try {
      await addShiftExpense(desc, amt, summary?.shiftDate, summary?.shiftType);
      toast.success('Expense Recorded', `Added ₱${amt.toLocaleString()} for "${desc}"`);
      setExpenseDesc('');
      setExpenseAmount('');
      await fetchSummary();
    } catch (err: any) {
      console.error('Failed to add expense:', err);
      toast.error('Failed', err.message || 'Could not record expense.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteExpense = async (exp: ShiftExpense) => {
    if (!window.confirm(`Delete operating expense "${exp.description}" (₱${exp.amount.toLocaleString()})?`)) {
      return;
    }
    try {
      await deleteShiftExpense(exp.id);
      toast.success('Deleted', 'Operating expense removed.');
      await fetchSummary();
    } catch (err: any) {
      console.error('Failed to delete expense:', err);
      toast.error('Failed', err.message || 'Could not delete expense.');
    }
  };

  // Money count calculations
  const totalCounted = DENOMINATIONS.reduce((sum, denom) => {
    const qty = parseInt(counts[denom] || '0', 10);
    return !isNaN(qty) && qty > 0 ? sum + denom * qty : sum;
  }, 0);

  const hasCounts = DENOMINATIONS.some((denom) => {
    const val = counts[denom];
    const qty = parseInt(val, 10);
    return val && val.trim() !== '' && !isNaN(qty) && qty > 0;
  });

  const expectedCashOnHand = summary?.expectedCashOnHand || 0;
  const cashVariance = totalCounted - expectedCashOnHand;

  const handleCountChange = (denom: number, value: string) => {
    if (value === '') {
      setCounts((prev) => ({ ...prev, [denom]: '' }));
      return;
    }
    const clean = value.replace(/[^0-9]/g, '');
    setCounts((prev) => ({ ...prev, [denom]: clean }));
  };

  const handleClearCounts = () => {
    setCounts({
      1000: '',
      500: '',
      200: '',
      100: '',
      50: '',
      20: '',
      10: '',
      5: '',
      1: '',
    });
    setCheckedBy('');
    toast.info('Counts Cleared', 'Physical money counter reset to empty.');
  };

  const printViaIframe = (html: string) => {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(html);
      doc.close();
      iframe.contentWindow?.focus();
      setTimeout(() => {
        iframe.contentWindow?.print();
        setTimeout(() => {
          document.body.removeChild(iframe);
        }, 1000);
      }, 300);
    }
  };

  const generateMoneyCountReceiptHtml = (): string => {
    const dateToday = selectedDate || new Date().toISOString().slice(0, 10);
    const shiftStr = selectedShift || summary?.shiftType || 'DAY';
    const cashierName = activeCashier || 'Cashier On Duty';
    const checkedByName = checkedBy.trim() || '____________________';

    const rows = [
      { denom: 1000, label: '1,000 x :' },
      { denom: 500, label: '  500 x :' },
      { denom: 200, label: '  200 x :' },
      { denom: 100, label: '  100 x :' },
      { denom: 50, label: '   50 x :' },
      { denom: 20, label: '   20 x :' },
      { denom: 10, label: '   10 x :' },
      { denom: 5, label: '    5 x :' },
      { denom: 1, label: '    1 x :' },
    ];

    const rowsHtml = rows
      .map((r) => {
        const rawVal = counts[r.denom] || '';
        const qty = parseInt(rawVal, 10);
        const hasQty = !isNaN(qty) && rawVal.trim() !== '';
        const qtyText = hasQty ? `${qty}` : '____________';
        const subtotalText = hasQty
          ? `₱${(r.denom * qty).toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}`
          : '₱____________';

        return `
        <div style="display: flex; justify-content: space-between; align-items: baseline; font-family: monospace; font-size: 11px; margin: 3px 0;">
          <span style="font-weight: bold; width: 68px; white-space: pre;">${r.label}</span>
          <span style="flex: 1; text-align: center; border-bottom: ${hasQty ? 'none' : '1px dotted #888'}; margin: 0 4px;">${qtyText}</span>
          <span style="font-weight: bold; width: 100px; text-align: right;">= ${subtotalText}</span>
        </div>
      `;
      })
      .join('');

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>Cashier End of Shift Money Count</title>
        <style>
          @page { margin: 0; size: 80mm auto; }
          * { box-sizing: border-box; }
          body {
            font-family: 'Courier New', Courier, monospace;
            width: 72mm;
            margin: 0 auto;
            padding: 10px 4px;
            color: #000;
            background: #fff;
            font-size: 11px;
            line-height: 1.35;
          }
          .center { text-align: center; }
          .right { text-align: right; }
          .bold { font-weight: bold; }
          .divider { border-top: 1px dashed #000; margin: 6px 0; }
          .double-divider { border-top: 2px solid #000; margin: 6px 0; }
          .row { display: flex; justify-content: space-between; margin: 2px 0; font-size: 11px; }
        </style>
      </head>
      <body>
        <div class="center">
          <div style="font-size: 13px; font-weight: 900; letter-spacing: 0.5px;">SEDONA COURT TRAVELLERS INN</div>
          <div style="font-size: 10px; font-weight: bold; margin-top: 2px;">CASHIER END-OF-SHIFT SETTLEMENT</div>
          <div style="font-size: 9px; color: #444;">PHYSICAL MONEY COUNT BREAKDOWN</div>
        </div>

        <div class="divider"></div>

        <div class="row">
          <span>Date Today:</span>
          <span class="bold">${dateToday}</span>
        </div>
        <div class="row">
          <span>Shift:</span>
          <span class="bold">${shiftStr} SHIFT</span>
        </div>
        <div class="row">
          <span>Cashier:</span>
          <span class="bold">${cashierName}</span>
        </div>
        <div class="row">
          <span>Checked By:</span>
          <span class="bold">${checkedByName}</span>
        </div>

        <div class="divider"></div>

        <div class="bold" style="font-size: 11px; margin-bottom: 5px;">
          Pesos / money count:
        </div>

        ${rowsHtml}

        <div class="divider"></div>

        <div class="row" style="font-size: 12px; font-weight: bold;">
          <span>TOTAL COUNT:</span>
          <span>${
            hasCounts
              ? `₱${totalCounted.toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}`
              : '₱____________'
          }</span>
        </div>
        <div class="row" style="font-size: 10px; color: #333;">
          <span>Expected Cash on Hand:</span>
          <span>₱${expectedCashOnHand.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}</span>
        </div>
        ${
          hasCounts
            ? `
        <div class="row" style="font-size: 10px; font-weight: bold; margin-top: 2px;">
          <span>Variance:</span>
          <span>${
            Math.abs(cashVariance) < 0.01
              ? '✔ BALANCED (₱0.00)'
              : cashVariance > 0
              ? `▲ OVER (+₱${cashVariance.toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })})`
              : `▼ SHORT (-₱${Math.abs(cashVariance).toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })})`
          }</span>
        </div>
        `
            : ''
        }

        ${(() => {
          const expenseList = summary?.expenses ?? [];
          const totalExp = summary?.totalExpenses ?? 0;
          const MAX_EXPENSE_ROWS = 6;

          const expRows = Array.from({ length: MAX_EXPENSE_ROWS })
            .map((_, idx) => {
              const exp = expenseList[idx];
              if (exp) {
                return `
            <div style="display: flex; justify-content: space-between; align-items: baseline; font-size: 10px; margin: 2px 0;">
              <span style="width: 14px; color: #555;">${idx + 1}.</span>
              <span style="flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 135px; margin-right: 4px;">${exp.description}</span>
              <span style="font-weight: bold; white-space: nowrap; text-align: right;">- ₱${Number(exp.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>`;
              } else {
                return `
            <div style="display: flex; justify-content: space-between; align-items: baseline; font-size: 10px; margin: 3px 0;">
              <span style="width: 14px; color: #777;">${idx + 1}.</span>
              <span style="flex: 1; border-bottom: 1px dotted #888; margin: 0 4px;">&nbsp;</span>
              <span style="font-weight: bold; width: 75px; text-align: right; border-bottom: 1px dotted #888;">₱__________</span>
            </div>`;
              }
            })
            .join('');

          return `
          <div class="divider"></div>
          <div class="bold" style="font-size: 10px; margin-bottom: 4px;">OPERATING EXPENSES SUMMARY:</div>
          ${expRows}
          <div style="display: flex; justify-content: space-between; font-size: 10px; font-weight: bold; margin-top: 4px; border-top: 1px dotted #888; padding-top: 3px;">
            <span>Total Expenses:</span>
            <span>${
              totalExp > 0
                ? `- ₱${totalExp.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : '₱____________'
            }</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 10px; font-weight: bold; margin-top: 2px;">
            <span>Net Cash After Expenses:</span>
            <span>₱${Math.max(0, expectedCashOnHand).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          `;
        })()}

        <div class="double-divider"></div>

        <div style="margin-top: 16px;">
          <div style="display: flex; justify-content: space-between; font-size: 9px; margin-bottom: 2px;">
            <span>Cashier Signature:</span>
            <span>Checked By Signature:</span>
          </div>
          <div style="display: flex; justify-content: space-between; margin-top: 16px;">
            <span>___________________</span>
            <span>___________________</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 8px; color: #555; margin-top: 2px;">
            <span>${cashierName}</span>
            <span>${checkedByName}</span>
          </div>
        </div>

        <div class="center" style="font-size: 8px; margin-top: 14px; color: #666;">
          Generated ${new Date().toLocaleString()} • Sedona Court PMS
        </div>
      </body>
      </html>
    `;
  };

  const handlePrintMoneyCount = async () => {
    setIsPrintingMoneyCount(true);
    try {
      const htmlContent = generateMoneyCountReceiptHtml();
      const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI?.isElectron;

      if (isElectron && (window as any).electronAPI?.printReceiptSilent) {
        const savedPrinter = localStorage.getItem('scti_hw_receipt_printer') || undefined;
        const savedDensity = (localStorage.getItem('scti_hw_print_density') as 'normal' | 'high' | 'ultra') || 'high';

        const res = await (window as any).electronAPI.printReceiptSilent({
          html: htmlContent,
          deviceName: savedPrinter,
          density: savedDensity,
          kickDrawer: false,
        });

        if (res.success) {
          toast.success(
            'Thermal Print Dispatched',
            `Money Count slip sent to ${savedPrinter ? savedPrinter : 'thermal printer'}`
          );
        } else {
          toast.warning('Printer Notice', res.error || 'Silent printing unavailable, opening print dialog');
          printViaIframe(htmlContent);
        }
      } else {
        printViaIframe(htmlContent);
      }
    } catch (err: any) {
      console.error('Failed to print money count:', err);
      toast.error('Print Error', err.message || 'Could not print money count slip.');
    } finally {
      setIsPrintingMoneyCount(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Header & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-3xl border border-secondary shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <Wallet size={22} />
            </div>
            <div>
              <h2 className="font-display font-black text-xl text-charcoal tracking-tight">
                Cashier End-of-Shift Settlement
              </h2>
              <p className="text-xs text-charcoal/60 mt-0.5">
                Record operating expenses, reconcile GCash collections, and verify physical cash on hand for shift turnover.
              </p>
            </div>
          </div>
        </div>

        {/* Shift Filter Toolbar */}
        <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
          <button
            type="button"
            onClick={() => setIsAutoShift(true)}
            className={`px-3 py-2 rounded-xl border transition cursor-pointer flex items-center gap-1.5 ${
              isAutoShift
                ? 'bg-primary text-white border-primary font-bold shadow-xs'
                : 'bg-cream/40 border-secondary text-charcoal hover:bg-cream'
            }`}
          >
            <Clock size={13} />
            <span>Current Live Shift</span>
          </button>

          <input
            type="date"
            value={selectedDate}
            onChange={(e) => {
              setSelectedDate(e.target.value);
              setIsAutoShift(false);
            }}
            className="px-3 py-1.5 bg-cream/30 border border-secondary rounded-xl text-xs outline-none focus:border-primary"
          />

          <button
            type="button"
            onClick={handlePrintMoneyCount}
            disabled={isPrintingMoneyCount}
            className="px-3 py-2 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white transition cursor-pointer flex items-center gap-1.5 font-bold shadow-xs disabled:opacity-50"
            title="Print Denominations Money Count on 80mm Thermal Printer"
          >
            {isPrintingMoneyCount ? (
              <RefreshCw size={13} className="animate-spin" />
            ) : (
              <Coins size={13} />
            )}
            <span>Print Money Count</span>
          </button>

          <button
            type="button"
            onClick={() => handleExportShiftForms('both')}
            disabled={exportingForms}
            className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white transition cursor-pointer flex items-center gap-1.5 font-bold shadow-xs disabled:opacity-50"
            title="Download printable Cashier Transaction + Shift Transfer forms for this shift (new)"
          >
            {exportingForms ? (
              <RefreshCw size={13} className="animate-spin" />
            ) : (
              <Download size={13} />
            )}
            <span>Shift Forms (New)</span>
          </button>

          <button
            type="button"
            onClick={() => handleExportShiftForms('transfer')}
            disabled={exportingForms}
            className="px-3 py-2 rounded-xl bg-white hover:bg-cream/60 border border-slate-400 text-slate-800 transition cursor-pointer flex items-center gap-1.5 font-bold shadow-xs disabled:opacity-50"
            title="Download only the Shift Transfer Form handoff slip for this shift (new)"
          >
            <Download size={13} />
            <span>Transfer Form</span>
          </button>
        </div>
      </div>

      {/* Main KPI Cards: Cash Formula */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Total Income */}
        <div className="bg-white p-5 rounded-3xl border border-secondary shadow-xs space-y-2">
          <div className="flex justify-between items-center text-[11px] font-mono font-bold uppercase text-charcoal/50">
            <span>Total Income (Gross)</span>
            <ReceiptIcon size={16} className="text-primary" />
          </div>
          <div className="font-display font-black text-2xl text-charcoal">
            ₱{(summary?.totalIncome || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <p className="text-[10px] font-mono text-charcoal/50">
            {summary?.receiptCount || 0} receipt(s) in {summary?.shiftType} shift
          </p>
        </div>

        {/* Less: GCash */}
        <div className="bg-white p-5 rounded-3xl border border-blue-200/80 shadow-xs space-y-2">
          <div className="flex justify-between items-center text-[11px] font-mono font-bold uppercase text-blue-700">
            <span>Less: GCash Collections</span>
            <ArrowDownRight size={16} className="text-blue-600" />
          </div>
          <div className="font-display font-black text-2xl text-blue-900">
            -₱{(summary?.totalGcash || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <p className="text-[10px] font-mono text-blue-600/70">
            Digital payments (not in physical cash drawer)
          </p>
        </div>

        {/* Less: Expenses */}
        <div className="bg-white p-5 rounded-3xl border border-amber-200/80 shadow-xs space-y-2">
          <div className="flex justify-between items-center text-[11px] font-mono font-bold uppercase text-amber-800">
            <span>Less: Operating Expenses</span>
            <ArrowDownRight size={16} className="text-amber-600" />
          </div>
          <div className="font-display font-black text-2xl text-amber-900">
            -₱{(summary?.totalExpenses || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <p className="text-[10px] font-mono text-amber-700/70">
            {summary?.expenses?.length || 0} expense line item(s)
          </p>
        </div>

        {/* Cash on Hand (Handover Amount) */}
        <div className="bg-emerald-800 text-white p-5 rounded-3xl border border-emerald-900 shadow-md space-y-2 relative overflow-hidden">
          <div className="absolute right-0 top-0 w-24 h-24 bg-white/10 rounded-full blur-xl pointer-events-none" />
          <div className="flex justify-between items-center text-[11px] font-mono font-bold uppercase text-emerald-200">
            <span>Expected Cash on Hand</span>
            <Wallet size={18} className="text-emerald-300" />
          </div>
          <div className="font-display font-black text-2xl text-white tracking-tight">
            ₱{(summary?.expectedCashOnHand || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] font-mono text-emerald-200/90 space-y-0.5 pt-1.5 border-t border-emerald-700/60">
            <div className="flex justify-between">
              <span>Cash Tendered:</span>
              <span className="font-bold">₱{(summary?.totalCashTendered || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between">
              <span>Change Given:</span>
              <span className="font-bold">-₱{(summary?.totalChangeGiven || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between font-bold text-white pt-0.5 border-t border-emerald-700/40">
              <span>Net Cash Received:</span>
              <span>₱{(summary?.totalCashReceived || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Two Column Layout: Operating Expenses & Money Count (Left) + Handover Slip (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2 spans): Expenses Entry, Table & Denomination Breakdown */}
        <div className="lg:col-span-2 space-y-6">
          {/* Physical Cash Money Count Card */}
          <div className="bg-white p-6 rounded-3xl border border-secondary shadow-xs space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-secondary/60">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200">
                  <Coins size={20} />
                </div>
                <div>
                  <h3 className="font-display font-black text-base text-charcoal flex items-center gap-2">
                    <span>Physical Cash Breakdown (Money Count)</span>
                  </h3>
                  <p className="text-xs text-charcoal/60 mt-0.5">
                    Enter the count of each bill/coin to calculate actual cash on hand or print a printable thermal count sheet.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleClearCounts}
                  disabled={!hasCounts && !checkedBy}
                  className="px-3 py-1.5 rounded-xl border border-secondary text-charcoal/60 hover:text-charcoal hover:bg-cream/50 text-xs font-mono font-bold transition cursor-pointer flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Clear all counts"
                >
                  <RotateCcw size={12} />
                  <span>Clear</span>
                </button>
                <button
                  type="button"
                  onClick={handlePrintMoneyCount}
                  disabled={isPrintingMoneyCount}
                  className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-mono font-bold transition cursor-pointer flex items-center gap-1.5 shadow-xs disabled:opacity-50"
                >
                  {isPrintingMoneyCount ? (
                    <RefreshCw size={13} className="animate-spin" />
                  ) : (
                    <Coins size={13} />
                  )}
                  <span>Print Money Count (Thermal)</span>
                </button>
              </div>
            </div>

            {/* Denomination Inputs Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {DENOM_CONFIGS.map((config) => {
                const countVal = counts[config.value] || '';
                const qtyNum = parseInt(countVal, 10) || 0;
                const subtotal = config.value * qtyNum;

                return (
                  <div
                    key={config.value}
                    className={`p-3 rounded-2xl border transition-all ${
                      qtyNum > 0
                        ? 'bg-cream/40 border-primary/40 shadow-xs'
                        : 'bg-cream/10 border-secondary/70 hover:border-secondary'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span
                        className={`text-[11px] font-mono font-black px-2.5 py-0.5 rounded-lg border ${config.badgeClass}`}
                      >
                        {config.label}
                      </span>
                      <span className="text-[10px] font-mono uppercase text-charcoal/40 font-bold">
                        {config.type}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold text-charcoal/60">x</span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        placeholder="0"
                        value={countVal}
                        onChange={(e) => handleCountChange(config.value, e.target.value)}
                        className="w-full px-3 py-1.5 bg-white border border-secondary rounded-xl text-sm font-mono font-black text-charcoal outline-none focus:border-primary focus:ring-1 focus:ring-primary text-center"
                      />
                    </div>

                    <div className="mt-2 pt-1.5 border-t border-secondary/40 flex justify-between items-center text-[11px] font-mono">
                      <span className="text-charcoal/50">Subtotal:</span>
                      <span
                        className={`font-bold ${
                          qtyNum > 0 ? 'text-charcoal' : 'text-charcoal/40'
                        }`}
                      >
                        ₱{subtotal.toLocaleString('en-US', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Reconciliation Summary Bar */}
            <div className="p-4 rounded-2xl bg-cream/30 border border-secondary/80 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="text-[10px] font-mono uppercase font-bold text-charcoal/60">
                  Cash Count Reconciliation
                </div>
                <div className="flex flex-wrap items-center gap-4 text-xs font-mono">
                  <div>
                    <span className="text-charcoal/50">Total Counted: </span>
                    <span className="font-display font-black text-sm text-charcoal">
                      ₱{totalCounted.toLocaleString('en-US', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                  <div>
                    <span className="text-charcoal/50">Expected: </span>
                    <span className="font-bold text-charcoal">
                      ₱{expectedCashOnHand.toLocaleString('en-US', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                </div>
              </div>

              {/* Status Badge */}
              <div className="flex items-center gap-3">
                {hasCounts ? (
                  Math.abs(cashVariance) < 0.01 ? (
                    <div className="px-3.5 py-1.5 rounded-xl bg-emerald-100 text-emerald-900 border border-emerald-300 font-mono text-xs font-black flex items-center gap-1.5 shadow-2xs">
                      <CheckCircle2 size={15} className="text-emerald-700" />
                      <span>BALANCED (₱0.00)</span>
                    </div>
                  ) : cashVariance > 0 ? (
                    <div className="px-3.5 py-1.5 rounded-xl bg-blue-100 text-blue-900 border border-blue-300 font-mono text-xs font-black flex items-center gap-1.5 shadow-2xs">
                      <AlertCircle size={15} className="text-blue-700" />
                      <span>
                        OVER (+₱{cashVariance.toLocaleString('en-US', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })})
                      </span>
                    </div>
                  ) : (
                    <div className="px-3.5 py-1.5 rounded-xl bg-rose-100 text-rose-900 border border-rose-300 font-mono text-xs font-black flex items-center gap-1.5 shadow-2xs">
                      <AlertCircle size={15} className="text-rose-700" />
                      <span>
                        SHORT (-₱{Math.abs(cashVariance).toLocaleString('en-US', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })})
                      </span>
                    </div>
                  )
                ) : (
                  <div className="px-3 py-1.5 rounded-xl bg-stone-100 text-stone-600 border border-stone-300 font-mono text-xs font-medium italic">
                    Blank Template Mode (Fill or print for manual writing)
                  </div>
                )}
              </div>
            </div>

            {/* Supervisor / Checked By Field */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <label className="text-[11px] font-mono uppercase tracking-wider text-charcoal/60 font-bold block mb-1">
                  Shift Cashier (Logged in)
                </label>
                <div className="px-3.5 py-2 bg-cream/30 border border-secondary rounded-xl text-xs font-mono font-bold text-charcoal">
                  {activeCashier || 'Cashier On Duty'}
                </div>
              </div>

              <div>
                <label className="text-[11px] font-mono uppercase tracking-wider text-charcoal/60 font-bold block mb-1">
                  Checked By (Supervisor / Next Cashier)
                </label>
                <input
                  type="text"
                  value={checkedBy}
                  onChange={(e) => setCheckedBy(e.target.value)}
                  placeholder="e.g. Supervisor Name / Incoming Cashier"
                  className="w-full px-3.5 py-2 bg-white border border-secondary rounded-xl text-xs font-mono text-charcoal outline-none focus:border-primary"
                />
              </div>
            </div>
          </div>

          {/* Add Operating Expense Card */}
          <div className="bg-white p-6 rounded-3xl border border-secondary shadow-xs space-y-4">
            <h3 className="font-display font-extrabold text-base text-charcoal flex items-center gap-2">
              <Plus size={18} className="text-primary" />
              <span>Record Operating Expense for Current Shift</span>
            </h3>

            {/* Presets quick tags */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-mono uppercase tracking-wider text-charcoal/50 font-bold block">
                Quick Presets
              </label>
              <div className="flex flex-wrap gap-1.5">
                {COMMON_EXPENSE_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setExpenseDesc(preset)}
                    className="text-[11px] font-mono px-2.5 py-1 rounded-lg bg-cream border border-secondary/60 text-charcoal/70 hover:text-primary hover:border-primary hover:bg-cream/70 transition cursor-pointer"
                  >
                    + {preset}
                  </button>
                ))}
              </div>
            </div>

            {/* Entry Form */}
            <form onSubmit={handleAddExpense} className="grid grid-cols-1 sm:grid-cols-12 gap-3 pt-2">
              <div className="sm:col-span-7">
                <label className="text-[11px] font-mono uppercase tracking-wider text-charcoal/60 font-bold block mb-1">
                  Expense Description
                </label>
                <input
                  type="text"
                  value={expenseDesc}
                  onChange={(e) => setExpenseDesc(e.target.value)}
                  placeholder="e.g. 2 Bottles Wilkins 5 Gallon"
                  className="w-full px-3.5 py-2.5 bg-cream/10 border border-secondary rounded-xl text-xs outline-none focus:border-primary text-charcoal"
                />
              </div>

              <div className="sm:col-span-3">
                <label className="text-[11px] font-mono uppercase tracking-wider text-charcoal/60 font-bold block mb-1">
                  Amount (₱ PHP)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={expenseAmount}
                  onChange={(e) => setExpenseAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-3.5 py-2.5 bg-cream/10 border border-secondary rounded-xl text-xs font-mono font-bold outline-none focus:border-primary text-charcoal"
                />
              </div>

              <div className="sm:col-span-2 flex items-end">
                <button
                  type="submit"
                  disabled={saving || !expenseDesc || !expenseAmount}
                  className="w-full bg-primary hover:bg-primary-light text-white font-sans text-xs font-bold py-2.5 rounded-xl transition cursor-pointer shadow-xs disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
                >
                  <Plus size={14} />
                  <span>{saving ? 'Adding...' : 'Add'}</span>
                </button>
              </div>
            </form>
          </div>

          {/* Expenses Table */}
          <div className="bg-white p-6 rounded-3xl border border-secondary shadow-xs space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="font-display font-extrabold text-base text-charcoal">
                  Operating Expenses Recorded
                </h3>
                <p className="text-xs text-charcoal/50">
                  {summary?.shiftDate} • {summary?.shiftType} Shift
                </p>
              </div>
              <div className="font-mono text-xs font-bold text-amber-900 bg-amber-50 border border-amber-200 px-3 py-1 rounded-xl">
                Subtotal: ₱{(summary?.totalExpenses || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>

            {summary?.expenses && summary.expenses.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-secondary text-charcoal/50 uppercase text-[10px]">
                      <th className="py-2.5 px-3">Description</th>
                      <th className="py-2.5 px-3">Recorded By</th>
                      <th className="py-2.5 px-3 text-right">Amount (PHP)</th>
                      <th className="py-2.5 px-3 text-center w-16">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-secondary/40">
                    {summary.expenses.map((exp) => (
                      <tr key={exp.id} className="hover:bg-cream/40 transition">
                        <td className="py-3 px-3 font-medium text-charcoal">
                          {exp.description}
                        </td>
                        <td className="py-3 px-3 text-charcoal/60 text-[11px]">
                          {exp.cashierId}
                        </td>
                        <td className="py-3 px-3 text-right font-bold text-charcoal">
                          ₱{exp.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="py-3 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => handleDeleteExpense(exp)}
                            className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                            title="Delete Expense"
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-8 text-charcoal/40 font-mono text-xs italic bg-cream/20 rounded-2xl border border-dashed border-secondary/60">
                No operating expenses recorded for this shift yet.
              </div>
            )}
          </div>

          {/* Room Transfers Recorded Table */}
          <div className="bg-white p-6 rounded-3xl border border-secondary shadow-xs space-y-4">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-indigo-50 text-indigo-800 border border-indigo-200">
                  <ArrowRightLeft size={18} />
                </div>
                <div>
                  <h3 className="font-display font-extrabold text-base text-charcoal">
                    Room Transfers & Relocations
                  </h3>
                  <p className="text-xs text-charcoal/50">
                    Audited guest relocations recorded on {summary?.shiftDate || selectedDate}
                  </p>
                </div>
              </div>
              <div className="font-mono text-xs font-bold text-indigo-900 bg-indigo-50 border border-indigo-200 px-3 py-1 rounded-xl">
                {shiftTransfers.length} Relocation{shiftTransfers.length === 1 ? '' : 's'}
              </div>
            </div>

            {shiftTransfers.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-secondary text-charcoal/50 uppercase text-[10px]">
                      <th className="py-2.5 px-3">Time</th>
                      <th className="py-2.5 px-3">Transfer Path</th>
                      <th className="py-2.5 px-3">Guest</th>
                      <th className="py-2.5 px-3">Reason & Notes</th>
                      <th className="py-2.5 px-3 text-right">Cashier</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-secondary/40">
                    {shiftTransfers.map((tx) => (
                      <tr key={tx.id} className="hover:bg-indigo-50/30 transition">
                        <td className="py-3 px-3 text-charcoal/70 text-[11px] whitespace-nowrap">
                          {new Date(tx.transferred_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-1.5 font-bold">
                            <span className="px-2 py-0.5 rounded bg-rose-50 border border-rose-200 text-rose-800">
                              Room {tx.source_room_number}
                            </span>
                            <ArrowRight size={12} className="text-indigo-600 shrink-0" />
                            <span className="px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800">
                              Room {tx.target_room_number}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-3 text-charcoal font-medium">
                          {tx.guest_name || 'Anonymous Guest'}
                        </td>
                        <td className="py-3 px-3">
                          <span className="inline-block px-2 py-0.5 rounded bg-cream border border-secondary/60 text-charcoal font-bold text-[10px] uppercase mr-1.5">
                            {tx.reason}
                          </span>
                          {tx.notes && (
                            <span className="text-[11px] text-charcoal/60 italic">
                              "{tx.notes}"
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right font-medium text-charcoal/70 text-[11px]">
                          {tx.transferred_by}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-7 text-charcoal/40 font-mono text-xs italic bg-cream/20 rounded-2xl border border-dashed border-secondary/60">
                No room relocations recorded for this date.
              </div>
            )}
          </div>
        </div>

        {/* Right Column (1 span): Handover Slip Card */}
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-3xl border border-secondary shadow-xs space-y-4" id="printable-shift-settlement">
            <div className="border-b border-secondary/60 pb-3 text-center space-y-1">
              <h4 className="font-display font-black text-sm text-primary uppercase">
                Sedona Court Travellers Inn
              </h4>
              <p className="text-[10px] font-mono text-charcoal/60 uppercase">
                Cashier Shift Handover Slip
              </p>
              <div className="text-[10px] font-mono font-bold text-charcoal/80 pt-1">
                {summary?.shiftDate} • {summary?.shiftType} SHIFT
              </div>
            </div>

            {/* Formula Breakdown */}
            <div className="space-y-2.5 font-mono text-xs pt-1">
              <div className="flex justify-between items-center text-charcoal/80">
                <span>Total Income (Receipts):</span>
                <span className="font-bold text-charcoal">
                  ₱{(summary?.totalIncome || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>

              <div className="flex justify-between items-center text-blue-700">
                <span>Less: GCash Collections:</span>
                <span className="font-bold">
                  -₱{(summary?.totalGcash || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>

              <div className="flex justify-between items-center text-amber-800">
                <span>Less: Operating Expenses:</span>
                <span className="font-bold">
                  -₱{(summary?.totalExpenses || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>

              <div className="border-t-2 border-dashed border-charcoal/30 pt-3 flex justify-between items-center font-bold text-sm text-primary">
                <span>Expected Cash on Hand:</span>
                <span className="font-display font-black text-base">
                  ₱{(summary?.expectedCashOnHand || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>

              {/* Physical Cash Count Breakdown in Slip if entered */}
              {hasCounts && (
                <div className="p-3 bg-cream/40 rounded-xl border border-secondary/70 space-y-1.5 mt-2">
                  <div className="flex justify-between items-center text-charcoal">
                    <span className="text-[11px] font-bold">Physical Counted:</span>
                    <span className="font-bold">
                      ₱{totalCounted.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-[10px]">
                    <span className="text-charcoal/60">Discrepancy:</span>
                    <span
                      className={`font-black ${
                        Math.abs(cashVariance) < 0.01
                          ? 'text-emerald-700'
                          : cashVariance > 0
                          ? 'text-blue-700'
                          : 'text-rose-700'
                      }`}
                    >
                      {Math.abs(cashVariance) < 0.01
                        ? 'BALANCED'
                        : cashVariance > 0
                        ? `OVER +₱${cashVariance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : `SHORT -₱${Math.abs(cashVariance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                    </span>
                  </div>
                </div>
              )}

              {/* Room Transfers Audit Note in Handover Slip */}
              {shiftTransfers.length > 0 && (
                <div className="p-2.5 bg-indigo-50/80 rounded-xl border border-indigo-200/80 text-[11px] font-mono text-indigo-950 flex items-center justify-between">
                  <span className="font-bold flex items-center gap-1.5">
                    <ArrowRightLeft size={13} className="text-indigo-600" />
                    Room Transfers:
                  </span>
                  <span className="font-black px-2 py-0.5 rounded-md bg-indigo-200/90 text-indigo-900 text-[10px]">
                    {shiftTransfers.length} relocation{shiftTransfers.length === 1 ? '' : 's'}
                  </span>
                </div>
              )}
            </div>

            {/* Handover Signature Sign-off Box */}
            <div className="border-t border-secondary/50 pt-4 space-y-4 text-[10px] font-mono">
              <div className="space-y-1">
                <span className="text-charcoal/50 uppercase font-bold block">Outgoing Cashier:</span>
                <div className="border-b border-charcoal/40 pb-1 font-bold text-charcoal flex justify-between">
                  <span>{activeCashier || 'Outgoing Cashier'}</span>
                  <span className="text-charcoal/40">(Signature)</span>
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-charcoal/50 uppercase font-bold block">Incoming Cashier (Verified Cash):</span>
                <div className="border-b border-charcoal/40 pb-1 font-bold text-charcoal flex justify-between">
                  <span>{checkedBy || '______________________'}</span>
                  <span className="text-charcoal/40">(Signature)</span>
                </div>
              </div>

              <div className="text-[9px] text-charcoal/50 italic text-center pt-2">
                Generated {new Date().toLocaleString()} • Sedona Court PMS
              </div>
            </div>

            <div className="space-y-2 pt-2">
              <button
                type="button"
                onClick={handlePrintMoneyCount}
                disabled={isPrintingMoneyCount}
                className="w-full py-2.5 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white font-mono text-xs font-bold transition cursor-pointer flex items-center justify-center gap-1.5 shadow-xs disabled:opacity-50"
              >
                {isPrintingMoneyCount ? (
                  <RefreshCw size={13} className="animate-spin" />
                ) : (
                  <Coins size={13} />
                )}
                <span>Print Money Count (Thermal 80mm)</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
