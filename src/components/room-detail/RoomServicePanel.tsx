import React, { useState, useEffect, useCallback } from 'react';
import { POSItem } from '../../types';
import { ShoppingBag, Minus, Plus, Printer, RefreshCw, Eye, X, ChefHat, Search } from 'lucide-react';
import { kitchenOrderService, KitchenOrder, reprintKitchenOrder } from '../../api/kitchen';
import { InventoryItem } from '../../api/inventory';
import { useToast } from '../ui/Toast';
import { PrintableKitchenTicket } from '../PrintableKitchenTicket';
import { printBrowserReceipt } from '../../utils/printBrowserReceipt';
import { motion, AnimatePresence } from 'motion/react';

interface RoomServicePanelProps {
  isWalkIn?: boolean;
  chargedFood: Array<{ item: POSItem; quantity: number }>;
  dynamicCatalog: POSItem[];
  addFoodItem: (item: POSItem) => void;
  changeFoodQty: (itemId: string, diff: number) => void;
  roomNumber?: string;
  guestName?: string;
  activeCashier?: string;
  /** Live shift inventory keyed by item id. Out-of-stock tracked items are hidden. */
  inventoryMap?: Record<string, InventoryItem>;
}

export const RoomServicePanel: React.FC<RoomServicePanelProps> = ({
  isWalkIn,
  chargedFood,
  dynamicCatalog,
  addFoodItem,
  changeFoodQty,
  roomNumber,
  guestName,
  activeCashier,
  inventoryMap,
}) => {
  const toast = useToast();
  const [menuSubCategory, setMenuSubCategory] = React.useState<string>('All');
  const [menuSearch, setMenuSearch] = React.useState<string>('');
  const [kitchenOrders, setKitchenOrders] = useState<KitchenOrder[]>([]);
  const [printingOrderId, setPrintingOrderId] = useState<number | null>(null);
  const [isPrintingKitchen, setIsPrintingKitchen] = useState<boolean>(false);
  const [activePrintTicket, setActivePrintTicket] = useState<KitchenOrder | null>(null);
  const [activeBatchTickets, setActiveBatchTickets] = useState<KitchenOrder[] | null>(null);
  const [previewTicket, setPreviewTicket] = useState<KitchenOrder | null>(null);
  // Pre-print preview: what the main "Print 80mm Kitchen Order" button will print.
  // Holds existing tickets OR a local draft built from unsent chargedFood (id < 0).
  const [prePrintOrders, setPrePrintOrders] = useState<KitchenOrder[] | null>(null);
  const [isConfirmingPrePrint, setIsConfirmingPrePrint] = useState<boolean>(false);
  // Kitchen-only print: items to send to kitchen without charging to room folio
  const [kitchenOnlyItems, setKitchenOnlyItems] = useState<Array<{ item: { id: string; name: string; price: number }; quantity: number }>>([]);
  const [isKitchenOnlyMode, setIsKitchenOnlyMode] = useState(false);
  const [isSendingKitchenOnly, setIsSendingKitchenOnly] = useState(false);

  const fetchOrders = useCallback(async () => {
    if (!roomNumber) return;
    try {
      const orders = await kitchenOrderService.getOrdersByRoom(roomNumber);
      setKitchenOrders(orders.filter(o => o.status !== 'cancelled'));
    } catch (err) {
      console.warn('Could not fetch room kitchen orders:', err);
    }
  }, [roomNumber]);

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 4000);
    return () => clearInterval(interval);
  }, [fetchOrders]);

  const handlePrintToKitchen = async (orderId: number) => {
    setPrintingOrderId(orderId);
    const target = kitchenOrders.find(o => o.id === orderId) || null;
    setActivePrintTicket(target);
    setActiveBatchTickets(null);
    try {
      reprintKitchenOrder(orderId).catch(err => console.warn('TCP reprint dispatch:', err));
      setTimeout(() => {
        printBrowserReceipt('printable-kitchen-ticket');
        toast.success('80mm Ticket Printed', 'Ticket sent to 80mm thermal receipt printer');
      }, 70);
      fetchOrders();
    } catch (err: any) {
      console.error('Print to kitchen failed:', err);
      toast.error('Print Failed', err.message || 'Failed to dispatch 80mm print');
    } finally {
      setPrintingOrderId(null);
    }
  };

  const handlePrintKitchenOrder = async () => {
    if (isPrintingKitchen || isConfirmingPrePrint) return;

    // 1. Calculate unsent items by comparing chargedFood with already sent kitchenOrders
    const sentQuantities: Record<string, number> = {};
    kitchenOrders.forEach(order => {
      if (order.status !== 'cancelled') {
        order.items.forEach(item => {
          sentQuantities[item.item_id] = (sentQuantities[item.item_id] || 0) + item.quantity;
        });
      }
    });

    const unsentItems = chargedFood.filter(f => kitchenOrderService.isFoodItem(f.item)).map(f => {
      const sentQty = sentQuantities[f.item.id] || 0;
      const unsentQty = f.quantity - sentQty;
      return { item: f.item, quantity: unsentQty };
    }).filter(f => f.quantity > 0);

    // 2. If there are unsent items, create a local draft preview and concatenate with existing orders
    if (unsentItems.length > 0 && roomNumber) {
      const now = new Date().toISOString();
      const total = unsentItems.reduce((sum, f) => sum + (f.item.price * f.quantity), 0);
      const draft: KitchenOrder = {
        id: -999,
        order_number: 'PREVIEW (unsaved)',
        room_number: roomNumber,
        guest_name: guestName || (isWalkIn ? 'Walk-in Guest' : 'Guest'),
        cashier_name: activeCashier || 'Frontdesk',
        items: unsentItems.map(f => ({
          item_id: f.item.id,
          name: f.item.name,
          quantity: f.quantity,
        })),
        total_items: unsentItems.reduce((sum, f) => sum + f.quantity, 0),
        total_amount: total,
        status: 'new',
        priority: 'normal',
        ordered_at: now,
        print_status: 'pending',
        print_attempts: 0,
        created_at: now,
        updated_at: now,
      };
      setPrePrintOrders([...kitchenOrders, draft]);
      return;
    }

    // 3. If there are NO unsent items, but there are existing tickets -> preview ALL concatenated
    if (kitchenOrders.length > 0) {
      setPrePrintOrders([...kitchenOrders]);
      return;
    }

    toast.info('No Food Order', 'Please add food items from the menu below before printing.');
  };

  /** User confirmed the pre-print preview -> actually create (if draft) + dispatch print. */
  const handleConfirmPrePrint = async () => {
    if (!prePrintOrders || prePrintOrders.length === 0 || isConfirmingPrePrint) return;
    const draftIndex = prePrintOrders.findIndex(o => o.id < 0);
    const isDraft = draftIndex !== -1;
    setIsConfirmingPrePrint(true);
    setIsPrintingKitchen(true);
    try {
      if (isDraft) {
        const draft = prePrintOrders[draftIndex];
        const newOrder = await kitchenOrderService.createOrder({
          room_number: draft.room_number,
          guest_name: draft.guest_name,
          cashier_name: draft.cashier_name,
          items: draft.items.map(it => ({
            item_id: it.item_id,
            name: it.name,
            quantity: it.quantity,
          })),
          total_amount: draft.total_amount,
          priority: 'normal',
        });
        
        const finalBatch = prePrintOrders.map(o => o.id === draft.id ? newOrder : o);
        setActiveBatchTickets(finalBatch);
        setActivePrintTicket(null);
        reprintKitchenOrder(newOrder.id).catch(err => console.warn('TCP print dispatch:', err));
        setTimeout(() => {
          printBrowserReceipt('printable-kitchen-ticket');
          toast.success('80mm Kitchen Order Printed', `Ticket ${newOrder.order_number} dispatched to 80mm thermal printer.`);
          setPrePrintOrders(null);
        }, 120);
        fetchOrders();
      } else {
        // Just print all existing tickets concatenated
        setActiveBatchTickets(prePrintOrders);
        setActivePrintTicket(null);
        // Only TCP dispatch the latest one if we have to, or skip. We care about browser printing.
        const latest = prePrintOrders[prePrintOrders.length - 1];
        if (latest) {
          reprintKitchenOrder(latest.id).catch(err => console.warn('TCP reprint dispatch:', err));
        }
        setTimeout(() => {
          printBrowserReceipt('printable-kitchen-ticket');
          toast.success('80mm Kitchen Order Printed', `Concatenated ticket dispatched to 80mm thermal printer.`);
          setPrePrintOrders(null);
        }, 120);
      }
    } catch (err: any) {
      console.error('Failed to print kitchen order:', err);
      toast.error('Print Failed', err.message || 'Failed to dispatch kitchen ticket.');
    } finally {
      setIsConfirmingPrePrint(false);
      setIsPrintingKitchen(false);
    }
  };

  /**
   * Kitchen-Only print: creates a kitchen order and prints an 80mm ticket
   * but does NOT add items to chargedFood / room folio.
   * Inventory is deducted server-side via the kitchen order creation.
   */
  const handleKitchenOnlySend = async () => {
    if (isSendingKitchenOnly || kitchenOnlyItems.length === 0 || !roomNumber) return;
    setIsSendingKitchenOnly(true);
    try {
      const total = kitchenOnlyItems.reduce((sum, f) => sum + f.item.price * f.quantity, 0);
      const newOrder = await kitchenOrderService.createOrder({
        room_number: roomNumber,
        guest_name: guestName || 'Guest',
        cashier_name: activeCashier || 'Frontdesk',
        items: kitchenOnlyItems.map(f => ({ item_id: f.item.id, name: f.item.name, quantity: f.quantity })),
        total_amount: total,
        priority: 'normal',
      });
      // Print ticket immediately
      setActivePrintTicket({
        ...newOrder,
        order_number: `${newOrder.order_number} [KITCHEN ONLY]`,
      });
      setActiveBatchTickets(null);
      reprintKitchenOrder(newOrder.id).catch(err => console.warn('TCP kitchen-only dispatch:', err));
      setTimeout(() => {
        printBrowserReceipt('printable-kitchen-ticket');
        toast.success('Kitchen-Only Ticket Printed', `Order ${newOrder.order_number} sent to kitchen (not charged to folio).`);
        setKitchenOnlyItems([]);
        setIsKitchenOnlyMode(false);
      }, 120);
      fetchOrders();
    } catch (err: any) {
      console.error('Kitchen-only order failed:', err);
      toast.error('Kitchen-Only Print Failed', err.message || 'Failed to create kitchen order.');
    } finally {
      setIsSendingKitchenOnly(false);
    }
  };

  const foodMenuCategories = ['All', 'Breakfast', 'Favorites', 'Kitchen Extras', 'Drinks', 'Miscellaneous'];
  // In-stock gate: untracked items (or no inventory record) are unlimited and
  // always shown; tracked items show only while quantity remains.
  const isItemInStock = (item: POSItem): boolean => {
    const inv = inventoryMap?.[item.id];
    if (!inv || !inv.is_tracked) return true;
    return inv.current_quantity > 0;
  };
  const stockLeft = (item: POSItem): number | null => {
    const inv = inventoryMap?.[item.id];
    return inv && inv.is_tracked ? inv.current_quantity : null;
  };
  const foodItems = dynamicCatalog.filter((item) => item.category !== 'Extras' && isItemInStock(item));
  const extraItems = dynamicCatalog.filter((item) => item.category === 'Extras' && isItemInStock(item));
  const hiddenOutOfStock = dynamicCatalog.filter((item) => item.category !== 'Extras').length - foodItems.length;

  // Only offer categories that actually have something orderable right now
  // ('All' always stays so the row never vanishes entirely).
  const categoryCount = (cat: string): number =>
    cat === 'All' ? foodItems.length : foodItems.filter((i) => i.category === cat).length;
  const visibleCategories = foodMenuCategories.filter((cat) => cat === 'All' || categoryCount(cat) > 0);

  // If the active tab runs dry (e.g. last portion just sold), fall back to All.
  useEffect(() => {
    if (menuSubCategory !== 'All' && categoryCount(menuSubCategory) === 0) {
      setMenuSubCategory('All');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuSubCategory, dynamicCatalog, inventoryMap]);
  const menuQuery = menuSearch.trim().toLowerCase();
  const matchesQuery = (item: POSItem) =>
    !menuQuery ||
    item.name.toLowerCase().includes(menuQuery) ||
    String(item.price).includes(menuQuery);
  // Sections to render: all categories grouped when 'All', single section otherwise.
  // Falls back to All immediately if the active tab just ran dry.
  const effectiveCategory = menuSubCategory !== 'All' && categoryCount(menuSubCategory) === 0
    ? 'All'
    : menuSubCategory;
  const visibleMenuSections = (effectiveCategory === 'All'
    ? foodMenuCategories.slice(1)
    : [effectiveCategory]
  ).map((cat) => ({
    category: cat,
    items: foodItems.filter((item) => item.category === cat && matchesQuery(item)),
    addedCount: chargedFood
      .filter((f) => f.item.category === cat)
      .reduce((sum, f) => sum + f.quantity, 0),
  }));
  const totalMenuMatches = visibleMenuSections.reduce((sum, s) => sum + s.items.length, 0);
  const getChargedQty = (itemId: string) =>
    chargedFood.find((f) => f.item.id === itemId)?.quantity || 0;

  return (
    <div className="space-y-4">
      {isWalkIn ? (
        <>
          {/* Header for Walk-In Room Service & Extras */}
          <div className="flex justify-between items-center border-b border-secondary/40 pb-2">
            <h3 className="font-display font-bold text-sm text-primary uppercase flex items-center gap-1.5">
              <ShoppingBag size={14} /> Room Service & Extras
            </h3>
            {roomNumber && (
              <button
                type="button"
                onClick={handlePrintKitchenOrder}
                disabled={isPrintingKitchen}
                className="px-2.5 py-1 text-[11px] font-mono font-bold bg-primary hover:bg-primary-hover text-white rounded-lg flex items-center gap-1.5 shadow-xs cursor-pointer transition disabled:opacity-50"
                title="Preview 80mm Kitchen Order before printing"
              >
                {isPrintingKitchen ? (
                  <>
                    <RefreshCw size={12} className="animate-spin" />
                    <span>Printing...</span>
                  </>
                ) : (
                  <>
                    <Printer size={12} />
                    <span>Print Kitchen Order</span>
                  </>
                )}
              </button>
            )}
          </div>

          {/* Selected Pre-added Extras & Menu Items List */}
          {chargedFood.length > 0 && (
            <div className="space-y-2 border-t border-secondary/30 pt-4">
              <span className="text-[11px] font-mono uppercase tracking-wider text-charcoal/50 block font-bold">
                Pre-Added Extras & Menu Items
              </span>
              <div className="space-y-2 bg-cream/40 p-3 rounded-xl border border-secondary/40">
                {chargedFood.map((order) => (
                  <div key={order.item.id} className="flex justify-between items-center text-xs">
                    <div className="flex flex-col">
                      <span className="font-medium text-charcoal">{order.item.name}</span>
                      <span className="text-[10px] font-mono text-charcoal/40">₱{order.item.price} each</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => changeFoodQty(order.item.id, -1)}
                        className="p-1 rounded bg-white border border-secondary text-primary cursor-pointer hover:bg-cream/40"
                      >
                        <Minus size={10} />
                      </button>
                      <span className="font-mono text-xs font-bold w-4 text-center">{order.quantity}</span>
                      <button
                        type="button"
                        onClick={() => changeFoodQty(order.item.id, 1)}
                        className="p-1 rounded bg-white border border-secondary text-primary cursor-pointer hover:bg-cream/40"
                      >
                        <Plus size={10} />
                      </button>
                      <span className="font-mono font-bold text-primary text-xs w-14 text-right">
                        ₱{(order.item.price * order.quantity).toLocaleString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          {/* Room Food Service Purchases (Occupied) */}
          <div className="flex justify-between items-center border-b border-secondary/40 pb-2">
            <h3 className="font-display font-bold text-sm text-primary uppercase flex items-center gap-1.5">
              <ShoppingBag size={14} /> Room Service & Extras
            </h3>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handlePrintKitchenOrder}
                disabled={isPrintingKitchen}
                className="px-2.5 py-1 text-[11px] font-mono font-bold bg-primary hover:bg-primary-hover text-white rounded-lg flex items-center gap-1.5 shadow-xs cursor-pointer transition disabled:opacity-50"
                title="Preview 80mm Kitchen Order before printing"
              >
                {isPrintingKitchen ? (
                  <>
                    <RefreshCw size={12} className="animate-spin" />
                    <span>Printing...</span>
                  </>
                ) : (
                  <>
                    <Printer size={12} />
                    <span>Print Kitchen Order</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => setIsKitchenOnlyMode(m => !m)}
                className={`px-2.5 py-1 text-[11px] font-mono font-bold rounded-lg flex items-center gap-1.5 shadow-xs cursor-pointer transition border ${
                  isKitchenOnlyMode
                    ? 'bg-amber-600 text-white border-amber-700'
                    : 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
                }`}
                title="Send items to kitchen without charging to room folio"
              >
                <ChefHat size={12} />
                <span>Kitchen Only</span>
              </button>
              <span className="text-[10px] font-mono font-bold bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full border border-amber-100">
                 Charged to Room
              </span>
            </div>
          </div>

          {/* Kitchen-Only Mode Panel */}
          {isKitchenOnlyMode && (
            <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ChefHat size={14} className="text-amber-700" />
                  <span className="text-xs font-bold font-mono text-amber-900 uppercase">Kitchen Only — Not Charged to Folio</span>
                </div>
                <button type="button" onClick={() => { setKitchenOnlyItems([]); setIsKitchenOnlyMode(false); }} className="text-amber-600 hover:text-amber-800 cursor-pointer">
                  <X size={14} />
                </button>
              </div>
              {kitchenOnlyItems.length > 0 ? (
                <div className="space-y-1.5">
                  {kitchenOnlyItems.map((f, idx) => (
                    <div key={f.item.id + idx} className="flex justify-between items-center text-xs font-mono bg-white border border-amber-200/60 rounded-lg px-2.5 py-1.5">
                      <span className="font-semibold text-charcoal">{f.item.name}</span>
                      <div className="flex items-center gap-1.5">
                        <button type="button" onClick={() => setKitchenOnlyItems(items => items.map((it, i) => i === idx ? { ...it, quantity: Math.max(0, it.quantity - 1) } : it).filter(it => it.quantity > 0))} className="p-0.5 rounded border border-secondary text-primary cursor-pointer hover:bg-cream/40"><Minus size={9} /></button>
                        <span className="font-bold w-4 text-center">{f.quantity}</span>
                        <button type="button" onClick={() => setKitchenOnlyItems(items => items.map((it, i) => i === idx ? { ...it, quantity: it.quantity + 1 } : it))} className="p-0.5 rounded border border-secondary text-primary cursor-pointer hover:bg-cream/40"><Plus size={9} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] font-sans text-amber-700 italic">Tap catalog items below to add to kitchen order (not folio).</p>
              )}
              <button
                type="button"
                onClick={handleKitchenOnlySend}
                disabled={isSendingKitchenOnly || kitchenOnlyItems.length === 0}
                className="w-full py-2 text-xs font-bold font-mono bg-amber-600 hover:bg-amber-700 text-white rounded-lg flex items-center justify-center gap-2 cursor-pointer transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSendingKitchenOnly ? (
                  <><RefreshCw size={12} className="animate-spin" /><span>Sending...</span></>
                ) : (
                  <><Printer size={12} /><span>Send to Kitchen &amp; Print Ticket (No Folio Charge)</span></>
                )}
              </button>
            </div>
          )}

          {chargedFood.length === 0 ? (
            <p className="text-[11px] font-sans text-charcoal/40 italic py-2">
              No room service or extra charges recorded yet. Click catalog items below to charge.
            </p>
          ) : (
            <div className="space-y-2">
              {chargedFood.map((item) => (
                <div key={item.item.id} className="flex justify-between items-center text-xs font-mono">
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold text-charcoal">{item.item.name}</span>
                    <span className="text-[10px] text-charcoal/40 block">₱{item.item.price} each</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => changeFoodQty(item.item.id, -1)}
                      className="p-1 rounded bg-cream border border-secondary text-primary cursor-pointer hover:bg-secondary/40"
                    >
                      <Minus size={10} />
                    </button>
                    <span className="font-bold w-4 text-center">{item.quantity}</span>
                    <button
                      type="button"
                      onClick={() => changeFoodQty(item.item.id, 1)}
                      className="p-1 rounded bg-cream border border-secondary text-primary cursor-pointer hover:bg-secondary/40"
                    >
                      <Plus size={10} />
                    </button>
                    <span className="font-bold text-charcoal min-w-[50px] text-right">
                      ₱{(item.item.price * item.quantity).toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Kitchen Tickets & 80mm Print Control */}
          {kitchenOrders.length > 0 && (
            <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5 font-mono">
              <div className="flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-1.5">
                  <Printer size={13} className="text-primary" />
                  <span className="font-bold text-charcoal">Kitchen Ticket(s) • 80mm Roll</span>
                  <span className="text-[10px] text-slate-500">({kitchenOrders.length})</span>
                </div>
              </div>

              {kitchenOrders.map((order) => {
                const isPrinting = printingOrderId === order.id || order.print_status === 'printing';
                const isPrinted = order.print_status === 'printed';
                const isFailed = order.print_status === 'failed';

                return (
                  <div
                    key={order.id}
                    className="p-2.5 bg-white border border-slate-200/80 rounded-lg flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-extrabold text-charcoal">{order.order_number}</span>
                        <span
                          className={`text-[9px] uppercase px-1.5 py-0.5 rounded font-bold ${
                            isFailed
                              ? 'bg-red-100 text-red-800 border border-red-200 animate-pulse'
                              : isPrinting
                              ? 'bg-blue-100 text-blue-800 border border-blue-200'
                              : isPrinted
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                              : 'bg-amber-100 text-amber-800 border border-amber-200'
                          }`}
                        >
                          {isFailed ? 'Print Failed' : isPrinting ? 'Printing...' : isPrinted ? 'Printed' : 'Pending Print'}
                        </span>
                        <span className="text-[9px] uppercase px-1.5 py-0.5 rounded font-bold bg-slate-100 text-slate-700">
                          {order.status}
                        </span>
                      </div>
                      {order.items && order.items.length > 0 && (
                        <p className="text-[10px] text-charcoal/70 mt-0.5 truncate">
                          {order.items.map(it => `${it.quantity}x ${it.name}`).join(', ')}
                        </p>
                      )}
                      {isFailed && (
                        <p className="text-[10px] text-red-600 mt-0.5 truncate">
                          {order.print_error || 'Printer unreachable. Write down order manually.'}
                        </p>
                      )}
                      {isPrinted && order.printed_at && (
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          Printed: {new Date(order.printed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {/* Preview Button */}
                      <button
                        type="button"
                        onClick={() => setPreviewTicket(order)}
                        className="p-1.5 text-charcoal/60 hover:text-primary hover:bg-cream/40 rounded border border-transparent hover:border-secondary transition cursor-pointer"
                        title="Preview 80mm Ticket Slip"
                      >
                        <Eye size={13} />
                      </button>

                      {/* Print 80mm Ticket Button */}
                      <button
                        type="button"
                        onClick={() => handlePrintToKitchen(order.id)}
                        disabled={isPrinting}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                          isFailed
                            ? 'bg-red-600 hover:bg-red-700 text-white shadow-xs'
                            : isPrinting
                            ? 'bg-slate-200 text-slate-500'
                            : isPrinted
                            ? 'bg-white hover:bg-cream/40 border border-secondary text-charcoal'
                            : 'bg-primary hover:bg-primary-hover text-white shadow-xs'
                        }`}
                      >
                        {isPrinting ? (
                          <>
                            <RefreshCw size={11} className="animate-spin" />
                            <span>Printing...</span>
                          </>
                        ) : isFailed ? (
                          <>
                            <RefreshCw size={11} />
                            <span>Retry 80mm</span>
                          </>
                        ) : isPrinted ? (
                          <>
                            <Printer size={11} className="text-emerald-600" />
                            <span>Reprint Kitchen Order</span>
                          </>
                        ) : (
                          <>
                            <Printer size={11} />
                            <span>Print Kitchen Order</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Catalog Selectors */}
      <div className={`space-y-3 ${isWalkIn ? 'border-t border-secondary/30 pt-4' : 'bg-cream/40 p-3 rounded-xl border border-secondary/40'}`}>
        <span className={`text-[11px] font-mono uppercase tracking-wider text-charcoal/50 block ${isWalkIn ? 'font-bold' : 'font-semibold'}`}>
          {isWalkIn ? 'Pre-Add Extra Charges (Clean Form)' : 'Add Extra Charges (Clean Form)'}
        </span>
        <div className="flex flex-wrap gap-1.5">
          {extraItems.map((item) => {
            const qty = chargedFood.find(f => f.item.id === item.id)?.quantity || 0;
            const left = stockLeft(item);
            const isLow = left !== null && left <= 3;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => addFoodItem(item)}
                title={isLow ? `Only ${left} left in stock` : undefined}
                className={`px-2.5 py-1.5 border text-[11px] rounded-lg transition cursor-pointer flex items-center gap-1 font-semibold ${
                  qty > 0
                    ? 'bg-primary/10 border-primary text-primary font-bold'
                    : isLow
                    ? 'bg-amber-50/60 hover:bg-amber-50 border-amber-300 text-charcoal/80'
                    : 'bg-white hover:bg-cream/30 border-secondary/60 text-charcoal/80'
                }`}
              >
                {qty > 0 ? `✓ ${item.name} (${qty})` : `+ ${item.name}`}
                <span className="font-mono text-[9px] font-bold text-primary">₱{item.price}</span>
                {isLow && (
                  <span className="font-mono text-[9px] font-extrabold text-amber-700">• {left} left</span>
                )}
              </button>
            );
          })}
          {extraItems.length === 0 && (
            <p className="text-[11px] text-charcoal/45 italic">All extras are currently out of stock.</p>
          )}
        </div>
      </div>

      <div className="space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className={`text-[11px] font-mono uppercase tracking-wider text-charcoal/50 block ${isWalkIn ? 'font-bold' : 'font-semibold'}`}>
            {isWalkIn ? 'Pre-Add Food & Drinks Menu' : 'Add Food & Drinks Menu'}
          </span>
          <span className="text-[10px] font-mono font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full whitespace-nowrap">
            {foodItems.length} in stock
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 text-[10px] text-charcoal/55">
          <span className="flex items-center gap-1.5">
            <span>🍳 6am–10pm</span>
            <span>•</span>
            <span>⚡ Drinks/Misc 24/7</span>
          </span>
          {hiddenOutOfStock > 0 && (
            <span className="font-mono italic whitespace-nowrap">
              {hiddenOutOfStock} out of stock — hidden
            </span>
          )}
        </div>

        {/* Category filter — only categories with something orderable */}
        <div className="flex flex-wrap items-center gap-1.5 py-0.5">
          {visibleCategories.map((cat) => {
            const count = categoryCount(cat);
            const added = cat === 'All'
              ? chargedFood.reduce((sum, f) => sum + f.quantity, 0)
              : chargedFood
                  .filter((f) => f.item.category === cat)
                  .reduce((sum, f) => sum + f.quantity, 0);
            const isActive = effectiveCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setMenuSubCategory(cat)}
                className={`px-2.5 py-1.5 rounded-xl text-[11px] whitespace-nowrap transition cursor-pointer flex items-center gap-1.5 border ${
                  isActive
                    ? 'bg-primary border-primary text-white font-bold shadow-xs'
                    : 'bg-white border-secondary/50 text-charcoal/70 hover:bg-cream/40 font-medium'
                }`}
              >
                <span>{cat}</span>
                <span className={`text-[9px] font-mono font-bold px-1.5 py-0.2 rounded-full ${
                  isActive ? 'bg-white/20 text-white' : 'bg-cream text-charcoal/50'
                }`}>
                  {count}
                </span>
                {added > 0 && (
                  <span className={`text-[9px] font-mono font-extrabold px-1.5 py-0.2 rounded-full ${
                    isActive ? 'bg-white text-primary' : 'bg-primary text-white'
                  }`}>
                    +{added}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-charcoal/40 pointer-events-none" />
          <input
            type="text"
            value={menuSearch}
            onChange={(e) => setMenuSearch(e.target.value)}
            placeholder="Search menu by name or price…"
            className="w-full pl-8 pr-8 py-2 text-xs bg-white border border-secondary/50 rounded-xl focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 placeholder:text-charcoal/35"
          />
          {menuSearch && (
            <button
              type="button"
              onClick={() => setMenuSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded-full hover:bg-cream text-charcoal/50 transition cursor-pointer"
              title="Clear search"
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* Grouped menu sections */}
        <div className="space-y-4">
          {totalMenuMatches === 0 && (
            <p className="text-xs text-charcoal/50 italic text-center py-4 bg-cream/40 rounded-xl border border-secondary/40">
              {menuQuery
                ? `No menu items match “${menuSearch.trim()}”.`
                : 'All menu items are currently out of stock.'}
            </p>
          )}
          {visibleMenuSections.map((section) => {
            if (section.items.length === 0) return null;
            return (
              <section key={section.category} className="min-w-0">
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <h4 className="min-w-0 truncate text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                    {section.category}
                  </h4>
                  <span className="shrink-0 text-[11px] tabular-nums text-slate-400">
                    {section.items.length} item{section.items.length !== 1 ? 's' : ''}
                    {section.addedCount > 0 && (
                      <span className="font-bold text-primary"> • {section.addedCount} added</span>
                    )}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {section.items.map((item) => {
                    const qty = getChargedQty(item.id);
                    const isAdded = qty > 0;
                    const left = stockLeft(item);
                    const isLow = left !== null && left <= 3;
                    return (
                      <div
                        key={item.id}
                        className={`min-w-0 rounded-xl border bg-white p-3 flex flex-col gap-2 transition-shadow hover:shadow-md ${
                          isAdded
                            ? 'border-primary ring-1 ring-primary/30'
                            : 'border-slate-200'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            if (isKitchenOnlyMode) {
                              // Add to kitchen-only queue (no folio charge)
                              setKitchenOnlyItems(prev => {
                                const existing = prev.find(f => f.item.id === item.id);
                                if (existing) {
                                  return prev.map(f => f.item.id === item.id ? { ...f, quantity: f.quantity + 1 } : f);
                                }
                                return [...prev, { item: { id: item.id, name: item.name, price: item.price }, quantity: 1 }];
                              });
                            } else {
                              addFoodItem(item);
                            }
                          }}
                          className="min-w-0 text-left cursor-pointer"
                          title={isKitchenOnlyMode ? `Add ${item.name} to kitchen-only order (not folio)` : `Add ${item.name} to bill`}
                        >
                          <span className="block text-[13px] font-semibold leading-snug text-slate-900 line-clamp-2 min-h-[36px]">
                            {item.name}
                          </span>
                          <span className="mt-1 flex items-center justify-between gap-2">
                            <span className="text-sm font-bold tabular-nums text-primary">
                              ₱{item.price.toLocaleString()}
                            </span>
                            {isLow && (
                              <span className="shrink-0 text-[10px] font-bold text-amber-700 bg-amber-100 px-1.5 py-px rounded-full">
                                {left} left
                              </span>
                            )}
                          </span>
                        </button>
                        {isAdded ? (
                          <div className="flex items-center justify-between bg-slate-50 rounded-lg border border-slate-200 px-1 py-0.5">
                            <button
                              type="button"
                              onClick={() => changeFoodQty(item.id, -1)}
                              className="p-1.5 rounded-md text-slate-600 hover:bg-white hover:text-primary transition cursor-pointer"
                              title={`Remove one ${item.name}`}
                            >
                              <Minus size={12} />
                            </button>
                            <span className="text-xs font-bold tabular-nums text-slate-800">
                              {qty} added
                            </span>
                            <button
                              type="button"
                              onClick={() => changeFoodQty(item.id, 1)}
                              className="p-1.5 rounded-md text-slate-600 hover:bg-white hover:text-primary transition cursor-pointer"
                              title={`Add one more ${item.name}`}
                            >
                              <Plus size={12} />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => addFoodItem(item)}
                            className="w-full py-1.5 rounded-lg bg-primary text-white hover:bg-primary-light text-[11px] font-bold tracking-wide transition flex items-center justify-center gap-1 cursor-pointer"
                          >
                            <Plus size={12} /> ADD
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      {/* 80mm Kitchen Thermal Ticket Print Container (Hidden on screen, prints on @media print) */}
      <div className="hidden print:block">
        {!previewTicket && !prePrintOrders && (
          <PrintableKitchenTicket
            order={activePrintTicket}
            orders={activeBatchTickets || undefined}
          />
        )}
      </div>

      {/* Quick 80mm Ticket Preview Modal (matches ReceiptPreview styling) */}
      <AnimatePresence>
        {previewTicket && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 print:hidden">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl max-w-xl w-full p-6 flex flex-col items-center gap-4 border border-secondary"
            >
              <div className="w-full flex justify-between items-center border-b border-secondary pb-3">
                <div className="flex items-center gap-2">
                  <ChefHat className="text-primary w-5 h-5" />
                  <span className="font-display font-bold text-base text-charcoal">
                    80mm Kitchen Ticket Preview
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setPreviewTicket(null)}
                  className="p-1 rounded-lg hover:bg-cream text-charcoal/60 transition cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Printable preview */}
              <div className="w-full flex justify-center py-2 max-h-[60vh] overflow-y-auto">
                <PrintableKitchenTicket order={previewTicket} />
              </div>

              <div className="w-full flex gap-2 pt-2 border-t border-secondary">
                <button
                  type="button"
                  onClick={() => {
                    handlePrintToKitchen(previewTicket.id);
                    setTimeout(() => setPreviewTicket(null), 500);
                  }}
                  className="flex-1 bg-primary hover:bg-primary-light text-white font-sans text-xs font-bold py-2.5 rounded-xl cursor-pointer transition shadow-sm flex items-center justify-center gap-2"
                >
                  <Printer size={15} />
                  Print Kitchen Order
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewTicket(null)}
                  className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-charcoal text-xs font-bold rounded-xl transition cursor-pointer"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Pre-print preview for the main "Print 80mm Kitchen Order" button.
          Shows exactly what will print BEFORE anything is sent to the printer. */}
      <AnimatePresence>
        {prePrintOrders && prePrintOrders.length > 0 && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 print:hidden">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl max-w-xl w-full p-6 flex flex-col items-center gap-4 border border-secondary"
            >
              <div className="w-full flex justify-between items-center border-b border-secondary pb-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <Eye className="text-primary w-5 h-5" />
                  <span className="font-display font-bold text-base text-charcoal">
                    Preview before printing
                  </span>
                  <span className="text-[10px] font-mono font-bold bg-cream text-charcoal/60 px-2 py-0.5 rounded-full border border-secondary">
                    {prePrintOrders.length} ticket{prePrintOrders.length !== 1 ? 's' : ''} • 80mm
                  </span>
                  {prePrintOrders.length === 1 && prePrintOrders[0].id < 0 && (
                    <span className="text-[10px] font-mono font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full border border-amber-200">
                      DRAFT — not saved yet
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setPrePrintOrders(null)}
                  disabled={isConfirmingPrePrint}
                  className="p-1 rounded-lg hover:bg-cream text-charcoal/60 transition cursor-pointer disabled:opacity-50"
                >
                  <X size={18} />
                </button>
              </div>

              <p className="w-full text-[11px] text-charcoal/60 font-mono -mb-1">
                {prePrintOrders.length === 1 && prePrintOrders[0].id < 0
                  ? 'Check the ticket below. Confirming will save it as a kitchen order, then print.'
                  : 'Check the ticket(s) below. Nothing prints until you confirm.'}
              </p>

              {/* Exact 80mm slip preview */}
              <div className="w-full flex justify-center py-2 max-h-[60vh] overflow-y-auto">
                <PrintableKitchenTicket orders={prePrintOrders} />
              </div>

              <div className="w-full flex gap-2 pt-2 border-t border-secondary">
                <button
                  type="button"
                  onClick={handleConfirmPrePrint}
                  disabled={isConfirmingPrePrint}
                  className="flex-1 bg-primary hover:bg-primary-hover text-white font-sans text-xs font-bold py-2.5 rounded-xl cursor-pointer transition shadow-sm flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isConfirmingPrePrint ? (
                    <>
                      <RefreshCw size={15} className="animate-spin" />
                      Printing...
                    </>
                  ) : (
                    <>
                      <Printer size={15} />
                      Confirm & Print Kitchen Order
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setPrePrintOrders(null)}
                  disabled={isConfirmingPrePrint}
                  className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-charcoal text-xs font-bold rounded-xl transition cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
