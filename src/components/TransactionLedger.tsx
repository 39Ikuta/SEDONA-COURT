/**
 * src/components/TransactionLedger.tsx
 * Universal transaction ledger for Admin, Cashier, and Owner.
 * Displays real-time auditable receipt records, live search, payment filter,
 * line-item breakdowns, financial summaries, sortable columns, shift grouping,
 * guest headcount metrics, and thermal receipt re-printing.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Receipt, DepositTransaction, Deposit } from '../types';
import { getAllDepositTransactions, getAllDeposits } from '../api/deposits';
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
  Ticket,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Users,
  Layers,
  ChevronDown,
  ChevronRight,
  Clock,
  ShieldCheck,
  Building
} from 'lucide-react';
import { GatePassModal } from './GatePassModal';
import { GatePassData } from './PrintableGatePass';
import { downloadTransactionLedgerExcel } from '../utils/excelGenerator';
import { downloadDbLedger } from '../api/reportExports';
import { useToast } from './ui/Toast';
import { USER_ACCOUNTS } from '../data';
import { getReceiptGuestCount, getBusinessDayAndShift } from './GuestCountCards';
import { getManilaDateParts } from '../utils/pricing';

function maskIdInText(text?: string): string {
  if (!text) return '';
  // Mask [Card #: XXXXX] / [ID: XXXXX] leaving last 4
  return String(text).replace(/(\[Card #: |\[(ID: )?).*?(\])/g, (m) => {
    const digits = m.replace(/[^A-Za-z0-9]/g, '');
    const last4 = digits.slice(-4);
    if (m.includes('Card')) return `[Card #: ****-${last4}]`;
    return `[ID: ****-${last4}]`;
  });
}

interface TransactionLedgerProps {
  receipts: Receipt[];
  onRefreshReceipts?: () => void;
  onViewReceipt: (receipt: Receipt) => void;
  loggedInUser: string;
  userRole?: string;
}

/**
 * Formats a timestamp to Asia/Manila 12h time: "Sep 29, 2026 · 10:06 AM"
 */
export function formatManilaDateTime(val?: string | Date | null): string {
  if (!val || val === 'N/A') return 'N/A';
  const d = val instanceof Date
    ? val
    : new Date(typeof val === 'string' && val.includes(' ') && !val.includes('T') ? val.replace(' ', 'T') : val);
  if (isNaN(d.getTime())) return String(val);

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const parts = formatter.formatToParts(d);
  const month = parts.find((p) => p.type === 'month')?.value || '';
  const day = parts.find((p) => p.type === 'day')?.value || '';
  const year = parts.find((p) => p.type === 'year')?.value || '';
  const hour = parts.find((p) => p.type === 'hour')?.value || '';
  const minute = parts.find((p) => p.type === 'minute')?.value || '';
  const dayPeriod = parts.find((p) => p.type === 'dayPeriod')?.value?.toUpperCase() || '';

  return `${month} ${day}, ${year} · ${hour}:${minute} ${dayPeriod}`;
}

/**
 * Computes stay duration between two timestamps in a human readable string.
 */
