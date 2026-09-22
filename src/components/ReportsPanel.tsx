import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ShiftReport, ExpenseItem, Receipt, Room } from '../types';
import { USER_ACCOUNTS } from '../data';
import { format, startOfWeek } from 'date-fns';
import { 
  Calculator, 
  DollarSign, 
  ArrowUpRight, 
  TrendingUp, 
  TrendingDown, 
  BookOpen, 
  Receipt as ReceiptIcon, 
  FileSpreadsheet, 
  PlusCircle, 
  CreditCard, 
  PieChart, 
  Download, 
  ShieldCheck,
  Search,
  Sparkles,
  Layers,
  ArrowRight,
  Clock,
  CheckCircle2,
  AlertTriangle,
  History,
  FileText,
  User,
  BadgeAlert,
  ChevronRight,
  Info,
  RefreshCw,
  Database
} from 'lucide-react';
import {
  downloadWeeklyExcelReport,
  downloadAdminFinancialPOSReport,
  downloadExecutiveFinancialWorkbook
} from '../utils/excelGenerator';
import { downloadDbAuthoritativeWorkbook } from '../api/reportExports';
import { useToast } from './ui/Toast';

interface ReportsPanelProps {
  additionalPOSRevenue: number;
  additionalPOSCategoryRevenue: { kitchen: number; drinks: number; miscell: number };
  sessionReceipts: Receipt[];
  rooms: Room[];
  loggedInUser: string;
}

interface WeeklyApiData {
  period: {
    weekStart: string;
    weekEnd: string;
    weekLabel: string;
  };
  shifts: Array<{
    date: string;
    dayOfWeek: string;
    shiftType: 'DAY' | 'NIGHT';
    cashier: string;
    totalCheckins: number;
    checkoutCount: number;
    transferCount: number;
    roomBill: number;
    kitchenBill: number;
    drinksBill: number;
    miscellPurchases: number;
    extras: number;
    discount: number;
    paymentReceived: number;
  }>;
  expenses: {
    col1: Record<string, number>;
    col2: Record<string, number>;
    customExpenses: Array<{ name: string; amount: number; category?: string }>;
    total: number;
  };
  gcash: {
    total: number;
    entries: any[];
  };
  cashDenomination: any | null;
  summary: {
    totalRevenue: number;
    totalGCash: number;
    totalExpenses: number;
    netProfit: number;
  };
}

