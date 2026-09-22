import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { BillableService, AuditLogEntry, UserRole } from '../types';
import { 
  ShieldCheck, 
  Lock, 
  Plus, 
  Trash2, 
  Edit3, 
  Save, 
  X, 
  Search, 
  DollarSign, 
  Coffee, 
  Wrench, 
  ClipboardList,
  AlertCircle,
  CalendarRange,
  Check,
  RotateCcw,
  Users,
  UserPlus,
  KeyRound,
  ShieldAlert,
  Printer,
  Zap,
  Monitor,
  FolderOpen,
  HardDrive,
  Flame,
  Coins,
  FileCheck,
  RefreshCw,
  Cpu,
  Ticket
} from 'lucide-react';
import { formatGatePassDateTime } from '../utils/barcode';
import { useToast } from './ui/Toast';
import { getUsers, createUser, deleteUser, resetUserPassword, UserAccountRecord } from '../api/users';

interface SettingsPanelProps {
  billableServices: BillableService[];
  auditLogs: AuditLogEntry[];
  role: UserRole;
  onAddService: (newService: Omit<BillableService, 'id'>) => void;
  onUpdateService: (updated: BillableService) => void;
  onDeleteService: (id: string) => void;
  loggedInUser: string;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  billableServices,
  auditLogs,
  role,
  onAddService,
  onUpdateService,
  onDeleteService,
  loggedInUser,
}) => {
  // Access level check: Only Owner can add, edit, toggle, or delete configurations
  const isOwner = role === 'owner';
  const isAuthorized = role === 'admin' || role === 'owner';
  const toast = useToast();

  // Sub-tabs in settings panel
  const [activeSubTab, setActiveSubTab] = useState<'rates' | 'menu' | 'services' | 'audit' | 'accounts' | 'hardware'>('rates');

  // Ensure cashiers cannot be on audit or accounts sub-tabs
  useEffect(() => {
    if ((role === 'cashier' || !isAuthorized) && (activeSubTab === 'audit' || activeSubTab === 'accounts')) {
      setActiveSubTab('rates');
    }
  }, [role, isAuthorized, activeSubTab]);

  // Hardware settings state
  const isElectron = Boolean(window.electronAPI?.isElectron);
  const [printers, setPrinters] = useState<Array<{ name: string; displayName: string; description: string; isDefault: boolean; status: number }>>([]);
  const [selectedPrinter, setSelectedPrinter] = useState<string>(() => localStorage.getItem('scti_hw_receipt_printer') || '');
  const [printDensity, setPrintDensity] = useState<'normal' | 'high' | 'ultra'>(() => (localStorage.getItem('scti_hw_print_density') as any) || 'high');
  const [autoKickDrawer, setAutoKickDrawer] = useState<boolean>(() => localStorage.getItem('scti_hw_auto_kick_drawer') !== 'false');
  const [drawerPin, setDrawerPin] = useState<2 | 5>(() => (parseInt(localStorage.getItem('scti_hw_drawer_pin') || '2', 10) as 2 | 5) || 2);
  const [displays, setDisplays] = useState<Array<{ id: number; label: string; bounds: any; isPrimary: boolean }>>([]);
  const [isTestingPrint, setIsTestingPrint] = useState(false);
  const [isTestingDrawer, setIsTestingDrawer] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [backupResult, setBackupResult] = useState<any>(null);
  const [appDataInfo, setAppDataInfo] = useState<any>(null);
  const [customerDisplayOpen, setCustomerDisplayOpen] = useState(false);

  useEffect(() => {
    if (activeSubTab === 'hardware' && isElectron && window.electronAPI) {
      window.electronAPI.getPrinters().then(setPrinters).catch(console.warn);
      window.electronAPI.getDisplays().then(setDisplays).catch(console.warn);
      window.electronAPI.getAppDataPath().then(setAppDataInfo).catch(console.warn);
    }
  }, [activeSubTab, isElectron]);

  const handleSaveHardwareSettings = () => {
    localStorage.setItem('scti_hw_receipt_printer', selectedPrinter);
    localStorage.setItem('scti_hw_print_density', printDensity);
    localStorage.setItem('scti_hw_auto_kick_drawer', autoKickDrawer ? 'true' : 'false');
    localStorage.setItem('scti_hw_drawer_pin', String(drawerPin));
    toast.success('Hardware Settings Saved', '80mm Printer & Cash Drawer configuration updated');
  };

  const handleTestPrint = async () => {
    if (!isElectron || !window.electronAPI) {
      toast.info('Browser Mode', 'Silent high-DPI thermal printing is active in the Electron Desktop application.');
      return;
    }
    setIsTestingPrint(true);
    try {
      const sampleHtml = `
        <div style="text-align: center; font-family: monospace; padding: 10px;">
          <h2 style="margin: 0; font-size: 16px; font-weight: 900;">SEDONA COURT</h2>
          <p style="font-size: 10px; margin: 4px 0; font-weight: bold;">HARDWARE THERMAL TEST PRINT</p>
          <hr style="border: none; border-top: 1px dashed black; margin: 8px 0;" />
          <div style="text-align: left; font-size: 11px; line-height: 1.4;">
            <div>DATE: ${new Date().toLocaleString()}</div>
            <div>PRINTER: ${selectedPrinter || 'System Default'}</div>
            <div>DENSITY: ${printDensity.toUpperCase()} (300 DPI)</div>
            <div>STATUS: ONLINE & OPTIMAL</div>
          </div>
          <hr style="border: none; border-top: 1px dashed black; margin: 8px 0;" />
          <p style="font-size: 10px; margin: 0; font-weight: bold;">*** TEST COMPLETED SUCCESSFULLY ***</p>
        </div>
      `;
      const res = await window.electronAPI.printReceiptSilent({
        html: sampleHtml,
        deviceName: selectedPrinter || undefined,
        density: printDensity,
        kickDrawer: false,
      });
      if (res.success) {
        toast.success('Test Print Sent', 'Check your 80mm thermal printer for the test receipt');
      } else {
        toast.error('Print Error', res.error || 'Failed to dispatch test print');
      }
    } catch (err: any) {
      toast.error('Print Error', err.message);
    } finally {
      setIsTestingPrint(false);
    }
  };

  const handleTestGatePassPrint = async () => {
    if (!isElectron || !window.electronAPI) {
      toast.info('Browser Mode', 'Silent high-DPI thermal printing is active in the Electron Desktop application.');
      return;
    }
    setIsTestingPrint(true);
    try {
      const sampleHtml = `
        <div style="text-align: center; font-family: monospace; padding: 10px;">
          <h2 style="margin: 0; font-size: 15px; font-weight: 900;">SEDONA REMEDIOS</h2>
          <p style="font-size: 9px; margin: 2px 0;">Doña Remedios Trinidad Hwy, San Rafael, Bulacan</p>
          <hr style="border: none; border-top: 2px solid black; margin: 6px 0;" />
          <div style="background: black; color: white; padding: 3px 0; font-weight: 900; font-size: 13px; letter-spacing: 2px;">GATE PASS</div>
          <hr style="border: none; border-top: 1px dashed black; margin: 6px 0;" />
          <div style="text-align: left; font-size: 11px; line-height: 1.5;">
            <div><strong>Ticket No.:</strong> GP-TEST-0017</div>
            <div><strong>Room No.:</strong> 17</div>
            <div><strong>Check In Date &amp; Time:</strong> ${formatGatePassDateTime(new Date(Date.now() - 3600000 * 3))}</div>
            <div><strong>Check Out Date &amp; Time:</strong> ${formatGatePassDateTime(new Date())}</div>
          </div>
          <hr style="border: none; border-top: 1px dashed black; margin: 6px 0;" />
          <div style="margin: 8px 0;">
            <div style="font-weight: bold; font-size: 10px; letter-spacing: 2px;">*GP-TEST-0017*</div>
          </div>
        </div>
      `;
      const res = await window.electronAPI.printReceiptSilent({
        html: sampleHtml,
        deviceName: selectedPrinter || undefined,
        density: printDensity,
        kickDrawer: false,
      });
      if (res.success) {
        toast.success('Gate Pass Test Sent', 'Check thermal printer for test Gate Pass');
      } else {
        toast.error('Print Error', res.error || 'Failed to dispatch Gate Pass test');
      }
    } catch (err: any) {
      toast.error('Print Error', err.message);
    } finally {
      setIsTestingPrint(false);
    }
  };

  const handleTestKickDrawer = async () => {
    if (!isElectron || !window.electronAPI) {
      toast.info('Browser Mode', 'Cash drawer kick is available in the Electron Desktop application.');
      return;
    }
    setIsTestingDrawer(true);
    try {
      const res = await window.electronAPI.openCashDrawer({
        printerName: selectedPrinter || undefined,
        drawerPin: drawerPin,
      });
      if (res.success) {
        toast.success('Cash Drawer Opened', `Dispatched kick pulse via Pin ${drawerPin}`);
      } else {
        toast.error('Drawer Kick Failed', res.error || 'Check printer connection');
      }
    } catch (err: any) {
      toast.error('Drawer Kick Error', err.message);
    } finally {
      setIsTestingDrawer(false);
    }
  };

  const handleBackupDatabase = async () => {
    if (!isElectron || !window.electronAPI) {
      toast.info('Browser Mode', 'Database snapshot backups are available in the Electron Desktop application.');
      return;
    }
    setIsBackingUp(true);
    try {
      const res = await window.electronAPI.backupDatabase();
      setBackupResult(res);
      if (res.success) {
        toast.success('Database Backed Up', res.message || 'SQLite snapshot saved');
      } else {
        toast.error('Backup Error', res.error || 'Could not create snapshot');
      }
    } catch (err: any) {
      toast.error('Backup Error', err.message);
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleOpenDataFolder = async () => {
    if (!isElectron || !window.electronAPI) {
      return;
    }
    await window.electronAPI.openDataFolder();
  };

  const handleToggleCustomerDisplay = async () => {
    if (!isElectron || !window.electronAPI) {
      window.open('/display', '_blank', 'width=1280,height=800');
      return;
    }
    const nextState = !customerDisplayOpen;
    const res = await window.electronAPI.toggleCustomerDisplay(nextState);
    if (res.success) {
      setCustomerDisplayOpen(Boolean(res.isOpen));
      toast.success('Customer Display', res.isOpen ? 'Opened on secondary monitor' : 'Closed customer window');
    }
  };

  // User accounts management state (Owner / Admin)
  const [userList, setUserList] = useState<UserAccountRecord[]>([]);
  const [loadingUsers, setLoadingUsers] = useState<boolean>(false);
  const [accountSearch, setAccountSearch] = useState<string>('');
  const [isCreatingUser, setIsCreatingUser] = useState<boolean>(false);
  const [newUsername, setNewUsername] = useState<string>('');
  const [newName, setNewName] = useState<string>('');
  const [newRole, setNewRole] = useState<UserRole>('cashier');
  const [newPassword, setNewPassword] = useState<string>('cashier123');
  const [submittingUser, setSubmittingUser] = useState<boolean>(false);

  // Password reset modal state
  const [resetTargetUser, setResetTargetUser] = useState<UserAccountRecord | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState<string>('cashier123');
  const [submittingReset, setSubmittingReset] = useState<boolean>(false);

  // Delete modal state
  const [deleteTargetUser, setDeleteTargetUser] = useState<UserAccountRecord | null>(null);
  const [deletingUser, setDeletingUser] = useState<boolean>(false);

  const fetchUsers = async () => {
    if (!isAuthorized) return;
    setLoadingUsers(true);
    try {
      const res = await getUsers();
      setUserList(res.users);
    } catch (err: any) {
      console.warn('Could not load user accounts:', err);
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    if (activeSubTab === 'accounts' && isAuthorized) {
      fetchUsers();
    }
  }, [activeSubTab, isAuthorized]);

  const handleCreateUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim() || !newName.trim() || !newPassword.trim()) {
      toast.error('Validation Error', 'Please complete all required fields.');
      return;
    }
    setSubmittingUser(true);
    try {
      const res = await createUser({
        username: newUsername.trim(),
        name: newName.trim(),
        role: newRole,
        accessCode: newPassword.trim(),
      });
      toast.success('Account Created', res.message || `Account @${newUsername} created.`);
      setIsCreatingUser(false);
      setNewUsername('');
      setNewName('');
      setNewRole('cashier');
      setNewPassword('cashier123');
      fetchUsers();
    } catch (err: any) {
      toast.error('Creation Failed', err.message || 'Could not create account');
    } finally {
      setSubmittingUser(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!deleteTargetUser) return;
    setDeletingUser(true);
    try {
      const res = await deleteUser(deleteTargetUser.id);
      toast.success('Account Deleted', res.message || `Account @${deleteTargetUser.username} deleted.`);
      setDeleteTargetUser(null);
      fetchUsers();
    } catch (err: any) {
      toast.error('Deletion Failed', err.message || 'Could not delete user account');
    } finally {
      setDeletingUser(false);
    }
  };

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTargetUser || !resetPasswordValue.trim()) return;
    setSubmittingReset(true);
    try {
      const res = await resetUserPassword(resetTargetUser.id, resetPasswordValue.trim());
      toast.success('Password Updated', res.message || `Password reset for @${resetTargetUser.username}.`);
      setResetTargetUser(null);
      setResetPasswordValue('cashier123');
    } catch (err: any) {
      toast.error('Reset Failed', err.message || 'Could not reset password');
    } finally {
      setSubmittingReset(false);
    }
  };

  // Search/Filter states
  const [searchTerm, setSearchTerm] = useState('');
  const [auditSearch, setAuditSearch] = useState('');

  // Form states (Create / Edit modal/form)
  const [editingId, setEditingId] = useState<string | null>(null);
  
  // Dynamic temporary states for form
  const [formName, setFormName] = useState('');
  const [formPrice, setFormPrice] = useState(0);
  const [formCategory, setFormCategory] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formImageUrl, setFormImageUrl] = useState('');
  const [formRateType, setFormRateType] = useState<'3h' | '12h' | '24h' | 'promo'>('24h');
  const [formWeekday, setFormWeekday] = useState<number | ''>('');
  const [formWeekend, setFormWeekend] = useState<number | ''>('');
  const [formSeasonal, setFormSeasonal] = useState<number | ''>('');
  const [formSeasonalStart, setFormSeasonalStart] = useState('');
  const [formSeasonalEnd, setFormSeasonalEnd] = useState('');
  const [formActive, setFormActive] = useState(true);

  const [isAddingNew, setIsAddingNew] = useState(false);

  // Clear form helper
  const resetForm = () => {
    setFormName('');
    setFormPrice(0);
    setFormCategory('');
    setFormDescription('');
    setFormImageUrl('');
    setFormRateType('24h');
    setFormWeekday('');
    setFormWeekend('');
    setFormSeasonal('');
    setFormSeasonalStart('');
    setFormSeasonalEnd('');
    setFormActive(true);
    setEditingId(null);
    setIsAddingNew(false);
  };

  // Trigger Edit Form
  const startEdit = (service: BillableService) => {
    if (!isOwner) return;
    setEditingId(service.id);
    setFormName(service.name);
    setFormPrice(service.price);
    setFormCategory(service.category);
    setFormDescription(service.description || '');
    setFormImageUrl(service.imageUrl || '');
    setFormRateType(service.rateType || '24h');
    setFormWeekday(service.weekdayOverride !== undefined ? service.weekdayOverride : '');
    setFormWeekend(service.weekendOverride !== undefined ? service.weekendOverride : '');
    setFormSeasonal(service.seasonalOverride !== undefined ? service.seasonalOverride : '');
    setFormSeasonalStart(service.seasonalStart || '');
    setFormSeasonalEnd(service.seasonalEnd || '');
    setFormActive(service.active);
    setIsAddingNew(false);
  };

  // Submit Form
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOwner) return;

    if (!formName.trim()) {
      toast.warning('Name Required', 'Please enter a name for this item.');
      return;
    }

    const payload: any = {
      name: formName.trim(),
      price: Number(formPrice) || 0,
      category: formCategory.trim() || 'General',
      description: formDescription.trim(),
      active: formActive,
    };

    if (activeSubTab === 'rates') {
      payload.type = 'room_rate';
      payload.rateType = formRateType;
    } else if (activeSubTab === 'menu') {
      payload.type = 'menu_item';
      if (formImageUrl.trim()) payload.imageUrl = formImageUrl.trim();
    } else {
      payload.type = 'service';
    }

    // Overrides
    if (formWeekday !== '') payload.weekdayOverride = Number(formWeekday);
    if (formWeekend !== '') payload.weekendOverride = Number(formWeekend);
    if (formSeasonal !== '') {
      payload.seasonalOverride = Number(formSeasonal);
      payload.seasonalStart = formSeasonalStart.trim() || undefined;
      payload.seasonalEnd = formSeasonalEnd.trim() || undefined;
    }

    if (editingId) {
      // Editing
      onUpdateService({
        ...payload,
        id: editingId,
        isDeleted: false,
      });
    } else {
      // Adding new
      onAddService(payload);
    }

    resetForm();
  };

  // Soft Delete handler
  const handleSoftDelete = (id: string, name: string) => {
    if (!isOwner) return;
    // Use toast for soft-delete confirmation feedback (the action is non-destructive)
    onDeleteService(id);
    toast.info('Item Removed', `"${name}" has been soft-deleted. Past reports and receipts remain intact.`);
  };

  // Toggle active availability
  const handleToggleActive = (service: BillableService) => {
    if (!isOwner) return;
    onUpdateService({
      ...service,
      active: !service.active,
    });
  };

  // Filter lists based on type and search
  const filteredServices = billableServices.filter((s) => {
    if (s.isDeleted) return false;
    
    // Type partition
    if (activeSubTab === 'rates' && s.type !== 'room_rate') return false;
    if (activeSubTab === 'menu' && s.type !== 'menu_item') return false;
    if (activeSubTab === 'services' && s.type !== 'service') return false;

    // Search query
    const matchQuery = s.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                       (s.description && s.description.toLowerCase().includes(searchTerm.toLowerCase())) ||
                       s.category.toLowerCase().includes(searchTerm.toLowerCase());
    return matchQuery;
  });

  // Filter audit logs
  const filteredAudits = auditLogs.filter((log) => {
    const q = auditSearch.toLowerCase();
    return log.operator.toLowerCase().includes(q) ||
           log.action.toLowerCase().includes(q) ||
           log.details.toLowerCase().includes(q) ||
           log.timestamp.includes(q);
  });

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6">
      {/* Title Header Section */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-5 rounded-2xl border border-secondary shadow-sm">
        <div>
          <h1 className="font-display font-black text-lg text-primary uppercase">
            Administrative Settings Console
          </h1>
          <p className="text-xs text-charcoal/60 mt-0.5 font-medium">
            Configure Stay Rates, Food & Beverage Menu, Extras, and audit administrative transactions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isOwner ? (
            <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 font-mono text-[10px] font-black uppercase px-3 py-1.5 rounded-xl">
              <ShieldCheck size={14} />
              <span>OWNER CONSOLE AUTHORIZED</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 text-amber-700 font-mono text-[10px] font-black uppercase px-3 py-1.5 rounded-xl">
              <Lock size={14} />
              <span>LOCK: READ-ONLY SCREEN</span>
            </div>
          )}
        </div>
      </div>

      {/* Access Control Notice Banner */}
      {!isOwner && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-xl flex items-start gap-3">
          <AlertCircle className="shrink-0 text-amber-600 mt-0.5" size={16} />
          <div className="text-xs">
            <span className="font-bold">🔒 READ-ONLY MODE ACTIVE:</span> Only the Owner account has permission to add, edit, or adjust room rates, menu items, and service pricing. Other accounts can view settings in read-only mode.
          </div>
        </div>
      )}

      {/* Double Navigation Bar (SubTabs) */}
      <div className="flex flex-col md:flex-row gap-4">
        {/* Left column navigation */}
        <div className="w-full md:w-60 shrink-0 bg-white p-4 rounded-2xl border border-secondary shadow-sm h-fit space-y-2">
          <div className="text-[10px] font-mono uppercase text-charcoal/40 tracking-wider font-bold mb-2">
            Configurations
          </div>
          {[
            { id: 'rates', label: 'Hotel Stay Rates', desc: 'Room tier price matrices', icon: DollarSign },
            { id: 'menu', label: 'Food & Drinks Menu', desc: 'F&B catalogue items', icon: Coffee },
            { id: 'services', label: 'Amenities & Services', desc: 'Laundry, Spa, Extras', icon: Wrench },
            ...(role !== 'cashier' && isAuthorized
              ? [{ id: 'audit', label: 'Administrative Audit', desc: 'Price change history', icon: ClipboardList }]
              : []),
            ...(isAuthorized
              ? [{ id: 'accounts', label: 'Staff Accounts', desc: 'Manage user logins & access', icon: Users }]
              : []),
            { id: 'hardware', label: 'Hardware & POS', desc: '80mm Thermal & Cash Drawer', icon: Printer }
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveSubTab(tab.id as any);
                  resetForm();
                }}
                className={`w-full text-left px-3.5 py-3 rounded-xl transition flex items-center gap-3 border cursor-pointer ${
                  isActive 
                    ? 'bg-primary border-primary text-white shadow-sm font-semibold' 
                    : 'bg-white hover:bg-cream/40 border-transparent text-charcoal/80'
                }`}
              >
                <Icon size={16} className={isActive ? 'text-white' : 'text-primary'} />
                <div className="flex flex-col">
                  <span className="text-xs font-bold leading-none">{tab.label}</span>
                  <span className={`text-[9px] mt-0.5 leading-none ${isActive ? 'text-white/70' : 'text-charcoal/40'}`}>{tab.desc}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Right column main content panel */}
        <div className="flex-1 bg-white rounded-2xl border border-secondary shadow-sm p-6 space-y-6">
          {/* Action Header bar (for search and add new) */}
          {activeSubTab !== 'audit' && activeSubTab !== 'accounts' && (
            <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-4 border-b border-secondary/40 pb-4">
              {/* Search Bar */}
              <div className="relative flex-1 max-w-md">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-charcoal/40" />
                <input
                  type="text"
                  placeholder="Search settings..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-cream/30 text-charcoal placeholder:text-charcoal/40 border border-secondary text-xs rounded-xl pl-9 pr-4 py-2.5 outline-none focus:border-primary transition"
                />
              </div>

              {/* Add New Button (Only Owner) */}
              {isOwner && !isAddingNew && !editingId && (
                <button
                  type="button"
                  onClick={() => {
                    setIsAddingNew(true);
                    setFormCategory(
                      activeSubTab === 'rates' ? 'Standard' : 
                      activeSubTab === 'menu' ? 'Favorites' : 'Extras'
                    );
                  }}
                  className="bg-primary hover:bg-primary-light text-white font-sans text-xs font-bold px-4 py-2.5 rounded-xl transition flex items-center gap-1.5 cursor-pointer shadow-sm active:scale-[0.98]"
                >
                  <Plus size={14} />
                  <span>
                    {activeSubTab === 'rates' ? 'Add stay block rate' : 
                     activeSubTab === 'menu' ? 'Add menu item' : 'Add custom service'}
                  </span>
                </button>
              )}
            </div>
          )}

          {/* Inline Form Panel for Creation/Editing */}
          {(isAddingNew || editingId) && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-cream/30 border border-primary/20 rounded-2xl p-5 space-y-4"
            >
              <div className="flex justify-between items-center border-b border-secondary/50 pb-2">
                <h3 className="font-display font-bold text-xs uppercase text-primary flex items-center gap-1.5">
                  <ShieldCheck size={14} />
                  <span>{editingId ? 'Modify System Entry' : 'Create System Entry'}</span>
                </h3>
                <button 
                  type="button" 
                  onClick={resetForm} 
                  className="p-1 rounded-md hover:bg-cream border border-transparent hover:border-secondary transition cursor-pointer"
                >
                  <X size={14} className="text-charcoal/60" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Name */}
                <div className="space-y-1">
                  <label className="text-[10px] font-mono uppercase tracking-wider text-charcoal/60 font-bold block">
                    Item Name
                  </label>
                  <input
                    type="text"
                    required
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder={activeSubTab === 'rates' ? 'e.g. VIP Stay (12 Hour block)' : 'e.g. Extra blanket set'}
                    className="w-full bg-white text-charcoal border border-secondary text-xs rounded-xl px-3 py-2 outline-none focus:border-primary transition"
                  />
                </div>

                {/* Base price */}
                <div className="space-y-1">
                  <label className="text-[10px] font-mono uppercase tracking-wider text-charcoal/60 font-bold block">
                    Base Price (₱)
                  </label>
                  <input
                    type="number"
                    required
                    min="0"
                    value={formPrice}
                    onChange={(e) => setFormPrice(Number(e.target.value))}
                    className="w-full bg-white text-charcoal border border-secondary text-xs rounded-xl px-3 py-2 outline-none focus:border-primary transition font-mono"
                  />
                </div>

                {/* Rate Type (Only Rates) */}
                {activeSubTab === 'rates' ? (
                  <div className="space-y-1">
                    <label className="text-[10px] font-mono uppercase tracking-wider text-charcoal/60 font-bold block">
                      Block Time type
                    </label>
                    <select
                      value={formRateType}
                      onChange={(e) => setFormRateType(e.target.value as any)}
                      className="w-full bg-white text-charcoal border border-secondary text-xs rounded-xl px-3 py-2 outline-none focus:border-primary transition"
                    >
                      <option value="3h">3 Hours Stay</option>
                      <option value="12h">12 Hours Stay</option>
                      <option value="24h">24 Hours Stay</option>
                      <option value="promo">Promo Stay</option>
                    </select>
                  </div>
                ) : null}

                {/* Category Selection */}
                <div className="space-y-1">
                  <label className="text-[10px] font-mono uppercase tracking-wider text-charcoal/60 font-bold block">
                    Category Tag
                  </label>
                  {activeSubTab === 'rates' ? (
                    <select
                      value={formCategory}
                      onChange={(e) => setFormCategory(e.target.value)}
                      className="w-full bg-white text-charcoal border border-secondary text-xs rounded-xl px-3 py-2 outline-none focus:border-primary transition font-semibold"
                    >
                      <option value="Standard">Standard (Classic Room)</option>
                      <option value="Deluxe">Deluxe (Premium Room)</option>
                      <option value="Suite">Suite (VIP Suite)</option>
                    </select>
                  ) : activeSubTab === 'menu' ? (
                    <select
                      value={formCategory}
                      onChange={(e) => setFormCategory(e.target.value)}
                      className="w-full bg-white text-charcoal border border-secondary text-xs rounded-xl px-3 py-2 outline-none focus:border-primary transition"
                    >
                      <option value="Favorites">Favorites</option>
                      <option value="Breakfast">Breakfast</option>
                      <option value="Drinks">Drinks</option>
                      <option value="Misc">Miscellaneous</option>
                    </select>
                  ) : (
                    <input
                      type="text"
                      required
                      placeholder="e.g. Laundry, Spa, Extras"
                      value={formCategory}
                      onChange={(e) => setFormCategory(e.target.value)}
                      className="w-full bg-white text-charcoal border border-secondary text-xs rounded-xl px-3 py-2 outline-none focus:border-primary transition"
                    />
                  )}
                </div>

                {/* Weekday & Weekend Overrides (Optional Rates & Services) */}
                <div className="space-y-1">
                  <label className="text-[10px] font-mono uppercase tracking-wider text-charcoal/60 font-bold block flex items-center gap-1">
                    <CalendarRange size={11} className="text-primary" />
                    <span>Weekday price override (Optional Mon-Thu)</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={formWeekday}
                    onChange={(e) => setFormWeekday(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="Same as base price if empty"
                    className="w-full bg-white text-charcoal border border-secondary text-xs rounded-xl px-3 py-2 outline-none focus:border-primary transition font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-mono uppercase tracking-wider text-charcoal/60 font-bold block flex items-center gap-1">
                    <CalendarRange size={11} className="text-primary" />
                    <span>Weekend price override (Optional Fri-Sun)</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={formWeekend}
                    onChange={(e) => setFormWeekend(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="Same as base price if empty"
                    className="w-full bg-white text-charcoal border border-secondary text-xs rounded-xl px-3 py-2 outline-none focus:border-primary transition font-mono"
                  />
                </div>

                {/* Seasonal overrides */}
                <div className="space-y-1">
                  <label className="text-[10px] font-mono uppercase tracking-wider text-charcoal/60 font-bold block">
                    Seasonal price override (Optional)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={formSeasonal}
                    onChange={(e) => setFormSeasonal(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="e.g. Holiday price"
                    className="w-full bg-white text-charcoal border border-secondary text-xs rounded-xl px-3 py-2 outline-none focus:border-primary transition font-mono"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[9px] font-mono uppercase text-charcoal/50 font-bold block">
                      Seasonal Start (MM-DD)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 12-15"
                      value={formSeasonalStart}
                      onChange={(e) => setFormSeasonalStart(e.target.value)}
                      className="w-full bg-white text-charcoal border border-secondary text-xs rounded-xl px-2.5 py-2 outline-none focus:border-primary transition font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-mono uppercase text-charcoal/50 font-bold block">
                      Seasonal End (MM-DD)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 01-15"
                      value={formSeasonalEnd}
                      onChange={(e) => setFormSeasonalEnd(e.target.value)}
                      className="w-full bg-white text-charcoal border border-secondary text-xs rounded-xl px-2.5 py-2 outline-none focus:border-primary transition font-mono"
                    />
                  </div>
                </div>

                {/* Description */}
                <div className="md:col-span-2 space-y-1">
                  <label className="text-[10px] font-mono uppercase tracking-wider text-charcoal/60 font-bold block">
                    Description / Details
                  </label>
                  <input
                    type="text"
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    placeholder="Short description for receipt invoices..."
                    className="w-full bg-white text-charcoal border border-secondary text-xs rounded-xl px-3 py-2 outline-none focus:border-primary transition"
                  />
                </div>

                {/* F&B Image URL (Only for Menu) */}
                {activeSubTab === 'menu' && (
                  <div className="md:col-span-2 space-y-1">
                    <label className="text-[10px] font-mono uppercase tracking-wider text-charcoal/60 font-bold block">
                      Menu Image URL (Optional)
                    </label>
                    <input
                      type="text"
                      value={formImageUrl}
                      onChange={(e) => setFormImageUrl(e.target.value)}
                      placeholder="https://..."
                      className="w-full bg-white text-charcoal border border-secondary text-xs rounded-xl px-3 py-2 outline-none focus:border-primary transition text-xs font-mono"
                    />
                  </div>
                )}

                {/* Status Toggle & Submit buttons */}
                <div className="md:col-span-2 flex items-center justify-between pt-2 border-t border-secondary/50">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={formActive}
                      onChange={(e) => setFormActive(e.target.checked)}
                      className="rounded border-secondary text-primary focus:ring-primary h-4 w-4"
                    />
                    <span className="text-xs font-bold text-charcoal">Available/Active flag</span>
                  </label>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={resetForm}
                      className="px-4 py-2 bg-white border border-secondary text-charcoal hover:bg-cream/40 rounded-xl text-xs font-bold transition cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-5 py-2 bg-primary hover:bg-primary-light text-white rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer shadow-sm active:scale-95"
                    >
                      <Save size={13} />
                      <span>{editingId ? 'Save entry updates' : 'Register entry'}</span>
                    </button>
                  </div>
                </div>
              </form>
            </motion.div>
          )}

          {/* VIEW 1: Stay Rates Matrix Grid */}
          {activeSubTab === 'rates' && (
            <div className="space-y-4">
              <div className="text-[11px] font-mono uppercase tracking-wider text-charcoal/40 font-bold">
                Active Room Rates Per Block
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {['Standard', 'Deluxe', 'Suite'].map((tier) => {
                  const tierRates = filteredServices.filter(s => s.category === tier);
                  return (
                    <div key={tier} className="bg-cream/20 p-4 rounded-2xl border border-secondary/60 flex flex-col gap-4">
                      <div className="flex justify-between items-center border-b border-secondary/50 pb-2">
                        <span className="font-display font-black text-xs text-primary uppercase">
                          {tier === 'Suite' ? 'VIP room tier' : tier === 'Deluxe' ? 'Premium room tier' : 'Classic room tier'}
                        </span>
                        <span className="text-[9px] font-mono bg-primary/10 text-primary font-bold px-2 py-0.5 rounded-md">
                          {tier.toUpperCase()}
                        </span>
                      </div>

                      {tierRates.length === 0 ? (
                        <p className="text-xs text-charcoal/40 italic py-4 text-center">No block rates configured</p>
                      ) : (
                        <div className="space-y-3.5 flex-1">
                          {tierRates.map((s) => (
                            <div key={s.id} className="group relative bg-white p-3 rounded-xl border border-secondary/40 shadow-xs flex flex-col gap-1.5 hover:border-primary/40 transition">
                              <div className="flex justify-between items-start">
                                <div className="flex flex-col">
                                  <span className="font-bold text-xs text-charcoal flex items-center gap-1.5">
                                    <span className={`w-1.5 h-1.5 rounded-full ${s.active ? 'bg-green-500' : 'bg-charcoal/30'}`} />
                                    {s.name}
                                  </span>
                                  <span className="text-[9px] font-mono text-charcoal/40 uppercase mt-0.5">
                                    Type: {s.rateType?.toUpperCase()} Stay
                                  </span>
                                </div>
                                <span className="font-mono font-bold text-primary text-xs shrink-0">
                                  ₱{s.price.toLocaleString()}
                                </span>
                              </div>

                              {/* Overrides indicators */}
                              {(s.weekdayOverride !== undefined || s.weekendOverride !== undefined || s.seasonalOverride !== undefined) && (
                                <div className="flex flex-wrap gap-1 mt-1 border-t border-secondary/30 pt-1.5">
                                  {s.weekdayOverride !== undefined && (
                                    <span className="text-[8px] font-mono bg-blue-50 text-blue-700 border border-blue-200/50 px-1.5 py-0.5 rounded font-semibold">
                                      Wkday: ₱{s.weekdayOverride}
                                    </span>
                                  )}
                                  {s.weekendOverride !== undefined && (
                                    <span className="text-[8px] font-mono bg-purple-50 text-purple-700 border border-purple-200/50 px-1.5 py-0.5 rounded font-semibold">
                                      Wkend: ₱{s.weekendOverride}
                                    </span>
                                  )}
                                  {s.seasonalOverride !== undefined && (
                                    <span className="text-[8px] font-mono bg-rose-50 text-rose-700 border border-rose-200/50 px-1.5 py-0.5 rounded font-semibold" title={`Active ${s.seasonalStart} to ${s.seasonalEnd}`}>
                                      Season: ₱{s.seasonalOverride}
                                    </span>
                                  )}
                                </div>
                              )}

                              {/* Hover Action Overlay */}
                              {isOwner && (
                                <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 flex gap-1 bg-white/95 p-1 rounded-lg border border-secondary transition shadow-sm">
                                  <button
                                    onClick={() => startEdit(s)}
                                    title="Edit rate parameters"
                                    className="p-1 rounded text-primary hover:bg-cream transition cursor-pointer"
                                  >
                                    <Edit3 size={11} />
                                  </button>
                                  <button
                                    onClick={() => handleToggleActive(s)}
                                    title={s.active ? 'Disable pricing (hide from frontdesk)' : 'Enable pricing'}
                                    className={`p-1 rounded transition cursor-pointer ${s.active ? 'text-amber-600 hover:bg-amber-50' : 'text-green-600 hover:bg-green-50'}`}
                                  >
                                    <Check size={11} />
                                  </button>
                                  <button
                                    onClick={() => handleSoftDelete(s.id, s.name)}
                                    title="Soft Delete"
                                    className="p-1 rounded text-accent hover:bg-accent/5 transition cursor-pointer"
                                  >
                                    <Trash2 size={11} />
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* VIEW 2: Menu Items List Table */}
          {activeSubTab === 'menu' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-[11px] font-mono uppercase tracking-wider text-charcoal/40 font-bold">
                  F&B Catalogue Entries ({filteredServices.length})
                </span>
              </div>

              {filteredServices.length === 0 ? (
                <div className="p-12 text-center text-xs text-charcoal/40 italic bg-cream/10 border border-secondary rounded-2xl">
                  No menu items found. Click "Add menu item" to populate the F&B catalog.
                </div>
              ) : (
                <div className="overflow-x-auto border border-secondary rounded-xl">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-cream/40 border-b border-secondary font-mono text-[10px] uppercase text-charcoal/50 tracking-wider">
                        <th className="px-4 py-3 font-semibold">Item & Details</th>
                        <th className="px-4 py-3 font-semibold">Category</th>
                        <th className="px-4 py-3 font-semibold text-right">Base Price</th>
                        <th className="px-4 py-3 font-semibold">Availability</th>
                        {isOwner && <th className="px-4 py-3 text-right">Actions</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-secondary/40 text-xs text-charcoal/80">
                      {filteredServices.map((item) => (
                        <tr key={item.id} className="hover:bg-cream/10 transition">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              {item.imageUrl ? (
                                <img
                                  src={item.imageUrl}
                                  alt={item.name}
                                  referrerPolicy="no-referrer"
                                  className="w-10 h-10 object-cover rounded-lg border border-secondary bg-cream flex-shrink-0"
                                />
                              ) : (
                                <div className="w-10 h-10 rounded-lg bg-cream flex items-center justify-center border border-secondary shrink-0 text-charcoal/40 font-bold">
                                  FB
                                </div>
                              )}
                              <div className="flex flex-col">
                                <span className="font-bold text-charcoal">{item.name}</span>
                                <span className="text-[10px] text-charcoal/40 leading-normal">{item.description || 'No description'}</span>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 font-mono text-[11px]">
                            <span className="px-2 py-0.5 bg-cream rounded-md font-bold text-primary/80">
                              {item.category}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right font-mono font-bold text-primary text-xs">
                            ₱{item.price.toLocaleString()}
                          </td>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              disabled={!isOwner}
                              onClick={() => handleToggleActive(item)}
                              className={`px-2 py-1 rounded-full text-[9px] font-bold border transition font-sans ${
                                item.active
                                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700 cursor-pointer'
                                  : 'bg-charcoal/5 border-secondary text-charcoal/40 cursor-pointer'
                              } ${!isOwner ? 'cursor-not-allowed opacity-80' : ''}`}
                            >
                              {item.active ? 'ACTIVE / FOR SALE' : 'UNAVAILABLE'}
                            </button>
                          </td>
                          {isOwner && (
                            <td className="px-4 py-3 text-right">
                              <div className="flex justify-end gap-1">
                                <button
                                  onClick={() => startEdit(item)}
                                  title="Edit properties"
                                  className="p-1.5 rounded hover:bg-cream border border-transparent hover:border-secondary transition cursor-pointer text-primary"
                                >
                                  <Edit3 size={13} />
                                </button>
                                <button
                                  onClick={() => handleSoftDelete(item.id, item.name)}
                                  title="Soft Delete"
                                  className="p-1.5 rounded hover:bg-accent/5 border border-transparent hover:border-accent/10 transition cursor-pointer text-accent"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* VIEW 3: Amenities & Hospitality Services */}
          {activeSubTab === 'services' && (
            <div className="space-y-4">
              <span className="text-[11px] font-mono uppercase tracking-wider text-charcoal/40 font-bold block">
                Amenities & Special Services Entries ({filteredServices.length})
              </span>

              {filteredServices.length === 0 ? (
                <div className="p-12 text-center text-xs text-charcoal/40 italic bg-cream/10 border border-secondary rounded-2xl">
                  No services found. Click "Add custom service" to define laundry, spa, or other billing add-ons.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filteredServices.map((serv) => (
                    <div key={serv.id} className="group relative bg-white p-4 border border-secondary/50 rounded-2xl hover:border-primary/40 transition shadow-xs flex justify-between items-start gap-4">
                      <div className="flex-1 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-xs text-charcoal">{serv.name}</span>
                          <span className="text-[9px] font-mono bg-cream border border-secondary/30 px-1.5 py-0.5 rounded font-black text-primary uppercase">
                            {serv.category}
                          </span>
                        </div>
                        <p className="text-[10px] text-charcoal/50 leading-relaxed">{serv.description || 'No description provided.'}</p>
                        
                        {/* Pricing overrides summary */}
                        {(serv.weekdayOverride !== undefined || serv.weekendOverride !== undefined) && (
                          <div className="flex gap-1 pt-1.5 border-t border-secondary/35">
                            {serv.weekdayOverride !== undefined && (
                              <span className="text-[8px] font-mono bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">
                                Weekday: ₱{serv.weekdayOverride}
                              </span>
                            )}
                            {serv.weekendOverride !== undefined && (
                              <span className="text-[8px] font-mono bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded">
                                Weekend: ₱{serv.weekendOverride}
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col items-end gap-3 shrink-0">
                        <span className="font-mono font-bold text-primary text-sm">
                          ₱{serv.price.toLocaleString()}
                        </span>
                        <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${serv.active ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-charcoal/5 border border-secondary text-charcoal/40'}`}>
                          {serv.active ? 'ACTIVE' : 'DISABLED'}
                        </span>
                      </div>

                      {/* Hover Actions */}
                      {isOwner && (
                        <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 flex gap-1 bg-white/95 p-1 rounded-lg border border-secondary transition shadow-sm">
                          <button
                            onClick={() => startEdit(serv)}
                            className="p-1 rounded text-primary hover:bg-cream cursor-pointer"
                          >
                            <Edit3 size={11} />
                          </button>
                          <button
                            onClick={() => handleToggleActive(serv)}
                            className="p-1 rounded text-primary hover:bg-cream cursor-pointer"
                          >
                            <Check size={11} />
                          </button>
                          <button
                            onClick={() => handleSoftDelete(serv.id, serv.name)}
                            className="p-1 rounded text-accent hover:bg-accent/5 cursor-pointer"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* VIEW 4: Administrative Audit Trail */}
          {activeSubTab === 'audit' && isAuthorized && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <span className="text-[11px] font-mono uppercase tracking-wider text-charcoal/40 font-bold block">
                  System Audit Logs ({filteredAudits.length} entries)
                </span>
                
                {/* Audit Search bar */}
                <div className="relative w-full sm:w-64">
                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-charcoal/40" />
                  <input
                    type="text"
                    placeholder="Filter audit logs..."
                    value={auditSearch}
                    onChange={(e) => setAuditSearch(e.target.value)}
                    className="w-full bg-cream/20 text-charcoal placeholder:text-charcoal/40 border border-secondary text-[11px] rounded-lg pl-8 pr-3 py-1.5 outline-none focus:border-primary transition"
                  />
                </div>
              </div>

              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                {/* Filter tags */}
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { label: 'All Audits', value: '' },
                    { label: 'Room Transfers', value: 'ROOM_TRANSFER' },
                    { label: 'Services & Pricing', value: 'SERVICE' },
                    { label: 'Checkouts', value: 'CHECKOUT' },
                  ].map((filter) => (
                    <button
                      key={filter.label}
                      type="button"
                      onClick={() => setAuditSearch(filter.value)}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold transition cursor-pointer border ${
                        auditSearch === filter.value
                          ? 'bg-primary text-white border-primary shadow-2xs'
                          : 'bg-white text-charcoal/70 border-secondary/60 hover:bg-cream/40'
                      }`}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
              </div>

              {filteredAudits.length === 0 ? (
                <div className="p-12 text-center text-xs text-charcoal/40 italic bg-cream/10 border border-secondary rounded-2xl">
                  No matching audit entries recorded.
                </div>
              ) : (
                <div className="overflow-hidden border border-secondary rounded-xl bg-cream/10">
                  <div className="max-h-96 overflow-y-auto divide-y divide-secondary/40">
                    {filteredAudits.slice().reverse().map((log) => {
                      const badgeClass =
                        log.action === 'ROOM_TRANSFER'
                          ? 'bg-indigo-100 border-indigo-300 text-indigo-900 font-extrabold'
                          : log.action.includes('DELETE')
                          ? 'bg-rose-100 border-rose-300 text-rose-800'
                          : log.action.includes('CREATE')
                          ? 'bg-emerald-100 border-emerald-300 text-emerald-800'
                          : log.action.includes('UPDATE')
                          ? 'bg-blue-100 border-blue-300 text-blue-800'
                          : 'bg-primary/10 border-primary/20 text-primary';

                      return (
                        <div key={log.id} className="p-3.5 hover:bg-white transition flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 text-xs">
                          <div className="space-y-1 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-[10px] text-charcoal/40">
                                {new Date(log.timestamp).toLocaleString()}
                              </span>
                              <span className={`px-2 py-0.5 border font-mono text-[9px] font-black uppercase rounded-md shadow-2xs ${badgeClass}`}>
                                {log.action}
                              </span>
                              <span className="font-sans font-bold text-charcoal">
                                by {log.operator}
                              </span>
                            </div>
                            <p className="text-charcoal/80 leading-relaxed font-medium">
                              {log.details}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* VIEW 5: Staff Accounts & Access Management (Owner & Admin) */}
          {activeSubTab === 'accounts' && isAuthorized && (
            <div className="space-y-5">
              {/* Header & Metric Cards */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-secondary/40 pb-4">
                <div>
                  <h3 className="font-display font-extrabold text-sm uppercase text-charcoal tracking-wide flex items-center gap-2">
                    <Users size={16} className="text-primary" />
                    <span>Staff Accounts &amp; Access Controls</span>
                  </h3>
                  <p className="text-[11px] text-charcoal/50 font-sans mt-0.5">
                    {isOwner
                      ? 'Create and delete staff logins, manage roles, and reset credentials.'
                      : 'View active staff accounts and access levels (read-only for administrators).'}
                  </p>
                </div>

                {isOwner && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsCreatingUser(true);
                      setNewUsername('');
                      setNewName('');
                      setNewRole('cashier');
                      setNewPassword('cashier123');
                    }}
                    className="bg-primary hover:bg-primary-light text-white font-sans text-xs font-bold px-4 py-2.5 rounded-xl transition flex items-center gap-1.5 cursor-pointer shadow-sm active:scale-[0.98]"
                  >
                    <UserPlus size={14} />
                    <span>Create New Account</span>
                  </button>
                )}
              </div>

              {/* Metric Badges */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {[
                  { label: 'Total Accounts', count: userList.length, color: 'border-secondary/60 bg-cream/20 text-charcoal' },
                  { label: 'Cashiers', count: userList.filter((u) => u.role === 'cashier').length, color: 'border-blue-200 bg-blue-50/50 text-blue-700' },
                  { label: 'Admins', count: userList.filter((u) => u.role === 'admin').length, color: 'border-purple-200 bg-purple-50/50 text-purple-700' },
                  { label: 'Kitchen', count: userList.filter((u) => u.role === 'kitchen').length, color: 'border-amber-200 bg-amber-50/50 text-amber-700' },
                  { label: 'Owners', count: userList.filter((u) => u.role === 'owner').length, color: 'border-rose-200 bg-rose-50/50 text-rose-700' },
                ].map((stat, i) => (
                  <div key={i} className={`p-3 rounded-xl border ${stat.color} flex flex-col`}>
                    <span className="text-[10px] font-mono uppercase tracking-wider opacity-70 font-semibold">{stat.label}</span>
                    <span className="text-lg font-mono font-bold mt-0.5">{stat.count}</span>
                  </div>
                ))}
              </div>

              {/* Search filter bar */}
              <div className="relative max-w-sm">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-charcoal/40" />
                <input
                  type="text"
                  placeholder="Filter by username, name, or role..."
                  value={accountSearch}
                  onChange={(e) => setAccountSearch(e.target.value)}
                  className="w-full bg-cream/30 text-charcoal placeholder:text-charcoal/40 border border-secondary text-xs rounded-xl pl-9 pr-4 py-2 outline-none focus:border-primary transition"
                />
              </div>

              {/* Accounts List / Cards Grid */}
              {loadingUsers ? (
                <div className="py-12 text-center text-xs text-charcoal/40 font-mono">
                  Loading user accounts...
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                  {userList
                    .filter((u) => {
                      const q = accountSearch.toLowerCase();
                      return (
                        u.username.toLowerCase().includes(q) ||
                        u.name.toLowerCase().includes(q) ||
                        u.role.toLowerCase().includes(q)
                      );
                    })
                    .map((u) => {
                      const isSelf = u.username.toLowerCase() === loggedInUser.toLowerCase();
                      const roleBadgeStyles =
                        u.role === 'owner'
                          ? 'bg-rose-50 text-rose-700 border-rose-200'
                          : u.role === 'admin'
                          ? 'bg-purple-50 text-purple-700 border-purple-200'
                          : u.role === 'cashier'
                          ? 'bg-blue-50 text-blue-700 border-blue-200'
                          : u.role === 'kitchen'
                          ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : 'bg-emerald-50 text-emerald-700 border-emerald-200';

                      return (
                        <div
                          key={u.id}
                          className="bg-cream/15 border border-secondary/60 hover:border-primary/40 rounded-2xl p-4 flex flex-col justify-between gap-3 shadow-2xs transition group"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary font-mono font-bold text-sm flex items-center justify-center border border-primary/20 shrink-0">
                                {u.name
                                  .split(' ')
                                  .map((n) => n[0])
                                  .join('')
                                  .substring(0, 2)
                                  .toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <h4 className="font-display font-bold text-xs text-charcoal truncate" title={u.name}>
                                    {u.name}
                                  </h4>
                                  {isSelf && (
                                    <span className="text-[8px] font-mono font-bold bg-primary text-white px-1.5 py-0.2 rounded-full">
                                      You
                                    </span>
                                  )}
                                </div>
                                <p className="text-[11px] font-mono text-charcoal/50">@{u.username}</p>
                              </div>
                            </div>

                            <span className={`text-[9px] font-mono font-extrabold uppercase px-2 py-0.5 rounded-full border ${roleBadgeStyles}`}>
                              {u.role}
                            </span>
                          </div>

                          <div className="pt-2 border-t border-secondary/30 flex items-center justify-between text-xs">
                            <span className="text-[10px] font-mono text-charcoal/40">
                              ID #{u.id}
                            </span>

                            {isOwner && (
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setResetTargetUser(u);
                                    setResetPasswordValue(u.role === 'cashier' ? 'cashier123' : '');
                                  }}
                                  className="p-1.5 text-charcoal/50 hover:text-primary hover:bg-white rounded-lg border border-transparent hover:border-secondary/40 transition cursor-pointer"
                                  title={`Reset password for @${u.username}`}
                                >
                                  <KeyRound size={13} />
                                </button>

                                <button
                                  type="button"
                                  disabled={isSelf}
                                  onClick={() => setDeleteTargetUser(u)}
                                  className={`p-1.5 rounded-lg border border-transparent transition ${
                                    isSelf
                                      ? 'text-charcoal/20 cursor-not-allowed'
                                      : 'text-charcoal/40 hover:text-rose-600 hover:bg-rose-50 hover:border-rose-200 cursor-pointer'
                                  }`}
                                  title={isSelf ? 'Cannot delete your own active account' : `Delete account @${u.username}`}
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          )}

          {/* ─── 6. Hardware & POS Peripherals SubTab ─── */}
          {activeSubTab === 'hardware' && (
            <div className="space-y-6">
              {/* Header & Status */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-secondary/40 pb-4">
                <div>
                  <h3 className="font-display font-black text-sm uppercase text-charcoal flex items-center gap-2">
                    <Printer size={16} className="text-primary" />
                    <span>POS Hardware &amp; Thermal Printing Console</span>
                  </h3>
                  <p className="text-xs text-charcoal/50 mt-0.5">
                    Configure 80mm thermal receipt printers, RJ11 auto cash drawers, and dual-monitor guest displays.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {isElectron ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                      <Zap size={12} className="text-emerald-600" />
                      Electron Desktop Engine Active
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold bg-amber-50 text-amber-800 border border-amber-200">
                      <Cpu size={12} className="text-amber-600" />
                      Browser Mode (Native Drivers Available in Desktop App)
                    </span>
                  )}
                </div>
              </div>

              {/* Hardware Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                
                {/* ─── Card 1: 80mm Thermal Receipt Printer ─── */}
                <div className="bg-cream/20 rounded-2xl border border-secondary p-5 space-y-4 flex flex-col justify-between">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                          <Printer size={16} />
                        </div>
                        <div>
                          <h4 className="font-display font-bold text-xs uppercase text-charcoal">
                            80mm Thermal Receipt Printer
                          </h4>
                          <span className="text-[10px] text-charcoal/50">Silent direct print without browser dialogs</span>
                        </div>
                      </div>
                      <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded bg-primary/10 text-primary">
                        300 DPI Ultra-HD
                      </span>
                    </div>

                    <div className="space-y-1.5 pt-2">
                      <label className="text-[10px] font-mono uppercase tracking-wider text-charcoal/60 font-bold block">
                        Target System Printer
                      </label>
                      {printers.length > 0 ? (
                        <select
                          value={selectedPrinter}
                          onChange={(e) => setSelectedPrinter(e.target.value)}
                          className="w-full bg-white text-charcoal border border-secondary text-xs rounded-xl px-3 py-2.5 outline-none focus:border-primary transition font-medium"
                        >
                          <option value="">System Default Printer</option>
                          {printers.map((p) => (
                            <option key={p.name} value={p.name}>
                              {p.displayName || p.name} {p.isDefault ? '(Default)' : ''}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          placeholder="e.g. POS-80C / Epson TM-T88VI"
                          value={selectedPrinter}
                          onChange={(e) => setSelectedPrinter(e.target.value)}
                          className="w-full bg-white text-charcoal border border-secondary text-xs rounded-xl px-3 py-2.5 outline-none focus:border-primary transition font-mono"
                        />
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] font-mono uppercase tracking-wider text-charcoal/60 font-bold block">
                        Thermal Burn Density / Contrast
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { id: 'normal', label: 'Normal (203 DPI)', desc: 'Standard speed' },
                          { id: 'high', label: 'High (300 DPI)', desc: 'Recommended' },
                          { id: 'ultra', label: 'Ultra-Dark', desc: 'Maximum contrast' },
                        ].map((d) => (
                          <button
                            key={d.id}
                            type="button"
                            onClick={() => setPrintDensity(d.id as any)}
                            className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
                              printDensity === d.id
                                ? 'bg-primary text-white border-primary shadow-xs'
                                : 'bg-white hover:bg-cream/40 border-secondary text-charcoal'
                            }`}
                          >
                            <div className="text-xs font-bold leading-tight">{d.label}</div>
                            <div className={`text-[9px] mt-0.5 ${printDensity === d.id ? 'text-white/75' : 'text-charcoal/40'}`}>
                              {d.desc}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-secondary/40 flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={handleSaveHardwareSettings}
                      className="px-4 py-2 bg-primary hover:bg-primary-light text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      <Save size={13} />
                      <span>Save Config</span>
                    </button>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={isTestingPrint}
                        onClick={handleTestPrint}
                        className="px-3.5 py-2 bg-white hover:bg-cream/40 border border-secondary text-charcoal rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        {isTestingPrint ? <RefreshCw size={13} className="animate-spin" /> : <Printer size={13} />}
                        <span>{isTestingPrint ? 'Testing...' : 'Test Receipt'}</span>
                      </button>

                      <button
                        type="button"
                        disabled={isTestingPrint}
                        onClick={handleTestGatePassPrint}
                        className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-xs"
                      >
                        <Ticket size={13} className="text-amber-400" />
                        <span>Test Gate Pass</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* ─── Card 2: RJ11 Hardware Cash Drawer ─── */}
                <div className="bg-cream/20 rounded-2xl border border-secondary p-5 space-y-4 flex flex-col justify-between">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-900 flex items-center justify-center">
                          <Coins size={16} />
                        </div>
                        <div>
                          <h4 className="font-display font-bold text-xs uppercase text-charcoal">
                            RJ11 Hardware Cash Drawer
                          </h4>
                          <span className="text-[10px] text-charcoal/50">Auto-kick pulse via printer RJ11 connector</span>
                        </div>
                      </div>
                      <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-900">
                        ESC/POS Pulse
                      </span>
                    </div>

                    {/* Auto Kick Toggle */}
                    <div className="p-3 bg-white rounded-xl border border-secondary flex items-center justify-between">
                      <div>
                        <div className="text-xs font-bold text-charcoal">Auto-Kick on Cash Settlement</div>
                        <div className="text-[10px] text-charcoal/50">Opens drawer immediately when guest pays Cash or Mixed</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setAutoKickDrawer(!autoKickDrawer)}
                        className={`w-11 h-6 rounded-full transition-colors cursor-pointer p-0.5 ${
                          autoKickDrawer ? 'bg-emerald-600' : 'bg-charcoal/20'
                        }`}
                      >
                        <div
                          className={`w-5 h-5 rounded-full bg-white transition-transform ${
                            autoKickDrawer ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>

                    {/* Drawer Pin Selector */}
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-mono uppercase tracking-wider text-charcoal/60 font-bold block">
                        Drawer Connector Pin
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { pin: 2, label: 'Pin 2 (Standard)', desc: 'Epson, Xprinter, Sunmi' },
                          { pin: 5, label: 'Pin 5 (Alternate)', desc: 'Star Micronics & Posiflex' },
                        ].map((p) => (
                          <button
                            key={p.pin}
                            type="button"
                            onClick={() => setDrawerPin(p.pin as any)}
                            className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
                              drawerPin === p.pin
                                ? 'bg-amber-500 text-slate-950 font-bold border-amber-600 shadow-xs'
                                : 'bg-white hover:bg-cream/40 border-secondary text-charcoal'
                            }`}
                          >
                            <div className="text-xs font-bold leading-tight">{p.label}</div>
                            <div className="text-[9px] text-charcoal/50 mt-0.5">{p.desc}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-secondary/40 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={handleSaveHardwareSettings}
                      className="px-4 py-2 bg-primary hover:bg-primary-light text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      <Save size={13} />
                      <span>Save Config</span>
                    </button>

                    <button
                      type="button"
                      disabled={isTestingDrawer}
                      onClick={handleTestKickDrawer}
                      className="px-4 py-2 bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-950 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-2xs disabled:opacity-50"
                    >
                      {isTestingDrawer ? <RefreshCw size={13} className="animate-spin" /> : <Zap size={13} />}
                      <span>{isTestingDrawer ? 'Dispatched...' : 'Test Kick Cash Drawer'}</span>
                    </button>
                  </div>
                </div>

                {/* ─── Card 3: Dual Screen Customer Display ─── */}
                <div className="bg-cream/20 rounded-2xl border border-secondary p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-xl bg-blue-500/10 text-blue-700 flex items-center justify-center">
                        <Monitor size={16} />
                      </div>
                      <div>
                        <h4 className="font-display font-bold text-xs uppercase text-charcoal">
                          Dual-Monitor Guest Screen
                        </h4>
                        <span className="text-[10px] text-charcoal/50">Dedicated customer-facing room &amp; payment monitor</span>
                      </div>
                    </div>
                    <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-800">
                      {displays.length > 1 ? `${displays.length} Displays Connected` : '1 Display Connected'}
                    </span>
                  </div>

                  <div className="space-y-2">
                    {displays.map((disp, idx) => (
                      <div
                        key={disp.id}
                        className={`p-3 rounded-xl border flex items-center justify-between ${
                          disp.isPrimary
                            ? 'bg-white border-secondary'
                            : 'bg-blue-50/60 border-blue-200'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <Monitor size={15} className={disp.isPrimary ? 'text-charcoal/50' : 'text-blue-600'} />
                          <div>
                            <div className="text-xs font-bold text-charcoal">
                              Display #{idx + 1} {disp.isPrimary ? '(Primary Cashier)' : '(Secondary Guest Screen)'}
                            </div>
                            <div className="text-[10px] font-mono text-charcoal/50">
                              {disp.bounds.width} × {disp.bounds.height} px
                            </div>
                          </div>
                        </div>
                        {disp.isPrimary ? (
                          <span className="text-[9px] font-mono font-bold text-charcoal/40 uppercase">Primary</span>
                        ) : (
                          <span className="text-[9px] font-mono font-bold text-blue-700 uppercase bg-blue-100 px-1.5 py-0.5 rounded">Target</span>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={handleToggleCustomerDisplay}
                      className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      <Monitor size={14} />
                      <span>{customerDisplayOpen ? 'Close Customer Display Window' : 'Launch Customer Display on Monitor #2'}</span>
                    </button>
                  </div>
                </div>

                {/* ─── Card 4: SQLite Database Backups & File Tools ─── */}
                <div className="bg-cream/20 rounded-2xl border border-secondary p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-xl bg-purple-500/10 text-purple-700 flex items-center justify-center">
                        <HardDrive size={16} />
                      </div>
                      <div>
                        <h4 className="font-display font-bold text-xs uppercase text-charcoal">
                          SQLite Database &amp; System Tools
                        </h4>
                        <span className="text-[10px] text-charcoal/50">Safe database snapshots and folder navigation</span>
                      </div>
                    </div>
                    <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded bg-purple-100 text-purple-800">
                      Local-First
                    </span>
                  </div>

                  {appDataInfo && (
                    <div className="p-2.5 bg-white rounded-xl border border-secondary text-[10px] font-mono text-charcoal/70 break-all space-y-1">
                      <div><strong>Data Dir:</strong> {appDataInfo.userData}</div>
                    </div>
                  )}

                  {backupResult && (
                    <div className="p-2.5 bg-emerald-50 rounded-xl border border-emerald-200 text-[10px] font-mono text-emerald-800 break-all">
                      ✅ {backupResult.message}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2 pt-2">
                    <button
                      type="button"
                      disabled={isBackingUp}
                      onClick={handleBackupDatabase}
                      className="py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
                    >
                      {isBackingUp ? <RefreshCw size={13} className="animate-spin" /> : <HardDrive size={13} />}
                      <span>{isBackingUp ? 'Backing Up...' : 'Backup DB Now'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleOpenDataFolder}
                      className="py-2.5 bg-white hover:bg-cream/40 border border-secondary text-charcoal rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <FolderOpen size={13} />
                      <span>Open Files</span>
                    </button>
                  </div>
                </div>

              </div>
            </div>
          )}
        </div>
      </div>

      {/* ─── Modal 1: Create New Staff Account (Owner Only) ─── */}
      <AnimatePresence>
        {isCreatingUser && (
          <div className="fixed inset-0 bg-charcoal/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white rounded-2xl border border-secondary shadow-xl max-w-md w-full overflow-hidden"
            >
              <div className="p-4 bg-cream/30 border-b border-secondary/50 flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <UserPlus size={16} className="text-primary" />
                  <h3 className="font-display font-bold text-xs uppercase tracking-wider text-charcoal">
                    Create New Staff Account
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsCreatingUser(false)}
                  className="text-charcoal/40 hover:text-charcoal p-1 rounded-lg hover:bg-secondary/30 transition cursor-pointer"
                >
                  <X size={15} />
                </button>
              </div>

              <form onSubmit={handleCreateUserSubmit} className="p-5 space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-mono uppercase tracking-wider text-charcoal/60 font-bold block">
                    Username (Login ID) *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. pau, raquel, tuter"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_.-]/g, ''))}
                    className="w-full bg-cream/20 text-charcoal border border-secondary text-xs rounded-xl px-3 py-2 outline-none focus:border-primary transition font-mono"
                  />
                  <span className="text-[9px] text-charcoal/40 font-mono">Lowercase letters, numbers, and hyphens only</span>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-mono uppercase tracking-wider text-charcoal/60 font-bold block">
                    Staff Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Pau Mendoza"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="w-full bg-cream/20 text-charcoal border border-secondary text-xs rounded-xl px-3 py-2 outline-none focus:border-primary transition"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-mono uppercase tracking-wider text-charcoal/60 font-bold block">
                    Assigned Role *
                  </label>
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as UserRole)}
                    className="w-full bg-cream/20 text-charcoal border border-secondary text-xs rounded-xl px-3 py-2 outline-none focus:border-primary transition font-semibold"
                  >
                    <option value="cashier">Cashier (Front Desk &amp; POS Sales)</option>
                    <option value="admin">Administrator (Management &amp; Room Control)</option>
                    <option value="owner">Hotel Owner (Full Access &amp; Account Control)</option>
                    <option value="kitchen">Kitchen Staff (Order Display Only)</option>
                    <option value="customer_display">Lobby Customer Display (Availability Kiosk)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-mono uppercase tracking-wider text-charcoal/60 font-bold">
                      Password / Access Code *
                    </label>
                    <button
                      type="button"
                      onClick={() => setNewPassword('cashier123')}
                      className="text-[9px] font-mono font-bold text-primary hover:underline cursor-pointer"
                    >
                      Use Generic (cashier123)
                    </button>
                  </div>
                  <input
                    type="text"
                    required
                    placeholder="Enter password (min 4 characters)"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full bg-cream/20 text-charcoal border border-secondary text-xs rounded-xl px-3 py-2 outline-none focus:border-primary transition font-mono"
                  />
                </div>

                <div className="pt-2 flex justify-end gap-2 border-t border-secondary/40">
                  <button
                    type="button"
                    onClick={() => setIsCreatingUser(false)}
                    className="px-4 py-2 bg-white border border-secondary text-charcoal hover:bg-cream/40 rounded-xl text-xs font-bold transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submittingUser}
                    className="px-5 py-2 bg-primary hover:bg-primary-light text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
                  >
                    <Check size={13} />
                    <span>{submittingUser ? 'Creating...' : 'Create Account'}</span>
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ─── Modal 2: Delete Account Confirmation ─── */}
      <AnimatePresence>
        {deleteTargetUser && (
          <div className="fixed inset-0 bg-charcoal/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl border border-rose-200 shadow-xl max-w-sm w-full p-5 space-y-4"
            >
              <div className="flex items-center gap-3 text-rose-600">
                <div className="w-9 h-9 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-center shrink-0">
                  <ShieldAlert size={18} />
                </div>
                <div>
                  <h3 className="font-display font-bold text-sm text-charcoal">
                    Delete User Account?
                  </h3>
                  <p className="text-[11px] font-mono text-charcoal/50 mt-0.5">
                    @{deleteTargetUser.username} ({deleteTargetUser.name})
                  </p>
                </div>
              </div>

              <p className="text-xs text-charcoal/70 leading-relaxed">
                Are you sure you want to permanently delete this staff account? All access privileges will be revoked immediately.
              </p>

              <div className="pt-2 flex justify-end gap-2 border-t border-secondary/40">
                <button
                  type="button"
                  onClick={() => setDeleteTargetUser(null)}
                  className="px-4 py-2 bg-white border border-secondary text-charcoal hover:bg-cream/40 rounded-xl text-xs font-bold transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={deletingUser}
                  onClick={handleDeleteUser}
                  className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
                >
                  <Trash2 size={13} />
                  <span>{deletingUser ? 'Deleting...' : 'Delete Account'}</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ─── Modal 3: Reset Staff Password ─── */}
      <AnimatePresence>
        {resetTargetUser && (
          <div className="fixed inset-0 bg-charcoal/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl border border-secondary shadow-xl max-w-sm w-full p-5 space-y-4"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
                  <KeyRound size={18} />
                </div>
                <div>
                  <h3 className="font-display font-bold text-sm text-charcoal">
                    Reset Staff Password
                  </h3>
                  <p className="text-[11px] font-mono text-charcoal/50 mt-0.5">
                    @{resetTargetUser.username} ({resetTargetUser.name})
                  </p>
                </div>
              </div>

              <form onSubmit={handleResetPasswordSubmit} className="space-y-3">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-mono uppercase tracking-wider text-charcoal/60 font-bold">
                      New Password / Access Code
                    </label>
                    <button
                      type="button"
                      onClick={() => setResetPasswordValue('cashier123')}
                      className="text-[9px] font-mono font-bold text-primary hover:underline cursor-pointer"
                    >
                      Use cashier123
                    </button>
                  </div>
                  <input
                    type="text"
                    required
                    placeholder="Enter new access code"
                    value={resetPasswordValue}
                    onChange={(e) => setResetPasswordValue(e.target.value)}
                    className="w-full bg-cream/20 text-charcoal border border-secondary text-xs rounded-xl px-3 py-2 outline-none focus:border-primary transition font-mono"
                  />
                </div>

                <div className="pt-2 flex justify-end gap-2 border-t border-secondary/40">
                  <button
                    type="button"
                    onClick={() => setResetTargetUser(null)}
                    className="px-4 py-2 bg-white border border-secondary text-charcoal hover:bg-cream/40 rounded-xl text-xs font-bold transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submittingReset}
                    className="px-5 py-2 bg-primary hover:bg-primary-light text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
                  >
                    <Save size={13} />
                    <span>{submittingReset ? 'Updating...' : 'Update Password'}</span>
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