function computeDurationLabel(checkIn?: string, checkOut?: string): string {
  if (!checkIn || !checkOut) return 'N/A';
  const inD = new Date(checkIn.includes(' ') && !checkIn.includes('T') ? checkIn.replace(' ', 'T') : checkIn);
  const outD = new Date(checkOut.includes(' ') && !checkOut.includes('T') ? checkOut.replace(' ', 'T') : checkOut);
  if (isNaN(inD.getTime()) || isNaN(outD.getTime())) return 'N/A';
  const diffMs = Math.max(0, outD.getTime() - inD.getTime());
  const hours = Math.floor(diffMs / 3600000);
  const mins = Math.floor((diffMs % 3600000) / 60000);
  if (hours === 0 && mins === 0) return '< 1m';
  if (hours === 0) return `${mins}m`;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
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

  // Filter States
  const [searchTerm, setSearchTerm] = useState('');
  const [paymentFilter, setPaymentFilter] = useState<'ALL' | 'CASH' | 'GCASH' | 'MIXED'>('ALL');
  const [cashierFilter, setCashierFilter] = useState<string>('ALL');
  const [dateFilter, setDateFilter] = useState<'TODAY' | 'SHIFT' | 'YESTERDAY' | 'CUSTOM' | 'ALL'>(() => (isCashier ? 'TODAY' : 'ALL'));
  const [customFromDate, setCustomFromDate] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [customToDate, setCustomToDate] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });

  // Sorting State (default: dateTime DESC, receiptNo DESC)
  const [sortField, setSortField] = useState<'dateTime' | 'receiptNo'>('dateTime');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Business-day / shift grouping toggle
  const [isGroupedByShift, setIsGroupedByShift] = useState(false);

  // Selected receipt for detail inspection
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [gatePassData, setGatePassData] = useState<GatePassData | null>(null);

  // Expanded rows accordion (for flat table expandable view)
  const [expandedReceipts, setExpandedReceipts] = useState<Record<string, boolean>>({});

  const toggleRowExpansion = (receiptNo: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setExpandedReceipts((prev) => ({
      ...prev,
      [receiptNo]: !prev[receiptNo],
    }));
  };

  // Deposit Tab State
  const [activeLedgerTab, setActiveLedgerTab] = useState<'receipts' | 'deposits'>('receipts');
  const [depositTransactions, setDepositTransactions] = useState<DepositTransaction[]>([]);
  const [securityDeposits, setSecurityDeposits] = useState<Deposit[]>([]);
  const [depositSearchTerm, setDepositSearchTerm] = useState('');
  const [depositDirectionFilter, setDepositDirectionFilter] = useState<'ALL' | 'IN' | 'OUT' | 'HELD' | 'REFUNDED' | 'FORFEITED'>('ALL');
  const [depositLoading, setDepositLoading] = useState(false);

  const fetchDeposits = async () => {
    try {
      setDepositLoading(true);
      const [txData, depData] = await Promise.all([
        getAllDepositTransactions().catch(() => []),
        getAllDeposits().catch(() => []),
      ]);
      setDepositTransactions(txData || []);
      setSecurityDeposits(depData || []);
    } catch (err) {
      console.warn('Could not fetch deposits:', err);
    } finally {
      setDepositLoading(false);
    }
  };

  useEffect(() => {
    fetchDeposits();
  }, []);

  // When cashier opens ledger or role changes to cashier, scope to TODAY and cashierFilter to ALL
  useEffect(() => {
    if (isCashier) {
      setDateFilter('TODAY');
      setCashierFilter('ALL');
    }
  }, [isCashier]);

  // Auto select first receipt if none selected
  useEffect(() => {
    if (!selectedReceipt && receipts.length > 0) {
      setSelectedReceipt(receipts[0]);
    }
  }, [receipts, selectedReceipt]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    if (onRefreshReceipts) {
      await onRefreshReceipts();
    }
    await fetchDeposits();
    setTimeout(() => setIsRefreshing(false), 400);
  };

  // Sorting Toggle Handler
  const handleSort = (field: 'dateTime' | 'receiptNo') => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  // Database-authoritative ledger export
  const handleDbExport = async () => {
    const pad = (n: number) => String(n).padStart(2, '0');
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const nowInfo = getBusinessDayAndShift(new Date());
    const yesterdayInfo = getBusinessDayAndShift(new Date(Date.now() - 24 * 3600 * 1000));
    let from = todayStr;
    let to = todayStr;
    if (dateFilter === 'TODAY') { from = nowInfo.businessDate; to = nowInfo.businessDate; }
    else if (dateFilter === 'YESTERDAY') { from = yesterdayInfo.businessDate; to = yesterdayInfo.businessDate; }
    else if (dateFilter === 'SHIFT') { from = nowInfo.businessDate; to = nowInfo.businessDate; }
    else if (dateFilter === 'CUSTOM') { from = customFromDate; to = customToDate; }
    else if (dateFilter === 'ALL') { from = '2024-01-01'; to = todayStr; }
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

  // Filter receipts based on search, payment, cashier, and date
  const filteredReceipts = useMemo(() => {
    const nowInfo = getBusinessDayAndShift(new Date());

    // Compute yesterday's business day date string
    const yesterdayDate = new Date(Date.now() - 24 * 3600 * 1000);
    const yesterdayInfo = getBusinessDayAndShift(yesterdayDate);

    const filtered = receipts.filter((r) => {
      // Exclude voided and force-checkout loss slips from sales view (shown via status filter server-side)
      const isVoid = (r as any).status === 'void';
      const isFce = String(r.receiptNo || '').startsWith('FCE-');
      if (isVoid || isFce) return false;
      // 1. Search
      const searchString = `${r.receiptNo} ${r.roomNumber || ''} ${r.guestName || ''} ${r.cashierId || ''} ${r.gcashRef || ''}`.toLowerCase();
      const matchesSearch = searchString.includes(searchTerm.toLowerCase());

      // 2. Payment Method
      const matchesPayment = paymentFilter === 'ALL' || r.paymentMethod === paymentFilter;

      // 3. Cashier
      const matchesCashier = cashierFilter === 'ALL' || (r.cashierId && r.cashierId.toLowerCase() === cashierFilter.toLowerCase());

      // 4. Date Filter (using Business Day 06:00 & Shift)
      let matchesDate = true;
      if (r.dateTime) {
        const rInfo = getBusinessDayAndShift(r.dateTime);

        if (dateFilter === 'TODAY') {
          matchesDate = rInfo.businessDate === nowInfo.businessDate;
        } else if (dateFilter === 'SHIFT') {
          matchesDate = rInfo.businessDate === nowInfo.businessDate && rInfo.shiftType === nowInfo.shiftType;
        } else if (dateFilter === 'YESTERDAY') {
          matchesDate = rInfo.businessDate === yesterdayInfo.businessDate;
        } else if (dateFilter === 'CUSTOM') {
          matchesDate = rInfo.businessDate >= customFromDate && rInfo.businessDate <= customToDate;
        } else if (dateFilter === 'ALL') {
          matchesDate = true;
        }
      }

      return matchesSearch && matchesPayment && matchesCashier && matchesDate;
    });

    // Sort receipts
    return filtered.sort((a, b) => {
      if (sortField === 'dateTime') {
        const dateA = new Date(a.dateTime ? (a.dateTime.includes(' ') && !a.dateTime.includes('T') ? a.dateTime.replace(' ', 'T') : a.dateTime) : 0).getTime();
        const dateB = new Date(b.dateTime ? (b.dateTime.includes(' ') && !b.dateTime.includes('T') ? b.dateTime.replace(' ', 'T') : b.dateTime) : 0).getTime();
        if (dateA !== dateB) {
          return sortDirection === 'asc' ? dateA - dateB : dateB - dateA;
        }
        // Secondary sort: receiptNo
        return sortDirection === 'asc'
          ? (a.receiptNo || '').localeCompare(b.receiptNo || '')
          : (b.receiptNo || '').localeCompare(a.receiptNo || '');
      } else {
        const comp = (a.receiptNo || '').localeCompare(b.receiptNo || '', undefined, { numeric: true });
        return sortDirection === 'asc' ? comp : -comp;
      }
    });
  }, [receipts, searchTerm, paymentFilter, cashierFilter, dateFilter, customFromDate, customToDate, sortField, sortDirection]);

  // Calculate live summary stats for filtered set
  const totalRevenue = useMemo(
    () => filteredReceipts.reduce((sum, r) => sum + r.total, 0),
    [filteredReceipts]
  );
  const totalInvoices = filteredReceipts.length;
  const totalGuestCount = useMemo(
    () => filteredReceipts.reduce((sum, r) => sum + getReceiptGuestCount(r), 0),
    [filteredReceipts]
  );

  const cashTotal = useMemo(
    () =>
      filteredReceipts.reduce((sum, r) => {
        if (r.paymentMethod === 'CASH') return sum + r.total;
        if (r.paymentMethod === 'MIXED') return sum + (r.cashAmount || 0);
        return sum;
      }, 0),
    [filteredReceipts]
  );

  const gcashTotal = useMemo(
    () =>
      filteredReceipts.reduce((sum, r) => {
        if (r.paymentMethod === 'GCASH') return sum + r.total;
        if (r.paymentMethod === 'MIXED') return sum + (r.gcashAmount || 0);
        return sum;
      }, 0),
    [filteredReceipts]
  );

  // Group receipts by Shift / Business Day when grouping is active
  const groupedReceipts = useMemo(() => {
    if (!isGroupedByShift) return null;
    const groups: Array<{
      groupKey: string;
      groupTitle: string;
      businessDate: string;
      shiftType: 'DAY' | 'NIGHT';
      receipts: Receipt[];
      subtotalAmount: number;
      subtotalGuests: number;
    }> = [];

    const map: Record<string, typeof groups[0]> = {};

    filteredReceipts.forEach((r) => {
      const info = getBusinessDayAndShift(r.dateTime || new Date());
      const groupKey = `${info.businessDate}_${info.shiftType}`;

      if (!map[groupKey]) {
        map[groupKey] = {
          groupKey,
          groupTitle: `${info.displayDate} · ${info.shiftLabel}`,
          businessDate: info.businessDate,
          shiftType: info.shiftType,
          receipts: [],
          subtotalAmount: 0,
          subtotalGuests: 0,
        };
        groups.push(map[groupKey]);
      }

      map[groupKey].receipts.push(r);
      map[groupKey].subtotalAmount += r.total;
      map[groupKey].subtotalGuests += getReceiptGuestCount(r);
    });

    return groups;
  }, [filteredReceipts, isGroupedByShift]);

  // Deposits filtering
  const filteredDeposits = useMemo(() => {
    return depositTransactions.filter((tx) => {
      const searchString = `${tx.guestIdentifier} ${tx.guestName || ''} ${tx.operator} ${tx.referenceId || ''} ${tx.roomNumber || ''} ${tx.notes || ''} ${tx.idempotencyKey}`.toLowerCase();
      const matchesSearch = searchString.includes(depositSearchTerm.toLowerCase());
      const matchesDirection =
        depositDirectionFilter === 'ALL' ||
        tx.direction === depositDirectionFilter;
      return matchesSearch && matchesDirection;
    });
  }, [depositTransactions, depositSearchTerm, depositDirectionFilter]);

  const totalDepositsCollected = useMemo(
    () =>
      depositTransactions
        .filter((tx) => tx.direction === 'IN')
        .reduce((sum, tx) => sum + tx.amountCentavos, 0) / 100,
    [depositTransactions]
  );

  const totalDepositsApplied = useMemo(
    () =>
      depositTransactions
        .filter((tx) => tx.direction === 'OUT')
        .reduce((sum, tx) => sum + tx.amountCentavos, 0) / 100,
    [depositTransactions]
  );

  const netGuestCredits = totalDepositsCollected - totalDepositsApplied;

  // Get unique cashiers from receipts
  const availableCashiers = useMemo(
    () => Array.from(new Set(receipts.map((r) => r.cashierId).filter(Boolean))),
    [receipts]
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
              title="Separate server-generated ledger built live from the database"
              className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-mono font-bold transition cursor-pointer shadow-xs active:scale-95 disabled:opacity-50"
            >
              <Database size={13} />
              <span>{exportingDb ? 'Generating…' : 'DB Ledger (.XLSX)'}</span>
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
          <span>Official Invoices &amp; Receipts</span>
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
          <span>Security Deposits &amp; Credits (DEP-...)</span>
          <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-100 text-emerald-800 font-mono font-bold">
            {depositTransactions.length}
          </span>
        </button>
      </div>

      {activeLedgerTab === 'receipts' && (
        <>
          {/* Summary KPI Badges: Filtered Set Summary with Guest Count, Invoices, Total Revenue */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Card 1: Total Invoiced Revenue */}
            <div className="bg-white p-5 rounded-2xl border border-secondary shadow-sm flex items-center justify-between">
              <div>
                <span className="text-[10px] font-mono text-charcoal/40 uppercase tracking-widest block">
                  Total Filtered Revenue
                </span>
                <span className="font-display font-black text-2xl text-primary mt-1 block">
                  ₱{totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className="text-[9px] font-mono text-charcoal/50 mt-1 block">
                  Filtered Set Amount Total
                </span>
              </div>
              <div className="w-12 h-12 rounded-xl bg-primary/5 border border-primary/10 text-primary flex items-center justify-center">
                <DollarSign size={20} />
              </div>
            </div>

            {/* Card 2: Invoices & Guest Count */}
            <div className="bg-white p-5 rounded-2xl border border-secondary shadow-sm flex items-center justify-between">
              <div>
                <span className="text-[10px] font-mono text-charcoal/40 uppercase tracking-widest block">
                  Invoices &amp; Guest Count
                </span>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="font-display font-black text-2xl text-charcoal">
                    {totalInvoices}
                  </span>
                  <span className="text-xs font-mono font-bold text-charcoal/50">invoices</span>
                </div>
                <div className="inline-flex items-center gap-1 text-[10px] font-mono font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200 mt-1">
                  <Users size={11} />
                  <span>{totalGuestCount} Guest Headcount</span>
                </div>
              </div>
              <div className="w-12 h-12 rounded-xl bg-cream border border-secondary/40 text-charcoal/60 flex items-center justify-center">
                <Users size={20} />
              </div>
            </div>

            {/* Card 3: Cash Collections */}
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

            {/* Card 4: GCash / Digital Sales */}
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
          </div>

          {/* Filter, Search & Grouping Bar */}
          <div className="bg-white border border-secondary rounded-2xl p-4 shadow-sm space-y-3">
            <div className="flex flex-col md:flex-row gap-3 items-center justify-between">
              {/* Search Bar */}
              <div className="relative w-full md:w-80">
                <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-charcoal/40" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search by receipt #, guest, room, ref..."
                  className="w-full pl-9 pr-4 py-2 bg-cream/15 border border-secondary text-xs rounded-xl outline-none focus:border-primary focus:bg-white transition"
                />
              </div>

              {/* Action Toggles & Controls */}
              <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-end">
                {/* Group By Shift Toggle Button */}
                <button
                  type="button"
                  onClick={() => setIsGroupedByShift((prev) => !prev)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold flex items-center gap-1.5 border transition cursor-pointer ${
                    isGroupedByShift
                      ? 'bg-primary text-white border-primary shadow-xs'
                      : 'bg-cream/20 hover:bg-cream/40 border-secondary text-charcoal/70'
                  }`}
                >
                  <Layers size={13} />
                  <span>{isGroupedByShift ? 'Grouped by Shift (Active)' : 'Group by Shift'}</span>
                </button>

                {/* Cashier Dropdown (hidden for cashiers, visible for Admins & Owners) */}
                {!isCashier && availableCashiers.length > 0 && (
                  <div className="flex items-center gap-1 bg-cream/30 px-2.5 py-1.5 rounded-xl border border-secondary/40 text-xs font-mono">
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

            {/* Date and Payment Filter Bars */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-secondary/30">
              {/* Date Filter Bar: Today, This shift, Yesterday, Custom range, All */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-mono text-charcoal/50 uppercase font-bold mr-1">Date:</span>
                <div className="flex flex-wrap gap-1 bg-cream/20 border border-secondary/60 p-1 rounded-xl">
                  {([
                    { id: 'TODAY', label: 'Today' },
                    { id: 'SHIFT', label: 'This Shift' },
                    { id: 'YESTERDAY', label: 'Yesterday' },
                    { id: 'CUSTOM', label: 'Custom Range' },
                    { id: 'ALL', label: 'All Dates' },
                  ] as const).map(({ id, label }) => {
                    if (isCashier && (id === 'CUSTOM' || id === 'ALL' || id === 'YESTERDAY')) return null;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setDateFilter(id)}
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold uppercase transition cursor-pointer ${
                          dateFilter === id ? 'bg-primary text-white shadow-xs' : 'text-charcoal/60 hover:bg-cream/40'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                {/* Custom Date Pickers */}
                {dateFilter === 'CUSTOM' && (
                  <div className="flex items-center gap-1.5 bg-cream/30 p-1 rounded-xl border border-secondary/50 text-xs font-mono">
                    <span className="text-[10px] text-charcoal/50 px-1 font-bold uppercase">From</span>
                    <input
                      type="date"
                      value={customFromDate}
                      onChange={(e) => setCustomFromDate(e.target.value)}
                      className="bg-white border border-secondary/60 rounded-lg px-2 py-0.5 text-[11px] font-mono outline-none focus:border-primary text-charcoal"
                    />
                    <span className="text-[10px] text-charcoal/50 px-1 font-bold uppercase">To</span>
                    <input
                      type="date"
                      value={customToDate}
                      onChange={(e) => setCustomToDate(e.target.value)}
                      className="bg-white border border-secondary/60 rounded-lg px-2 py-0.5 text-[11px] font-mono outline-none focus:border-primary text-charcoal"
                    />
                  </div>
                )}
              </div>

              {/* Payment Method Filter */}
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-mono text-charcoal/50 uppercase font-bold mr-1">Payment:</span>
                <div className="flex gap-1 bg-cream/20 border border-secondary/60 p-1 rounded-xl">
                  {(['ALL', 'CASH', 'GCASH', 'MIXED'] as const).map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setPaymentFilter(method)}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold uppercase transition cursor-pointer ${
                        paymentFilter === method ? 'bg-primary text-white shadow-xs' : 'text-charcoal/60 hover:bg-cream/40'
                      }`}
                    >
                      {method}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Split Ledger View: Invoices Table on Left, Drilldown on Right */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Invoices Table Container (2 Cols) */}
            <div className="bg-white border border-secondary rounded-2xl overflow-hidden lg:col-span-2 shadow-sm flex flex-col justify-between">
              <div>
                <div className="p-4 border-b border-secondary bg-cream/10 flex justify-between items-center">
                  <h3 className="font-display font-extrabold text-xs text-charcoal uppercase tracking-wider flex items-center gap-1.5">
                    <History size={13} className="text-primary" />
                    Live Invoices &amp; Receipts ({filteredReceipts.length})
                  </h3>
                  <div className="flex items-center gap-3 text-[10px] font-mono text-charcoal/60 font-semibold">
                    <span>
                      Sorted by: <span className="text-primary font-bold">{sortField === 'dateTime' ? 'Date / Time' : 'Receipt No'} ({sortDirection.toUpperCase()})</span>
                    </span>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left font-mono text-[11px] border-collapse min-w-[560px]">
                    <thead>
                      <tr className="bg-cream/30 border-b border-secondary text-charcoal/60 text-[10px] uppercase font-bold tracking-wider">
                        {/* Sortable RECEIPT NO */}
                        <th className="py-2.5 px-3">
                          <button
                            type="button"
                            onClick={() => handleSort('receiptNo')}
                            className="flex items-center gap-1 font-bold text-charcoal hover:text-primary transition cursor-pointer uppercase"
                          >
                            <span>Receipt No</span>
                            {sortField === 'receiptNo' ? (
                              sortDirection === 'asc' ? <ArrowUp size={11} className="text-primary" /> : <ArrowDown size={11} className="text-primary" />
                            ) : (
                              <ArrowUpDown size={11} className="text-charcoal/30" />
                            )}
                          </button>
                        </th>

                        {/* Sortable DATE / TIME (right after RECEIPT NO) */}
                        <th className="py-2.5 px-3">
                          <button
                            type="button"
                            onClick={() => handleSort('dateTime')}
                            className="flex items-center gap-1 font-bold text-charcoal hover:text-primary transition cursor-pointer uppercase"
                          >
                            <span>Date / Time</span>
                            {sortField === 'dateTime' ? (
                              sortDirection === 'asc' ? <ArrowUp size={11} className="text-primary" /> : <ArrowDown size={11} className="text-primary" />
                            ) : (
                              <ArrowUpDown size={11} className="text-charcoal/30" />
                            )}
                          </button>
                        </th>

                        <th className="py-2.5 px-2">Room / Stay</th>
                        <th className="py-2.5 px-2">Guest / Pax</th>
                        <th className="py-2.5 px-2">Payment</th>
                        <th className="py-2.5 px-4 text-right">Amount (PHP)</th>
                        <th className="py-2.5 px-2 text-center">Detail</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-secondary/30">
                      {filteredReceipts.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-16 text-center text-charcoal/40 italic">
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
                      ) : isGroupedByShift && groupedReceipts ? (
                        /* Grouped View by Shift / Business Day */
                        groupedReceipts.map((group) => (
                          <React.Fragment key={group.groupKey}>
                            {/* Shift Group Header Row */}
                            <tr className="bg-primary/5 border-t-2 border-b border-primary/20">
                              <td colSpan={7} className="py-2.5 px-4">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <Clock size={13} className="text-primary" />
                                    <span className="font-display font-black text-xs text-primary uppercase">
                                      {group.groupTitle}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-3 text-[10px] font-mono">
                                    <span className="bg-white/80 px-2 py-0.5 rounded border border-primary/20 text-primary font-bold">
                                      {group.receipts.length} Invoices
                                    </span>
                                    <span className="bg-white/80 px-2 py-0.5 rounded border border-emerald-200 text-emerald-800 font-bold">
                                      {group.subtotalGuests} Guests
                                    </span>
                                    <span className="font-bold text-charcoal">
                                      Subtotal: <span className="font-black text-primary">₱{group.subtotalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                    </span>
                                  </div>
                                </div>
                              </td>
                            </tr>

                            {/* Shift Invoices Rows */}
                            {group.receipts.map((receipt) => {
                              const isSelected = selectedReceipt?.receiptNo === receipt.receiptNo;
                              const isExpanded = Boolean(expandedReceipts[receipt.receiptNo]);
                              const guestCount = getReceiptGuestCount(receipt);
                              const durationStr = receipt.stayDuration || computeDurationLabel(receipt.checkIn, receipt.checkOut);

                              return (
                                <React.Fragment key={receipt.receiptNo}>
                                  <tr
                                    onClick={() => setSelectedReceipt(receipt)}
                                    className={`cursor-pointer transition-colors ${
                                      isSelected
                                        ? 'bg-primary/5 font-bold border-l-4 border-primary'
                                        : 'hover:bg-cream/15'
                                    }`}
                                  >
                                    <td className="py-2.5 px-3 font-bold text-primary whitespace-nowrap">
                                      {receipt.receiptNo}
                                    </td>
                                    <td className="py-2.5 px-3 text-[10px] text-charcoal/70 whitespace-nowrap font-medium">
                                      {formatManilaDateTime(receipt.dateTime)}
                                    </td>
                                    <td className="py-2.5 px-2">
                                      <div className="font-semibold text-charcoal">
                                        {receipt.roomNumber ? `Room ${receipt.roomNumber}` : 'Direct POS'}
                                      </div>
                                      <div className="text-[9px] text-emerald-700 font-mono font-bold">
                                        {durationStr}
                                      </div>
                                    </td>
                                    <td className="py-2.5 px-2 text-charcoal/80">
                                      <div className="font-medium truncate max-w-[110px]">{receipt.guestName || 'Walk-in'}</div>
                                      <div className="text-[9px] text-charcoal/50 font-mono">
                                        {guestCount} pax
                                      </div>
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
                                    <td className="py-2.5 px-2 text-center">
                                      <button
                                        type="button"
                                        onClick={(e) => toggleRowExpansion(receipt.receiptNo, e)}
                                        className="text-charcoal/40 hover:text-primary transition p-1 cursor-pointer"
                                        title="Toggle Stay Details"
                                      >
                                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                      </button>
                                    </td>
                                  </tr>

                                  {/* Expandable Stay Detail Row */}
                                  {isExpanded && (
                                    <tr className="bg-cream/20 text-[10px] border-b border-secondary/40">
                                      <td colSpan={7} className="p-3">
                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-white p-3 rounded-xl border border-secondary/50 font-mono">
                                          <div>
                                            <span className="text-[9px] text-charcoal/40 uppercase block font-bold">IN (Check-in)</span>
                                            <span className="font-bold text-charcoal">{formatManilaDateTime(receipt.checkIn || receipt.dateTime)}</span>
                                          </div>
                                          <div>
                                            <span className="text-[9px] text-charcoal/40 uppercase block font-bold">OUT (Check-out)</span>
                                            <span className="font-bold text-charcoal">{formatManilaDateTime(receipt.checkOut || receipt.dateTime)}</span>
                                          </div>
                                          <div>
                                            <span className="text-[9px] text-charcoal/40 uppercase block font-bold">TIME CONSUMED</span>
                                            <span className="font-extrabold text-emerald-700">{durationStr}</span>
                                          </div>
                                        </div>
                                      </td>
                                    </tr>
                                  )}
                                </React.Fragment>
                              );
                            })}
                          </React.Fragment>
                        ))
                      ) : (
                        /* Flat Table View */
                        filteredReceipts.map((receipt) => {
                          const isSelected = selectedReceipt?.receiptNo === receipt.receiptNo;
                          const isExpanded = Boolean(expandedReceipts[receipt.receiptNo]);
                          const guestCount = getReceiptGuestCount(receipt);
                          const durationStr = receipt.stayDuration || computeDurationLabel(receipt.checkIn, receipt.checkOut);

                          return (
                            <React.Fragment key={receipt.receiptNo}>
                              <tr
                                onClick={() => setSelectedReceipt(receipt)}
                                className={`cursor-pointer transition-colors ${
                                  isSelected
                                    ? 'bg-primary/5 font-bold border-l-4 border-primary'
                                    : 'hover:bg-cream/15'
                                }`}
                              >
                                <td className="py-2.5 px-3 font-bold text-primary whitespace-nowrap">
                                  {receipt.receiptNo}
                                </td>
                                <td className="py-2.5 px-3 text-[10px] text-charcoal/70 whitespace-nowrap font-medium">
                                  {formatManilaDateTime(receipt.dateTime)}
                                </td>
                                <td className="py-2.5 px-2">
                                  <div className="font-semibold text-charcoal">
                                    {receipt.roomNumber ? `Room ${receipt.roomNumber}` : 'Direct POS'}
                                  </div>
                                  <div className="text-[9px] text-emerald-700 font-mono font-bold">
                                    {durationStr}
                                  </div>
                                </td>
                                <td className="py-2.5 px-2 text-charcoal/80">
                                  <div className="font-medium truncate max-w-[110px]">{receipt.guestName || 'Walk-in'}</div>
                                  <div className="text-[9px] text-charcoal/50 font-mono">
                                    {guestCount} pax
                                  </div>
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
                                <td className="py-2.5 px-2 text-center">
                                  <button
                                    type="button"
                                    onClick={(e) => toggleRowExpansion(receipt.receiptNo, e)}
                                    className="text-charcoal/40 hover:text-primary transition p-1 cursor-pointer"
                                    title="Toggle Stay Details"
                                  >
                                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                  </button>
                                </td>
                              </tr>

                              {/* Expandable Stay Detail Row */}
                              {isExpanded && (
                                <tr className="bg-cream/20 text-[10px] border-b border-secondary/40">
                                  <td colSpan={7} className="p-3">
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-white p-3 rounded-xl border border-secondary/50 font-mono">
                                      <div>
                                        <span className="text-[9px] text-charcoal/40 uppercase block font-bold">IN (Check-in)</span>
                                        <span className="font-bold text-charcoal">{formatManilaDateTime(receipt.checkIn || receipt.dateTime)}</span>
                                      </div>
                                      <div>
                                        <span className="text-[9px] text-charcoal/40 uppercase block font-bold">OUT (Check-out)</span>
                                        <span className="font-bold text-charcoal">{formatManilaDateTime(receipt.checkOut || receipt.dateTime)}</span>
                                      </div>
                                      <div>
                                        <span className="text-[9px] text-charcoal/40 uppercase block font-bold">TIME CONSUMED</span>
                                        <span className="font-extrabold text-emerald-700">{durationStr}</span>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Table Footer Summary */}
              <div className="p-3 bg-cream/10 border-t border-secondary flex flex-wrap justify-between items-center text-[10px] font-mono text-charcoal/60">
                <div>
                  Showing <span className="font-bold text-primary">{filteredReceipts.length}</span> of {receipts.length} total records
                </div>
                <div className="flex items-center gap-3">
                  <span>Headcount: <span className="font-bold text-emerald-700">{totalGuestCount} Guests</span></span>
                  <span>Total: <span className="font-bold text-primary">₱{totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
                </div>
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
                    {/* Stay IN, OUT & TIME CONSUMED Card */}
                    <div className="space-y-1.5 bg-primary/5 p-3 rounded-xl border border-primary/15 text-[10px] text-charcoal/80">
                      <div className="flex justify-between items-center text-primary font-bold border-b border-primary/10 pb-1 mb-1">
                        <span>Stay Timeline</span>
                        <span>{selectedReceipt.stayDuration || computeDurationLabel(selectedReceipt.checkIn, selectedReceipt.checkOut)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-charcoal/50 uppercase">IN (Check In):</span>
                        <span className="font-bold text-charcoal">{formatManilaDateTime(selectedReceipt.checkIn || selectedReceipt.dateTime)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-charcoal/50 uppercase">OUT (Check Out):</span>
                        <span className="font-bold text-charcoal">{formatManilaDateTime(selectedReceipt.checkOut || selectedReceipt.dateTime)}</span>
                      </div>
                      <div className="flex justify-between text-emerald-800 font-bold pt-1 border-t border-primary/10">
                        <span>TIME CONSUMED:</span>
                        <span>{selectedReceipt.stayDuration || computeDurationLabel(selectedReceipt.checkIn, selectedReceipt.checkOut)}</span>
                      </div>
                    </div>

                    {/* Metadata card */}
                    <div className="space-y-1 bg-cream/20 p-3 rounded-xl border border-secondary/40 text-[10px] text-charcoal/70 uppercase">
                      <div className="flex justify-between">
                        <span>Logged At:</span>
                        <span className="font-bold text-charcoal">{formatManilaDateTime(selectedReceipt.dateTime)}</span>
                      </div>
                      {selectedReceipt.roomNumber && (
                        <div className="flex justify-between">
                          <span>Room Assigned:</span>
                          <span className="font-bold text-primary">Room {selectedReceipt.roomNumber} ({selectedReceipt.roomType || 'Standard'})</span>
                        </div>
                      )}
                      {selectedReceipt.guestName && (
                        <div className="flex justify-between">
                          <span>Guest Name:</span>
                          <span className="font-bold text-charcoal">{selectedReceipt.guestName}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span>Guest Headcount:</span>
                        <span className="font-bold text-emerald-700">{getReceiptGuestCount(selectedReceipt)} pax</span>
                      </div>
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
                            {it.subtext && <span className="text-[9px] text-charcoal/50 block">{maskIdInText(it.subtext)}</span>}
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
                      {selectedReceipt.discount && selectedReceipt.discount > 0 && (
                        <div className="flex justify-between text-emerald-700 font-semibold text-[11px]">
                          <span>Discount Applied:</span>
                          <span>-₱{selectedReceipt.discount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
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
                      {selectedReceipt.amountTendered !== undefined && selectedReceipt.amountTendered > 0 && (
                        <div className="flex justify-between text-charcoal/80">
                          <span>Amount Tendered:</span>
                          <span className="font-bold">₱{selectedReceipt.amountTendered.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                        </div>
                      )}
                      {selectedReceipt.changeAmount !== undefined && (
                        <div className="flex justify-between text-charcoal/80">
                          <span>Change Returned:</span>
                          <span className="font-bold">₱{selectedReceipt.changeAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                        </div>
                      )}
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

      {/* SECURITY DEPOSITS & CREDITS TAB */}
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
                  {depositTransactions.filter((t) => t.direction === 'IN').length} deposit-in entries
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
                  {depositTransactions.filter((t) => t.direction === 'OUT').length} applied transactions
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
                  Active Held Deposits
                </span>
                <span className="font-display font-black text-2xl text-amber-700 mt-1 block">
                  {securityDeposits.filter((d) => d.status === 'held').length} Held
                </span>
                <span className="text-[9px] font-mono text-charcoal/50 mt-1 block">
                  Official DEP-... vouchers
                </span>
              </div>
              <div className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center">
                <ShieldCheck size={20} />
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
                placeholder="Search by guest ID, name, operator, ref, DEP-..."
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
                            {formatManilaDateTime(tx.createdAt)}
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
                          <td
                            className={`py-3 px-4 text-right font-bold text-sm whitespace-nowrap ${
                              isIn ? 'text-emerald-700' : 'text-purple-700'
                            }`}
                          >
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
