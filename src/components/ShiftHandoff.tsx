import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  Printer,
  Calendar,
  Clock,
  User,
  Wallet,
  CreditCard,
  DollarSign,
  CheckCircle2,
  AlertCircle,
  Plus,
  Trash2,
  CheckSquare,
  Square,
  Sparkles,
  BookOpen,
  ClipboardList,
  FileSpreadsheet,
  Download
} from 'lucide-react';
import { Room, Receipt } from '../types';
import { downloadDailyExcelReport } from '../utils/excelGenerator';
import { downloadShiftForms } from '../api/reportExports';
import { printBrowserReceipt } from '../utils/printBrowserReceipt';

interface HandoffTask {
  id: string;
  text: string;
  completed: boolean;
  priority: 'low' | 'medium' | 'high';
  assignedTo?: string;
}

interface ShiftHandoffProps {
  rooms: Room[];
  activeCashier: string;
  sessionReceipts: Receipt[];
  pendingTasks: HandoffTask[];
  onToggleTask: (id: string) => void;
  onAddTask: (text: string, priority: 'low' | 'medium' | 'high') => void;
  onDeleteTask: (id: string) => void;
  onClose: () => void;
  onConfirmLogout: () => void;
}

export const ShiftHandoff: React.FC<ShiftHandoffProps> = ({
  rooms,
  activeCashier,
  sessionReceipts,
  pendingTasks,
  onToggleTask,
  onAddTask,
  onDeleteTask,
  onClose,
  onConfirmLogout,
}) => {
  // Local state for starting and ending cash drawer counts to simulate reconciliation
  const [startingFloat, setStartingFloat] = useState<number>(5000);
  const [endingDrawerInput, setEndingDrawerInput] = useState<string>('');
  const [newTaskText, setNewTaskText] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [showPrintView, setShowPrintView] = useState(false);
  const [incomingOperator, setIncomingOperator] = useState('PAU');
  const [exportingForms, setExportingForms] = useState(false);
  const [formsError, setFormsError] = useState<string | null>(null);
  const [shiftType, setShiftType] = useState<'DAY' | 'NIGHT'>(() => {
    const hour = new Date().getHours();
    return (hour >= 6 && hour < 18) ? 'DAY' : 'NIGHT';
  });

  // Derive cash and gcash sales from sessionReceipts
  const cashSales = sessionReceipts.reduce((sum, r) => {
    if (r.paymentMethod === 'CASH') return sum + r.total;
    if (r.paymentMethod === 'MIXED') return sum + (r.cashAmount || 0);
    return sum;
  }, 0);

  const gcashSales = sessionReceipts.reduce((sum, r) => {
    if (r.paymentMethod === 'GCASH') return sum + r.total;
    if (r.paymentMethod === 'MIXED') return sum + (r.gcashAmount || 0);
    return sum;
  }, 0);

  const totalSessionRevenue = cashSales + gcashSales;

  // Expected cash in drawer = Starting Float + Cash Sales
  const expectedCashInDrawer = startingFloat + cashSales;
  const actualCashInDrawer = endingDrawerInput !== '' ? parseFloat(endingDrawerInput) : expectedCashInDrawer;
  const drawerVariance = actualCashInDrawer - expectedCashInDrawer;

  // Active Occupied / Overdue rooms counting
  const occupiedCount = rooms.filter(r => r.state === 'occupied').length;
  const overdueCount = rooms.filter(r => r.state === 'overdue').length;
  const cleaningCount = rooms.filter(r => r.state === 'cleaning').length;
  const availableCount = rooms.filter(r => r.state === 'available').length;

  const currentDateTime = new Date().toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  const handleAddNewTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskText.trim()) return;
    onAddTask(newTaskText.trim(), newTaskPriority);
    setNewTaskText('');
  };

  const triggerPrint = () => {
    printBrowserReceipt('printable-shift-settlement');
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-charcoal/40 backdrop-blur-sm flex items-center justify-center p-4 md:p-6 font-sans">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        className="bg-white rounded-3xl shadow-xl border border-secondary max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col"
      >
        {/* HEADER */}
        <div className="bg-primary text-white p-5 md:p-6 flex justify-between items-center shrink-0 border-b border-primary-light/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-white font-display font-bold text-lg border border-white/10">
              ⚡
            </div>
            <div>
              <h2 className="font-display text-base md:text-lg font-black uppercase tracking-tight">
                Shift Terminal Handoff &amp; Remittance
              </h2>
              <p className="text-[10px] text-cream/70 font-mono tracking-wider uppercase">
                Active cash drawer audit &amp; pending operations list
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/10 rounded-xl transition text-cream hover:text-white cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* MAIN BODY SCROLL */}
        <div className="flex-1 overflow-y-auto p-5 md:p-6 space-y-6 bg-cream/10">
          {/* TOP QUICK METRICS */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-2xl border border-secondary shadow-sm flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-primary/5 text-primary flex items-center justify-center shrink-0">
                <User size={18} />
              </div>
              <div className="min-w-0">
                <span className="text-[10px] font-mono text-charcoal/40 uppercase tracking-wider block">
                  Outgoing Operator
                </span>
                <span className="font-mono text-sm font-bold text-primary block">
                  {activeCashier} &bull; STATION FD-01
                </span>
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-secondary shadow-sm flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center shrink-0">
                <Clock size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-[10px] font-mono text-charcoal/40 uppercase tracking-wider block">
                  Shifting Schedule (12H)
                </span>
                <span className="font-mono text-xs font-bold text-charcoal block truncate">
                  {shiftType === 'DAY' ? 'DAY SHIFT' : 'NIGHT SHIFT'} &bull; {shiftType === 'DAY' ? '06AM-06PM' : '06PM-06AM'}
                </span>
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-secondary shadow-sm flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                <Wallet size={18} />
              </div>
              <div className="min-w-0">
                <span className="text-[10px] font-mono text-charcoal/40 uppercase tracking-wider block">
                  Cash Revenue Collected
                </span>
                <span className="font-mono text-sm font-bold text-emerald-700 block">
                  ₱{cashSales.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-secondary shadow-sm flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center shrink-0">
                <CreditCard size={18} />
              </div>
              <div className="min-w-0">
                <span className="text-[10px] font-mono text-charcoal/40 uppercase tracking-wider block">
                  GCash Revenue Collected
                </span>
                <span className="font-mono text-sm font-bold text-blue-700 block">
                  ₱{gcashSales.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* LEFT COLUMN: ACTIVE RECONCILIATION */}
            <div className="space-y-4">
              {/* 12-HOUR SHIFT CONTROL PANEL */}
              <div className="bg-white p-5 rounded-2xl border border-secondary shadow-sm space-y-4">
                <div className="flex justify-between items-center border-b border-secondary pb-2">
                  <h3 className="font-display text-xs font-bold text-primary uppercase tracking-wider flex items-center gap-2">
                    <Clock size={14} className="text-accent" />
                    12-Hour Rotational Shift Control
                  </h3>
                  <span className="bg-amber-100 text-amber-800 text-[8px] px-2 py-0.5 rounded-full font-mono font-bold uppercase tracking-wider">
                    Protocol 12H-Rotational
                  </span>
                </div>

                <p className="text-[11px] text-charcoal/60 leading-relaxed">
                  Sedona Court runs standard <strong className="text-primary font-bold">12-hour shifts</strong> for frontdesk operators. Please select your active shift to correctly partition this session's cash and digital sales:
                </p>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setShiftType('DAY')}
                    className={`p-3 rounded-xl border text-left transition relative overflow-hidden flex flex-col justify-between cursor-pointer ${
                      shiftType === 'DAY'
                        ? 'bg-amber-50/50 border-amber-500 ring-2 ring-amber-500/10 font-bold'
                        : 'bg-white border-secondary hover:bg-cream/15'
                    }`}
                  >
                    <div className="flex justify-between items-center w-full">
                      <span className={`text-[10px] font-mono font-bold ${shiftType === 'DAY' ? 'text-amber-700' : 'text-charcoal/40'}`}>
                        DAY SHIFT
                      </span>
                      <span className="text-lg">☀️</span>
                    </div>
                    <div className="mt-2">
                      <span className="text-xs font-bold block text-primary">06:00 AM - 06:00 PM</span>
                      <span className="text-[9px] text-charcoal/50 font-mono block mt-0.5">Rotational Cashier Slot</span>
                    </div>
                    {shiftType === 'DAY' && (
                      <div className="absolute top-0 right-0 bg-amber-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-bl">
                        ACTIVE
                      </div>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setShiftType('NIGHT')}
                    className={`p-3 rounded-xl border text-left transition relative overflow-hidden flex flex-col justify-between cursor-pointer ${
                      shiftType === 'NIGHT'
                        ? 'bg-indigo-50/50 border-indigo-500 ring-2 ring-indigo-500/10 font-bold'
                        : 'bg-white border-secondary hover:bg-cream/15'
                    }`}
                  >
                    <div className="flex justify-between items-center w-full">
                      <span className={`text-[10px] font-mono font-bold ${shiftType === 'NIGHT' ? 'text-indigo-700' : 'text-charcoal/40'}`}>
                        NIGHT SHIFT
                      </span>
                      <span className="text-lg">🌙</span>
                    </div>
                    <div className="mt-2">
                      <span className="text-xs font-bold block text-primary">06:00 PM - 06:00 AM</span>
                      <span className="text-[9px] text-charcoal/50 font-mono block mt-0.5">Rotational Cashier Slot</span>
                    </div>
                    {shiftType === 'NIGHT' && (
                      <div className="absolute top-0 right-0 bg-indigo-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-bl">
                        ACTIVE
                      </div>
                    )}
                  </button>
                </div>

                <div className="bg-cream/40 p-2.5 rounded-xl border border-secondary/60 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                  <span className="text-[10px] font-mono text-charcoal/60">
                    Auto-detected based on terminal hour (System Hour: {new Date().getHours()}:00)
                  </span>
                </div>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-secondary shadow-sm space-y-4">
                <h3 className="font-display text-xs font-bold text-primary uppercase tracking-wider border-b border-secondary pb-2 flex items-center gap-2">
                  <DollarSign size={14} className="text-accent" />
                  Cash Register Audit &amp; Reconciliation
                </h3>

                <div className="grid grid-cols-2 gap-3 font-mono text-xs">
                  <div>
                    <label className="text-[10px] text-charcoal/50 block mb-1">STARTING DRAWER FLOAT</label>
                    <input
                      type="number"
                      value={startingFloat}
                      onChange={(e) => setStartingFloat(parseFloat(e.target.value) || 0)}
                      className="w-full bg-cream/30 border border-secondary p-2 rounded-xl focus:outline-none focus:border-primary text-xs font-bold"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-charcoal/50 block mb-1">ACTUAL CASH IN DRAWER</label>
                    <input
                      type="number"
                      placeholder={`Expected: ₱${expectedCashInDrawer}`}
                      value={endingDrawerInput}
                      onChange={(e) => setEndingDrawerInput(e.target.value)}
                      className="w-full bg-cream/30 border border-secondary p-2 rounded-xl focus:outline-none focus:border-primary text-xs font-bold"
                    />
                  </div>
                </div>

                <div className="p-3 bg-cream/40 rounded-xl border border-secondary/60 space-y-2">
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-charcoal/60">Expected Cash sales:</span>
                    <span className="font-bold">₱{cashSales.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-charcoal/60">Expected Cash Drawer:</span>
                    <span className="font-bold">₱{expectedCashInDrawer.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between text-xs font-mono border-t border-secondary/80 pt-2">
                    <span className="font-bold text-charcoal">Reconciliation Result:</span>
                    <span className={`font-bold font-mono ${
                      drawerVariance === 0
                        ? 'text-emerald-600'
                        : drawerVariance > 0
                        ? 'text-blue-600'
                        : 'text-rose-600'
                    }`}>
                      {drawerVariance === 0 ? (
                        'BALANCED (₱0.00)'
                      ) : drawerVariance > 0 ? (
                        `OVERAGE (+₱${drawerVariance.toLocaleString('en-US', { minimumFractionDigits: 2 })})`
                      ) : (
                        `SHORTAGE (₱${drawerVariance.toLocaleString('en-US', { minimumFractionDigits: 2 })})`
                      )}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <label className="text-[10px] font-mono text-charcoal/50 uppercase tracking-wider shrink-0">
                    INCOMING OPERATOR:
                  </label>
                  <select
                    value={incomingOperator}
                    onChange={(e) => setIncomingOperator(e.target.value)}
                    className="bg-cream/40 border border-secondary p-1 px-2 rounded-lg font-mono text-xs font-bold text-primary focus:outline-none cursor-pointer"
                  >
                    <option value="PAU">PAU (Incoming Shift)</option>
                    <option value="ANN">ANN (Incoming Shift)</option>
                    <option value="RCA">RCA (Shift Supervisor)</option>
                  </select>
                </div>
              </div>

              {/* DAILY BOOKINGS & STATE OVERVIEW */}
              <div className="bg-white p-5 rounded-2xl border border-secondary shadow-sm space-y-4">
                <h3 className="font-display text-xs font-bold text-primary uppercase tracking-wider border-b border-secondary pb-2 flex items-center gap-2">
                  <BookOpen size={14} className="text-accent" />
                  Frontdesk Apartment Occupancy
                </h3>

                <div className="grid grid-cols-4 gap-2 text-center">
                  <div className="p-2 bg-emerald-50 rounded-xl border border-emerald-100/50">
                    <span className="text-xl font-bold font-mono text-emerald-700 block">{occupiedCount}</span>
                    <span className="text-[8px] text-emerald-600 font-mono uppercase font-bold">Occupied</span>
                  </div>
                  <div className="p-2 bg-rose-50 rounded-xl border border-rose-100/50">
                    <span className="text-xl font-bold font-mono text-rose-700 block">{overdueCount}</span>
                    <span className="text-[8px] text-rose-600 font-mono uppercase font-bold">Overdue</span>
                  </div>
                  <div className="p-2 bg-amber-50 rounded-xl border border-amber-100/50">
                    <span className="text-xl font-bold font-mono text-amber-700 block">{cleaningCount}</span>
                    <span className="text-[8px] text-amber-600 font-mono uppercase font-bold">Cleaning</span>
                  </div>
                  <div className="p-2 bg-charcoal/5 rounded-xl border border-secondary">
                    <span className="text-xl font-bold font-mono text-charcoal/60 block">{availableCount}</span>
                    <span className="text-[8px] text-charcoal/50 font-mono uppercase font-bold">Vacant</span>
                  </div>
                </div>

                {/* LOG OF GENERATED RECEIPTS */}
                <div className="space-y-1.5">
                  <span className="text-[9px] font-mono text-charcoal/40 uppercase tracking-widest block">
                    Session Transactions ({sessionReceipts.length})
                  </span>
                  {sessionReceipts.length === 0 ? (
                    <p className="text-[10px] text-charcoal/40 font-mono italic p-3 bg-cream/30 border border-secondary rounded-xl text-center">
                      No checkouts or cash orders generated in this session yet.
                    </p>
                  ) : (
                    <div className="max-h-[140px] overflow-y-auto space-y-1.5 pr-1 border border-secondary/50 rounded-xl p-2 bg-cream/20">
                      {sessionReceipts.map((r, i) => (
                        <div
                          key={r.receiptNo + i}
                          className="flex justify-between items-center text-[10px] font-mono bg-white p-2 border border-secondary rounded-lg"
                        >
                          <div>
                            <span className="font-bold text-primary block">{r.receiptNo}</span>
                            <span className="text-charcoal/50 text-[9px]">
                              Room {r.roomNumber} &bull; {r.guestName}
                            </span>
                          </div>
                          <div className="text-right">
                            <span className="font-bold text-charcoal block">
                              ₱{r.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </span>
                            <span className={`text-[8px] font-bold px-1 py-0.2 rounded uppercase ${
                              r.paymentMethod === 'GCASH'
                                ? 'bg-blue-50 text-blue-600'
                                : r.paymentMethod === 'MIXED'
                                  ? 'bg-purple-50 text-purple-600'
                                  : 'bg-emerald-50 text-emerald-600'
                            }`}>
                              {r.paymentMethod}
                            </span>
                            {r.paymentMethod === 'MIXED' && (
                              <span className="block text-[8px] text-charcoal/40 font-mono mt-0.5">
                                ₱{(r.cashAmount || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}/₱{(r.gcashAmount || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* RIGHT COLUMN: PENDING TASKS CHECKLIST */}
            <div className="bg-white p-5 rounded-2xl border border-secondary shadow-sm flex flex-col h-full space-y-4">
              <div className="flex justify-between items-center border-b border-secondary pb-2 shrink-0">
                <h3 className="font-display text-xs font-bold text-primary uppercase tracking-wider flex items-center gap-2">
                  <ClipboardList size={14} className="text-accent" />
                  Operator Tasks &amp; Shift Notes Handoff
                </h3>
                <span className="bg-primary/5 text-primary text-[10px] px-2 py-0.5 rounded-full font-mono font-bold">
                  {pendingTasks.filter(t => !t.completed).length} Pending
                </span>
              </div>

              {/* Tasks Checklist */}
              <div className="flex-1 overflow-y-auto max-h-[220px] space-y-2 pr-1">
                {pendingTasks.length === 0 ? (
                  <p className="text-xs text-charcoal/40 italic text-center py-6">
                    No active tasks or shift notes. Add some below to handoff!
                  </p>
                ) : (
                  pendingTasks.map((task) => (
                    <div
                      key={task.id}
                      className={`flex items-start justify-between gap-3 p-3 rounded-xl border transition text-xs ${
                        task.completed
                          ? 'bg-cream/10 border-secondary/40 text-charcoal/40 line-through'
                          : 'bg-white border-secondary hover:bg-cream/5'
                      }`}
                    >
                      <button
                        onClick={() => onToggleTask(task.id)}
                        className="mt-0.5 text-primary hover:text-primary-light transition cursor-pointer shrink-0"
                      >
                        {task.completed ? (
                          <CheckSquare size={16} className="text-emerald-600" />
                        ) : (
                          <Square size={16} />
                        )}
                      </button>
                      <span className="flex-1 break-words">{task.text}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-[8px] font-mono font-bold uppercase px-1.5 py-0.5 rounded ${
                          task.priority === 'high'
                            ? 'bg-rose-100 text-rose-700 border border-rose-200'
                            : task.priority === 'medium'
                            ? 'bg-amber-100 text-amber-700 border border-amber-200'
                            : 'bg-cream text-charcoal/60 border border-secondary'
                        }`}>
                          {task.priority}
                        </span>
                        <button
                          onClick={() => onDeleteTask(task.id)}
                          className="text-charcoal/30 hover:text-accent p-1 rounded transition cursor-pointer"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Task Adding Form */}
              <form onSubmit={handleAddNewTask} className="space-y-3 pt-3 border-t border-secondary shrink-0">
                <div className="flex gap-2">
                  <input
                    type="text"
                    required
                    placeholder="Enter pending task or critical handoff note..."
                    value={newTaskText}
                    onChange={(e) => setNewTaskText(e.target.value)}
                    className="flex-1 px-3 py-2 text-xs bg-cream/30 border border-secondary rounded-xl focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  />
                  <button
                    type="submit"
                    className="bg-primary hover:bg-primary-light text-white p-2.5 rounded-xl transition cursor-pointer shrink-0 flex items-center justify-center active:scale-95"
                  >
                    <Plus size={16} />
                  </button>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-[10px] font-mono text-charcoal/40 uppercase tracking-wider">
                    PRIORITY LEVEL:
                  </span>
                  <div className="flex gap-2">
                    {(['low', 'medium', 'high'] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setNewTaskPriority(p)}
                        className={`text-[9px] font-mono uppercase font-bold px-2.5 py-1 rounded-lg border transition cursor-pointer ${
                          newTaskPriority === p
                            ? p === 'high'
                              ? 'bg-rose-500 border-rose-500 text-white'
                              : p === 'medium'
                              ? 'bg-amber-500 border-amber-500 text-white'
                              : 'bg-charcoal border-charcoal text-white'
                            : 'bg-white border-secondary text-charcoal hover:bg-cream/30'
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>

         {/* BOTTOM ACTION BUTTONS */}
        <div className="bg-cream/40 p-5 md:p-6 border-t border-secondary/50 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-4 shrink-0">
          <div className="flex flex-wrap gap-2.5 self-stretch sm:self-auto">
            <button
              onClick={() => setShowPrintView(true)}
              className="flex-1 sm:flex-none border border-secondary bg-white text-charcoal hover:bg-cream/40 font-mono text-xs font-bold py-3 px-5 rounded-2xl cursor-pointer transition text-center flex items-center justify-center gap-2 active:scale-95 shadow-sm"
            >
              <Printer size={14} /> Preview Printable Slip
            </button>
            <button
              onClick={() => downloadDailyExcelReport(
                rooms,
                activeCashier,
                sessionReceipts,
                pendingTasks,
                startingFloat,
                actualCashInDrawer,
                incomingOperator,
                shiftType
              )}
              id="export-shift-excel-btn"
              className="flex-1 sm:flex-none bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs font-bold py-3 px-5 rounded-2xl cursor-pointer transition text-center flex items-center justify-center gap-2 active:scale-95 shadow-sm"
              title="Download formatted Excel report of receipts, pending tasks, cash reconciliation, and room status for incoming shift and admin"
            >
              <FileSpreadsheet size={15} /> Download Shift &amp; Admin Report (.XLSX)
            </button>
            <button
              onClick={async () => {
                const now = new Date();
                const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
                setFormsError(null);
                setExportingForms(true);
                try {
                  await downloadShiftForms(today, shiftType);
                } catch (err: any) {
                  setFormsError(err?.message || 'Could not generate shift forms.');
                } finally {
                  setExportingForms(false);
                }
              }}
              disabled={exportingForms}
              className="flex-1 sm:flex-none bg-slate-800 hover:bg-slate-900 text-white font-mono text-xs font-bold py-3 px-5 rounded-2xl cursor-pointer transition text-center flex items-center justify-center gap-2 active:scale-95 shadow-sm disabled:opacity-50"
              title="Download printable Cashier Transaction + Shift Transfer forms for this shift from the database (new)"
            >
              <Download size={15} /> {exportingForms ? 'Generating…' : 'Shift Forms (New) (.XLSX)'}
            </button>
            <button
              onClick={async () => {
                const now = new Date();
                const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
                setFormsError(null);
                setExportingForms(true);
                try {
                  await downloadShiftForms(today, shiftType, 'transfer');
                } catch (err: any) {
                  setFormsError(err?.message || 'Could not generate transfer form.');
                } finally {
                  setExportingForms(false);
                }
              }}
              disabled={exportingForms}
              className="flex-1 sm:flex-none bg-white hover:bg-cream/60 border border-slate-400 text-slate-800 font-mono text-xs font-bold py-3 px-5 rounded-2xl cursor-pointer transition text-center flex items-center justify-center gap-2 active:scale-95 shadow-sm disabled:opacity-50"
              title="Download only the Shift Transfer Form handoff slip for this shift (new)"
            >
              <Download size={15} /> Transfer Form (.XLSX)
            </button>
            {formsError && (
              <p className="w-full text-[11px] font-mono text-rose-700">{formsError}</p>
            )}
          </div>

          <div className="flex gap-2.5 self-stretch sm:self-auto">
            <button
              onClick={onClose}
              className="flex-1 sm:flex-none bg-white hover:bg-cream/30 border border-secondary text-charcoal font-sans text-xs font-bold py-3 px-5 rounded-2xl cursor-pointer transition text-center active:scale-95"
            >
              Cancel &amp; Stay
            </button>
            <button
              onClick={onConfirmLogout}
              className="flex-[2] sm:flex-none bg-accent hover:bg-accent-light text-white font-sans text-xs font-bold py-3 px-6 rounded-2xl cursor-pointer transition shadow-md shadow-accent/5 hover:shadow-accent/15 text-center active:scale-95"
            >
              Verify Remittance &amp; Log Out
            </button>
          </div>
        </div>
      </motion.div>

      {/* DETAILED PRINTABLE MODAL OVERLAY */}
      <AnimatePresence>
        {showPrintView && (
          <div className="fixed inset-0 z-[60] bg-charcoal/90 backdrop-blur-md flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white text-charcoal rounded-3xl max-w-md w-full p-6 shadow-2xl flex flex-col max-h-[85vh]"
            >
              <div className="flex justify-between items-center border-b border-dashed border-charcoal/20 pb-4 mb-4 shrink-0">
                <span className="font-mono text-xs font-bold text-primary tracking-widest uppercase">
                  Thermal Slip Preview
                </span>
                <button
                  onClick={() => setShowPrintView(false)}
                  className="p-1 hover:bg-cream border border-secondary rounded-lg transition text-charcoal/60 hover:text-charcoal cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Thermal Receipt Body */}
              <div id="printable-shift-remittance" className="flex-1 overflow-y-auto pr-1 font-mono text-xs space-y-6 bg-[#fafafa] p-4 border border-secondary rounded-2xl">
                <div className="text-center space-y-1">
                  <h4 className="font-display font-black text-sm uppercase tracking-wider text-primary">
                    SEDONA COURT
                  </h4>
                  <p className="text-[9px] uppercase tracking-wider text-charcoal/60">
                    Travellers Inn &bull; Station FD-01
                  </p>
                  <p className="text-[8px] text-charcoal/40">
                    Shift Terminal Handover Report
                  </p>
                </div>

                <div className="border-t border-dashed border-charcoal/20 pt-4 space-y-1.5 text-[10px]">
                  <div className="flex justify-between">
                    <span>PRINTED ON:</span>
                    <span>{currentDateTime}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>OUTGOING OP:</span>
                    <span className="font-bold">{activeCashier}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>INCOMING OP:</span>
                    <span className="font-bold">{incomingOperator}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>SHIFT BASIS:</span>
                    <span className="font-bold">12-HOUR ROTATIONAL</span>
                  </div>
                  <div className="flex justify-between">
                    <span>ACTIVE SHIFT:</span>
                    <span className="font-bold">{shiftType === 'DAY' ? 'DAY SHIFT (06AM - 06PM)' : 'NIGHT SHIFT (06PM - 06AM)'}</span>
                  </div>
                </div>

                <div className="border-t border-dashed border-charcoal/20 pt-4 space-y-1.5 text-[10px]">
                  <h5 className="font-bold uppercase tracking-wider text-primary text-[10px] pb-1">
                    I. RECONCILIATION SUMMARY
                  </h5>
                  <div className="flex justify-between">
                    <span>STARTING FLOAT:</span>
                    <span>₱{startingFloat.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>CASH SALES:</span>
                    <span>₱{cashSales.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>GCASH SALES:</span>
                    <span>₱{gcashSales.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between font-bold border-t border-dotted border-charcoal/20 pt-1">
                    <span>TOTAL SALES REVENUE:</span>
                    <span>₱{totalSessionRevenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between font-bold text-primary mt-1">
                    <span>ACTUAL IN DRAWER:</span>
                    <span>₱{actualCashInDrawer.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between font-bold border-t border-dotted border-charcoal/20 pt-1">
                    <span>DRAWER VARIANCE:</span>
                    <span className={drawerVariance === 0 ? 'text-emerald-600' : drawerVariance > 0 ? 'text-blue-600' : 'text-rose-600'}>
                      ₱{drawerVariance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>

                <div className="border-t border-dashed border-charcoal/20 pt-4 space-y-1.5 text-[10px]">
                  <h5 className="font-bold uppercase tracking-wider text-primary text-[10px] pb-1">
                    II. ROOM OCCUPANCY REPORT
                  </h5>
                  <div className="flex justify-between">
                    <span>OCCUPIED APARTMENTS:</span>
                    <span>{occupiedCount} Rooms</span>
                  </div>
                  <div className="flex justify-between">
                    <span>OVERDUE / LATE OUTS:</span>
                    <span>{overdueCount} Rooms</span>
                  </div>
                  <div className="flex justify-between">
                    <span>CLEANING IN PROGRESS:</span>
                    <span>{cleaningCount} Rooms</span>
                  </div>
                  <div className="flex justify-between">
                    <span>VACANT AVAILABLE:</span>
                    <span>{availableCount} Rooms</span>
                  </div>
                </div>

                <div className="border-t border-dashed border-charcoal/20 pt-4 space-y-1.5 text-[10px]">
                  <h5 className="font-bold uppercase tracking-wider text-primary text-[10px] pb-1">
                    III. PENDING TASKS HANDOFF
                  </h5>
                  {pendingTasks.filter(t => !t.completed).length === 0 ? (
                    <p className="italic text-[9px] text-charcoal/40">No pending operational issues turned over.</p>
                  ) : (
                    pendingTasks
                      .filter(t => !t.completed)
                      .map((t, idx) => (
                        <div key={t.id} className="text-[9px] leading-relaxed flex gap-1 items-start">
                          <span className="font-bold">{idx + 1}.</span>
                          <span>[{t.priority.toUpperCase()}] {t.text}</span>
                        </div>
                      ))
                  )}
                </div>

                <div className="border-t border-dashed border-charcoal/20 pt-6 text-center space-y-6">
                  <div className="grid grid-cols-2 gap-4 text-[8px] uppercase tracking-wider">
                    <div className="space-y-4">
                      <div className="border-b border-charcoal/40 pb-1 h-8 flex items-end justify-center">
                        <span className="font-bold">{activeCashier}</span>
                      </div>
                      <span>REMITTING CASHIER</span>
                    </div>
                    <div className="space-y-4">
                      <div className="border-b border-charcoal/40 pb-1 h-8 flex items-end justify-center">
                        <span className="font-bold">{incomingOperator}</span>
                      </div>
                      <span>RECEIVING CASHIER</span>
                    </div>
                  </div>
                  <p className="text-[8px] text-charcoal/40">
                    Sedona Court Inn Core PMS &bull; End of Shift Remittance Document
                  </p>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-secondary flex flex-col sm:flex-row gap-2 shrink-0">
                <button
                  onClick={triggerPrint}
                  className="flex-1 bg-primary hover:bg-primary-light text-white font-mono text-xs font-bold py-2.5 px-3 rounded-xl cursor-pointer transition text-center flex items-center justify-center gap-1.5 active:scale-95 shadow-md shadow-primary/5"
                >
                  <Printer size={14} /> Print Slip
                </button>
                <button
                  onClick={() => downloadDailyExcelReport(
                    rooms,
                    activeCashier,
                    sessionReceipts,
                    pendingTasks,
                    startingFloat,
                    actualCashInDrawer,
                    incomingOperator,
                    shiftType
                  )}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs font-bold py-2.5 px-3 rounded-xl cursor-pointer transition text-center flex items-center justify-center gap-1.5 active:scale-95 shadow-md"
                >
                  <FileSpreadsheet size={14} /> Excel (.XLSX)
                </button>
                <button
                  onClick={() => setShowPrintView(false)}
                  className="bg-white hover:bg-cream border border-secondary text-charcoal font-sans text-xs font-bold py-2.5 px-3 rounded-xl cursor-pointer transition text-center active:scale-95"
                >
                  Dismiss
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