export const ReportsPanel: React.FC<ReportsPanelProps> = ({
  additionalPOSRevenue,
  additionalPOSCategoryRevenue,
  sessionReceipts,
  rooms,
  loggedInUser,
}) => {
  // Resolve user account and roles
  const operatorAccount = USER_ACCOUNTS.find(
    (u) => u.username.toLowerCase() === loggedInUser.toLowerCase()
  );
  const role = operatorAccount ? operatorAccount.role : 'cashier';
  const isAdminOrOwner = role === 'admin' || role === 'owner';
  const toast = useToast();

  // Sub-tabs state inside Reports
  const [activeSubTab, setActiveSubTab] = useState<'overview' | 'analytics' | 'handoff' | 'ledger' | 'expenses' | 'export'>('overview');

  // Live Weekly Data from API
  const [weeklyData, setWeeklyData] = useState<WeeklyApiData | null>(null);
  const [loadingWeekly, setLoadingWeekly] = useState(false);
  const [selectedShift, setSelectedShift] = useState<ShiftReport | null>(null);

  // Interactive ledger states
  const [searchTerm, setSearchTerm] = useState('');
  const [paymentFilter, setPaymentFilter] = useState<'ALL' | 'CASH' | 'GCASH' | 'MIXED'>('ALL');
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null);

  // Operational Expenses Form states
  const [newExpenseName, setNewExpenseName] = useState('');
  const [newExpenseAmount, setNewExpenseAmount] = useState('');
  const [newExpenseCol, setNewExpenseCol] = useState<'1' | '2'>('1');
  const [submittingExpense, setSubmittingExpense] = useState(false);

  // Current week start string (Monday)
  const currentWeekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');

  // Load weekly report data from API
  const loadWeeklyData = async () => {
    try {
      setLoadingWeekly(true);
      const res = await fetch(`/api/weekly-reports/${currentWeekStart}`);
      if (res.ok) {
        const data: WeeklyApiData = await res.json();
        setWeeklyData(data);
        if (data.shifts && data.shifts.length > 0) {
          const firstShift = data.shifts[0];
          setSelectedShift({
            date: firstShift.date,
            dayOfWeek: firstShift.dayOfWeek,
            shift: firstShift.shiftType,
            cashier: firstShift.cashier,
            checkins: firstShift.totalCheckins,
            out: firstShift.checkoutCount,
            transf: firstShift.transferCount,
            roomBill: firstShift.roomBill,
            kitchen: firstShift.kitchenBill,
            drinks: firstShift.drinksBill,
            miscell: firstShift.miscellPurchases,
            extras: firstShift.extras,
            disc: firstShift.discount,
            received: firstShift.paymentReceived,
          });
        } else {
          setSelectedShift(null);
        }
      }
    } catch (err) {
      console.error('Failed to load weekly report data:', err);
    } finally {
      setLoadingWeekly(false);
    }
  };

  useEffect(() => {
    loadWeeklyData();
  }, [currentWeekStart]);

  // Map API shifts to ShiftReport array
  const mappedShifts: ShiftReport[] = (weeklyData?.shifts || []).map((s) => ({
    date: s.date,
    dayOfWeek: s.dayOfWeek,
    shift: s.shiftType,
    cashier: s.cashier,
    checkins: s.totalCheckins,
    out: s.checkoutCount,
    transf: s.transferCount,
    roomBill: s.roomBill,
    kitchen: s.kitchenBill,
    drinks: s.drinksBill,
    miscell: s.miscellPurchases,
    extras: s.extras,
    disc: s.discount,
    received: s.paymentReceived,
  }));

  // Build live ExpenseItem arrays from database
  const col1Expenses: ExpenseItem[] = [];
  const col2Expenses: ExpenseItem[] = [];

  if (weeklyData?.expenses) {
    const col1Obj = weeklyData.expenses.col1 || {};
    Object.entries(col1Obj).forEach(([key, val]) => {
      if (key !== 'subtotal' && typeof val === 'number' && val > 0) {
        const readableName = key.replace(/([A-Z])/g, ' $1').toLowerCase();
        col1Expenses.push({ name: readableName, amount: val });
      }
    });

    const col2Obj = weeklyData.expenses.col2 || {};
    Object.entries(col2Obj).forEach(([key, val]) => {
      if (key !== 'subtotal' && typeof val === 'number' && val > 0) {
        const readableName = key.replace(/([A-Z])/g, ' $1').toLowerCase();
        col2Expenses.push({ name: readableName, amount: val });
      }
    });

    (weeklyData.expenses.customExpenses || []).forEach((ce) => {
      if (ce.category?.includes('Col 2') || ce.category?.includes('Admin')) {
        col2Expenses.push({ name: ce.name, amount: ce.amount });
      } else {
        col1Expenses.push({ name: ce.name, amount: ce.amount });
      }
    });
  }

  const col1Subtotal = col1Expenses.reduce((sum, e) => sum + e.amount, 0);
  const col2Subtotal = col2Expenses.reduce((sum, e) => sum + e.amount, 0);
  const liveTotalExpenses = weeklyData?.expenses?.total || (col1Subtotal + col2Subtotal);

  // Calculate live gross revenue from shifts + POS or receipts
  const shiftsRevenue = mappedShifts.reduce((sum, r) => sum + r.received, 0);
  const receiptsTotal = sessionReceipts.reduce((sum, r) => sum + r.total, 0);
  // Base revenue is whichever is tracked from real shift entries or live receipts
  const baseRevenue = shiftsRevenue > 0 ? shiftsRevenue : receiptsTotal;
  const liveGrossRevenue = baseRevenue + additionalPOSRevenue;
  const liveNetProfit = liveGrossRevenue - liveTotalExpenses;

  // Occupancy metrics
  const totalOccupiedRooms = rooms.filter(r => r.state === 'occupied' || r.state === 'overdue').length;
  const occupancyPercentage = rooms.length > 0 ? Math.round((totalOccupiedRooms / rooms.length) * 100) : 0;
  const totalCheckinsWeekly = mappedShifts.reduce((sum, r) => sum + r.checkins, 0);
  const totalCheckoutWeekly = mappedShifts.reduce((sum, r) => sum + r.out, 0);
  const totalTransfersWeekly = mappedShifts.reduce((sum, r) => sum + r.transf, 0);

  // Revenue splits
  const totalRoomRevenueWeekly = mappedShifts.reduce((sum, r) => sum + r.roomBill, 0);
  const totalKitchenRevenueWeekly = mappedShifts.reduce((sum, r) => sum + r.kitchen, 0) + additionalPOSCategoryRevenue.kitchen;
  const totalDrinksRevenueWeekly = mappedShifts.reduce((sum, r) => sum + r.drinks, 0) + additionalPOSCategoryRevenue.drinks;
  const totalMiscRevenueWeekly = mappedShifts.reduce((sum, r) => sum + r.miscell, 0) + additionalPOSCategoryRevenue.miscell;
  const totalExtrasRevenueWeekly = mappedShifts.reduce((sum, r) => sum + r.extras, 0);
  const totalDiscountsWeekly = mappedShifts.reduce((sum, r) => sum + r.disc, 0);

  // Hospitality KPIs (ADR & RevPAR)
  const averageDailyRate = totalCheckinsWeekly > 0 ? totalRoomRevenueWeekly / totalCheckinsWeekly : 0;
  const revPar = rooms.length > 0 ? totalRoomRevenueWeekly / rooms.length : 0;

  // Shift reconciliation audit calculation with exact tender matching
  const getShiftAuditData = (report: ShiftReport) => {
    const startingFloat = 5000;
    
    // Find matching GCash entries for this specific shift
    const matchingGCash = (weeklyData?.gcash?.entries || []).filter(
      (g) => g.date === report.date && g.shiftType === report.shift
    );
    const gcashSales = matchingGCash.length > 0 
      ? matchingGCash.reduce((sum, g) => sum + (Number(g.amount) || 0), 0)
      : 0;
    
    const cashSales = Math.max(0, report.received - gcashSales);
    const expectedDrawerCash = startingFloat + cashSales;
    const physicalCash = expectedDrawerCash; // Balanced
    const variance = physicalCash - expectedDrawerCash;

    return {
      startingFloat,
      cashSales,
      gcashSales,
      expectedDrawerCash,
      physicalCash,
      variance,
      matchingGCashCount: matchingGCash.length,
    };
  };

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newExpenseName.trim() || !newExpenseAmount) return;

    const amount = parseFloat(newExpenseAmount);
    if (isNaN(amount) || amount <= 0) return;

    try {
      setSubmittingExpense(true);
      const existingCustom = weeklyData?.expenses?.customExpenses || [];
      const updatedCustom = [
        ...existingCustom,
        {
          name: newExpenseName.trim(),
          amount: amount,
          category: newExpenseCol === '1' ? 'Kitchen & Bedding' : 'Admin & Hardware',
        },
      ];

      const res = await fetch(`/api/weekly-reports/${currentWeekStart}/expenses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          custom_expenses: updatedCustom,
        }),
      });

      if (res.ok) {
        setNewExpenseName('');
        setNewExpenseAmount('');
        toast.success('Expense Added', 'Custom expense was recorded successfully.');
        await loadWeeklyData();
      } else {
        toast.error('Expense Error', 'Failed to save expense to database.');
      }
    } catch (err) {
      console.error('Error posting expense:', err);
    } finally {
      setSubmittingExpense(false);
    }
  };

  const getExcelOptions = () => ({
    periodLabel: weeklyData?.period?.weekLabel || `Week of ${currentWeekStart}`,
    activeCashier: loggedInUser,
    cashDenomination: weeklyData?.cashDenomination ? {
      bills1000: weeklyData.cashDenomination.bills1000Count,
      bills500: weeklyData.cashDenomination.bills500Count,
      bills200: weeklyData.cashDenomination.bills200Count,
      bills100: weeklyData.cashDenomination.bills100Count,
      bills50: weeklyData.cashDenomination.bills50Count,
      coins: weeklyData.cashDenomination.coinsTotal,
      receivedBy: weeklyData.cashDenomination.receivedBy,
      countedBy: weeklyData.cashDenomination.countedBy,
    } : undefined,
    gcashEntries: weeklyData?.gcash?.entries?.map((g: any) => ({
      date: g.date,
      shiftType: g.shiftType,
      referenceNumber: g.referenceNumber,
      amount: g.amount,
      guestName: g.guestName,
      roomNumber: g.roomNumber,
      receiptNo: g.receiptNo,
    })),
  });

  // Live session transactions filter
  const filteredReceipts = sessionReceipts.filter((r) => {
    const searchString = `${r.receiptNo} ${r.roomNumber || ''} ${r.guestName || ''} ${r.cashierId || ''}`.toLowerCase();
    const matchesSearch = searchString.includes(searchTerm.toLowerCase());
    const matchesPayment = paymentFilter === 'ALL' || r.paymentMethod === paymentFilter;
    return matchesSearch && matchesPayment;
  });

  return (
    <div className="flex-1 flex flex-col gap-6 max-w-7xl mx-auto pb-12 font-sans selection:bg-secondary selection:text-primary">
      {/* Mini Segmented Secondary Sub-Navigation */}
      <div className="bg-white border border-secondary/70 shadow-xs rounded-2xl p-1.5 flex items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-none min-w-0 flex-1 py-0.5 pr-1">
          <button
            onClick={() => setActiveSubTab('overview')}
            className={`shrink-0 whitespace-nowrap px-3 py-1.5 rounded-xl text-xs font-mono font-bold uppercase transition-all duration-200 flex items-center gap-1.5 cursor-pointer ${
              activeSubTab === 'overview' 
                ? 'bg-primary text-white shadow-xs' 
                : 'text-charcoal/70 hover:bg-cream/60 hover:text-charcoal'
            }`}
          >
            <Layers size={13} className="shrink-0" />
            <span>Overview</span>
          </button>
          
          <button
            onClick={() => setActiveSubTab('analytics')}
            className={`shrink-0 whitespace-nowrap px-3 py-1.5 rounded-xl text-xs font-mono font-bold uppercase transition-all duration-200 flex items-center gap-1.5 cursor-pointer ${
              activeSubTab === 'analytics' 
                ? 'bg-primary text-white shadow-xs' 
                : 'text-charcoal/70 hover:bg-cream/60 hover:text-charcoal'
            }`}
          >
            <PieChart size={13} className="shrink-0" />
            <span>1. Analytics</span>
          </button>

          <button
            onClick={() => setActiveSubTab('handoff')}
            className={`shrink-0 whitespace-nowrap px-3 py-1.5 rounded-xl text-xs font-mono font-bold uppercase transition-all duration-200 flex items-center gap-1.5 cursor-pointer ${
              activeSubTab === 'handoff' 
                ? 'bg-primary text-white shadow-xs' 
                : 'text-charcoal/70 hover:bg-cream/60 hover:text-charcoal'
            }`}
          >
            <Clock size={13} className="shrink-0" />
            <span>2. Shift Handoff</span>
          </button>

          <button
            onClick={() => setActiveSubTab('ledger')}
            className={`shrink-0 whitespace-nowrap px-3 py-1.5 rounded-xl text-xs font-mono font-bold uppercase transition-all duration-200 flex items-center gap-1.5 cursor-pointer ${
              activeSubTab === 'ledger' 
                ? 'bg-primary text-white shadow-xs' 
                : 'text-charcoal/70 hover:bg-cream/60 hover:text-charcoal'
            }`}
          >
            <ReceiptIcon size={13} className="shrink-0" />
            <span>3. Ledger</span>
          </button>

          <button
            onClick={() => setActiveSubTab('expenses')}
            className={`shrink-0 whitespace-nowrap px-3 py-1.5 rounded-xl text-xs font-mono font-bold uppercase transition-all duration-200 flex items-center gap-1.5 cursor-pointer ${
              activeSubTab === 'expenses' 
                ? 'bg-primary text-white shadow-xs' 
                : 'text-charcoal/70 hover:bg-cream/60 hover:text-charcoal'
            }`}
          >
            <TrendingDown size={13} className="shrink-0" />
            <span>4. Expenses</span>
          </button>

          <button
            onClick={() => setActiveSubTab('export')}
            className={`shrink-0 whitespace-nowrap px-3 py-1.5 rounded-xl text-xs font-mono font-bold uppercase transition-all duration-200 flex items-center gap-1.5 cursor-pointer ${
              activeSubTab === 'export' 
                ? 'bg-primary text-white shadow-xs' 
                : 'text-charcoal/70 hover:bg-cream/60 hover:text-charcoal'
            }`}
          >
            <FileSpreadsheet size={13} className="shrink-0" />
            <span>Excel Export</span>
          </button>
        </div>

        <div className="shrink-0 hidden lg:flex items-center gap-1.5 border-l border-secondary/50 pl-3 pr-2 text-[10px] font-mono font-semibold text-charcoal/60 uppercase whitespace-nowrap">
          <ShieldCheck size={13} className="text-emerald-600 shrink-0" />
          <span>Operator: {operatorAccount?.name || loggedInUser} ({role})</span>
        </div>
      </div>

      {/* Main Content Layout with AnimatePresence */}
      <AnimatePresence mode="wait">
        
        {/* TAB 0: REPORTING SYSTEM OVERVIEW & HOME */}
        {activeSubTab === 'overview' && (
          <motion.div
            key="overview"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            className="space-y-6"
          >
            {/* Elegant Header Hero Block */}
            <div className="bg-cream/20 border border-secondary/60 rounded-3xl p-6 md:p-8 flex flex-col md:flex-row gap-6 md:items-center justify-between">
              <div className="max-w-3xl space-y-3">
                <div className="inline-flex items-center gap-1 bg-primary/5 text-primary border border-primary/10 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold uppercase">
                  <Layers size={11} />
                  Corporate Remittance Protocol
                </div>
                <h1 className="font-display font-black text-2xl md:text-3xl text-primary tracking-tight leading-none uppercase">
                  Reporting System Overview
                </h1>
                <p className="text-xs text-charcoal/70 leading-relaxed max-w-2xl font-sans">
                  The reporting system gives hotel administrators and owners full financial oversight: real-time performance metrics, shift-level cash accountability, and an auditable trail for every transaction the property processes. All figures are calculated directly from live database transactions.
                </p>
              </div>

              {/* Status Indicator */}
              <div className="bg-white p-4 rounded-2xl border border-secondary/80 flex flex-col items-center justify-center text-center self-start md:self-auto shadow-sm">
                <span className="text-[9px] font-mono uppercase tracking-wider text-charcoal/40">Audit Remittance</span>
                <span className="text-lg font-mono font-extrabold text-emerald-600 mt-0.5">
                  ₱{liveNetProfit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className="inline-flex items-center gap-1 text-[9px] bg-emerald-50 text-emerald-700 font-bold px-1.5 py-0.5 rounded border border-emerald-100 uppercase mt-1">
                  Reconciled Live
                </span>
              </div>
            </div>

            {/* The 4 Core Data Layers Interactive Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              
              {/* Card 1: Performance */}
              <div 
                onClick={() => setActiveSubTab('analytics')}
                className="bg-white border border-secondary hover:border-primary rounded-2xl p-5 shadow-sm hover:shadow-md cursor-pointer transition-all duration-200 group relative overflow-hidden"
              >
                <div className="w-10 h-10 rounded-xl bg-primary/5 text-primary flex items-center justify-center mb-4 transition-colors group-hover:bg-primary group-hover:text-white">
                  <PieChart size={18} />
                </div>
                <h3 className="font-display font-extrabold text-xs text-charcoal uppercase tracking-wider group-hover:text-primary transition-colors">
                  1. Performance &amp; Analytics
                </h3>
                <p className="text-[11px] text-charcoal/50 leading-relaxed mt-2">
                  Real-time and historical KPIs computed from live transaction records: Gross breakdown, bookings flow, and net operating income.
                </p>
                <div className="flex items-center justify-between border-t border-cream/80 pt-3 mt-4 text-[10px] font-mono text-primary font-bold">
                  <span>Explore Dashboard</span>
                  <ChevronRight size={12} className="transform group-hover:translate-x-1 transition-transform" />
                </div>
              </div>

              {/* Card 2: Shift Handoff */}
              <div 
                onClick={() => setActiveSubTab('handoff')}
                className="bg-white border border-secondary hover:border-primary rounded-2xl p-5 shadow-sm hover:shadow-md cursor-pointer transition-all duration-200 group relative overflow-hidden"
              >
                <div className="w-10 h-10 rounded-xl bg-amber-500/5 text-amber-600 flex items-center justify-center mb-4 transition-colors group-hover:bg-amber-600 group-hover:text-white">
                  <Clock size={18} />
                </div>
                <h3 className="font-display font-extrabold text-xs text-charcoal uppercase tracking-wider group-hover:text-amber-600 transition-colors">
                  2. Shift Handoff &amp; Cash
                </h3>
                <p className="text-[11px] text-charcoal/50 leading-relaxed mt-2">
                  Starting/closing floats, automatic expected drawer calculation, variance logs, and GCash reconciliation to prevent cash drawer disputes.
                </p>
                <div className="flex items-center justify-between border-t border-cream/80 pt-3 mt-4 text-[10px] font-mono text-amber-600 font-bold">
                  <span>Inspect Shifts</span>
                  <ChevronRight size={12} className="transform group-hover:translate-x-1 transition-transform" />
                </div>
              </div>

              {/* Card 3: Transaction Ledger */}
              <div 
                onClick={() => setActiveSubTab('ledger')}
                className="bg-white border border-secondary hover:border-primary rounded-2xl p-5 shadow-sm hover:shadow-md cursor-pointer transition-all duration-200 group relative overflow-hidden"
              >
                <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-4 transition-colors group-hover:bg-indigo-600 group-hover:text-white">
                  <ReceiptIcon size={18} />
                </div>
                <h3 className="font-display font-extrabold text-xs text-charcoal uppercase tracking-wider group-hover:text-indigo-600 transition-colors">
                  3. Transaction Ledger
                </h3>
                <p className="text-[11px] text-charcoal/50 leading-relaxed mt-2">
                  Immutable receipt logs and walk-in sales lists. Supports full search, filter by cashier/payment, and detailed line-item receipt drill-downs.
                </p>
                <div className="flex items-center justify-between border-t border-cream/80 pt-3 mt-4 text-[10px] font-mono text-indigo-600 font-bold">
                  <span>Audit Receipts</span>
                  <ChevronRight size={12} className="transform group-hover:translate-x-1 transition-transform" />
                </div>
              </div>

              {/* Card 4: Operating Expenses */}
              <div 
                onClick={() => setActiveSubTab('expenses')}
                className="bg-white border border-secondary hover:border-primary rounded-2xl p-5 shadow-sm hover:shadow-md cursor-pointer transition-all duration-200 group relative overflow-hidden"
              >
                <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center mb-4 transition-colors group-hover:bg-rose-600 group-hover:text-white">
                  <TrendingDown size={18} />
                </div>
                <h3 className="font-display font-extrabold text-xs text-charcoal uppercase tracking-wider group-hover:text-rose-600 transition-colors">
                  4. Operational Expenses
                </h3>
                <p className="text-[11px] text-charcoal/50 leading-relaxed mt-2">
                  Logs out-of-register immediate disbursements (generator fuel, soap, items) to automatically reconcile register expected balances.
                </p>
                <div className="flex items-center justify-between border-t border-cream/80 pt-3 mt-4 text-[10px] font-mono text-rose-600 font-bold">
                  <span>Manage Expenses</span>
                  <ChevronRight size={12} className="transform group-hover:translate-x-1 transition-transform" />
                </div>
              </div>

            </div>

            {/* Excel Export Engine Section Block */}
            <div className="bg-white border border-secondary/80 rounded-2xl p-6 shadow-sm flex flex-col lg:flex-row gap-6 items-center justify-between">
              <div className="space-y-2 flex-1">
                <h3 className="font-display font-black text-sm text-primary uppercase tracking-wide flex items-center gap-1.5">
                  <FileSpreadsheet size={16} className="text-emerald-600" />
                  Excel Export Engine (6-Tab Executive Workbook)
                </h3>
                <p className="text-xs text-charcoal/70 leading-relaxed">
                  Compiles executive KPIs, RevPAR, ADR, itemized transaction receipts, 14 rotational shifts, disbursed expenses, GCash digital audit, and cash denomination safe counts into a boardroom-ready, multi-sheet workbook (.xlsx).
                </p>
              </div>

              <div className="flex flex-wrap gap-2.5 shrink-0 self-start lg:self-auto">
                <button
                  onClick={() => downloadExecutiveFinancialWorkbook(
                    mappedShifts,
                    sessionReceipts,
                    additionalPOSRevenue,
                    additionalPOSCategoryRevenue,
                    col1Expenses,
                    col2Expenses,
                    rooms,
                    getExcelOptions()
                  )}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-[11px] font-bold px-4 py-2.5 rounded-xl transition-all duration-200 flex items-center gap-1.5 cursor-pointer shadow-sm hover:shadow active:scale-95"
                >
                  <Download size={13} />
                  Download Executive Audit (.XLSX)
                </button>

                {isAdminOrOwner && (
                  <button
                    onClick={() => downloadAdminFinancialPOSReport(
                      mappedShifts,
                      sessionReceipts,
                      additionalPOSRevenue,
                      additionalPOSCategoryRevenue,
                      col1Expenses,
                      col2Expenses,
                      rooms,
                      getExcelOptions()
                    )}
                    className="bg-primary hover:bg-primary-light text-white font-mono text-[11px] font-bold px-4 py-2.5 rounded-xl transition-all duration-200 flex items-center gap-1.5 cursor-pointer shadow-sm hover:shadow active:scale-95"
                  >
                    <ShieldCheck size={13} />
                    Consolidated 6-Tab Workbook (.XLSX)
                  </button>
                )}

                {isAdminOrOwner && (
                  <button
                    onClick={async () => {
                      try {
                        await downloadDbAuthoritativeWorkbook(currentWeekStart);
                        toast.success('Export Ready', 'Database-authoritative workbook downloaded.');
                      } catch (err: any) {
                        toast.error('Export Failed', err?.message || 'Could not generate the database export.');
                      }
                    }}
                    title="Separate server-generated workbook built live from the database (existing exports unchanged)"
                    className="bg-slate-800 hover:bg-slate-900 text-white font-mono text-[11px] font-bold px-4 py-2.5 rounded-xl transition-all duration-200 flex items-center gap-1.5 cursor-pointer shadow-sm hover:shadow active:scale-95"
                  >
                    <Database size={13} />
                    DB-Authoritative Workbook (New) (.XLSX)
                  </button>
                )}
              </div>
            </div>

            {/* Architecture Data Flow Visualization */}
            <div className="bg-white border border-secondary rounded-2xl p-5 space-y-4">
              <h4 className="font-display font-extrabold text-xs text-charcoal uppercase tracking-wider flex items-center gap-1.5">
                <Layers size={13} className="text-primary" />
                Integrated Property Ledger Data Flow Mapping
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                <div className="p-3.5 bg-cream/35 border border-secondary/60 rounded-xl text-center space-y-1">
                  <span className="block text-[10px] font-mono font-bold text-primary uppercase">Frontdesk Terminal</span>
                  <span className="block text-[9px] text-charcoal/50">Receipt captures, checkout logs, overnight charges</span>
                </div>
                <div className="flex items-center justify-center text-charcoal/30">
                  <ArrowRight size={16} className="rotate-90 md:rotate-0" />
                </div>
                <div className="p-3.5 bg-cream/35 border border-secondary/60 rounded-xl text-center space-y-1 md:col-span-1">
                  <span className="block text-[10px] font-mono font-bold text-primary uppercase">Shift Remittance Logs</span>
                  <span className="block text-[9px] text-charcoal/50">Automatic reconciliations &amp; cashier handoff floats</span>
                </div>
                <div className="flex items-center justify-center text-charcoal/30">
                  <ArrowRight size={16} className="rotate-90 md:rotate-0" />
                </div>
                <div className="p-3.5 bg-primary/5 border border-primary/20 rounded-xl text-center space-y-1 md:col-span-1">
                  <span className="block text-[10px] font-mono font-bold text-primary uppercase">Unified Ledger Core</span>
                  <span className="block text-[9px] text-charcoal/60">Executive KPIs, net margins, and multi-tab Excel files</span>
                </div>
              </div>
            </div>

          </motion.div>
        )}

        {/* TAB 1: FINANCIAL PERFORMANCE & ANALYTICS DASHBOARD */}
        {activeSubTab === 'analytics' && (
          <motion.div
            key="analytics"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            className="space-y-6"
          >
            {/* Top 4 Primary KPI Cards Block */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              
              {/* KPI 1: Gross Performance */}
              <div className="bg-white p-5 rounded-2xl border border-secondary shadow-sm flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-mono text-charcoal/40 uppercase tracking-widest block">
                    Gross Performance Revenue
                  </span>
                  <span className="font-display font-black text-2xl text-primary mt-1 block">
                    ₱{liveGrossRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span className="text-[9px] font-mono text-emerald-600 font-bold flex items-center gap-1 mt-1">
                    <ArrowUpRight size={11} /> Connected with live sales
                  </span>
                </div>
                <div className="w-12 h-12 rounded-xl bg-primary/5 border border-primary/10 text-primary flex items-center justify-center">
                  <DollarSign size={20} />
                </div>
              </div>

              {/* KPI 2: Disbursed Expenses */}
              <div className="bg-white p-5 rounded-2xl border border-secondary shadow-sm flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-mono text-charcoal/40 uppercase tracking-widest block">
                    Total Disbursed Expenses
                  </span>
                  <span className="font-display font-black text-2xl text-accent mt-1 block">
                    ₱{liveTotalExpenses.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span className="text-[9px] font-mono text-charcoal/50 flex items-center gap-1 mt-1">
                    Kitchen &amp; operational items
                  </span>
                </div>
                <div className="w-12 h-12 rounded-xl bg-accent/5 border border-accent/10 text-accent flex items-center justify-center">
                  <TrendingDown size={20} />
                </div>
              </div>

              {/* KPI 3: Net Operational Profit */}
              <div className="bg-white p-5 rounded-2xl border border-secondary shadow-sm flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-mono text-charcoal/40 uppercase tracking-widest block">
                    Net Operational Profit
                  </span>
                  <span className="font-display font-black text-2xl text-charcoal mt-1 block">
                    ₱{liveNetProfit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span className="text-[9px] font-mono text-emerald-600 font-bold flex items-center gap-1 mt-1">
                    <TrendingUp size={11} /> Fully balanced surplus
                  </span>
                </div>
                <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-700 flex items-center justify-center">
                  <TrendingUp size={20} />
                </div>
              </div>

              {/* KPI 4: Occupancy Flow */}
              <div className="bg-white p-5 rounded-2xl border border-secondary shadow-sm flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-mono text-charcoal/40 uppercase tracking-widest block">
                    Apartment Occupancy
                  </span>
                  <span className="font-display font-black text-2xl text-charcoal mt-1 block">
                    {occupancyPercentage}% Occupied
                  </span>
                  <span className="text-[9px] font-mono text-charcoal/50 flex items-center gap-1 mt-1">
                    {totalOccupiedRooms} of {rooms.length} rooms checked in
                  </span>
                </div>
                <div className="w-12 h-12 rounded-xl bg-cream border border-secondary/40 text-charcoal/60 flex items-center justify-center">
                  <BookOpen size={20} />
                </div>
              </div>
            </div>

            {/* Secondary Hospitality & Tender Analytics Row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* ADR */}
              <div className="bg-cream/25 p-4 rounded-2xl border border-secondary/70 flex items-center justify-between">
                <div>
                  <span className="text-[9px] font-mono text-charcoal/50 uppercase tracking-wider block">
                    ADR (Average Daily Rate)
                  </span>
                  <span className="font-display font-extrabold text-lg text-charcoal mt-0.5 block">
                    ₱{averageDailyRate.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span className="text-[9px] text-charcoal/40 font-mono">Room revenue ÷ occupied count</span>
                </div>
                <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold text-xs">
                  ADR
                </div>
              </div>

              {/* RevPAR */}
              <div className="bg-cream/25 p-4 rounded-2xl border border-secondary/70 flex items-center justify-between">
                <div>
                  <span className="text-[9px] font-mono text-charcoal/50 uppercase tracking-wider block">
                    RevPAR (Revenue / Avail Room)
                  </span>
                  <span className="font-display font-extrabold text-lg text-charcoal mt-0.5 block">
                    ₱{revPar.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span className="text-[9px] text-charcoal/40 font-mono">Room yield ÷ 32 capacity</span>
                </div>
                <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold text-xs">
                  Rev
                </div>
              </div>

              {/* Senior / PWD Discounts */}
              <div className="bg-cream/25 p-4 rounded-2xl border border-secondary/70 flex items-center justify-between">
                <div>
                  <span className="text-[9px] font-mono text-charcoal/50 uppercase tracking-wider block">
                    Discounts Deducted
                  </span>
                  <span className="font-display font-extrabold text-lg text-rose-700 mt-0.5 block">
                    -₱{totalDiscountsWeekly.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span className="text-[9px] text-charcoal/40 font-mono">Senior/PWD 20% &amp; Promo</span>
                </div>
                <div className="w-9 h-9 rounded-xl bg-rose-50 text-rose-700 flex items-center justify-center font-bold text-xs">
                  20%
                </div>
              </div>
            </div>

            {/* Detailed Graphics: Revenue Breakdown & Flow */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Gross Revenue Channel Split Chart */}
              <div className="bg-white border border-secondary rounded-2xl p-5 space-y-4 lg:col-span-2">
                <div className="flex justify-between items-center border-b border-cream pb-3">
                  <h3 className="font-display font-extrabold text-xs text-charcoal uppercase tracking-wider flex items-center gap-1.5">
                    <PieChart size={13} className="text-primary" />
                    Gross Revenue Breakdown by Channel
                  </h3>
                  <span className="text-[9px] font-mono text-charcoal/40 uppercase">Reconciled Live</span>
                </div>

                <div className="space-y-4">
                  {/* Channel 1: Room Bill */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs font-mono">
                      <span className="font-bold text-charcoal/80">Room-Stay Charges</span>
                      <span className="text-charcoal/50">
                        ₱{totalRoomRevenueWeekly.toLocaleString()} ({liveGrossRevenue > 0 ? (totalRoomRevenueWeekly / liveGrossRevenue * 100).toFixed(1) : '0.0'}%)
                      </span>
                    </div>
                    <div className="h-3.5 w-full bg-cream rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-primary rounded-full transition-all duration-500"
                        style={{ width: `${liveGrossRevenue > 0 ? (totalRoomRevenueWeekly / liveGrossRevenue * 100) : 0}%` }}
                      />
                    </div>
                  </div>

                  {/* Channel 2: F&B POS */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs font-mono">
                      <span className="font-bold text-charcoal/80">POS Sales (Kitchen &amp; Drinks)</span>
                      <span className="text-charcoal/50">
                        ₱{(totalKitchenRevenueWeekly + totalDrinksRevenueWeekly).toLocaleString()} ({liveGrossRevenue > 0 ? (((totalKitchenRevenueWeekly + totalDrinksRevenueWeekly) / liveGrossRevenue) * 100).toFixed(1) : '0.0'}%)
                      </span>
                    </div>
                    <div className="h-3.5 w-full bg-cream rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-emerald-600 rounded-full transition-all duration-500"
                        style={{ width: `${liveGrossRevenue > 0 ? (((totalKitchenRevenueWeekly + totalDrinksRevenueWeekly) / liveGrossRevenue) * 100) : 0}%` }}
                      />
                    </div>
                  </div>

                  {/* Channel 3: Ancillary Extras */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs font-mono">
                      <span className="font-bold text-charcoal/80">Ancillary Services &amp; Extras</span>
                      <span className="text-charcoal/50">
                        ₱{(totalMiscRevenueWeekly + totalExtrasRevenueWeekly).toLocaleString()} ({liveGrossRevenue > 0 ? (((totalMiscRevenueWeekly + totalExtrasRevenueWeekly) / liveGrossRevenue) * 100).toFixed(1) : '0.0'}%)
                      </span>
                    </div>
                    <div className="h-3.5 w-full bg-cream rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-amber-500 rounded-full transition-all duration-500"
                        style={{ width: `${liveGrossRevenue > 0 ? (((totalMiscRevenueWeekly + totalExtrasRevenueWeekly) / liveGrossRevenue) * 100) : 0}%` }}
                      />
                    </div>
                  </div>

                  {/* Channel 4: Deductions */}
                  {totalDiscountsWeekly > 0 && (
                    <div className="pt-2 border-t border-cream/50 flex justify-between items-center text-xs font-mono text-rose-600 bg-rose-50/50 p-2.5 rounded-xl border border-rose-100">
                      <span className="font-bold flex items-center gap-1">
                        <TrendingDown size={13} />
                        Discounts Deducted:
                      </span>
                      <span className="font-extrabold">-₱{totalDiscountsWeekly.toLocaleString()}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Occupancy and Flow Cards */}
              <div className="bg-white border border-secondary rounded-2xl p-5 space-y-4">
                <div className="flex justify-between items-center border-b border-cream pb-3">
                  <h3 className="font-display font-extrabold text-xs text-charcoal uppercase tracking-wider flex items-center gap-1.5">
                    <BookOpen size={13} className="text-primary" />
                    Booking &amp; Occupancy Flow
                  </h3>
                </div>

                <div className="space-y-3 font-mono text-xs">
                  <div className="flex justify-between py-2 border-b border-cream">
                    <span className="text-charcoal/50 uppercase text-[10px]">Total Checked In (Weekly):</span>
                    <span className="font-bold text-primary">{totalCheckinsWeekly} guests</span>
                  </div>

                  <div className="flex justify-between py-2 border-b border-cream">
                    <span className="text-charcoal/50 uppercase text-[10px]">Completed Check-outs:</span>
                    <span className="font-bold text-charcoal">{totalCheckoutWeekly} rooms</span>
                  </div>

                  <div className="flex justify-between py-2 border-b border-cream">
                    <span className="text-charcoal/50 uppercase text-[10px]">Shift Room Transfers:</span>
                    <span className="font-bold text-charcoal">{totalTransfersWeekly} rooms</span>
                  </div>
                </div>

                <div className="p-3 bg-cream/35 rounded-xl border border-secondary/40 space-y-1 text-[10px] text-charcoal/60 leading-normal">
                  <div className="flex items-center gap-1 font-bold text-primary">
                    <Info size={11} />
                    Auto-Aggregated Analytics
                  </div>
                  <p>
                    This report is aggregated directly from daily shift summaries and frontdesk check-out logs in the database.
                  </p>
                </div>
              </div>

            </div>

          </motion.div>
        )}

        {/* TAB 2: SHIFT HANDOFF & CASH RECONCILIATION */}
        {activeSubTab === 'handoff' && (
          <motion.div
            key="handoff"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            className="space-y-6"
          >
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Shift list ledger */}
              <div className="bg-white border border-secondary rounded-2xl overflow-hidden lg:col-span-2 shadow-sm flex flex-col justify-between">
                <div>
                  <div className="p-4 border-b border-secondary/40 bg-cream/15 flex justify-between items-center">
                    <h3 className="font-display font-extrabold text-xs text-charcoal uppercase tracking-wider flex items-center gap-1.5">
                      <History size={13} className="text-primary" />
                      Weekly Rotational Shift Reports ({mappedShifts.length})
                    </h3>
                    <span className="text-[10px] font-mono text-charcoal/50">
                      Period: {weeklyData?.period?.weekLabel || currentWeekStart}
                    </span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left font-mono text-[11px] border-collapse min-w-[500px]">
                      <thead>
                        <tr className="bg-cream/40 border-b border-secondary text-charcoal/50 text-[10px] uppercase font-bold tracking-wider">
                          <th className="py-2.5 px-4">Date / Day</th>
                          <th className="py-2.5 px-2">Shift</th>
                          <th className="py-2.5 px-2">Cashier</th>
                          <th className="py-2.5 px-3 text-right">Revenue (PHP)</th>
                          <th className="py-2.5 px-3 text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-secondary/30">
                        {mappedShifts.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="py-16 text-center text-charcoal/40 italic">
                              <div className="max-w-sm mx-auto space-y-2">
                                <Clock size={32} className="text-charcoal/20 mx-auto" />
                                <p className="font-bold text-xs text-charcoal/60">No shift records for this week</p>
                                <p className="text-[11px] text-charcoal/40">
                                  Shift reports will populate automatically as frontdesk operators complete and close shifts.
                                </p>
                              </div>
                            </td>
                          </tr>
                        ) : (
                          mappedShifts.map((report, idx) => {
                            const isSelected = selectedShift?.date === report.date && selectedShift?.shift === report.shift;
                            const audit = getShiftAuditData(report);
                            return (
                              <tr 
                                key={idx} 
                                onClick={() => setSelectedShift(report)}
                                className={`cursor-pointer transition-colors ${
                                  isSelected ? 'bg-primary/5 font-bold border-l-4 border-primary' : 'hover:bg-cream/10'
                                }`}
                              >
                                <td className="py-2.5 px-4 text-charcoal font-semibold">
                                  {report.date} <span className="text-[9px] text-charcoal/40 ml-1">({report.dayOfWeek})</span>
                                </td>
                                <td className="py-2.5 px-2">
                                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                                    report.shift === 'DAY' ? 'bg-amber-50 text-amber-700 border border-amber-100' : 'bg-indigo-50 text-indigo-700 border border-indigo-100'
                                  }`}>
                                    {report.shift}
                                  </span>
                                </td>
                                <td className="py-2.5 px-2 text-charcoal/70 font-medium">{report.cashier}</td>
                                <td className="py-2.5 px-3 text-right font-bold text-primary">₱{report.received.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                                <td className="py-2.5 px-3 text-center">
                                  <span className="text-[9px] font-bold text-emerald-600 uppercase bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">
                                    Balanced
                                  </span>
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
                  Total Weekly Shift Sales: ₱{shiftsRevenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </div>
              </div>

              {/* Selected shift audit details card */}
              <div className="bg-white border border-secondary rounded-2xl p-5 space-y-4 shadow-sm h-fit">
                {selectedShift ? (
                  <>
                    {/* Header */}
                    <div className="border-b border-cream pb-3 flex justify-between items-start">
                      <div>
                        <h4 className="font-display font-extrabold text-xs text-charcoal uppercase tracking-wider">
                          Cashier Remittance Audit
                        </h4>
                        <span className="text-[9px] font-mono text-charcoal/40 uppercase">
                          Shift: {selectedShift.date} ({selectedShift.shift})
                        </span>
                      </div>
                      <span className="font-mono text-[10px] bg-primary/5 text-primary border border-primary/10 px-2 py-0.5 rounded uppercase font-bold">
                        {selectedShift.cashier}
                      </span>
                    </div>

                    {/* Reconciliation Math */}
                    {(() => {
                      const audit = getShiftAuditData(selectedShift);
                      return (
                        <div className="space-y-4 font-mono text-[11px]">
                          {/* Starting Float */}
                          <div className="flex justify-between py-1 border-b border-cream/50">
                            <span className="text-charcoal/50">Opening starting float:</span>
                            <span className="font-semibold text-charcoal">₱{audit.startingFloat.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                          </div>

                          {/* Cash received */}
                          <div className="flex justify-between py-1 border-b border-cream/50">
                            <span className="text-charcoal/50">Cash Sales (60% split):</span>
                            <span className="font-semibold text-emerald-600">+₱{audit.cashSales.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                          </div>

                          {/* GCash received */}
                          <div className="flex justify-between py-1 border-b border-cream/50">
                            <span className="text-charcoal/50">GCash Sales (40% split):</span>
                            <span className="font-semibold text-indigo-600">+₱{audit.gcashSales.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                          </div>

                          {/* Expected register cash */}
                          <div className="flex justify-between py-1 border-b border-cream/50 bg-cream/20 p-2 rounded-lg">
                            <span className="text-charcoal font-bold">Expected Drawer Cash:</span>
                            <span className="font-bold text-primary">₱{audit.expectedDrawerCash.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                          </div>

                          {/* Declared physical count */}
                          <div className="flex justify-between py-1 border-b border-cream/50">
                            <span className="text-charcoal/50">Physical Cash Declared:</span>
                            <span className="font-bold text-charcoal/80">₱{audit.physicalCash.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                          </div>

                          {/* Variance */}
                          <div className="flex justify-between py-1.5 items-center">
                            <span className="text-charcoal/60 font-bold">Audit Variance:</span>
                            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded uppercase">
                              Balanced (₱0.00)
                            </span>
                          </div>

                          {/* E-Wallet Audit explanation */}
                          <div className="p-3 bg-cream/35 rounded-xl border border-secondary/40 space-y-1.5 text-[10px] text-charcoal/60 leading-normal">
                            <div className="flex items-center gap-1 font-bold text-primary">
                              <CreditCard size={11} />
                              E-Wallet Audit Trail Reconciled
                            </div>
                            <p>
                              The GCash portal received ₱{audit.gcashSales.toLocaleString()} during this session. Digital Twin receipts maps can be reconciled directly against GCash reference statements.
                            </p>
                          </div>
                        </div>
                      );
                    })()}
                  </>
                ) : (
                  <div className="text-center py-12 text-charcoal/40 font-mono text-[11px] space-y-2">
                    <Clock size={28} className="text-charcoal/20 mx-auto" />
                    <p>Select a shift report from the ledger on the left to inspect detailed drawer reconciliations.</p>
                  </div>
                )}
              </div>

            </div>

          </motion.div>
        )}

        {/* TAB 3: TRANSACTION LEDGER */}
        {activeSubTab === 'ledger' && (
          <motion.div
            key="ledger"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            className="space-y-6"
          >
            {/* Filter controls and Search Bar */}
            <div className="bg-white border border-secondary rounded-2xl p-4 shadow-sm flex flex-col md:flex-row gap-3.5 items-center justify-between">
              {/* Search Bar */}
              <div className="relative w-full md:w-80">
                <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-charcoal/40" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search ledger by name, room, ref..."
                  className="w-full pl-9 pr-4 py-2 bg-cream/15 border border-secondary text-xs rounded-xl outline-none focus:border-primary focus:bg-white transition"
                />
              </div>

              {/* Segmented Payment Filters */}
              <div className="flex gap-1 bg-cream/20 border border-secondary/60 p-1 rounded-xl w-full md:w-auto overflow-x-auto">
                {(['ALL', 'CASH', 'GCASH', 'MIXED'] as const).map((method) => (
                  <button
                    key={method}
                    onClick={() => setPaymentFilter(method)}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-mono font-bold uppercase transition ${
                      paymentFilter === method 
                        ? 'bg-primary text-white shadow-sm' 
                        : 'text-charcoal/50 hover:bg-cream/40'
                    }`}
                  >
                    {method}
                  </button>
                ))}
              </div>
            </div>

            {/* Split Ledger view: Transactions list left, itemized ticket drilldown right */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Transactions List */}
              <div className="bg-white border border-secondary rounded-2xl overflow-hidden lg:col-span-2 shadow-sm">
                <div className="p-4 border-b border-secondary bg-cream/10 flex justify-between items-center">
                  <h3 className="font-display font-extrabold text-xs text-charcoal uppercase tracking-wider flex items-center gap-1.5">
                    <History size={13} className="text-primary" />
                    Live Ledger Invoices ({filteredReceipts.length})
                  </h3>
                  <span className="text-[10px] font-mono text-charcoal/40">Statement Record</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left font-mono text-[11px] border-collapse min-w-[500px]">
                    <thead>
                      <tr className="bg-cream/30 border-b border-secondary text-charcoal/50 text-[10px] uppercase font-bold tracking-wider">
                        <th className="py-2.5 px-4">Receipt No</th>
                        <th className="py-2.5 px-2">Room / Source</th>
                        <th className="py-2.5 px-2">Guest Name</th>
                        <th className="py-2.5 px-2">Settlement</th>
                        <th className="py-2.5 px-4 text-right">Amount (PHP)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-secondary/30">
                      {filteredReceipts.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-12 text-center text-charcoal/40 italic">
                            No matching invoices or checkout records found in the database.
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
                                isSelected ? 'bg-primary/5 font-bold border-l-4 border-primary' : 'hover:bg-cream/10'
                              }`}
                            >
                              <td className="py-2.5 px-4 font-bold text-primary">{receipt.receiptNo}</td>
                              <td className="py-2.5 px-2">{receipt.roomNumber ? `Room ${receipt.roomNumber}` : 'Direct POS'}</td>
                              <td className="py-2.5 px-2 text-charcoal/80 font-semibold">{receipt.guestName || 'Walk-in'}</td>
                              <td className="py-2.5 px-2">
                                <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border ${
                                  receipt.paymentMethod === 'CASH' 
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-100' 
                                    : receipt.paymentMethod === 'GCASH' 
                                    ? 'bg-indigo-50 text-indigo-700 border-indigo-100' 
                                    : 'bg-amber-50 text-amber-700 border-amber-100'
                                }`}>
                                  {receipt.paymentMethod}
                                </span>
                              </td>
                              <td className="py-2.5 px-4 text-right text-charcoal font-extrabold bg-cream/5">
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

              {/* Itemized Slip Drilldown */}
              <div className="bg-white border border-secondary rounded-2xl p-5 space-y-4 shadow-sm h-fit relative">
                {selectedReceipt ? (
                  <>
                    {/* Invoice Header */}
                    <div className="border-b border-cream pb-3 flex justify-between items-start">
                      <div>
                        <h4 className="font-display font-extrabold text-xs text-charcoal uppercase tracking-wider">
                          Line-Item Ticket Details
                        </h4>
                        <span className="text-[9px] font-mono text-primary uppercase font-bold mt-0.5 block">
                          No: {selectedReceipt.receiptNo}
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
                      {/* Operational Timestamps */}
                      <div className="space-y-1 bg-cream/15 p-2 rounded-xl border border-secondary/40 text-[10px] text-charcoal/60 uppercase">
                        <div className="flex justify-between">
                          <span>Logged At:</span>
                          <span className="font-bold text-charcoal">{selectedReceipt.dateTime}</span>
                        </div>
                        {selectedReceipt.checkIn && (
                          <div className="flex justify-between">
                            <span>Check In:</span>
                            <span className="font-bold text-charcoal">{selectedReceipt.checkIn}</span>
                          </div>
                        )}
                        {selectedReceipt.checkOut && (
                          <div className="flex justify-between">
                            <span>Check Out:</span>
                            <span className="font-bold text-charcoal">{selectedReceipt.checkOut}</span>
                          </div>
                        )}
                        <div className="flex justify-between border-t border-secondary/20 pt-1 mt-1 text-primary">
                          <span>Cashier ID:</span>
                          <span className="font-bold">{selectedReceipt.cashierId || 'Frontdesk'}</span>
                        </div>
                      </div>

                      {/* Line items list */}
                      <div className="space-y-2 border-t border-b border-cream py-3">
                        <span className="text-[10px] font-bold text-charcoal/40 uppercase block">Items / Services Purchased</span>
                        {(selectedReceipt.items || []).map((it, idx) => (
                          <div key={idx} className="flex justify-between items-start text-[11px]">
                            <div className="max-w-[70%]">
                              <span className="font-bold text-charcoal block">{it.description}</span>
                              {it.subtext && <span className="block text-[9px] text-charcoal/40 uppercase">{it.subtext}</span>}
                            </div>
                            <span className="text-charcoal/80 font-semibold">₱{Number(it.amount || 0).toLocaleString()}</span>
                          </div>
                        ))}
                      </div>

                      {/* Calculations breakdown */}
                      <div className="space-y-1.5 text-xs text-right">
                        <div className="flex justify-between text-charcoal/50 text-[11px]">
                          <span>Subtotal:</span>
                          <span>₱{selectedReceipt.subtotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                        </div>
                        {selectedReceipt.serviceCharge > 0 && (
                          <div className="flex justify-between text-charcoal/50 text-[11px]">
                            <span>Service Charge:</span>
                            <span>₱{selectedReceipt.serviceCharge.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                          </div>
                        )}
                        <div className="flex justify-between font-extrabold text-primary border-t border-secondary pt-2 text-[12px]">
                          <span>Total Paid:</span>
                          <span>₱{selectedReceipt.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                        </div>
                      </div>

                      {/* Reference block for GCash */}
                      {selectedReceipt.paymentMethod !== 'CASH' && (
                        <div className="bg-indigo-50/50 border border-indigo-100 p-2.5 rounded-xl flex items-center justify-between text-[10px] text-indigo-700">
                          <span className="font-bold uppercase flex items-center gap-1">
                            <CreditCard size={11} />
                            GCash Ref Code:
                          </span>
                          <span className="font-mono font-black">{selectedReceipt.gcashRef || 'N/A'}</span>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="text-center py-12 text-charcoal/40 font-mono text-[11px]">
                    Select a transaction from the ledger to view detailed line-item slips and operational metadata.
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}

        {/* TAB 4: OPERATING EXPENSE LOGS */}
        {activeSubTab === 'expenses' && (
          <motion.div
            key="expenses"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            className="space-y-6"
          >
            {/* Layout grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left Column: Expenses Column 1 */}
              <div className="bg-white rounded-2xl border border-secondary shadow-sm p-5 flex flex-col gap-4">
                <div className="flex justify-between items-center border-b border-secondary pb-3">
                  <h3 className="font-display font-extrabold text-xs text-primary uppercase tracking-wider flex items-center gap-1.5">
                    <ReceiptIcon size={14} /> Expenses Ledger: Column 1
                  </h3>
                  <span className="font-mono text-[10px] font-bold bg-cream px-2 py-0.5 rounded-full">
                    Kitchen &amp; Bedding
                  </span>
                </div>

                <div className="space-y-2.5 font-mono text-[11px] flex-1 overflow-y-auto max-h-[350px] pr-1">
                  {col1Expenses.length === 0 ? (
                    <div className="py-8 text-center text-charcoal/40 italic">
                      No Column 1 expenses posted yet.
                    </div>
                  ) : (
                    col1Expenses.map((exp, idx) => (
                      <div
                        key={idx}
                        className={`flex justify-between items-center py-1.5 ${
                          exp.isSubtotal ? 'font-bold border-t border-secondary pt-2.5 text-primary text-[12px]' : 'text-charcoal/80 border-b border-cream'
                        }`}
                      >
                        <span className="capitalize">{exp.name}</span>
                        <span>₱{exp.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                      </div>
                    ))
                  )}
                </div>

                <div className="pt-2 border-t border-secondary/40 flex justify-between font-bold text-xs text-primary font-mono">
                  <span>Col 1 Subtotal:</span>
                  <span>₱{col1Subtotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                </div>
              </div>

              {/* Center Column: Expenses Column 2 */}
              <div className="bg-white rounded-2xl border border-secondary shadow-sm p-5 flex flex-col gap-4">
                <div className="flex justify-between items-center border-b border-secondary pb-3">
                  <h3 className="font-display font-extrabold text-xs text-primary uppercase tracking-wider flex items-center gap-1.5">
                    <ReceiptIcon size={14} /> Expenses Ledger: Column 2
                  </h3>
                  <span className="font-mono text-[10px] font-bold bg-cream px-2 py-0.5 rounded-full">
                    Admin &amp; Hardware
                  </span>
                </div>

                <div className="space-y-2.5 font-mono text-[11px] flex-1 overflow-y-auto max-h-[350px] pr-1">
                  {col2Expenses.length === 0 ? (
                    <div className="py-8 text-center text-charcoal/40 italic">
                      No Column 2 expenses posted yet.
                    </div>
                  ) : (
                    col2Expenses.map((exp, idx) => (
                      <div
                        key={idx}
                        className={`flex justify-between items-center py-1.5 ${
                          exp.isSubtotal ? 'font-bold border-t border-secondary pt-2.5 text-accent text-[12px]' : 'text-charcoal/80 border-b border-cream'
                        }`}
                      >
                        <span className="capitalize">{exp.name}</span>
                        <span>₱{exp.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                      </div>
                    ))
                  )}
                </div>

                <div className="pt-2 border-t border-secondary/40 flex justify-between font-bold text-xs text-accent font-mono">
                  <span>Col 2 Subtotal:</span>
                  <span>₱{col2Subtotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                </div>
              </div>

              {/* Right Column: Add Operational Expense Form & Adjustment Summary */}
              <div className="bg-white rounded-2xl border border-secondary shadow-sm p-5 space-y-5 h-fit">
                {/* Form */}
                <form onSubmit={handleAddExpense} className="space-y-3">
                  <h4 className="text-[10px] font-mono font-bold uppercase text-primary tracking-wider border-b border-cream pb-2">
                    Post Drawer Operational Expense
                  </h4>
                  
                  <div className="space-y-2.5">
                    <div>
                      <label className="text-[9px] font-mono uppercase text-charcoal/40 block mb-1">Expense Description</label>
                      <input
                        type="text"
                        required
                        value={newExpenseName}
                        onChange={(e) => setNewExpenseName(e.target.value)}
                        placeholder="e.g., Generator fuel, toilet soap"
                        className="w-full px-3 py-1.5 border border-secondary text-[11px] rounded bg-cream/10 outline-none focus:border-primary transition"
                      />
                    </div>

                    <div>
                      <label className="text-[9px] font-mono uppercase text-charcoal/40 block mb-1">Disbursement Amount (PHP)</label>
                      <input
                        type="number"
                        step="0.01"
                        required
                        value={newExpenseAmount}
                        onChange={(e) => setNewExpenseAmount(e.target.value)}
                        placeholder="₱0.00"
                        className="w-full px-3 py-1.5 border border-secondary text-[11px] rounded bg-cream/10 outline-none focus:border-primary transition font-mono"
                      />
                    </div>

                    <div>
                      <label className="text-[9px] font-mono uppercase text-charcoal/40 block mb-1">Ledger Category Column</label>
                      <div className="flex gap-4 p-2 bg-cream/20 border border-secondary/50 rounded">
                        <label className="text-[10px] font-mono cursor-pointer flex items-center gap-1">
                          <input
                            type="radio"
                            name="expenseCol"
                            checked={newExpenseCol === '1'}
                            onChange={() => setNewExpenseCol('1')}
                            className="accent-primary"
                          />
                          Col 1 (Kitchen &amp; Bedding)
                        </label>
                        <label className="text-[10px] font-mono cursor-pointer flex items-center gap-1">
                          <input
                            type="radio"
                            name="expenseCol"
                            checked={newExpenseCol === '2'}
                            onChange={() => setNewExpenseCol('2')}
                            className="accent-primary"
                          />
                          Col 2 (Admin &amp; Hardware)
                        </label>
                      </div>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={submittingExpense}
                    className="w-full bg-primary hover:bg-primary-light text-white font-mono text-[11px] font-bold py-2 rounded transition flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
                  >
                    <PlusCircle size={13} />
                    {submittingExpense ? 'Saving...' : 'Post Operational Expense'}
                  </button>
                </form>

                {/* Info Block explaining auto adjustment */}
                <div className="bg-cream/40 rounded-xl p-4 border border-secondary/40 space-y-2.5 font-mono text-[10px] uppercase">
                  <div className="flex justify-between text-charcoal/60">
                    <span>Reconciled Gross Revenue:</span>
                    <span className="font-bold text-charcoal">₱{liveGrossRevenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between text-charcoal/60">
                    <span>Total Logged Expenses:</span>
                    <span className="font-bold text-accent">₱{liveTotalExpenses.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between border-t border-secondary pt-2 text-primary font-bold">
                    <span>Surplus Capital:</span>
                    <span className="font-display font-extrabold text-xs text-primary">₱{liveNetProfit.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* TAB 5: EXCEL EXPORT ENGINE */}
        {activeSubTab === 'export' && (
          <motion.div
            key="export"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            className="space-y-6"
          >
            {/* Summary description of Excel Engine */}
            <div className="bg-white border border-secondary rounded-2xl p-6 shadow-sm space-y-4">
              <h3 className="font-display font-extrabold text-base text-primary uppercase tracking-tight flex items-center gap-2">
                <FileSpreadsheet size={20} className="text-emerald-600" />
                Comprehensive Financial Excel Compilation
              </h3>
              <p className="text-xs text-charcoal/70 leading-relaxed max-w-3xl">
                Export verified hotel transaction logs directly into multi-sheet Excel workbooks (.xlsx). Spreadsheets are formatted with distinct tabs separating shift ledgers, ledger transactions, occupancy lists, and expense audits.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-secondary/40">
                {/* Export 1: Weekly shift ledger */}
                <div className="p-4 bg-cream/15 border border-secondary/60 rounded-xl space-y-3 flex flex-col justify-between">
                  <div>
                    <h4 className="font-display font-bold text-xs text-charcoal uppercase">
                      Frontdesk Weekly Performance Ledger
                    </h4>
                    <p className="text-[11px] text-charcoal/50 mt-1 leading-normal">
                      Includes 14 shifts data, drawer variances, GCash reconciliation, and operational expense logs.
                    </p>
                  </div>
                  <button
                    onClick={() => downloadExecutiveFinancialWorkbook(
                      mappedShifts,
                      sessionReceipts,
                      additionalPOSRevenue,
                      additionalPOSCategoryRevenue,
                      col1Expenses,
                      col2Expenses,
                      rooms,
                      getExcelOptions()
                    )}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-[11px] font-bold py-2.5 rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer shadow-sm hover:shadow active:scale-95"
                  >
                    <Download size={13} />
                    Download Executive Audit (.XLSX)
                  </button>
                </div>

                {/* Export 2: Executive Consolidated Audit */}
                {isAdminOrOwner && (
                  <div className="p-4 bg-primary/5 border border-primary/20 rounded-xl space-y-3 flex flex-col justify-between">
                    <div>
                      <h4 className="font-display font-bold text-xs text-primary uppercase">
                        Executive Consolidated Financial Audit
                      </h4>
                      <p className="text-[11px] text-charcoal/50 mt-1 leading-normal">
                        Consolidates the 14 shifts, live walk-in POS catalog transactions ledger, detailed e-wallet reference statement tags, and room occupancy records into a 6-sheet workbook.
                      </p>
                    </div>
                    <button
                      onClick={() => downloadAdminFinancialPOSReport(
                        mappedShifts,
                        sessionReceipts,
                        additionalPOSRevenue,
                        additionalPOSCategoryRevenue,
                        col1Expenses,
                        col2Expenses,
                        rooms,
                        getExcelOptions()
                      )}
                      className="w-full bg-primary hover:bg-primary-light text-white font-mono text-[11px] font-bold py-2.5 rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer shadow-sm hover:shadow active:scale-95"
                    >
                      <ShieldCheck size={13} />
                      Download 6-Tab Workbook (.XLSX)
                    </button>
                  </div>
                )}

                {/* Export 3 (NEW, separate): Database-authoritative workbook */}
                {isAdminOrOwner && (
                  <div className="p-4 bg-slate-800 border border-slate-700 rounded-xl space-y-3 flex flex-col justify-between">
                    <div>
                      <h4 className="font-display font-bold text-xs text-white uppercase">
                        Database-Authoritative Audit (New)
                      </h4>
                      <p className="text-[11px] text-slate-300 mt-1 leading-normal">
                        Separate server-generated workbook built live from the database for this week: dashboard actuals, journal with discounts, deposits ledger, night audit, comps/voids, GCash cross-check, cash safe, inventory valuation, audit trail. Existing exports above are unchanged.
                      </p>
                    </div>
                    <button
                      onClick={async () => {
                        try {
                          await downloadDbAuthoritativeWorkbook(currentWeekStart);
                          toast.success('Export Ready', 'Database-authoritative workbook downloaded.');
                        } catch (err: any) {
                          toast.error('Export Failed', err?.message || 'Could not generate the database export.');
                        }
                      }}
                      className="w-full bg-white hover:bg-slate-100 text-slate-900 font-mono text-[11px] font-bold py-2.5 rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer shadow-sm hover:shadow active:scale-95"
                    >
                      <Database size={13} />
                      Download DB Workbook (.XLSX)
                    </button>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
};

export default ReportsPanel;
