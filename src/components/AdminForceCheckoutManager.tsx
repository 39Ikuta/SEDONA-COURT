import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ForceCheckoutRequest, ForceCheckoutResolution } from '../types';
import { X, ShieldAlert, CheckCircle2, XCircle, Clock, AlertTriangle, UserCheck, MessageSquare, ArrowRight, Loader2, RefreshCw } from 'lucide-react';
import { getForceCheckoutRequests, approveForceCheckoutRequest, rejectForceCheckoutRequest } from '../api/force-checkout';
import { formatStayDuration } from '../utils/pricing';

interface AdminForceCheckoutManagerProps {
  isOpen: boolean;
  onClose: () => void;
  onRefreshRooms?: () => void;
  activeAdminUser: string;
}

export const AdminForceCheckoutManager: React.FC<AdminForceCheckoutManagerProps> = ({
  isOpen,
  onClose,
  onRefreshRooms,
  activeAdminUser,
}) => {
  const [requests, setRequests] = useState<ForceCheckoutRequest[]>([]);
  const [activeTab, setActiveTab] = useState<'pending' | 'history'>('pending');
  const [selectedRequest, setSelectedRequest] = useState<ForceCheckoutRequest | null>(null);
  const [resolutionType, setResolutionType] = useState<ForceCheckoutResolution>('loss_write_off');
  const [adminNotes, setAdminNotes] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRequests = async () => {
    setIsLoading(true);
    try {
      const data = await getForceCheckoutRequests('all');
      setRequests(data);
    } catch (err: any) {
      console.error('Failed to load force checkout requests:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchRequests();
      setSelectedRequest(null);
      setAdminNotes('');
      setError(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const pendingRequests = requests.filter((r) => r.status === 'pending');
  const historyRequests = requests.filter((r) => r.status !== 'pending');

  const handleApprove = async () => {
    if (!selectedRequest) return;
    setIsProcessing(true);
    setError(null);

    try {
      await approveForceCheckoutRequest(selectedRequest.id, {
        adminNotes: adminNotes.trim() || 'Approved by management.',
        resolutionType,
      });
      await fetchRequests();
      setSelectedRequest(null);
      setAdminNotes('');
      if (onRefreshRooms) onRefreshRooms();
    } catch (err: any) {
      console.error('Approval error:', err);
      setError(err.message || 'Failed to approve request');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReject = async () => {
    if (!selectedRequest) return;
    if (!adminNotes.trim()) {
      setError('Please specify the reason for rejection in the admin notes field.');
      return;
    }
    setIsProcessing(true);
    setError(null);

    try {
      await rejectForceCheckoutRequest(selectedRequest.id, {
        adminNotes: adminNotes.trim(),
      });
      await fetchRequests();
      setSelectedRequest(null);
      setAdminNotes('');
      if (onRefreshRooms) onRefreshRooms();
    } catch (err: any) {
      console.error('Rejection error:', err);
      setError(err.message || 'Failed to reject request');
    } finally {
      setIsProcessing(false);
    }
  };

  const formatDisplayTime = (val?: string) => {
    if (!val) return 'N/A';
    const d = new Date(val);
    if (!isNaN(d.getTime())) {
      return d.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
    }
    return val;
  };

  const getReasonLabel = (reason: string) => {
    switch (reason) {
      case 'skip_out': return 'Guest Skipped Out / Non-Payment';
      case 'overstay_unreachable': return 'Overstay & Abandoned';
      case 'disputed_bill': return 'Disputed Bill';
      case 'emergency_eviction': return 'Emergency / Eviction';
      case 'system_error': return 'System Error / Desync';
      default: return 'Other Incident';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-charcoal/60 backdrop-blur-sm animate-fade-in">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-3xl shadow-2xl border border-secondary max-w-4xl w-full overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="p-5 bg-charcoal text-white flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500 text-charcoal flex items-center justify-center font-bold shadow-md">
              <ShieldAlert size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-display font-black text-base tracking-wide text-white">
                  Force Check-Out Management Center
                </h3>
                {pendingRequests.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-rose-600 text-white font-mono text-[10px] font-bold">
                    {pendingRequests.length} Pending
                  </span>
                )}
              </div>
              <p className="text-xs text-white/60 font-mono mt-0.5">
                Review, audit, and approve cashier room release requests.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={fetchRequests}
              disabled={isLoading}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-mono flex items-center gap-1 transition cursor-pointer"
            >
              <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
              <span>Refresh</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-full text-white/50 hover:text-white hover:bg-white/10 transition cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-secondary/50 bg-cream/20 px-5 pt-3 gap-3">
          <button
            type="button"
            onClick={() => { setActiveTab('pending'); setSelectedRequest(null); }}
            className={`pb-3 font-mono text-xs font-bold transition border-b-2 cursor-pointer flex items-center gap-2 ${
              activeTab === 'pending'
                ? 'border-rose-600 text-rose-700'
                : 'border-transparent text-charcoal/50 hover:text-charcoal'
            }`}
          >
            <span>Pending Escalations</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
              pendingRequests.length > 0 ? 'bg-rose-100 text-rose-800' : 'bg-secondary/40 text-charcoal/60'
            }`}>
              {pendingRequests.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => { setActiveTab('history'); setSelectedRequest(null); }}
            className={`pb-3 font-mono text-xs font-bold transition border-b-2 cursor-pointer flex items-center gap-2 ${
              activeTab === 'history'
                ? 'border-primary text-primary'
                : 'border-transparent text-charcoal/50 hover:text-charcoal'
            }`}
          >
            <span>Resolved History</span>
            <span className="px-1.5 py-0.2 rounded-full bg-secondary/40 text-[10px] text-charcoal/60">
              {historyRequests.length}
            </span>
          </button>
        </div>

        {/* Content Body (Split view) */}
        <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-5 divide-y md:divide-y-0 md:divide-x divide-secondary/40">
          {/* Requests List (2 cols) */}
          <div className="md:col-span-2 overflow-y-auto p-4 space-y-2.5 max-h-[550px]">
            {isLoading ? (
              <div className="p-8 text-center text-charcoal/40 font-mono text-xs flex flex-col items-center gap-2">
                <Loader2 size={20} className="animate-spin text-primary" />
                <span>Loading requests...</span>
              </div>
            ) : (activeTab === 'pending' ? pendingRequests : historyRequests).length === 0 ? (
              <div className="p-8 text-center text-charcoal/40 font-mono text-xs bg-cream/10 rounded-2xl border border-dashed border-secondary/60">
                <CheckCircle2 size={24} className="mx-auto mb-2 text-emerald-600 opacity-60" />
                <span>No {activeTab} force check-out requests found.</span>
              </div>
            ) : (
              (activeTab === 'pending' ? pendingRequests : historyRequests).map((req) => {
                const isSelected = selectedRequest?.id === req.id;
                return (
                  <button
                    key={req.id}
                    type="button"
                    onClick={() => { setSelectedRequest(req); setAdminNotes(''); setError(null); }}
                    className={`w-full p-3.5 rounded-2xl border text-left transition cursor-pointer flex flex-col gap-2 ${
                      isSelected
                        ? 'bg-primary/5 border-primary shadow-xs ring-1 ring-primary'
                        : 'bg-white border-secondary/60 hover:bg-cream/20'
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-2">
                        <span className="font-display font-extrabold text-sm text-primary">
                          Room {req.roomNumber}
                        </span>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase ${
                          req.status === 'pending'
                            ? 'bg-amber-100 text-amber-900 border border-amber-300'
                            : req.status === 'approved'
                            ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                            : 'bg-rose-100 text-rose-900 border border-rose-300'
                        }`}>
                          {req.status}
                        </span>
                      </div>
                      <span className="font-mono font-bold text-xs text-rose-700">
                        ₱{req.uncollectedAmount.toLocaleString()}
                      </span>
                    </div>

                    <div className="text-[11px] font-sans font-semibold text-charcoal truncate">
                      {getReasonLabel(req.reason)}
                    </div>

                    <div className="flex justify-between items-center text-[10px] font-mono text-charcoal/50 border-t border-secondary/30 pt-1.5">
                      <span>By: {req.requestedBy}</span>
                      <span>{formatDisplayTime(req.requestedAt)}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Request Inspection & Approval Panel (3 cols) */}
          <div className="md:col-span-3 overflow-y-auto p-5 space-y-4 max-h-[550px]">
            {selectedRequest ? (
              <div className="space-y-4">
                {/* Header of Selected */}
                <div className="p-4 bg-cream/30 rounded-2xl border border-secondary/60 space-y-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="text-[9px] font-mono uppercase font-bold text-charcoal/50">
                        Request ID: #{selectedRequest.id}
                      </span>
                      <h4 className="font-display font-extrabold text-base text-primary">
                        Apartment {selectedRequest.roomNumber} ({selectedRequest.roomType || 'Standard'})
                      </h4>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] font-mono text-charcoal/50 uppercase block">Uncollected Balance</span>
                      <span className="font-display font-extrabold text-lg text-rose-700">
                        ₱{selectedRequest.uncollectedAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[11px] font-mono pt-2 border-t border-secondary/30 text-charcoal/70">
                    <div>Guest: <span className="font-bold text-charcoal">{selectedRequest.guestName || 'Anonymous'}</span></div>
                    <div>Check-In: <span className="font-bold text-charcoal">{formatDisplayTime(selectedRequest.checkInTime)}</span></div>
                    <div>Requested By: <span className="font-bold text-primary">{selectedRequest.requestedBy}</span></div>
                    <div>Requested At: <span className="font-bold text-charcoal">{formatDisplayTime(selectedRequest.requestedAt)}</span></div>
                  </div>
                </div>

                {/* Incident Reason & Cashier Explanation */}
                <div className="p-4 bg-rose-50/50 rounded-2xl border border-rose-200 space-y-2">
                  <div className="flex items-center gap-1.5 text-rose-900 font-bold text-xs uppercase font-mono">
                    <ShieldAlert size={14} className="text-rose-600 shrink-0" />
                    <span>Incident Reason: {getReasonLabel(selectedRequest.reason)}</span>
                  </div>
                  <div className="text-xs text-charcoal font-sans bg-white p-3 rounded-xl border border-rose-200/70 leading-relaxed">
                    <span className="text-[10px] font-mono text-charcoal/40 uppercase block mb-1 font-bold">
                      Cashier Notes / Statement:
                    </span>
                    {selectedRequest.cashierNotes || '(No additional explanation provided by cashier)'}
                  </div>
                </div>

                {/* Itemized breakdown if available */}
                {selectedRequest.billedBreakdown && selectedRequest.billedBreakdown.length > 0 && (
                  <div className="space-y-1.5 p-3 rounded-xl border border-secondary/50 bg-cream/10 text-xs font-mono">
                    <span className="text-[10px] uppercase font-bold text-charcoal/50 block">Uncollected Charges Breakdown</span>
                    {selectedRequest.billedBreakdown.map((item, i) => (
                      <div key={i} className="flex justify-between text-charcoal/80">
                        <span>{item.description} {item.subtext ? `(${item.subtext})` : ''}</span>
                        <span>₱{Number(item.amount || 0).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* If already resolved, show resolution summary */}
                {selectedRequest.status !== 'pending' ? (
                  <div className={`p-4 rounded-2xl border space-y-2 font-mono text-xs ${
                    selectedRequest.status === 'approved'
                      ? 'bg-emerald-50/80 border-emerald-300 text-emerald-950'
                      : 'bg-rose-50/80 border-rose-300 text-rose-950'
                  }`}>
                    <div className="flex justify-between items-center font-bold">
                      <span className="uppercase">Resolution: {selectedRequest.status.toUpperCase()}</span>
                      <span>Resolved by: {selectedRequest.resolvedBy}</span>
                    </div>
                    {selectedRequest.resolutionType && (
                      <div>Accounting Treatment: <span className="font-bold">{selectedRequest.resolutionType}</span></div>
                    )}
                    <div className="border-t border-current/20 pt-1.5 text-[11px] font-sans">
                      Admin Notes: {selectedRequest.adminNotes || 'No notes.'}
                    </div>
                  </div>
                ) : (
                  /* Admin Actions Section */
                  <div className="space-y-3 pt-2 border-t border-secondary/40">
                    {error && (
                      <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs flex items-center gap-2">
                        <AlertTriangle size={14} className="shrink-0" />
                        <span>{error}</span>
                      </div>
                    )}

                    {/* Accounting Resolution Selector */}
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-mono uppercase font-bold text-charcoal/70 block">
                        Choose Accounting Resolution
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { key: 'loss_write_off', label: 'Bad Debt / Loss Write-Off', desc: '₱0 cash, audited operational write-off' },
                          { key: 'deposit_forfeit', label: 'Forfeit Guest Deposit', desc: 'Settle against guest security deposit' },
                          { key: 'void_mistake', label: 'System Void (No Loss)', desc: 'Mistakenly marked occupied' },
                          { key: 'manual_settle', label: 'Manual Settlement', desc: 'Paid or settled outside POS' },
                        ].map((res) => (
                          <button
                            key={res.key}
                            type="button"
                            onClick={() => setResolutionType(res.key as ForceCheckoutResolution)}
                            className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
                              resolutionType === res.key
                                ? 'bg-primary/10 border-primary text-primary font-bold shadow-xs'
                                : 'bg-white border-secondary/50 text-charcoal/70 hover:bg-cream/30'
                            }`}
                          >
                            <span className="text-xs font-bold block">{res.label}</span>
                            <span className="text-[9px] text-charcoal/50 block font-normal leading-tight mt-0.5">{res.desc}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Admin Decision Notes */}
                    <div className="space-y-1">
                      <label className="text-[11px] font-mono uppercase font-bold text-charcoal/70 block">
                        Admin Approval / Rejection Notes
                      </label>
                      <textarea
                        rows={2}
                        value={adminNotes}
                        onChange={(e) => setAdminNotes(e.target.value)}
                        placeholder="e.g. Approved bad debt write-off per security report. Room cleared for housekeeping."
                        className="w-full p-2.5 text-xs bg-cream/10 border border-secondary rounded-xl font-sans outline-none focus:border-primary resize-none"
                      />
                    </div>

                    {/* Decision Buttons */}
                    <div className="flex gap-2 pt-2">
                      <button
                        type="button"
                        onClick={handleReject}
                        disabled={isProcessing}
                        className="flex-1 bg-white hover:bg-rose-50 border border-rose-300 text-rose-700 font-sans text-xs font-bold py-3 rounded-xl cursor-pointer transition text-center flex items-center justify-center gap-1.5 disabled:opacity-50"
                      >
                        <XCircle size={14} />
                        <span>Reject Request</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleApprove}
                        disabled={isProcessing}
                        className="flex-[2] bg-emerald-600 hover:bg-emerald-700 text-white font-sans text-xs font-bold py-3 rounded-xl cursor-pointer transition shadow-md shadow-emerald-600/10 flex items-center justify-center gap-1.5 active:scale-[0.98] disabled:opacity-50"
                      >
                        {isProcessing ? (
                          <>
                            <Loader2 size={14} className="animate-spin" />
                            <span>Processing...</span>
                          </>
                        ) : (
                          <>
                            <CheckCircle2 size={14} />
                            <span>Approve & Release Room to Cleaning</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center p-8 text-center text-charcoal/40 font-mono text-xs space-y-2">
                <ShieldAlert size={32} className="opacity-40 text-primary" />
                <p>Select a Force Check-Out request from the left list to review incident details and take management action.</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer info */}
        <div className="p-3 bg-cream/20 border-t border-secondary/40 text-center text-[10px] font-mono text-charcoal/50">
          LOGGED MANAGEMENT OPERATOR: {activeAdminUser} // AUDIT LOGGING ENABLED
        </div>
      </motion.div>
    </div>
  );
};
