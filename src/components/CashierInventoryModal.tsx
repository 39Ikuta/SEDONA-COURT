import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  Package,
  Layers,
  Check,
  AlertTriangle,
  RotateCcw,
  FileSpreadsheet,
  Download,
  Search,
  Filter,
  Sparkles,
  Clock,
  User,
  CheckCircle2,
  AlertCircle,
  Plus,
  Tag,
  Boxes,
  Shirt,
  Sparkle
} from 'lucide-react';
import {
  InventoryItem,
  ShiftInfo,
  getCurrentInventory,
  setStockCount,
  batchSetStock,
  createInventoryItem,
  downloadDailyInventoryCsv,
  downloadWeeklyInventoryCsv
} from '../api/inventory';
import { useToast } from './ui/Toast';
import { useModalEscape } from '../hooks/useModalEscape';

interface CashierInventoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeCashier: string;
  onInventoryChanged?: () => void;
}

const PRESET_CATEGORIES = [
  'Linen & Bedding',
  'Hotel Supplies',
  'Laundry',
  'Breakfast',
  'Favorites',
  'Kitchen Extras',
  'Drinks',
  'Miscellaneous',
  'Extras'
];

export const CashierInventoryModal: React.FC<CashierInventoryModalProps> = ({
  isOpen,
  onClose,
  activeCashier,
  onInventoryChanged,
}) => {
  const toast = useToast();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [editedQuantities, setEditedQuantities] = useState<Record<string, number>>({});
  const [shiftInfo, setShiftInfo] = useState<ShiftInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [downloadingReport, setDownloadingReport] = useState<'daily' | 'weekly' | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');

  // Add Item Drawer / Sub-modal state
  const [isAddItemOpen, setIsAddItemOpen] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemCategory, setNewItemCategory] = useState('Linen & Bedding');
  const [customCategory, setCustomCategory] = useState('');
  const [newItemQuantity, setNewItemQuantity] = useState<number>(10);
  const [newItemPrice, setNewItemPrice] = useState<string>('');
  const [isAddingItem, setIsAddingItem] = useState(false);

  useModalEscape(isOpen, onClose, !saving && !isAddingItem);

  const fetchInventory = async () => {
    setLoading(true);
    try {
      const data = await getCurrentInventory();
      setItems(data.items);
      setShiftInfo(data.currentShift);

      // Initialize edited quantities with current values
      const initialMap: Record<string, number> = {};
      data.items.forEach(it => {
        initialMap[it.item_id] = it.current_quantity;
      });
      setEditedQuantities(initialMap);
    } catch (err: any) {
      console.error('Failed to load inventory:', err);
      toast.warning('Error', 'Unable to fetch shift inventory.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchInventory();
      setIsAddItemOpen(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Custom sort for category pills so key hotel operations categories appear first
  const preferredCategoryOrder = [
    'All',
    'Linen & Bedding',
    'Hotel Supplies',
    'Laundry',
    'Breakfast',
    'Favorites',
    'Kitchen Extras',
    'Drinks',
    'Miscellaneous',
    'Extras'
  ];

  const distinctCategories = Array.from(new Set<string>(items.map(i => i.category || '')));
  const categories = [
    'All',
    ...preferredCategoryOrder.filter(c => c !== 'All' && distinctCategories.includes(c)),
    ...distinctCategories.filter(c => !preferredCategoryOrder.includes(c))
  ];

  const filteredItems = items.filter(item => {
    const matchesCat = selectedCategory === 'All' || item.category === selectedCategory;
    const matchesSearch =
      item.item_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.item_id.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesSearch;
  });

  const handleQtyChange = (itemId: string, newQty: number) => {
    const clamped = Math.max(0, Math.floor(newQty));
    setEditedQuantities(prev => ({
      ...prev,
      [itemId]: clamped,
    }));
  };

  const handleQuickAdd = (itemId: string, amount: number) => {
    setEditedQuantities(prev => {
      const current = prev[itemId] ?? 0;
      return {
        ...prev,
        [itemId]: Math.max(0, current + amount),
      };
    });
  };

  const handleSetZero = (itemId: string) => {
    setEditedQuantities(prev => ({
      ...prev,
      [itemId]: 0,
    }));
  };

  // Check how many items were modified compared to current database values
  const dirtyItems = items.filter(
    item => editedQuantities[item.item_id] !== undefined && editedQuantities[item.item_id] !== item.current_quantity
  );

  const handleSaveAll = async () => {
    if (dirtyItems.length === 0) {
      toast.info('No Changes', 'All stock counts match current records.');
      return;
    }

    setSaving(true);
    try {
      const payload = dirtyItems.map(it => ({
        itemId: it.item_id,
        quantity: editedQuantities[it.item_id],
      }));

      await batchSetStock(payload, `Cashier shift inventory update by ${activeCashier}`);
      toast.success('Inventory Updated', `Saved stock counts for ${dirtyItems.length} items.`);
      await fetchInventory();
      if (onInventoryChanged) onInventoryChanged();
    } catch (err: any) {
      console.error('Failed to save batch stock:', err);
      toast.warning('Save Failed', err.message || 'Could not save inventory.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSingle = async (item: InventoryItem) => {
    const targetQty = editedQuantities[item.item_id] ?? item.current_quantity;
    try {
      await setStockCount(item.item_id, targetQty, `Shift update by ${activeCashier}`);
      toast.success('Item Updated', `${item.item_name} set to ${targetQty} available.`);
      await fetchInventory();
      if (onInventoryChanged) onInventoryChanged();
    } catch (err: any) {
      console.error('Failed to set single stock:', err);
      toast.warning('Update Failed', err.message || 'Could not update item stock.');
    }
  };

  const handleCreateNewItem = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalCategory = newItemCategory === 'Custom' ? customCategory.trim() : newItemCategory.trim();

    if (!newItemName.trim()) {
      toast.warning('Name Required', 'Please enter an item or supply name.');
      return;
    }
    if (!finalCategory) {
      toast.warning('Category Required', 'Please select or enter a category.');
      return;
    }

    setIsAddingItem(true);
    try {
      const parsedPrice = newItemPrice ? parseFloat(newItemPrice) : undefined;
      const res = await createInventoryItem({
        itemName: newItemName.trim(),
        category: finalCategory,
        initialQuantity: newItemQuantity,
        price: parsedPrice,
        isTracked: true,
      });

      toast.success('Item Added', `"${res.data.item_name}" registered with initial stock of ${newItemQuantity}.`);
      setNewItemName('');
      setNewItemQuantity(10);
      setNewItemPrice('');
      setCustomCategory('');
      setIsAddItemOpen(false);
      await fetchInventory();
      if (onInventoryChanged) onInventoryChanged();
    } catch (err: any) {
      console.error('Failed to add new inventory item:', err);
      toast.warning('Error', err.message || 'Could not add inventory item.');
    } finally {
      setIsAddingItem(false);
    }
  };

  const handleDownloadCsv = async (type: 'daily' | 'weekly') => {
    setDownloadingReport(type);
    try {
      if (type === 'daily') {
        await downloadDailyInventoryCsv();
        toast.success('Downloaded', "Daily shift inventory report exported successfully.");
      } else {
        await downloadWeeklyInventoryCsv();
        toast.success('Downloaded', "Weekly shift inventory report exported successfully.");
      }
    } catch (err: any) {
      console.error('Failed to download report:', err);
      toast.warning('Download Error', err.message || 'Could not export report.');
    } finally {
      setDownloadingReport(null);
    }
  };

  const getCategoryBadgeClass = (category: string) => {
    switch (category) {
      case 'Linen & Bedding':
        return 'bg-indigo-50 text-indigo-700 border-indigo-200/80';
      case 'Hotel Supplies':
        return 'bg-teal-50 text-teal-700 border-teal-200/80';
      case 'Laundry':
        return 'bg-purple-50 text-purple-700 border-purple-200/80';
      case 'Drinks':
        return 'bg-blue-50 text-blue-700 border-blue-200/80';
      case 'Breakfast':
        return 'bg-amber-50 text-amber-700 border-amber-200/80';
      case 'Favorites':
        return 'bg-rose-50 text-rose-700 border-rose-200/80';
      case 'Kitchen Extras':
        return 'bg-orange-50 text-orange-700 border-orange-200/80';
      case 'Miscellaneous':
        return 'bg-slate-100 text-slate-700 border-slate-200/80';
      default:
        return 'bg-zinc-100 text-zinc-700 border-zinc-200/80';
    }
  };

  const outOfStockCount = items.filter(i => (editedQuantities[i.item_id] ?? i.current_quantity) === 0).length;
  const availableCount = items.length - outOfStockCount;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="inventory-modal-title"
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto animate-fadeIn"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 12 }}
        transition={{ duration: 0.2 }}
        className="bg-white border border-[#E1DAD0] rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden text-charcoal"
      >
        {/* Modal Header */}
        <div className="p-5 sm:p-6 bg-gradient-to-r from-[#793743] via-[#652b36] to-[#4e1f28] text-white flex items-center justify-between shrink-0 relative overflow-hidden">
          <div className="absolute right-0 top-0 bottom-0 opacity-10 pointer-events-none flex items-center pr-8">
            <Package size={140} />
          </div>

          <div className="flex flex-col gap-1 relative z-10">
            <div className="flex items-center gap-2">
              <span className="p-1.5 bg-white/10 rounded-lg text-amber-300">
                <Package size={20} />
              </span>
              <h2 id="inventory-modal-title" className="font-display font-black text-lg sm:text-xl tracking-wide uppercase">
                Cashier Shift Menu &amp; Supplies Inventory
              </h2>
            </div>
            <p className="text-xs text-white/80 font-sans">
              Enter and recount available stock for food, drinks, linens, bedding sets, supplies, and laundry.
            </p>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer shrink-0 z-10"
            title="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Shift Badge & Quick Stats Bar */}
        <div className="bg-[#F8F6F2] border-b border-[#E1DAD0] px-5 py-3 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-primary/10 text-primary font-bold rounded-lg border border-primary/20">
              <Clock size={13} />
              <span>Shift: {shiftInfo ? `${shiftInfo.shiftType} (${shiftInfo.shiftId})` : 'Active Shift'}</span>
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white text-charcoal/70 rounded-lg border border-[#E1DAD0]">
              <User size={13} className="text-primary" />
              <span>Cashier: <strong className="text-charcoal">{activeCashier}</strong></span>
            </span>
          </div>

          <div className="flex items-center gap-2 font-semibold">
            <span className="text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
              ● {availableCount} In Stock
            </span>
            <span className="text-rose-700 bg-rose-50 px-2.5 py-1 rounded-lg border border-rose-200">
              ● {outOfStockCount} Out of Stock
            </span>
          </div>
        </div>

        {/* Toolbar: Search, Add Item Toggle, Export Buttons */}
        <div className="p-4 border-b border-[#E1DAD0] bg-white flex flex-col sm:flex-row gap-3 items-center justify-between shrink-0">
          <div className="flex items-center gap-2 w-full sm:w-auto flex-1 max-w-md">
            <div className="relative w-full">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-charcoal/40" />
              <input
                type="text"
                placeholder="Search item, linen, supply, or ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-[#F9F7F4] border border-[#E1DAD0] rounded-xl text-xs focus:bg-white focus:outline-hidden focus:border-primary transition"
              />
            </div>
          </div>

          {/* Action Buttons: Add Item & Export */}
          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              onClick={() => setIsAddItemOpen(!isAddItemOpen)}
              className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                isAddItemOpen
                  ? 'bg-primary text-white border-primary shadow-xs'
                  : 'border-primary/30 bg-primary/5 hover:bg-primary/10 text-primary'
              }`}
              title="Add a new trackable item or hotel supply to shift inventory"
            >
              <Plus size={14} />
              <span>{isAddItemOpen ? 'Close Add Form' : 'Add Item / Supply'}</span>
            </button>

            <button
              onClick={() => handleDownloadCsv('daily')}
              disabled={downloadingReport !== null}
              className="px-3 py-1.5 rounded-xl border border-emerald-600/30 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
              title="Download today's inventory activity as a styled workbook"
            >
              <Download size={13} />
              <span>{downloadingReport === 'daily' ? 'Exporting...' : 'Daily XLSX'}</span>
            </button>

            <button
              onClick={() => handleDownloadCsv('weekly')}
              disabled={downloadingReport !== null}
              className="px-3 py-1.5 rounded-xl border border-blue-600/30 bg-blue-50 hover:bg-blue-100 text-blue-800 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
              title="Download weekly inventory report as a styled workbook"
            >
              <FileSpreadsheet size={13} />
              <span>{downloadingReport === 'weekly' ? 'Exporting...' : 'Weekly XLSX'}</span>
            </button>
          </div>
        </div>

        {/* Collapsible Add New Inventory Item Panel */}
        <AnimatePresence>
          {isAddItemOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="border-b border-[#E1DAD0] bg-gradient-to-br from-[#FAF8F5] to-[#F2EDE4] overflow-hidden"
            >
              <form onSubmit={handleCreateNewItem} className="p-4 sm:p-5 space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-charcoal uppercase tracking-wider">
                  <Sparkles size={14} className="text-primary" />
                  <span>Register New Shift Tracked Item or Supply</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                  {/* Item Name */}
                  <div className="sm:col-span-4">
                    <label className="block text-[11px] font-semibold text-charcoal/70 mb-1">
                      Item / Supply Name *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Bed sheet, Blanket, Guest Kit"
                      value={newItemName}
                      onChange={(e) => setNewItemName(e.target.value)}
                      className="w-full px-3 py-1.5 bg-white border border-[#D5CCC0] rounded-xl text-xs focus:outline-hidden focus:border-primary"
                    />
                  </div>

                  {/* Category Dropdown */}
                  <div className="sm:col-span-3">
                    <label className="block text-[11px] font-semibold text-charcoal/70 mb-1">
                      Category *
                    </label>
                    <select
                      value={newItemCategory}
                      onChange={(e) => setNewItemCategory(e.target.value)}
                      className="w-full px-3 py-1.5 bg-white border border-[#D5CCC0] rounded-xl text-xs focus:outline-hidden focus:border-primary"
                    >
                      {PRESET_CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                      <option value="Custom">+ Custom Category...</option>
                    </select>
                  </div>

                  {/* Custom Category Input if selected */}
                  {newItemCategory === 'Custom' && (
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-semibold text-charcoal/70 mb-1">
                        Custom Category *
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Toiletries"
                        value={customCategory}
                        onChange={(e) => setCustomCategory(e.target.value)}
                        className="w-full px-3 py-1.5 bg-white border border-[#D5CCC0] rounded-xl text-xs focus:outline-hidden focus:border-primary"
                      />
                    </div>
                  )}

                  {/* Initial Quantity */}
                  <div className={newItemCategory === 'Custom' ? 'sm:col-span-2' : 'sm:col-span-3'}>
                    <label className="block text-[11px] font-semibold text-charcoal/70 mb-1">
                      Initial Shift Stock *
                    </label>
                    <input
                      type="number"
                      min="0"
                      required
                      value={newItemQuantity}
                      onChange={(e) => setNewItemQuantity(parseInt(e.target.value || '0', 10))}
                      className="w-full px-3 py-1.5 bg-white border border-[#D5CCC0] rounded-xl text-xs font-mono font-bold focus:outline-hidden focus:border-primary"
                    />
                  </div>

                  {/* Price (optional) */}
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-semibold text-charcoal/70 mb-1">
                      Base Price (₱, opt)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      placeholder="0.00"
                      value={newItemPrice}
                      onChange={(e) => setNewItemPrice(e.target.value)}
                      className="w-full px-3 py-1.5 bg-white border border-[#D5CCC0] rounded-xl text-xs font-mono focus:outline-hidden focus:border-primary"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setIsAddItemOpen(false)}
                    className="px-3 py-1.5 rounded-xl border border-[#D5CCC0] bg-white hover:bg-[#F2EEE9] text-charcoal text-xs font-semibold transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isAddingItem}
                    className="px-4 py-1.5 rounded-xl bg-primary hover:bg-primary-light text-white text-xs font-bold shadow-xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {isAddingItem ? (
                      <>
                        <RotateCcw className="animate-spin" size={13} />
                        <span>Adding...</span>
                      </>
                    ) : (
                      <>
                        <Check size={13} />
                        <span>Add to Shift Inventory</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Category Pills */}
        <div className="px-4 py-2 border-b border-[#E1DAD0] bg-[#FAFAF8] flex items-center gap-1.5 overflow-x-auto shrink-0 scrollbar-none">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition shrink-0 cursor-pointer ${
                selectedCategory === cat
                  ? 'bg-primary text-white shadow-xs'
                  : 'bg-white text-charcoal/70 border border-[#E1DAD0] hover:bg-[#F2EEE9]'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Inventory Items List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {loading ? (
            <div className="py-16 text-center text-charcoal/50 text-xs flex flex-col items-center gap-2">
              <RotateCcw className="animate-spin text-primary" size={24} />
              <span>Loading shift inventory...</span>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="py-12 text-center text-charcoal/40 text-xs">
              No items match the selected filter.
            </div>
          ) : (
            filteredItems.map((item) => {
              const currentVal = editedQuantities[item.item_id] ?? item.current_quantity;
              const isDirty = currentVal !== item.current_quantity;
              const isZero = currentVal === 0;

              return (
                <div
                  key={item.item_id}
                  className={`p-3.5 rounded-2xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                    isZero
                      ? 'bg-rose-50/40 border-rose-200'
                      : isDirty
                      ? 'bg-amber-50/50 border-amber-300 shadow-xs'
                      : 'bg-white border-[#E8E2D8] hover:border-primary/40'
                  }`}
                >
                  {/* Item Info */}
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center font-mono font-bold text-xs shrink-0 ${
                        isZero
                          ? 'bg-rose-100 text-rose-700'
                          : currentVal <= 3
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-emerald-100 text-emerald-700'
                      }`}
                    >
                      {currentVal}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-charcoal">{item.item_name}</span>
                        <span className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border ${getCategoryBadgeClass(item.category)}`}>
                          {item.category}
                        </span>
                        {isZero && (
                          <span className="text-[9px] font-mono font-bold uppercase bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded">
                            86'D / OUT OF STOCK
                          </span>
                        )}
                        {isDirty && (
                          <span className="text-[9px] font-mono font-bold uppercase bg-amber-200 text-amber-900 px-1.5 py-0.5 rounded">
                            Modified (Prev: {item.current_quantity})
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-charcoal/50 font-mono mt-0.5 flex items-center gap-2">
                        <span>ID: {item.item_id}</span>
                        {item.last_updated_by && (
                          <span>• Last: {item.last_updated_by} ({item.updated_at ? item.updated_at.slice(11, 16) : ''})</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Portions & Adjusters */}
                  <div className="flex items-center gap-2 justify-end">
                    {/* Quick Add Buttons */}
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleQuickAdd(item.item_id, 1)}
                        className="px-2 py-1 rounded-lg bg-[#F2EEE9] hover:bg-[#E5DFD7] text-charcoal text-xs font-mono font-bold transition cursor-pointer"
                        title="Add 1"
                      >
                        +1
                      </button>
                      <button
                        type="button"
                        onClick={() => handleQuickAdd(item.item_id, 5)}
                        className="px-2 py-1 rounded-lg bg-[#F2EEE9] hover:bg-[#E5DFD7] text-charcoal text-xs font-mono font-bold transition cursor-pointer"
                        title="Add 5"
                      >
                        +5
                      </button>
                      <button
                        type="button"
                        onClick={() => handleQuickAdd(item.item_id, 10)}
                        className="px-2 py-1 rounded-lg bg-[#F2EEE9] hover:bg-[#E5DFD7] text-charcoal text-xs font-mono font-bold transition cursor-pointer"
                        title="Add 10"
                      >
                        +10
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSetZero(item.item_id)}
                        className="px-2 py-1 rounded-lg bg-rose-100 hover:bg-rose-200 text-rose-700 text-xs font-mono font-bold transition cursor-pointer"
                        title="Set 0 (Out of stock)"
                      >
                        86
                      </button>
                    </div>

                    {/* Numeric Input */}
                    <div className="flex items-center border border-[#D5CCC0] rounded-xl overflow-hidden bg-white shadow-2xs">
                      <button
                        type="button"
                        onClick={() => handleQtyChange(item.item_id, currentVal - 1)}
                        disabled={currentVal <= 0}
                        className="px-2.5 py-1 text-charcoal/70 hover:bg-[#F2EEE9] disabled:opacity-30 cursor-pointer font-bold"
                      >
                        -
                      </button>
                      <input
                        type="number"
                        min="0"
                        value={currentVal}
                        onChange={(e) => handleQtyChange(item.item_id, parseInt(e.target.value || '0', 10))}
                        className="w-14 text-center font-mono font-bold text-xs py-1 focus:outline-hidden"
                      />
                      <button
                        type="button"
                        onClick={() => handleQtyChange(item.item_id, currentVal + 1)}
                        className="px-2.5 py-1 text-charcoal/70 hover:bg-[#F2EEE9] cursor-pointer font-bold"
                      >
                        +
                      </button>
                    </div>

                    {/* Single Save Indicator */}
                    {isDirty && (
                      <button
                        type="button"
                        onClick={() => handleSaveSingle(item)}
                        className="p-1.5 rounded-lg bg-primary text-white hover:bg-primary-light transition cursor-pointer"
                        title="Save this item count immediately"
                      >
                        <Check size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-[#F8F6F2] border-t border-[#E1DAD0] flex items-center justify-between gap-3 shrink-0">
          <div className="text-xs font-mono text-charcoal/60">
            {dirtyItems.length > 0 ? (
              <span className="text-amber-800 font-semibold flex items-center gap-1.5">
                <AlertCircle size={14} className="text-amber-600" />
                <span>{dirtyItems.length} items modified. Click "Save Shift Stock Counts" to commit.</span>
              </span>
            ) : (
              <span className="text-emerald-700 flex items-center gap-1.5">
                <CheckCircle2 size={14} />
                <span>All portions &amp; supplies synced with live inventory.</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-[#D5CCC0] bg-white hover:bg-[#F2EEE9] text-charcoal text-xs font-semibold transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveAll}
              disabled={saving || dirtyItems.length === 0}
              className="px-5 py-2 rounded-xl bg-primary hover:bg-primary-light text-white text-xs font-bold shadow-sm transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {saving ? (
                <>
                  <RotateCcw className="animate-spin" size={14} />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Check size={14} />
                  <span>Save Shift Stock Counts ({dirtyItems.length})</span>
                </>
              )}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
