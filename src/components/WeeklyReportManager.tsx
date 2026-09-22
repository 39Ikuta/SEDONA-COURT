/**
 * src/components/WeeklyReportManager.tsx
 * Complete weekly report management UI with data entry, editing, and export
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks, parseISO } from 'date-fns';
import {
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  Calendar,
  DollarSign,
  Plus,
  Trash2,
  Save,
  AlertCircle,
  CheckCircle,
  Loader,
} from 'lucide-react';
import { generateWeeklyReportExcel, generateDailyReportExcel } from '../utils/weeklyReportExporter';

interface WeeklyData {
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
    customExpenses: Array<{ name: string; amount: number; category: string }>;
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

export const WeeklyReportManager: React.FC = () => {
  const [selectedWeek, setSelectedWeek] = useState<Date>(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [weeklyData, setWeeklyData] = useState<WeeklyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'shifts' | 'expenses' | 'gcash' | 'cash'>('shifts');
  const [cashDenomInput, setCashDenomInput] = useState({
    bills_1000_count: 0,
    bills_500_count: 0,
    bills_200_count: 0,
    bills_100_count: 0,
    bills_50_count: 0,
    coins_total: 0,
    received_by: '',
  });
  const [selectedDay, setSelectedDay] = useState<string>(format(new Date(), 'yyyy-MM-dd'));

  // Load data when week changes
  useEffect(() => {
    loadWeekData(selectedWeek);
  }, [selectedWeek]);

  const loadWeekData = async (week: Date) => {
    try {
      setLoading(true);
      setError(null);
      const weekStartStr = format(week, 'yyyy-MM-dd');
      const response = await fetch(`/api/weekly-reports/${weekStartStr}`);

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.details || errData.error || `Server error (HTTP ${response.status})`);
      }

      const data = await response.json().catch(() => null);
      if (!data) {
        throw new Error('Invalid JSON response received from server');
      }

      setWeeklyData(data);
      setCashDenomInput(data.cashDenomination || {
        bills_1000_count: 0,
        bills_500_count: 0,
        bills_200_count: 0,
        bills_100_count: 0,
        bills_50_count: 0,
        coins_total: 0,
        received_by: '',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      console.error('Error loading weekly data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handlePreviousWeek = () => {
    setSelectedWeek((prev) => subWeeks(prev, 1));
  };

  const handleNextWeek = () => {
    setSelectedWeek((prev) => addWeeks(prev, 1));
  };

  const handleSaveCashDenom = async () => {
    try {
      setLoading(true);
      setError(null);
      const weekStartStr = format(selectedWeek, 'yyyy-MM-dd');
      const response = await fetch(`/api/weekly-reports/${weekStartStr}/cash-denom`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Operator': localStorage.getItem('loggedInUser') || 'UNASSIGNED',
        },
        body: JSON.stringify(cashDenomInput),
      });

      const data = await response.json();

      if (!response.ok) {
        const errorMsg = data.details || data.error || 'Failed to save cash denomination';
        setError(errorMsg);
        return;
      }

      setSuccessMessage('Cash denomination saved successfully');
      setTimeout(() => setSuccessMessage(null), 3000);
      await loadWeekData(selectedWeek);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleExportExcel = async () => {
    if (!weeklyData) return;

    try {
      generateWeeklyReportExcel(
        selectedWeek,
        weeklyData.shifts,
        weeklyData.expenses,
        weeklyData.gcash.entries,
        weeklyData.cashDenomination,
        cashDenomInput.received_by || 'RCA Admin'
      );

      setSuccessMessage('Excel report generated');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError('Failed to generate Excel file');
      console.error('Error:', err);
    }
  };

  const handleExportDailyExcel = async () => {
    if (!weeklyData) return;

    try {
      const targetDate = parseISO(selectedDay);
      generateDailyReportExcel(
        targetDate,
        weeklyData.shifts,
        weeklyData.expenses,
        weeklyData.gcash.entries,
        weeklyData.cashDenomination,
        cashDenomInput.received_by || 'RCA Admin'
      );

      setSuccessMessage('Daily Excel report generated');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError('Failed to generate Daily Excel file');
      console.error('Error:', err);
    }
  };

  if (loading && !weeklyData) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col gap-6 max-w-7xl mx-auto pb-12 font-sans">
      {/* HEADER */}
      <div className="bg-white border border-secondary rounded-2xl p-6 shadow-sm">
        <h1 className="font-display font-black text-2xl text-primary uppercase">Weekly Report Manager</h1>
        <p className="text-sm text-charcoal/60 mt-2">
          Manage shift entries, expenses, GCash tracking, and cash reconciliation
        </p>
      </div>

      {/* ALERTS */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex items-start gap-3"
          >
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-bold text-rose-900">Error</h3>
              <p className="text-sm text-rose-700">{error}</p>
            </div>
          </motion.div>
        )}
        {successMessage && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-start gap-3"
          >
            <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-bold text-emerald-900">Success</h3>
              <p className="text-sm text-emerald-700">{successMessage}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* WEEK SELECTOR */}
      <div className="bg-white border border-secondary rounded-2xl p-6 shadow-sm flex items-center justify-between">
        <button
          onClick={handlePreviousWeek}
          className="p-2 hover:bg-cream rounded-lg transition"
          title="Previous week"
        >
          <ChevronLeft className="w-5 h-5 text-primary" />
        </button>

        <div className="text-center">
          <div className="flex items-center gap-2 justify-center">
            <Calendar className="w-5 h-5 text-primary" />
            <span className="font-mono font-bold text-lg">
              {weeklyData?.period.weekLabel || 'Loading...'}
            </span>
          </div>
          <p className="text-xs text-charcoal/60 mt-1 font-mono">
            {format(selectedWeek, 'yyyy-MM-dd')} to {format(endOfWeek(selectedWeek, { weekStartsOn: 1 }), 'yyyy-MM-dd')}
          </p>
        </div>

        <button
          onClick={handleNextWeek}
          className="p-2 hover:bg-cream rounded-lg transition"
          title="Next week"
        >
          <ChevronRight className="w-5 h-5 text-primary" />
        </button>
      </div>

      {/* SUMMARY CARDS */}
      {weeklyData && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-secondary rounded-xl p-4 shadow-sm">
            <span className="text-xs font-mono text-charcoal/50 uppercase">Total Revenue</span>
            <span className="text-xl font-bold text-primary block mt-1">
              ₱{weeklyData.summary.totalRevenue.toLocaleString('en-PH', { maximumFractionDigits: 2 })}
            </span>
          </div>

          <div className="bg-white border border-secondary rounded-xl p-4 shadow-sm">
            <span className="text-xs font-mono text-charcoal/50 uppercase">GCash Sales</span>
            <span className="text-xl font-bold text-blue-600 block mt-1">
              ₱{weeklyData.summary.totalGCash.toLocaleString('en-PH', { maximumFractionDigits: 2 })}
            </span>
          </div>

          <div className="bg-white border border-secondary rounded-xl p-4 shadow-sm">
            <span className="text-xs font-mono text-charcoal/50 uppercase">Total Expenses</span>
            <span className="text-xl font-bold text-accent block mt-1">
              ₱{weeklyData.summary.totalExpenses.toLocaleString('en-PH', { maximumFractionDigits: 2 })}
            </span>
          </div>

          <div className="bg-white border border-secondary rounded-xl p-4 shadow-sm">
            <span className="text-xs font-mono text-charcoal/50 uppercase">Net Profit</span>
            <span className="text-xl font-bold text-emerald-600 block mt-1">
              ₱{weeklyData.summary.netProfit.toLocaleString('en-PH', { maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>
      )}

      {/* TAB NAVIGATION */}
      <div className="bg-white border border-secondary rounded-2xl p-2 flex gap-2 overflow-x-auto">
        {(['shifts', 'expenses', 'gcash', 'cash'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-xl font-mono text-xs font-bold uppercase transition whitespace-nowrap ${
              activeTab === tab ? 'bg-primary text-white' : 'text-charcoal/60 hover:bg-cream/50'
            }`}
          >
            {tab === 'shifts' && '📋 Shifts'}
            {tab === 'expenses' && '💰 Expenses'}
            {tab === 'gcash' && '📱 GCash'}
            {tab === 'cash' && '💵 Cash Count'}
          </button>
        ))}
      </div>

      {/* SHIFTS TAB */}
      {activeTab === 'shifts' && weeklyData && (
        <div className="bg-white border border-secondary rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead className="bg-cream/50 border-b border-secondary">
                <tr>
                  <th className="px-3 py-2 text-left font-bold text-charcoal/70">Date</th>
                  <th className="px-3 py-2 text-left font-bold text-charcoal/70">Shift</th>
                  <th className="px-3 py-2 text-left font-bold text-charcoal/70">Cashier</th>
                  <th className="px-3 py-2 text-right font-bold text-charcoal/70">Check-ins</th>
                  <th className="px-3 py-2 text-right font-bold text-charcoal/70">Room</th>
                  <th className="px-3 py-2 text-right font-bold text-charcoal/70">Kitchen</th>
                  <th className="px-3 py-2 text-right font-bold text-charcoal/70">Drinks</th>
                  <th className="px-3 py-2 text-right font-bold text-charcoal/70">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-secondary/30">
                {weeklyData.shifts.map((shift, idx) => (
                  <tr key={idx} className="hover:bg-cream/20">
                    <td className="px-3 py-2">{shift.date}</td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                        shift.shiftType === 'DAY' ? 'bg-amber-100 text-amber-700' : 'bg-indigo-100 text-indigo-700'
                      }`}>
                        {shift.shiftType}
                      </span>
                    </td>
                    <td className="px-3 py-2">{shift.cashier}</td>
                    <td className="px-3 py-2 text-right">{shift.totalCheckins}</td>
                    <td className="px-3 py-2 text-right">₱{shift.roomBill.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">₱{shift.kitchenBill.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">₱{shift.drinksBill.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right font-bold text-primary">
                      ₱{shift.paymentReceived.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* EXPENSES TAB */}
      {activeTab === 'expenses' && weeklyData && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Column 1 */}
          <div className="bg-white border border-secondary rounded-2xl p-5 shadow-sm">
            <h3 className="font-bold text-sm uppercase mb-4">Operations & Supplies</h3>
            <div className="space-y-2 font-mono text-xs divide-y divide-secondary/30 max-h-96 overflow-y-auto">
              {Object.entries(weeklyData.expenses.col1)
                .filter(([k]) => k !== 'subtotal')
                .map(([key, value]) => (
                  <div key={key} className="py-2 flex justify-between">
                    <span className="text-charcoal/70 capitalize">{key.replace(/([A-Z])/g, ' $1').toLowerCase()}</span>
                    <span className="font-bold">₱{(value as number).toLocaleString()}</span>
                  </div>
                ))}
            </div>
            <div className="mt-4 pt-4 border-t border-secondary font-bold flex justify-between">
              <span>Subtotal</span>
              <span>₱{weeklyData.expenses.col1.subtotal.toLocaleString()}</span>
            </div>
          </div>

          {/* Column 2 */}
          <div className="bg-white border border-secondary rounded-2xl p-5 shadow-sm">
            <h3 className="font-bold text-sm uppercase mb-4">Admin & Personnel</h3>
            <div className="space-y-2 font-mono text-xs divide-y divide-secondary/30">
              {Object.entries(weeklyData.expenses.col2)
                .filter(([k]) => k !== 'subtotal')
                .map(([key, value]) => (
                  <div key={key} className="py-2 flex justify-between">
                    <span className="text-charcoal/70 capitalize">{key.replace(/([A-Z])/g, ' $1').toLowerCase()}</span>
                    <span className="font-bold">₱{(value as number).toLocaleString()}</span>
                  </div>
                ))}
            </div>
            <div className="mt-4 pt-4 border-t border-secondary font-bold flex justify-between">
              <span>Subtotal</span>
              <span>₱{weeklyData.expenses.col2.subtotal.toLocaleString()}</span>
            </div>
          </div>

          {/* Summary */}
          <div className="bg-white border border-secondary rounded-2xl p-5 shadow-sm">
            <h3 className="font-bold text-sm uppercase mb-4">Summary</h3>
            <div className="space-y-3 font-mono text-sm">
              <div className="flex justify-between pb-3 border-b border-secondary">
                <span>Col 1</span>
                <span className="font-bold">₱{weeklyData.expenses.col1.subtotal.toLocaleString()}</span>
              </div>
              <div className="flex justify-between pb-3 border-b border-secondary">
                <span>Col 2</span>
                <span className="font-bold">₱{weeklyData.expenses.col2.subtotal.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-lg font-bold text-primary pt-2">
                <span>Total</span>
                <span>₱{weeklyData.expenses.total.toLocaleString()}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* GCASH TAB */}
      {activeTab === 'gcash' && weeklyData && (
        <div className="bg-white border border-secondary rounded-2xl overflow-hidden shadow-sm">
          <div className="p-6 border-b border-secondary">
            <div className="flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-primary" />
              <span className="font-mono font-bold text-lg">
                Total GCash: ₱{weeklyData.gcash.total.toLocaleString('en-PH', { maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          {weeklyData.gcash.entries.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead className="bg-cream/50 border-b border-secondary">
                  <tr>
                    <th className="px-3 py-2 text-left font-bold">Date</th>
                    <th className="px-3 py-2 text-left font-bold">Reference</th>
                    <th className="px-3 py-2 text-left font-bold">Guest</th>
                    <th className="px-3 py-2 text-right font-bold">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-secondary/30">
                  {weeklyData.gcash.entries.map((entry, idx) => (
                    <tr key={idx} className="hover:bg-cream/20">
                      <td className="px-3 py-2">{entry.date}</td>
                      <td className="px-3 py-2">{entry.referenceNumber}</td>
                      <td className="px-3 py-2">{entry.guestName}</td>
                      <td className="px-3 py-2 text-right font-bold">₱{entry.amount.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-6 text-center text-charcoal/50 font-mono">No GCash entries for this week</div>
          )}
        </div>
      )}

      {/* CASH COUNT TAB */}
      {activeTab === 'cash' && (
        <div className="bg-white border border-secondary rounded-2xl p-6 shadow-sm space-y-6">
          <h3 className="font-bold text-lg">Cash Denomination Count</h3>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {[
              { label: '₱1000 Bills', key: 'bills_1000_count' },
              { label: '₱500 Bills', key: 'bills_500_count' },
              { label: '₱200 Bills', key: 'bills_200_count' },
              { label: '₱100 Bills', key: 'bills_100_count' },
              { label: '₱50 Bills', key: 'bills_50_count' },
              { label: 'Coins (PHP)', key: 'coins_total' },
            ].map((item) => (
              <div key={item.key} className="space-y-2">
                <label className="text-xs font-mono uppercase text-charcoal/60">{item.label}</label>
                <input
                  type="number"
                  value={cashDenomInput[item.key as keyof typeof cashDenomInput] || 0}
                  onChange={(e) =>
                    setCashDenomInput({
                      ...cashDenomInput,
                      [item.key]: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-full px-3 py-2 border border-secondary rounded-lg font-mono text-sm"
                />
              </div>
            ))}
          </div>

          <div className="space-y-2 pt-4 border-t border-secondary">
            <label className="text-xs font-mono uppercase text-charcoal/60">Received By</label>
            <input
              type="text"
              value={cashDenomInput.received_by || ''}
              onChange={(e) =>
                setCashDenomInput({
                  ...cashDenomInput,
                  received_by: e.target.value,
                })
              }
              placeholder="Enter name or initials"
              className="w-full px-3 py-2 border border-secondary rounded-lg"
            />
          </div>

          <button
            onClick={handleSaveCashDenom}
            disabled={loading}
            className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-charcoal/30 text-white font-mono text-sm font-bold py-3 px-4 rounded-lg transition flex items-center justify-center gap-2"
          >
            <Save size={16} />
            {loading ? 'Saving...' : 'Save Cash Count'}
          </button>
        </div>
      )}

      {/* EXPORT BUTTON */}
      <div className="flex flex-col sm:flex-row gap-4 justify-end items-end">
        <div className="flex gap-2 items-center bg-cream/50 p-2 rounded-xl border border-secondary">
           <input 
             type="date" 
             value={selectedDay}
             onChange={(e) => setSelectedDay(e.target.value)}
             className="px-3 py-2 border border-secondary rounded-lg font-mono text-sm"
           />
           <button
             onClick={handleExportDailyExcel}
             disabled={loading || !weeklyData}
             className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-charcoal/30 text-white font-mono font-bold py-2 px-4 rounded-xl transition flex items-center gap-2"
           >
             <FileSpreadsheet size={18} />
             Export Daily
           </button>
        </div>

        <button
          onClick={handleExportExcel}
          disabled={loading || !weeklyData}
          className="bg-primary hover:bg-primary-light disabled:bg-charcoal/30 text-white font-mono font-bold py-3 px-6 rounded-2xl transition flex items-center gap-2"
        >
          <FileSpreadsheet size={18} />
          Export Weekly
        </button>
      </div>
    </div>
  );
};
