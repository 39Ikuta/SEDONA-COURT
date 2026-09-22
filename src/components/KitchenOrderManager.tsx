/**
 * src/components/KitchenOrderManager.tsx
 * Cashier interface for managing kitchen order statuses & 80mm thermal ticket printing
 * Replicates the exact 80mm thermal roll print & preview architecture of ReceiptPreview.tsx
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Clock,
  CheckCircle,
  ChefHat,
  Package,
  X,
  AlertCircle,
  Printer,
  RefreshCw,
  Eye,
  FileText,
} from 'lucide-react';
import { kitchenOrderService, KitchenOrder, reprintKitchenOrder } from '../api/kitchen';
import { useToast } from './ui/Toast';
import { PrintableKitchenTicket } from './PrintableKitchenTicket';
import { printBrowserReceipt } from '../utils/printBrowserReceipt';

interface KitchenOrderManagerProps {
  isOpen: boolean;
  onClose: () => void;
  currentRoomNumber?: string; // Filter orders by room if provided
}

export const KitchenOrderManager: React.FC<KitchenOrderManagerProps> = ({
  isOpen,
  onClose,
  currentRoomNumber,
}) => {
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState<number | null>(null);
  const [printingOrderId, setPrintingOrderId] = useState<number | null>(null);
  const [isPrintingAll, setIsPrintingAll] = useState(false);
  const [filterMode, setFilterMode] = useState<'active' | 'all'>('active');

  // Active preview / print ticket selection
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [isBatchPreview, setIsBatchPreview] = useState(false);
  const [activeTab, setActiveTab] = useState<'orders' | 'preview'>('orders');

  const toast = useToast();

  // Fetch orders
  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      let fetchedOrders: KitchenOrder[];
      if (currentRoomNumber) {
        fetchedOrders = await kitchenOrderService.getOrdersByRoom(currentRoomNumber);
      } else {
        fetchedOrders = await kitchenOrderService.getOrders();
      }
      setOrders(fetchedOrders);
    } catch (err) {
      console.error('Failed to fetch kitchen orders:', err);
    } finally {
      setLoading(false);
    }
  }, [currentRoomNumber]);

  useEffect(() => {
    if (!isOpen) return;
    fetchOrders();
    const interval = setInterval(fetchOrders, 10000);
    return () => clearInterval(interval);
  }, [isOpen, fetchOrders]);

  const activeOrdersCount = orders.filter((o) => !['delivered', 'cancelled'].includes(o.status)).length;
  const displayedOrders = filterMode === 'active'
    ? orders.filter((o) => !['delivered', 'cancelled'].includes(o.status))
    : orders;

  // Auto-select first order if none selected or selected order is no longer present
  useEffect(() => {
    if (displayedOrders.length > 0) {
      if (!selectedOrderId || !displayedOrders.some((o) => o.id === selectedOrderId)) {
        setSelectedOrderId(displayedOrders[0].id);
      }
    } else {
      setSelectedOrderId(null);
    }
  }, [displayedOrders, selectedOrderId]);

  const selectedOrder = orders.find((o) => o.id === selectedOrderId) || displayedOrders[0] || null;

  // Print single 80mm ticket matching ReceiptPreview.tsx mechanism
  const handlePrint80mmTicket = (order: KitchenOrder) => {
    setSelectedOrderId(order.id);
    setIsBatchPreview(false);
    setPrintingOrderId(order.id);

    try {
      // 1. Dispatch background TCP network print job
      reprintKitchenOrder(order.id).catch((err) =>
        console.warn('Background TCP reprint dispatch:', err)
      );

      // 2. Browser thermal printing via helper
      setTimeout(() => {
        printBrowserReceipt('printable-kitchen-ticket');
        toast.success(
          '80mm Thermal Ticket Printed',
          `Order ${order.order_number} sent to 80mm receipt printer.`
        );
      }, 60);

      // 3. Mark local print status as printing
      setOrders((prev) =>
        prev.map((o) => (o.id === order.id ? { ...o, print_status: 'printing' } : o))
      );
    } catch (err: any) {
      console.error('80mm Print error:', err);
      toast.error('Print Failed', err.message || 'Failed to dispatch 80mm print job');
    } finally {
      setPrintingOrderId(null);
    }
  };

  // Print all tickets on 80mm continuous roll
  const handlePrintAll80mmTickets = () => {
    if (!displayedOrders.length) return;
    setIsBatchPreview(true);
    setIsPrintingAll(true);

    try {
      // 1. Dispatch background TCP print jobs
      for (const ord of displayedOrders) {
        reprintKitchenOrder(ord.id).catch((err) =>
          console.warn(`TCP reprint error for ${ord.order_number}:`, err)
        );
      }

      // 2. Trigger browser 80mm thermal print dialog
      setTimeout(() => {
        printBrowserReceipt('printable-kitchen-ticket');
        toast.success(
          '80mm Tickets Printed',
          `Dispatched ${displayedOrders.length} ticket(s) to 80mm receipt printer.`
        );
      }, 60);

      setOrders((prev) =>
        prev.map((o) =>
          displayedOrders.some((d) => d.id === o.id) ? { ...o, print_status: 'printing' } : o
        )
      );
    } catch (err: any) {
      console.error('Batch 80mm print error:', err);
      toast.error('Print Failed', 'Failed to dispatch batch print');
    } finally {
      setIsPrintingAll(false);
    }
  };

  const updateOrderStatus = async (orderId: number, newStatus: KitchenOrder['status']) => {
    setUpdating(orderId);
    try {
      await kitchenOrderService.updateStatus(orderId, newStatus);
      setOrders((prev) =>
        prev.map((order) => (order.id === orderId ? { ...order, status: newStatus } : order))
      );
      toast.success('Status Updated', `Order status changed to ${newStatus}`);
    } catch (err) {
      console.error('Failed to update order status:', err);
      toast.error('Update Failed', 'Failed to update order status. Please try again.');
    } finally {
      setUpdating(null);
    }
  };

  const getStatusColor = (status: KitchenOrder['status']) => {
    switch (status) {
      case 'new':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'preparing':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'ready':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'delivered':
        return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getStatusIcon = (status: KitchenOrder['status']) => {
    switch (status) {
      case 'new':
        return <Clock className="w-4 h-4" />;
      case 'preparing':
        return <ChefHat className="w-4 h-4" />;
      case 'ready':
        return <Package className="w-4 h-4" />;
      default:
        return <CheckCircle className="w-4 h-4" />;
    }
  };

  const getNextStatus = (currentStatus: KitchenOrder['status']): KitchenOrder['status'] | null => {
    switch (currentStatus) {
      case 'new':
        return 'preparing';
      case 'preparing':
        return 'ready';
      case 'ready':
        return 'delivered';
      default:
        return null;
    }
  };

  const getNextStatusLabel = (currentStatus: KitchenOrder['status']): string => {
    switch (currentStatus) {
      case 'new':
        return 'Start Preparing';
      case 'preparing':
        return 'Mark Ready';
      case 'ready':
        return 'Mark Delivered';
      default:
        return 'Complete';
    }
  };

  const formatElapsedTime = (orderTime: string) => {
    const now = new Date();
    const ordered = new Date(orderTime);
    const minutes = Math.floor((now.getTime() - ordered.getTime()) / (1000 * 60));
    if (minutes < 60) {
      return `${minutes}m`;
    } else {
      const hours = Math.floor(minutes / 60);
      const remainingMinutes = minutes % 60;
      return `${hours}h ${remainingMinutes}m`;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-2 sm:p-4 print:p-0">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] overflow-hidden flex flex-col border border-secondary print:border-none print:shadow-none print:rounded-none"
      >
        {/* Modal Header */}
        <div className="bg-primary text-white px-5 py-4 sm:px-6 sm:py-5 flex justify-between items-center shrink-0 print:hidden">
          <div>
            <h2 className="text-lg sm:text-xl font-bold font-display flex items-center gap-2">
              <ChefHat className="w-5 h-5 sm:w-6 sm:h-6" />
              Kitchen Order Management
            </h2>
            <p className="text-white/80 text-xs font-mono mt-0.5">
              {currentRoomNumber
                ? `Orders for Room ${currentRoomNumber}`
                : 'All Active Kitchen Orders • 80mm Roll Thermal Printing'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={fetchOrders}
              disabled={loading}
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition cursor-pointer"
              title="Refresh Orders"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition cursor-pointer"
              title="Close Modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Filter & View Switcher Bar */}
        <div className="bg-cream/40 border-b border-secondary/40 px-5 py-2.5 flex flex-wrap items-center justify-between gap-3 shrink-0 print:hidden">
          <div className="flex items-center gap-2 text-xs font-mono">
            <button
              type="button"
              onClick={() => {
                setFilterMode('active');
                setIsBatchPreview(false);
              }}
              className={`px-3 py-1 rounded-lg font-bold transition cursor-pointer ${
                filterMode === 'active'
                  ? 'bg-primary text-white shadow-xs'
                  : 'bg-white border border-secondary text-charcoal/70 hover:bg-cream/60'
              }`}
            >
              Active Orders ({activeOrdersCount})
            </button>
            <button
              type="button"
              onClick={() => {
                setFilterMode('all');
                setIsBatchPreview(false);
              }}
              className={`px-3 py-1 rounded-lg font-bold transition cursor-pointer ${
                filterMode === 'all'
                  ? 'bg-primary text-white shadow-xs'
                  : 'bg-white border border-secondary text-charcoal/70 hover:bg-cream/60'
              }`}
            >
              All Orders ({orders.length})
            </button>
          </div>

          {/* Tab switcher for mobile */}
          <div className="flex items-center gap-2 lg:hidden">
            <button
              type="button"
              onClick={() => setActiveTab('orders')}
              className={`px-2.5 py-1 text-xs font-mono rounded-md font-bold transition cursor-pointer ${
                activeTab === 'orders'
                  ? 'bg-charcoal text-white'
                  : 'bg-white border border-secondary text-charcoal'
              }`}
            >
              Orders List
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('preview')}
              className={`px-2.5 py-1 text-xs font-mono rounded-md font-bold transition cursor-pointer flex items-center gap-1 ${
                activeTab === 'preview'
                  ? 'bg-charcoal text-white'
                  : 'bg-white border border-secondary text-charcoal'
              }`}
            >
              <FileText size={12} />
              80mm Slip
            </button>
          </div>

          {/* Quick Print All on 80mm Roll */}
          {displayedOrders.length > 0 && (
            <button
              type="button"
              onClick={handlePrintAll80mmTickets}
              disabled={isPrintingAll}
              className="px-3 py-1.5 rounded-lg text-xs font-mono font-bold bg-slate-800 hover:bg-slate-900 text-white shadow-xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              title="Print all tickets on 80mm continuous roll"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>{isPrintingAll ? 'Printing 80mm...' : `Print All 80mm (${displayedOrders.length})`}</span>
            </button>
          )}
        </div>

        {/* Main Content: Split Layout (Orders List Left + 80mm Ticket Preview Right) */}
        <div className="flex-1 overflow-hidden flex flex-col lg:flex-row divide-y lg:divide-y-0 lg:divide-x divide-secondary/40">
          {/* Left Column: Orders List */}
          <div
            className={`flex-1 overflow-y-auto p-4 sm:p-5 max-h-[70vh] lg:max-h-none ${
              activeTab === 'preview' ? 'hidden lg:block' : 'block'
            }`}
          >
            {loading && orders.length === 0 ? (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
                <p className="text-gray-600 mt-2 text-sm font-mono">Loading kitchen orders...</p>
              </div>
            ) : displayedOrders.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <Package className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p className="text-base font-semibold">No kitchen orders found</p>
                <p className="text-xs text-charcoal/50 mt-1">
                  {filterMode === 'active' && orders.length > 0
                    ? 'All orders are completed. Switch to "All Orders" to view history.'
                    : 'No food orders have been recorded yet.'}
                </p>
              </div>
            ) : (
              <div className="space-y-3.5">
                <AnimatePresence>
                  {displayedOrders.map((order) => {
                    const isSelected = selectedOrderId === order.id && !isBatchPreview;
                    const isPrinting = printingOrderId === order.id || order.print_status === 'printing';
                    const isPrinted = order.print_status === 'printed';
                    const isFailed = order.print_status === 'failed';

                    return (
                      <motion.div
                        key={order.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        onClick={() => {
                          setSelectedOrderId(order.id);
                          setIsBatchPreview(false);
                        }}
                        className={`border rounded-xl p-3.5 transition cursor-pointer shadow-2xs ${
                          isSelected
                            ? 'bg-primary/5 border-primary shadow-xs ring-1 ring-primary/30'
                            : 'bg-white hover:bg-gray-50/80 border-secondary/70'
                        }`}
                      >
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className="text-sm font-extrabold font-mono text-charcoal">
                                {order.order_number}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded-full text-[11px] font-bold font-mono border flex items-center gap-1 ${getStatusColor(
                                  order.status
                                )}`}
                              >
                                {getStatusIcon(order.status)}
                                {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
                              </span>
                              {order.priority === 'urgent' && (
                                <span className="bg-red-100 text-red-800 px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1">
                                  <AlertCircle className="w-3 h-3" />
                                  URGENT
                                </span>
                              )}
                              <span
                                className={`text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded ${
                                  isFailed
                                    ? 'bg-red-100 text-red-800 border border-red-200 animate-pulse'
                                    : isPrinting
                                    ? 'bg-blue-100 text-blue-800 border border-blue-200'
                                    : isPrinted
                                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                    : 'bg-amber-100 text-amber-800 border border-amber-200'
                                }`}
                              >
                                {isFailed
                                  ? 'Print Failed'
                                  : isPrinting
                                  ? 'Printing...'
                                  : isPrinted
                                  ? 'Printed'
                                  : 'Pending Print'}
                              </span>
                            </div>
                            <div className="text-xs text-gray-600 font-mono">
                              📍 Room {order.room_number} • {order.guest_name} • ⏱️{' '}
                              {formatElapsedTime(order.ordered_at)} ago
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedOrderId(order.id);
                              setIsBatchPreview(false);
                              setActiveTab('preview');
                            }}
                            className="p-1 text-charcoal/50 hover:text-primary transition"
                            title="Preview 80mm Ticket"
                          >
                            <Eye size={15} />
                          </button>
                        </div>

                        {/* Order Items List */}
                        <div className="mb-2.5">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                            {order.items.map((item, index) => (
                              <div
                                key={index}
                                className="bg-cream/40 rounded p-1.5 border border-secondary/40 text-xs flex justify-between items-center"
                              >
                                <span className="font-medium text-charcoal truncate pr-1">
                                  {item.name}
                                </span>
                                <span className="text-primary font-bold font-mono shrink-0">
                                  x{item.quantity}
                                </span>
                              </div>
                            ))}
                          </div>
                          {order.special_instructions && (
                            <p className="text-[11px] text-amber-800 italic mt-1 font-mono">
                              📝 {order.special_instructions}
                            </p>
                          )}
                        </div>

                        {/* Order Actions & Print Button */}
                        <div className="flex flex-wrap justify-between items-center gap-2 pt-2 border-t border-secondary/30">
                          <div className="text-xs font-mono text-gray-500">
                            Total:{' '}
                            <span className="font-bold text-primary">
                              ₱
                              {order.total_amount.toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </span>
                          </div>

                          <div className="flex gap-1.5 items-center">
                            {/* Print 80mm Ticket Button */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handlePrint80mmTicket(order);
                              }}
                              disabled={isPrinting}
                              className={`px-2.5 py-1 rounded-lg text-xs font-bold font-mono border transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 ${
                                isFailed
                                  ? 'bg-red-50 border-red-300 text-red-700 hover:bg-red-100'
                                  : isPrinted
                                  ? 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                                  : 'bg-primary hover:bg-primary-hover text-white border-primary shadow-xs'
                              }`}
                            >
                              <Printer className="w-3.5 h-3.5" />
                              <span>{isPrinted ? 'Reprint 80mm' : 'Print 80mm'}</span>
                            </button>

                            {/* Status Advance Button */}
                            {getNextStatus(order.status) && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  updateOrderStatus(order.id, getNextStatus(order.status)!);
                                }}
                                disabled={updating === order.id}
                                className="bg-charcoal hover:bg-black text-white font-mono text-xs font-bold px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1 cursor-pointer"
                              >
                                {updating === order.id ? (
                                  <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
                                ) : (
                                  getStatusIcon(getNextStatus(order.status)!)
                                )}
                                <span>{getNextStatusLabel(order.status)}</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            )}
          </div>

          {/* Right Column: Exact 80mm Thermal Receipt Ticket Preview (matches ReceiptPreview.tsx) */}
          <div
            className={`w-full lg:w-[380px] bg-muted-bg/50 p-4 sm:p-6 flex flex-col items-center justify-start overflow-y-auto shrink-0 print:p-0 print:w-auto ${
              activeTab === 'orders' ? 'hidden lg:flex' : 'flex'
            }`}
          >
            {selectedOrder ? (
              <div className="w-full flex flex-col items-center gap-4">
                {/* 80mm Print Actions Side-Panel Bar matching ReceiptPreview */}
                <div className="w-full flex flex-col gap-2.5 print:hidden">
                  <button
                    type="button"
                    onClick={() => {
                      if (isBatchPreview) {
                        handlePrintAll80mmTickets();
                      } else if (selectedOrder) {
                        handlePrint80mmTicket(selectedOrder);
                      }
                    }}
                    className="w-full bg-primary hover:bg-primary-light text-white font-sans text-xs font-bold py-3 rounded-xl cursor-pointer transition shadow-sm flex items-center justify-center gap-2"
                  >
                    <Printer size={15} />
                    <span>
                      {isBatchPreview
                        ? `Print All ${displayedOrders.length} Tickets (80mm)`
                        : `Print 80mm Thermal Ticket (${selectedOrder.order_number})`}
                    </span>
                  </button>

                  <div className="flex items-center justify-between text-[11px] font-mono text-charcoal/60 px-1">
                    <span>
                      Previewing:{' '}
                      <strong className="text-primary font-bold">
                        {isBatchPreview ? `Batch (${displayedOrders.length})` : selectedOrder.order_number}
                      </strong>
                    </span>
                    {isBatchPreview && (
                      <button
                        type="button"
                        onClick={() => setIsBatchPreview(false)}
                        className="text-primary underline font-bold cursor-pointer"
                      >
                        Single Ticket
                      </button>
                    )}
                  </div>
                </div>

                {/* The 80mm Paper Roll Kitchen Ticket itself (matches ReceiptPreview.tsx) */}
                <motion.div
                  key={isBatchPreview ? 'batch' : selectedOrder.id}
                  initial={{ opacity: 0, scale: 0.98, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  className="w-full flex justify-center"
                >
                  <PrintableKitchenTicket
                    order={selectedOrder}
                    orders={isBatchPreview ? displayedOrders : undefined}
                  />
                </motion.div>
              </div>
            ) : (
              <div className="text-center py-16 text-gray-400 font-mono text-xs">
                <FileText className="w-8 h-8 mx-auto mb-2 opacity-40" />
                Select an order on the left to preview the 80mm ticket slip.
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="bg-gray-50 px-5 py-3 border-t border-secondary/40 flex justify-between items-center shrink-0 print:hidden">
          <div className="text-xs font-mono text-gray-600">
            {displayedOrders.length} order{displayedOrders.length !== 1 ? 's' : ''} shown
            {currentRoomNumber && ` • Room ${currentRoomNumber}`}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-800 text-xs font-bold font-mono rounded-lg transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default KitchenOrderManager;