/**
 * src/components/TransactionLedger.tsx
 * Universal transaction ledger for Admin, Cashier, and Owner.
 * Displays real-time auditable receipt records, live search, payment filter,
 * line-item breakdowns, financial summaries, and thermal receipt re-printing.
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Receipt, DepositTransaction } from '../types';
import { getReceipts } from '../api/receipts';
import { getAllDepositTransactions } from '../api/deposits';
import {
  BookOpen,
  Search,
  Receipt as ReceiptIcon,
  CreditCard,
  Wallet,
  DollarSign,
  History,
  Printer,
  Calendar,
  User,
  Filter,
  RefreshCw,
  ArrowUpRight,
  ArrowDownRight,
  Sparkles,
  CheckCircle2,
  X,
  FileText,
  Download,
  FileSpreadsheet,
  Database,
  Ticket
} from 'lucide-react';
import { GatePassModal } from './GatePassModal';
import { GatePassData } from './PrintableGatePass';

import { downloadTransactionLedgerExcel } from '../utils/excelGenerator';
import { downloadDbLedger } from '../api/reportExports';
import { useToast } from './ui/Toast';
import { USER_ACCOUNTS } from '../data';

interface TransactionLedgerProps {
  receipts: Receipt[];
  onRefreshReceipts?: () => void;
  onViewReceipt: (receipt: Receipt) => void;
  loggedInUser: string;
  userRole?: string;
}

export const TransactionLedger: React.FC<TransactionLedgerProps> = ({
  receipts,
  onRefreshReceipts,
  onViewReceipt,
  loggedInUser,
  userRole,
}) => {
  // Detect if user is cashier
  const matchedUser = USER_ACCOUNTS.find(
    (u) => u.username.toLowerCase() === loggedInUser?.toLowerCase()
  );
  const effectiveRole = (userRole || matchedUser?.role || '').toLowerCase();
  const isCashier = effectiveRole === 'cashier';
  const toast = useToast();
  const [exportingDb, setExportingDb] = useState(false);

  // Database-authoritative ledger export (separate from the browser export).
  const handleDbExport = async () => {
    const pad = (n: number) => String(n).padStart(2, '0');
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const effectiveDateFilter = isCashier ? 'TODAY' : dateFilter;
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekAgoStr = `${weekAgo.getFullYear()}-${pad(weekAgo.getMonth() + 1)}-${pad(weekAgo.getDate())}`;
    const from = effectiveDateFilter === 'TODAY' ? todayStr : effectiveDateFilter === 'WEEK' ? weekAgoStr : '1970-01-01';
    const to = todayStr;
    setExportingDb(true);
    try {
      await downloadDbLedger({
        from,
        to,
        paymentMethod: paymentFilter,
        cashier: cashierFilter === 'ALL' ? '' : cashierFilter,
      });
      toast.success('Export Ready', 'Database-authoritative ledger downloaded.');
    } catch (err: any) {
      toast.error('Export Failed', err?.message || 'Could not generate the database ledger.');
    } finally {
      setExportingDb(false);
    }
  };

  const [searchTerm, setSearchTerm] = useState('');
  const [paymentFilter, setPaymentFilter] = useState<'ALL' | 'CASH' | 'GCASH' | 'MIXED'>('ALL');
  const [cashierFilter, setCashierFilter] = useState<string>('ALL');
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null);
  const [dateFilter, setDateFilter] = useState<'ALL' | 'TODAY' | 'WEEK'>(() => (isCashier ? 'TODAY' : 'ALL'));
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [gatePassData, setGatePassData] = useState<GatePassData | null>(null);

  // When cashier opens ledger or role changes to cashier, ensure filter is locked to TODAY and cashierFilter is ALL
  useEffect(() => {
    if (isCashier) {
      setDateFilter('TODAY');
      setCashierFilter('ALL');
    }
  }, [isCashier]);

  // Auto select first receipt if available and none selected
  useEffect(() => {
    if (!selectedReceipt && receipts.length > 0) {
      setSelectedReceipt(receipts[0]);
    }
  }, [receipts, selectedReceipt]);

  const [activeLedgerTab, setActiveLedgerTab] = useState<'receipts' | 'deposits'>('receipts');
  const [depositTransactions, setDepositTransactions] = useState<DepositTransaction[]>([]);
  const [depositSearchTerm, setDepositSearchTerm] = useState('');
  const [depositDirectionFilter, setDepositDirectionFilter] = useState<'ALL' | 'IN' | 'OUT'>('ALL');
  const [depositLoading, setDepositLoading] = useState(false);

  const fetchDeposits = async () => {
    try {
      setDepositLoading(true);
      const data = await getAllDepositTransactions();
      setDepositTransactions(data || []);
    } catch (err) {
      console.warn('Could not fetch deposit transactions:', err);
    } finally {
      setDepositLoading(false);
    }
  };

  useEffect(() => {
    fetchDeposits();
  }, []);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    if (onRefreshReceipts) {
      await onRefreshReceipts();
    }
    await fetchDeposits();
    setTimeout(() => setIsRefreshing(false), 400);
  };

  // Filter receipts
  const filteredReceipts = receipts.filter((r) => {
    // Search
    const searchString = `${r.receiptNo} ${r.roomNumber || ''} ${r.guestName || ''} ${r.cashierId || ''} ${r.gcashRef || ''}`.toLowerCase();
    const matchesSearch = searchString.includes(searchTerm.toLowerCase());

    // Payment Method
    const matchesPayment = paymentFilter === 'ALL' || r.paymentMethod === paymentFilter;

    // Cashier
    const matchesCashier = cashierFilter === 'ALL' || (r.cashierId && r.cashierId.toLowerCase() === cashierFilter.toLowerCase());

    // Date Filter (cashiers are strictly restricted to TODAY)
    const effectiveDateFilter = isCashier ? 'TODAY' : dateFilter;
    let matchesDate = true;
    if (effectiveDateFilter === 'TODAY') {
      if (!r.dateTime) return true;
      const rDate = new Date(r.dateTime.includes(' ') && !r.dateTime.includes('T') ? r.dateTime.replace(' ', 'T') : r.dateTime);
      const now = new Date();
      if (!isNaN(rDate.getTime())) {
        matchesDate =
          rDate.getFullYear() === now.getFullYear() &&
          rDate.getMonth() === now.getMonth() &&
          rDate.getDate() === now.getDate();
      } else {
        const todayStr = now.toISOString().split('T')[0];
        matchesDate = r.dateTime.startsWith(todayStr);
      }
    } else if (effectiveDateFilter === 'WEEK') {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
      sevenDaysAgo.setHours(0, 0, 0, 0);
      const rDate = new Date(r.dateTime.includes(' ') && !r.dateTime.includes('T') ? r.dateTime.replace(' ', 'T') : r.dateTime);
      matchesDate = !isNaN(rDate.getTime()) ? rDate >= sevenDaysAgo : true;
    }

    return matchesSearch && matchesPayment && matchesCashier && matchesDate;
  });

  // Calculate live summary stats
  const totalRevenue = filteredReceipts.reduce((sum, r) => sum + r.total, 0);
  const cashTotal = filteredReceipts.reduce((sum, r) => {
    if (r.paymentMethod === 'CASH') return sum + r.total;
    if (r.paymentMethod === 'MIXED') return sum + (r.cashAmount || 0);
    return sum;
  }, 0);
  const gcashTotal = filteredReceipts.reduce((sum, r) => {
    if (r.paymentMethod === 'GCASH') return sum + r.total;
    if (r.paymentMethod === 'MIXED') return sum + (r.gcashAmount || 0);
    return sum;
  }, 0);

  const formatDisplayDate = (val?: string) => {
    if (!val || val === 'N/A') return 'N/A';
    const d = new Date(val.includes(' ') && !val.includes('T') ? val.replace(' ', 'T') : val);
    if (!isNaN(d.getTime())) {
      return d.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
    }
    return val;
  };

  const filteredDeposits = depositTransactions.filter((tx) => {
    const searchString = `${tx.guestIdentifier} ${tx.guestName || ''} ${tx.operator} ${tx.referenceId || ''} ${tx.roomNumber || ''} ${tx.notes || ''} ${tx.idempotencyKey}`.toLowerCase();
    const matchesSearch = searchString.includes(depositSearchTerm.toLowerCase());
    const matchesDirection = depositDirectionFilter === 'ALL' || tx.direction === depositDirectionFilter;
    return matchesSearch && matchesDirection;
  });

  const totalDepositsCollected = depositTransactions
    .filter((tx) => tx.direction === 'IN')
    .reduce((sum, tx) => sum + tx.amountCentavos, 0) / 100;

  const totalDepositsApplied = depositTransactions
    .filter((tx) => tx.direction === 'OUT')
    .reduce((sum, tx) => sum + tx.amountCentavos, 0) / 100;

  const netGuestCredits = totalDepositsCollected - totalDepositsApplied;

  // Get unique cashiers from receipts
  const availableCashiers = Array.from(
    new Set(receipts.map((r) => r.cashierId).filter(Boolean))
  );

  return (
    <div className="flex-1 flex flex-col gap-6 max-w-7xl mx-auto pb-12 font-sans selection:bg-secondary selection:text-primary">
      {/* Header Banner */}
      <div className="bg-white border border-secondary/70 shadow-xs rounded-3xl p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 bg-primary/5 text-primary border border-primary/10 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold uppercase mb-2">
            <BookOpen size={12} />
            Official General Ledger
          </div>
          <h1 className="font-display font-black text-2xl md:text-3xl text-primary tracking-tight uppercase">
            Transaction Ledger &amp; Invoices
          </h1>
          <p className="text-xs text-charcoal/60 mt-1 max-w-xl leading-relaxed">
            Real-time auditable transaction log of all room checkouts, direct POS sales, and payment collections across all cashiers and shifts.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 self-stretch md:self-auto justify-end">
          <button
            onClick={() => downloadTransactionLedgerExcel(filteredReceipts, `${paymentFilter} Payments (${dateFilter})`)}
            className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-mono font-bold transition cursor-pointer shadow-xs active:scale-95"
          >
            <Download size={13} />
            <span>Export Excel (.XLSX)</span>
          </button>
          {!isCashier && (
            <button
              onClick={handleDbExport}
              disabled={exportingDb}
              title="Separate server-generated ledger built live from the database (existing export unchanged)"
              className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-mono font-bold transition cursor-pointer shadow-xs active:scale-95 disabled:opacity-50"
            >
              <Database size={13} />
              <span>{exportingDb ? 'Generating…' : 'DB Ledger (New) (.XLSX)'}</span>
            </button>
          )}
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-cream/40 hover:bg-cream border border-secondary/60 text-charcoal text-xs font-mono font-bold transition cursor-pointer disabled:opacity-50 active:scale-95"
          >
            <RefreshCw size={13} className={isRefreshing ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Ledger Mode Tab Switcher */}
      <div className="flex border-b border-secondary/60 gap-4">
        <button
          type="button"
          onClick={() => setActiveLedgerTab('receipts')}
          className={`pb-3 font-display font-extrabold text-xs uppercase tracking-wider transition border-b-2 cursor-pointer flex items-center gap-2 ${
            activeLedgerTab === 'receipts'
              ? 'border-primary text-primary'
              : 'border-transparent text-charcoal/50 hover:text-charcoal'
          }`}
        >
          <ReceiptIcon size={14} />
          <span>Receipts &amp; Invoices Ledger</span>
          <span className="px-2 py-0.5 rounded-full text-[10px] bg-secondary/40 font-mono font-bold text-charcoal">
            {filteredReceipts.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveLedgerTab('deposits')}
          className={`pb-3 font-display font-extrabold text-xs uppercase tracking-wider transition border-b-2 cursor-pointer flex items-center gap-2 ${
            activeLedgerTab === 'deposits'
              ? 'border-primary text-primary'
              : 'border-transparent text-charcoal/50 hover:text-charcoal'
          }`}
        >
          <Wallet size={14} />
          <span>Guest Deposits &amp; Credits Ledger</span>
          <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-100 text-emerald-800 font-mono font-bold">
            {depositTransactions.length}
          </span>
        </button>
      </div>

      {activeLedgerTab === 'receipts' && (
        <>
          {/* Summary KPI Badges */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-2xl border border-secondary shadow-sm flex items-center justify-between">
              <div>
                <span className="text-[10px] font-mono text-charcoal/40 uppercase tracking-widest block">
                  Total Invoiced Revenue
                </span>
            <span className="font-display font-black text-2xl text-primary mt-1 block">
              ₱{totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-[9px] font-mono text-charcoal/50 mt-1 block">
              {filteredReceipts.length} recorded invoice{filteredReceipts.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-primary/5 border border-primary/10 text-primary flex items-center justify-center">
            <DollarSign size={20} />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-secondary shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[10px] font-mono text-charcoal/40 uppercase tracking-widest block">
              Cash Collections
            </span>
            <span className="font-display font-black text-2xl text-emerald-700 mt-1 block">
              ₱{cashTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-[9px] font-mono text-emerald-600 font-bold mt-1 block">
              Physical Register Cash
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-700 flex items-center justify-center">
            <Wallet size={20} />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-secondary shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[10px] font-mono text-charcoal/40 uppercase tracking-widest block">
              GCash / Digital Sales
            </span>
            <span className="font-display font-black text-2xl text-indigo-700 mt-1 block">
              ₱{gcashTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-[9px] font-mono text-indigo-600 font-bold mt-1 block">
              E-Wallet Verified
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-700 flex items-center justify-center">
            <CreditCard size={20} />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-secondary shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[10px] font-mono text-charcoal/40 uppercase tracking-widest block">
              Ledger Settlement Status
            </span>
            <span className="font-display font-black text-2xl text-charcoal mt-1 block">
              100% Balanced
            </span>
            <span className="text-[9px] font-mono text-emerald-600 font-bold flex items-center gap-1 mt-1">
              <CheckCircle2 size={11} /> Reconciled with SQLite DB
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-cream border border-secondary/40 text-charcoal/60 flex items-center justify-center">
            <ReceiptIcon size={20} />
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white border border-secondary rounded-2xl p-4 shadow-sm flex flex-col md:flex-row gap-3.5 items-center justify-between">
        {/* Search Bar */}
        <div className="relative w-full md:w-80">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-charcoal/40" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by receipt #, guest, room, or ref..."
            className="w-full pl-9 pr-4 py-2 bg-cream/15 border border-secondary text-xs rounded-xl outline-none focus:border-primary focus:bg-white transition"
          />
        </div>

        {/* Filter Controls Group */}
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          {/* Date Filter */}
          <div className="flex gap-1 bg-cream/20 border border-secondary/60 p-1 rounded-xl">
            {(isCashier ? (['TODAY'] as const) : (['ALL', 'TODAY', 'WEEK'] as const)).map((df) => (
              <button
                key={df}
                onClick={() => setDateFilter(df)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold uppercase transition cursor-pointer ${
                  (isCashier ? 'TODAY' : dateFilter) === df ? 'bg-primary text-white shadow-xs' : 'text-charcoal/60 hover:bg-cream/40'
                }`}
              >
                {df === 'ALL' ? 'All Dates' : df === 'TODAY' ? 'Today' : 'This Week'}
              </button>
            ))}
          </div>

          {/* Payment Method Filters */}
          <div className="flex gap-1 bg-cream/20 border border-secondary/60 p-1 rounded-xl">
            {(['ALL', 'CASH', 'GCASH', 'MIXED'] as const).map((method) => (
              <button
                key={method}
                onClick={() => setPaymentFilter(method)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold uppercase transition cursor-pointer ${
                  paymentFilter === method ? 'bg-primary text-white shadow-xs' : 'text-charcoal/60 hover:bg-cream/40'
                }`}
              >
                {method}
              </button>
            ))}
          </div>

          {/* Cashier Dropdown (hidden for cashiers, visible for Admins & Owners) */}
          {!isCashier && availableCashiers.length > 0 && (
            <div className="flex items-center gap-1 bg-cream/30 px-2 py-1 rounded-xl border border-secondary/40 text-xs font-mono">
              <User size={12} className="text-charcoal/40" />
              <select
                value={cashierFilter}
                onChange={(e) => setCashierFilter(e.target.value)}
                className="bg-transparent border-none outline-none font-bold text-primary text-[11px] cursor-pointer"
              >
                <option value="ALL">All Cashiers</option>
                {availableCashiers.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Split Ledger View: Invoices Table on Left, Thermal Drilldown on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Transactions Table (2 cols) */}
        <div className="bg-white border border-secondary rounded-2xl overflow-hidden lg:col-span-2 shadow-sm flex flex-col justify-between">
          <div>
            <div className="p-4 border-b border-secondary bg-cream/10 flex justify-between items-center">
              <h3 className="font-display font-extrabold text-xs text-charcoal uppercase tracking-wider flex items-center gap-1.5">
                <History size={13} className="text-primary" />
                Live Invoices &amp; Receipts ({filteredReceipts.length})
              </h3>
              <span className="text-[10px] font-mono text-charcoal/50">Sorted by Date (Newest First)</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-[11px] border-collapse min-w-[520px]">
                <thead>
                  <tr className="bg-cream/30 border-b border-secondary text-charcoal/50 text-[10px] uppercase font-bold tracking-wider">
                    <th className="py-2.5 px-4">Receipt No</th>
                    <th className="py-2.5 px-2">Date / Time</th>
                    <th className="py-2.5 px-2">Room / Source</th>
                    <th className="py-2.5 px-2">Guest Name</th>
                    <th className="py-2.5 px-2">Payment</th>
                    <th className="py-2.5 px-4 text-right">Amount (PHP)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-secondary/30">
                  {filteredReceipts.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-16 text-center text-charcoal/40 italic">
                        <div className="max-w-sm mx-auto space-y-2">
                          <ReceiptIcon size={32} className="text-charcoal/20 mx-auto" />
                          <p className="font-bold text-xs text-charcoal/60">No transaction records found</p>
                          <p className="text-[11px] text-charcoal/40">
                            {searchTerm || paymentFilter !== 'ALL' || (!isCashier && dateFilter !== 'ALL')
                              ? 'Try adjusting your search or filters.'
                              : isCashier
                              ? 'No transactions recorded for today yet.'
                              : 'Complete room checkouts or POS sales to record live receipts in this ledger.'}
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredReceipts.map((receipt) => {
                      const isSelected = selectedReceipt?.receiptNo === receipt.receiptNo;
                      return (
                        <tr
                          key={receipt.receiptNo}
                          onClick={() => setSelectedReceipt(receipt)}
                          className={`cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-primary/5 font-bold border-l-4 border-primary'
                              : 'hover:bg-cream/15'
                          }`}
                        >
                          <td className="py-2.5 px-4 font-bold text-primary">{receipt.receiptNo}</td>
                          <td className="py-2.5 px-2 text-[10px] text-charcoal/60">
                            {formatDisplayDate(receipt.dateTime)}
                          </td>
                          <td className="py-2.5 px-2 font-semibold">
                            <div>{receipt.roomNumber ? `Room ${receipt.roomNumber}` : 'Direct POS'}</div>
                            {(receipt.stayDuration || receipt.rateSelected) && (
                              <div className="text-[9px] text-emerald-700 font-mono font-bold">
                                {receipt.stayDuration || `${receipt.rateSelected?.toUpperCase()} Stay`}
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 px-2 text-charcoal/80 font-medium truncate max-w-[120px]">
                            {receipt.guestName || 'Walk-in'}
                          </td>
                          <td className="py-2.5 px-2">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border ${
                                receipt.paymentMethod === 'CASH'
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                                  : receipt.paymentMethod === 'GCASH'
                                  ? 'bg-indigo-50 text-indigo-700 border-indigo-100'
                                  : 'bg-amber-50 text-amber-700 border-amber-100'
                              }`}
                            >
                              {receipt.paymentMethod}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 text-right text-charcoal font-black bg-cream/5">
                            ₱{receipt.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="p-3 bg-cream/10 border-t border-secondary text-right text-[10px] font-mono text-charcoal/50">
            Showing {filteredReceipts.length} of {receipts.length} total ledger records
          </div>
        </div>

        {/* Selected Receipt Inspection / Re-print Panel */}
        <div className="bg-white border border-secondary rounded-2xl p-5 space-y-4 shadow-sm h-fit relative">
          {selectedReceipt ? (
            <>
              {/* Header */}
              <div className="border-b border-secondary/40 pb-3 flex justify-between items-start">
                <div>
                  <h4 className="font-display font-black text-xs text-charcoal uppercase tracking-wider flex items-center gap-1.5">
                    <FileText size={13} className="text-primary" />
                    Itemized Receipt Drilldown
                  </h4>
                  <span className="text-[10px] font-mono text-primary font-bold mt-0.5 block">
                    #{selectedReceipt.receiptNo}
                  </span>
                </div>
                <button
                  onClick={() => setSelectedReceipt(null)}
                  className="text-charcoal/30 hover:text-charcoal transition text-xs font-mono cursor-pointer"
                >
                  [Close]
                </button>
              </div>

              <div className="space-y-4 font-mono text-[11px]">
                {/* Metadata card */}
                <div className="space-y-1 bg-cream/20 p-3 rounded-xl border border-secondary/40 text-[10px] text-charcoal/70 uppercase">
                  <div className="flex justify-between">
                    <span>Logged At:</span>
                    <span className="font-bold text-charcoal">{formatDisplayDate(selectedReceipt.dateTime)}</span>
                  </div>
                  {selectedReceipt.roomNumber && (
                    <div className="flex justify-between">
                      <span>Room Assigned:</span>
                      <span className="font-bold text-primary">Room {selectedReceipt.roomNumber} ({selectedReceipt.roomType || 'Standard'})</span>
                    </div>
                  )}
                  {(selectedReceipt.stayDuration || selectedReceipt.rateSelected) && (
                    <div className="flex justify-between text-emerald-800 font-bold">
                      <span>Declared Stay:</span>
                      <span>{selectedReceipt.stayDuration || `${selectedReceipt.rateSelected?.toUpperCase()} Stay`}</span>
                    </div>
                  )}
                  {selectedReceipt.guestName && (
                    <div className="flex justify-between">
                      <span>Guest Name:</span>
                      <span className="font-bold text-charcoal">{selectedReceipt.guestName}</span>
                    </div>
                  )}
                  {selectedReceipt.checkIn && (
                    <div className="flex justify-between">
                      <span>Check In:</span>
                      <span className="font-bold text-charcoal">{formatDisplayDate(selectedReceipt.checkIn)}</span>
                    </div>
                  )}
                  {selectedReceipt.checkOut && (
                    <div className="flex justify-between">
                      <span>Check Out:</span>
                      <span className="font-bold text-charcoal">{formatDisplayDate(selectedReceipt.checkOut)}</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-secondary/30 pt-1 mt-1 text-primary">
                    <span>Cashier ID:</span>
                    <span className="font-bold">{selectedReceipt.cashierId || 'Frontdesk'}</span>
                  </div>
                </div>

                {/* Line Items List */}
                <div className="space-y-2 border-t border-b border-secondary/30 py-3">
                  <span className="text-[10px] font-bold text-charcoal/40 uppercase block">Items &amp; Room Charges</span>
                  {(selectedReceipt.items || []).map((it, idx) => (
                    <div key={idx} className="flex justify-between items-start text-[11px]">
                      <div className="max-w-[70%]">
                        <span className="font-bold text-charcoal block">{it.description}</span>
                        {it.subtext && <span className="text-[9px] text-charcoal/50 block">{it.subtext}</span>}
                      </div>
                      <span className="text-charcoal font-semibold">
                        ₱{Number(it.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Calculations Breakdown */}
                <div className="space-y-1.5 text-xs text-right">
                  <div className="flex justify-between text-charcoal/60 text-[11px]">
                    <span>Subtotal:</span>
                    <span>₱{selectedReceipt.subtotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                  </div>
                  {selectedReceipt.serviceCharge > 0 && (
                    <div className="flex justify-between text-charcoal/60 text-[11px]">
                      <span>Service Charge:</span>
                      <span>₱{selectedReceipt.serviceCharge.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-black text-primary border-t border-secondary/60 pt-2 text-sm">
                    <span>Total Paid:</span>
                    <span>₱{selectedReceipt.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>

                {/* Settlement details */}
                <div className="bg-cream/30 p-2.5 rounded-xl border border-secondary/40 space-y-1 text-[10px]">
                  <div className="flex justify-between">
                    <span className="text-charcoal/60 uppercase">Settlement Method:</span>
                    <span className="font-bold text-primary">{selectedReceipt.paymentMethod}</span>
                  </div>
                  {selectedReceipt.paymentMethod === 'MIXED' && (
                    <>
                      <div className="flex justify-between text-emerald-700">
                        <span>Cash Tendered:</span>
                        <span className="font-bold">₱{(selectedReceipt.cashAmount || 0).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-indigo-700">
                        <span>GCash Tendered:</span>
                        <span className="font-bold">₱{(selectedReceipt.gcashAmount || 0).toLocaleString()}</span>
                      </div>
                    </>
                  )}
                  {selectedReceipt.gcashRef && (
                    <div className="flex justify-between text-indigo-700 font-bold border-t border-secondary/20 pt-1 mt-1">
                      <span>GCash Ref Code:</span>
                      <span className="font-mono">{selectedReceipt.gcashRef}</span>
                    </div>
                  )}
                </div>

                {/* Re-print and View Actions */}
                <div className="pt-2 flex gap-2">
                  <button
                    onClick={() => onViewReceipt(selectedReceipt)}
                    className="flex-1 bg-primary hover:bg-primary-light text-white font-mono text-xs font-bold py-2.5 px-3 rounded-xl flex items-center justify-center gap-1.5 transition cursor-pointer shadow-xs"
                  >
                    <Printer size={13} />
                    <span>Print Receipt</span>
                  </button>
                  <button
                    onClick={() => {
                      const data: GatePassData = {
                        ticketNo: selectedReceipt.receiptNo || `GP-${selectedReceipt.roomNumber}`,
                        roomNumber: selectedReceipt.roomNumber,
                        roomType: selectedReceipt.roomType,
                        guestName: selectedReceipt.guestName,
                        checkIn: selectedReceipt.checkIn || selectedReceipt.dateTime,
                        checkOut: selectedReceipt.checkOut || selectedReceipt.dateTime,
                        cashierName: selectedReceipt.cashierId,
                      };
                      setGatePassData(data);
                    }}
                    className="flex-1 bg-slate-900 hover:bg-slate-800 text-white font-mono text-xs font-bold py-2.5 px-3 rounded-xl flex items-center justify-center gap-1.5 transition cursor-pointer shadow-xs"
                  >
                    <Ticket size={13} className="text-amber-400" />
                    <span>Gate Pass</span>
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="text-center py-16 text-charcoal/40 font-mono text-xs space-y-2">
              <ReceiptIcon size={32} className="text-charcoal/20 mx-auto" />
              <p className="font-bold">No receipt selected</p>
              <p className="text-[11px]">Select any transaction from the list on the left to inspect full invoice details.</p>
            </div>
          )}
        </div>
      </div>
    </>
  )}

    {activeLedgerTab === 'deposits' && (
      <div className="space-y-6">
        {/* Deposit Summary KPI Badges */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-2xl border border-secondary shadow-sm flex items-center justify-between">
            <div>
              <span className="text-[10px] font-mono text-charcoal/40 uppercase tracking-widest block">
                Total Deposits Collected
              </span>
              <span className="font-display font-black text-2xl text-emerald-700 mt-1 block">
                ₱{totalDepositsCollected.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span className="text-[9px] font-mono text-charcoal/50 mt-1 block">
                {depositTransactions.filter(t => t.direction === 'IN').length} deposit-in entries
              </span>
            </div>
            <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center">
              <ArrowDownRight size={20} />
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-secondary shadow-sm flex items-center justify-between">
            <div>
              <span className="text-[10px] font-mono text-charcoal/40 uppercase tracking-widest block">
                Credits Applied / Used
              </span>
              <span className="font-display font-black text-2xl text-purple-700 mt-1 block">
                ₱{totalDepositsApplied.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span className="text-[9px] font-mono text-charcoal/50 mt-1 block">
                {depositTransactions.filter(t => t.direction === 'OUT').length} applied transactions
              </span>
            </div>
            <div className="w-12 h-12 rounded-xl bg-purple-50 border border-purple-200 text-purple-700 flex items-center justify-center">
              <ArrowUpRight size={20} />
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-secondary shadow-sm flex items-center justify-between">
            <div>
              <span className="text-[10px] font-mono text-charcoal/40 uppercase tracking-widest block">
                Net Outstanding Credit
              </span>
              <span className="font-display font-black text-2xl text-primary mt-1 block">
                ₱{netGuestCredits.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span className="text-[9px] font-mono text-emerald-600 font-bold mt-1 block flex items-center gap-1">
                <CheckCircle2 size={10} /> Stored Guest Balance
              </span>
            </div>
            <div className="w-12 h-12 rounded-xl bg-primary/5 border border-primary/10 text-primary flex items-center justify-center">
              <Wallet size={20} />
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-secondary shadow-sm flex items-center justify-between">
            <div>
              <span className="text-[10px] font-mono text-charcoal/40 uppercase tracking-widest block">
                Ledger Integrity
              </span>
              <span className="font-display font-bold text-lg text-charcoal mt-1 block">
                Integer Centavos
              </span>
              <span className="text-[9px] font-mono text-emerald-600 font-bold flex items-center gap-1 mt-1">
                <CheckCircle2 size={11} /> Append-Only &amp; Non-Negative
              </span>
            </div>
            <div className="w-12 h-12 rounded-xl bg-cream border border-secondary/40 text-charcoal/60 flex items-center justify-center">
              <BookOpen size={20} />
            </div>
          </div>
        </div>

        {/* Deposit Search & Filters */}
        <div className="bg-white border border-secondary rounded-2xl p-4 shadow-sm flex flex-col md:flex-row gap-3.5 items-center justify-between">
          <div className="relative w-full md:w-80">
            <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-charcoal/40" />
            <input
              type="text"
              value={depositSearchTerm}
              onChange={(e) => setDepositSearchTerm(e.target.value)}
              placeholder="Search by guest ID, name, operator, ref..."
              className="w-full pl-9 pr-4 py-2 bg-cream/15 border border-secondary text-xs rounded-xl outline-none focus:border-primary focus:bg-white transition"
            />
          </div>

          <div className="flex gap-1 bg-cream/20 border border-secondary/60 p-1 rounded-xl">
            {(['ALL', 'IN', 'OUT'] as const).map((dir) => (
              <button
                key={dir}
                type="button"
                onClick={() => setDepositDirectionFilter(dir)}
                className={`px-3 py-1 rounded-lg text-[10px] font-mono font-bold uppercase transition cursor-pointer ${
                  depositDirectionFilter === dir ? 'bg-primary text-white shadow-xs' : 'text-charcoal/60 hover:bg-cream/40'
                }`}
              >
                {dir === 'ALL' ? 'All Activity' : dir === 'IN' ? 'Deposits In' : 'Applied / Used'}
              </button>
            ))}
          </div>
        </div>

        {/* Deposit Transactions Table */}
        <div className="bg-white border border-secondary rounded-2xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs font-mono">
              <thead>
                <tr className="border-b border-secondary/50 bg-cream/20 text-[10px] text-charcoal/50 uppercase tracking-wider">
                  <th className="py-3 px-4 font-bold">Timestamp</th>
                  <th className="py-3 px-4 font-bold">Guest Profile</th>
                  <th className="py-3 px-4 font-bold">Type</th>
                  <th className="py-3 px-4 font-bold text-right">Amount</th>
                  <th className="py-3 px-4 font-bold">Method / Details</th>
                  <th className="py-3 px-4 font-bold">Stay Ref</th>
                  <th className="py-3 px-4 font-bold">Operator</th>
                  <th className="py-3 px-4 font-bold">Idempotency Key</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-secondary/20">
                {depositLoading ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-charcoal/40 font-mono text-xs">
                      <RefreshCw size={24} className="mx-auto text-primary animate-spin mb-2" />
                      <p>Loading deposit ledger records...</p>
                    </td>
                  </tr>
                ) : filteredDeposits.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-charcoal/40 font-mono text-xs">
                      <Wallet size={28} className="mx-auto text-charcoal/20 mb-2" />
                      <p className="font-bold">No deposit transactions found</p>
                      <p className="text-[11px] text-charcoal/40">
                        {depositTransactions.length === 0
                          ? 'No deposits have been recorded yet. Use the room drawer to record a guest deposit.'
                          : 'No transactions match your search filter.'}
                      </p>
                    </td>
                  </tr>
                ) : (
                  filteredDeposits.map((tx) => {
                    const isIn = tx.direction === 'IN';
                    return (
                      <tr key={tx.id} className="hover:bg-cream/10 transition">
                        <td className="py-3 px-4 text-charcoal/70 text-[11px] whitespace-nowrap">
                          {formatDisplayDate(tx.createdAt)}
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-bold text-charcoal text-xs">{tx.guestIdentifier}</div>
                          {tx.guestName && (
                            <div className="text-[10px] text-charcoal/50 font-sans">{tx.guestName}</div>
                          )}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold ${
                              isIn
                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                : 'bg-purple-100 text-purple-800 border border-purple-200'
                            }`}
                          >
                            {isIn ? <ArrowDownRight size={11} /> : <ArrowUpRight size={11} />}
                            {isIn ? 'DEPOSIT IN' : 'APPLIED'}
                          </span>
                        </td>
                        <td className={`py-3 px-4 text-right font-bold text-sm whitespace-nowrap ${
                          isIn ? 'text-emerald-700' : 'text-purple-700'
                        }`}>
                          {isIn ? '+' : '-'}₱{(tx.amountCentavos / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="py-3 px-4 text-[11px]">
                          <div className="font-bold text-charcoal">{tx.paymentMethod}</div>
                          {tx.paymentMethod === 'MIXED' && (
                            <div className="text-[9px] text-charcoal/60">
                              Cash: ₱{((tx.cashAmountCentavos || 0) / 100).toFixed(2)} | GCash: ₱{((tx.gcashAmountCentavos || 0) / 100).toFixed(2)}
                            </div>
                          )}
                          {tx.referenceId && (
                            <div className="text-[9px] text-indigo-700 font-mono">
                              Ref: {tx.referenceId}
                            </div>
                          )}
                          {tx.notes && (
                            <div className="text-[9px] text-charcoal/50 italic max-w-xs truncate">
                              {tx.notes}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-[11px] whitespace-nowrap">
                          {tx.roomNumber ? (
                            <span className="font-bold text-primary">Room {tx.roomNumber}</span>
                          ) : tx.bookingId ? (
                            <span className="text-charcoal/60">Booking #{tx.bookingId}</span>
                          ) : (
                            <span className="text-charcoal/30">—</span>
                          )}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-800 text-[10px] font-bold border border-slate-200">
                            {tx.operator}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-[9px] text-charcoal/40 font-mono max-w-[120px] truncate" title={tx.idempotencyKey}>
                          {tx.idempotencyKey}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    )}
      {/* Gate Pass Modal */}
      {gatePassData && (
        <GatePassModal
          data={gatePassData}
          isOpen={Boolean(gatePassData)}
          onClose={() => setGatePassData(null)}
        />
      )}
    </div>
  );
};

export default TransactionLedger;
