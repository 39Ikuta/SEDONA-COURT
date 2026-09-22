import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  LayoutDashboard,
  Calendar,
  ShoppingCart,
  BookOpen,
  BarChart3,
  FileSpreadsheet,
  Settings,
  UtensilsCrossed,
  Tv,
  User,
  LogOut,
  Clock,
  Menu,
  X,
  ChevronDown,
  ShieldAlert,
  Sparkles,
  Check,
  Wallet,
  Coins,
  Bell
} from 'lucide-react';
import { useToast } from './ui/Toast';
import { ScreenState } from '../types';
import { USER_ACCOUNTS } from '../data';
import { DateTimeDisplay } from './DateTimeDisplay';

interface HeaderProps {
  activeTab: ScreenState;
  setActiveTab: (tab: ScreenState) => void;
  activeCashier: string;
  setActiveCashier: (cashier: string) => void;
  onLogout: () => void;
  loggedInUser: string;
  pendingForceCheckoutCount?: number;
  notificationCount?: number;
  onOpenForceCheckoutManager?: () => void;
  onOpenLaunchAnimation?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  activeCashier,
  setActiveCashier,
  onLogout,
  loggedInUser,
  pendingForceCheckoutCount = 0,
  notificationCount = 0,
  onOpenForceCheckoutManager,
  onOpenLaunchAnimation,
}) => {
  const toast = useToast();
  const isElectron = Boolean(window.electronAPI?.isElectron);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [reportsDropdownOpen, setReportsDropdownOpen] = useState(false);

  const handleQuickOpenDrawer = async () => {
    if (window.electronAPI) {
      try {
        const printerName = localStorage.getItem('scti_hw_receipt_printer') || undefined;
        const pin = (parseInt(localStorage.getItem('scti_hw_drawer_pin') || '2', 10) as 2 | 5) || 2;
        const res = await window.electronAPI.openCashDrawer({ printerName, drawerPin: pin });
        if (res.success) {
          toast.success('Cash Drawer Opened', 'RJ11 kick pulse dispatched');
        } else {
          toast.error('Drawer Error', res.error || 'Failed to open cash drawer');
        }
      } catch (err: any) {
        toast.error('Drawer Error', err.message);
      }
    }
  };

  const reportsDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        reportsDropdownRef.current &&
        !reportsDropdownRef.current.contains(event.target as Node)
      ) {
        setReportsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const currentUser = USER_ACCOUNTS.find(
    (u) => u.username.toLowerCase() === loggedInUser.toLowerCase()
  ) || {
    username: loggedInUser,
    name: loggedInUser,
    role: 'admin' as const,
  };

  const role = currentUser.role;
  const cashiers = ['PAU', 'RAQUEL', 'TUTER'];
  const isReportsActive = activeTab === 'reports' || activeTab === 'weekly-reports';

  // Compute staff initials
  const initials = currentUser.name
    ? currentUser.name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .substring(0, 2)
        .toUpperCase()
    : 'SC';

  return (
    <header className="bg-white/95 backdrop-blur-md border-b border-[#E1DAD0] sticky top-0 z-40 shadow-xs w-full transition-all flex flex-col">
      {/* ─── TOP ROW: Brand & System Controls ─── */}
      <div className="w-full max-w-[1720px] mx-auto px-3 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-2 sm:gap-4">
        
        {/* ─── 1. Brand & Logo ─── */}
        <button
          onClick={onOpenLaunchAnimation}
          className="flex items-center gap-2.5 sm:gap-3 shrink-0 text-left group cursor-pointer select-none focus:outline-hidden"
          title="Click to play Brand Launch Animation"
        >
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-[#793743] to-[#5a2530] flex items-center justify-center p-1.5 shadow-xs border border-primary/20 group-hover:scale-105 group-hover:shadow-md transition-all duration-200 shrink-0">
            <img src="/sedona-logo.png" alt="Sedona Court" className="w-full h-full object-contain filter drop-shadow-xs" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="font-display text-sm sm:text-base font-black tracking-tight text-primary uppercase leading-none group-hover:text-primary-light transition-colors whitespace-nowrap">
                Sedona Court
              </span>
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-mono font-bold bg-emerald-50 text-emerald-800 border border-emerald-200/80 shadow-2xs">
                PMS
              </span>
            </div>
            <span className="text-[9px] uppercase tracking-wider font-mono text-charcoal/60 mt-0.5 flex items-center gap-1 whitespace-nowrap">
              Travellers Inn
              <Sparkles size={9} className="text-amber-500 opacity-70 group-hover:opacity-100 transition-opacity" />
            </span>
          </div>
        </button>

        {/* ─── 2. Unified Terminal Controls & Live Status Cluster ─── */}
        <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
          
          {/* Prominent Streamlined Station Clock */}
          <div className="hidden xl:flex items-center shrink-0">
            <DateTimeDisplay variant="compact" />
          </div>

          {/* Unified Staff / Terminal Profile Chip */}
          <div className="flex items-center gap-2 bg-[#F2EEE9]/80 border border-[#E1DAD0] rounded-xl px-2.5 py-1 shadow-2xs shrink-0">
            <div className="w-6 h-6 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-mono font-black text-[10px] shrink-0 border border-primary/20">
              {initials}
            </div>
            
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-1.5 leading-none">
                <span className="font-sans font-bold text-xs text-charcoal truncate max-w-[90px] sm:max-w-[120px]" title={currentUser.name}>
                  {currentUser.name}
                </span>
                <span className={`text-[8px] font-mono font-extrabold uppercase px-1.5 py-0.2 rounded border tracking-wider leading-tight ${
                  role === 'owner'
                    ? 'bg-rose-50 border-rose-200 text-rose-700'
                    : role === 'admin'
                    ? 'bg-purple-50 border-purple-200 text-purple-700'
                    : role === 'cashier'
                    ? 'bg-blue-50 border-blue-200 text-blue-700'
                    : role === 'kitchen'
                    ? 'bg-amber-50 border-amber-200 text-amber-700'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                }`}>
                  {role}
                </span>
              </div>

              {/* Active Badge for Cashier */}
              <span className="text-[9px] font-mono font-semibold text-charcoal/50 mt-0.5 leading-none">
                Station #{activeCashier}
              </span>
            </div>
          </div>

          {/* Admin Force Check-Out Alert Button */}
          {(role === 'owner' || role === 'admin') && onOpenForceCheckoutManager && (
            <button
              type="button"
              onClick={onOpenForceCheckoutManager}
              className={`px-2.5 py-1.5 rounded-xl font-mono text-xs font-bold flex items-center gap-1.5 transition-all duration-150 cursor-pointer border shrink-0 ${
                pendingForceCheckoutCount > 0
                  ? 'bg-rose-50 border-rose-300 text-rose-700 animate-pulse hover:bg-rose-100 shadow-xs'
                  : 'bg-[#F2EEE9]/80 hover:bg-white border-[#E1DAD0] text-charcoal/70 hover:text-primary shadow-2xs'
              }`}
              title={pendingForceCheckoutCount > 0 ? `${pendingForceCheckoutCount} Force Check-Out request(s) pending approval` : 'Force Check-Out Management'}
            >
              <ShieldAlert size={14} className={pendingForceCheckoutCount > 0 ? 'text-rose-600' : 'text-charcoal/50'} />
              <span className="hidden xl:inline">Force Out</span>
              {pendingForceCheckoutCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-rose-600 text-white text-[9px] font-bold">
                  {pendingForceCheckoutCount}
                </span>
              )}
            </button>
          )}

          {/* Quick Cash Drawer Kick (Electron HW) */}
          {isElectron && (
            <button
              type="button"
              onClick={handleQuickOpenDrawer}
              title="Open / Kick RJ11 Cash Drawer"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl font-mono text-xs font-bold text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-200 transition-all duration-150 cursor-pointer shrink-0 shadow-2xs active:scale-95"
            >
              <Coins size={14} className="text-amber-700" />
              <span className="hidden xl:inline">Drawer</span>
            </button>
          )}

          {/* Logout Action Button */}
          <button
            onClick={onLogout}
            title="Log out of terminal"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-mono text-xs font-bold text-rose-700 bg-rose-50/80 hover:bg-rose-100 border border-rose-200/90 transition-all duration-150 cursor-pointer shrink-0 shadow-2xs group active:scale-95"
          >
            <LogOut size={14} className="text-rose-600 group-hover:translate-x-0.5 transition-transform" />
            <span className="hidden sm:inline">Log Out</span>
          </button>

          {/* Mobile Navigation Toggle Button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="lg:hidden p-2 text-charcoal/70 hover:text-primary hover:bg-[#F2EEE9] rounded-xl transition-colors cursor-pointer border border-[#E1DAD0] shrink-0"
            aria-label="Toggle navigation menu"
          >
            {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>

        </div>
      </div>

      {/* ─── 3. BOTTOM ROW: Desktop Navigation Dock ─── */}
      <div className="hidden lg:block w-full bg-white border-t border-[#E1DAD0]/70 relative z-0">
        <div className="w-full max-w-[1720px] mx-auto px-4 sm:px-6 lg:px-8">
          {role !== 'kitchen' ? (
            <nav className="flex flex-wrap items-center gap-2 py-2">
              
              {/* Frontdesk */}
              <button
                onClick={() => setActiveTab('dashboard')}
                className={`relative px-4 py-2 rounded-xl text-[13px] font-semibold transition-all duration-200 flex items-center gap-2 cursor-pointer whitespace-nowrap select-none group ${
                  activeTab === 'dashboard' || activeTab === 'receipt-preview'
                    ? 'text-primary bg-primary/5 shadow-xs border border-primary/20'
                    : 'text-charcoal/70 hover:text-charcoal hover:bg-[#F2EEE9]/70 border border-transparent'
                }`}
              >
                <LayoutDashboard size={16} className={activeTab === 'dashboard' || activeTab === 'receipt-preview' ? 'text-primary' : 'text-charcoal/40 group-hover:text-primary/70 transition-colors'} />
                <span>Frontdesk</span>
              </button>

              {/* Notifications & Live Alerts */}
              <button
                id="header-nav-notifications-btn"
                onClick={() => setActiveTab('notifications')}
                className={`relative px-4 py-2 rounded-xl text-[13px] font-semibold transition-all duration-200 flex items-center gap-2 cursor-pointer whitespace-nowrap select-none group ${
                  activeTab === 'notifications'
                    ? 'text-primary bg-primary/5 shadow-xs border border-primary/20'
                    : 'text-charcoal/70 hover:text-charcoal hover:bg-[#F2EEE9]/70 border border-transparent'
                }`}
                title="View Live Room Alerts & Checkout Notifications"
              >
                <Bell size={16} className={activeTab === 'notifications' ? 'text-primary' : 'text-charcoal/40 group-hover:text-primary/70 transition-colors'} />
                <span>Notifications</span>
                {notificationCount > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono font-black bg-rose-600 text-white animate-pulse shadow-xs">
                    {notificationCount}
                  </span>
                )}
              </button>

              {/* Bookings */}
              <button
                onClick={() => setActiveTab('bookings')}
                className={`relative px-4 py-2 rounded-xl text-[13px] font-semibold transition-all duration-200 flex items-center gap-2 cursor-pointer whitespace-nowrap select-none group ${
                  activeTab === 'bookings'
                    ? 'text-primary bg-primary/5 shadow-xs border border-primary/20'
                    : 'text-charcoal/70 hover:text-charcoal hover:bg-[#F2EEE9]/70 border border-transparent'
                }`}
              >
                <Calendar size={16} className={activeTab === 'bookings' ? 'text-primary' : 'text-charcoal/40 group-hover:text-primary/70 transition-colors'} />
                <span>Bookings</span>
              </button>

              {/* POS Catalog */}
              <button
                onClick={() => setActiveTab('pos')}
                className={`relative px-4 py-2 rounded-xl text-[13px] font-semibold transition-all duration-200 flex items-center gap-2 cursor-pointer whitespace-nowrap select-none group ${
                  activeTab === 'pos'
                    ? 'text-primary bg-primary/5 shadow-xs border border-primary/20'
                    : 'text-charcoal/70 hover:text-charcoal hover:bg-[#F2EEE9]/70 border border-transparent'
                }`}
              >
                <ShoppingCart size={16} className={activeTab === 'pos' ? 'text-primary' : 'text-charcoal/40 group-hover:text-primary/70 transition-colors'} />
                <span>POS Catalog</span>
              </button>

              {/* Ledger */}
              <button
                onClick={() => setActiveTab('ledger')}
                className={`relative px-4 py-2 rounded-xl text-[13px] font-semibold transition-all duration-200 flex items-center gap-2 cursor-pointer whitespace-nowrap select-none group ${
                  activeTab === 'ledger'
                    ? 'text-primary bg-primary/5 shadow-xs border border-primary/20'
                    : 'text-charcoal/70 hover:text-charcoal hover:bg-[#F2EEE9]/70 border border-transparent'
                }`}
              >
                <BookOpen size={16} className={activeTab === 'ledger' ? 'text-primary' : 'text-charcoal/40 group-hover:text-primary/70 transition-colors'} />
                <span>Ledger</span>
              </button>

              {/* Shift Settlement */}
              <button
                onClick={() => setActiveTab('shift-settlement')}
                className={`relative px-4 py-2 rounded-xl text-[13px] font-semibold transition-all duration-200 flex items-center gap-2 cursor-pointer whitespace-nowrap select-none group ${
                  activeTab === 'shift-settlement'
                    ? 'text-primary bg-primary/5 shadow-xs border border-primary/20'
                    : 'text-charcoal/70 hover:text-charcoal hover:bg-[#F2EEE9]/70 border border-transparent'
                }`}
              >
                <Wallet size={16} className={activeTab === 'shift-settlement' ? 'text-primary' : 'text-charcoal/40 group-hover:text-primary/70 transition-colors'} />
                <span>Shift Settlement</span>
              </button>

              {/* Reports Dropdown */}
              {(role === 'admin' || role === 'owner') && (
                <div className="relative shrink-0" ref={reportsDropdownRef}>
                  <button
                    type="button"
                    onClick={() => setReportsDropdownOpen(!reportsDropdownOpen)}
                    className={`relative px-4 py-2 rounded-xl text-[13px] font-semibold transition-all duration-200 flex items-center gap-2 cursor-pointer whitespace-nowrap select-none group ${
                      isReportsActive
                        ? 'text-primary bg-primary/5 shadow-xs border border-primary/20'
                        : 'text-charcoal/70 hover:text-charcoal hover:bg-[#F2EEE9]/70 border border-transparent'
                    }`}
                  >
                    <BarChart3 size={16} className={isReportsActive ? 'text-primary' : 'text-charcoal/40 group-hover:text-primary/70 transition-colors'} />
                    <span>
                      {activeTab === 'weekly-reports' ? 'Weekly Remittance' : activeTab === 'reports' ? 'Shift Performance' : 'Reports & Audits'}
                    </span>
                    <ChevronDown size={14} className={`transition-transform duration-200 ${reportsDropdownOpen ? 'rotate-180' : ''}`} />
                  </button>

                  <AnimatePresence>
                    {reportsDropdownOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: 6, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 6, scale: 0.96 }}
                        transition={{ duration: 0.15 }}
                        className="absolute left-0 top-full mt-2 w-64 bg-white/98 backdrop-blur-md border border-[#E1DAD0] rounded-2xl shadow-xl p-2 z-50 space-y-1 font-sans"
                      >
                        <div className="px-2.5 py-1 text-[9px] font-mono font-bold uppercase text-charcoal/40 tracking-wider">
                          Financial &amp; Audit Reports
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setActiveTab('reports');
                            setReportsDropdownOpen(false);
                          }}
                          className={`w-full text-left p-2 rounded-xl transition flex items-center justify-between cursor-pointer ${
                            activeTab === 'reports' ? 'bg-primary/10 text-primary font-bold' : 'hover:bg-cream/60 text-charcoal/80'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                              <BarChart3 size={15} />
                            </div>
                            <div>
                              <div className="text-xs font-bold leading-tight">Shift Performance</div>
                              <div className="text-[10px] text-charcoal/50 font-normal leading-tight mt-0.5">Daily shifts, KPIs &amp; expenses</div>
                            </div>
                          </div>
                          {activeTab === 'reports' && <Check size={14} className="text-primary shrink-0" />}
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setActiveTab('weekly-reports');
                            setReportsDropdownOpen(false);
                          }}
                          className={`w-full text-left p-2 rounded-xl transition flex items-center justify-between cursor-pointer ${
                            activeTab === 'weekly-reports' ? 'bg-primary/10 text-primary font-bold' : 'hover:bg-cream/60 text-charcoal/80'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0 border border-emerald-100">
                              <FileSpreadsheet size={15} />
                            </div>
                            <div>
                              <div className="text-xs font-bold leading-tight">Weekly Remittance</div>
                              <div className="text-[10px] text-charcoal/50 font-normal leading-tight mt-0.5">Aggregated shifts &amp; GCash</div>
                            </div>
                          </div>
                          {activeTab === 'weekly-reports' && <Check size={14} className="text-primary shrink-0" />}
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* Settings */}
              <button
                onClick={() => setActiveTab('settings')}
                className={`relative px-4 py-2 rounded-xl text-[13px] font-semibold transition-all duration-200 flex items-center gap-2 cursor-pointer whitespace-nowrap select-none group ml-auto ${
                  activeTab === 'settings'
                    ? 'text-primary bg-primary/5 shadow-xs border border-primary/20'
                    : 'text-charcoal/70 hover:text-charcoal hover:bg-[#F2EEE9]/70 border border-transparent'
                }`}
              >
                <Settings size={16} className={activeTab === 'settings' ? 'text-primary' : 'text-charcoal/40 group-hover:text-primary/70 transition-colors'} />
                <span>System Settings</span>
              </button>
            </nav>
          ) : (
            /* Kitchen Staff Navigation */
            <nav className="flex flex-wrap items-center gap-2 py-2">
              <button
                onClick={() => setActiveTab('kitchen-view')}
                className={`relative px-5 py-2 rounded-xl text-[13px] font-semibold transition-all duration-200 flex items-center gap-2 cursor-pointer whitespace-nowrap select-none group ${
                  activeTab === 'kitchen-view'
                    ? 'text-amber-950 font-bold bg-amber-50 shadow-xs border border-amber-200'
                    : 'text-charcoal/70 hover:text-amber-900 hover:bg-amber-50/50 border border-transparent'
                }`}
              >
                <UtensilsCrossed size={16} className={activeTab === 'kitchen-view' ? 'text-amber-800' : 'text-charcoal/40 group-hover:text-amber-800/70 transition-colors'} />
                <span>Orders Queue Board</span>
              </button>

              <button
                onClick={() => setActiveTab('kitchen-tv')}
                className={`relative px-5 py-2 rounded-xl text-[13px] font-semibold transition-all duration-200 flex items-center gap-2 cursor-pointer whitespace-nowrap select-none group ${
                  activeTab === 'kitchen-tv'
                    ? 'text-amber-950 font-bold bg-amber-50 shadow-xs border border-amber-200'
                    : 'text-charcoal/70 hover:text-amber-900 hover:bg-amber-50/50 border border-transparent'
                }`}
              >
                <Tv size={16} className={activeTab === 'kitchen-tv' ? 'text-amber-800' : 'text-charcoal/40 group-hover:text-amber-800/70 transition-colors'} />
                <span>Kitchen TV Display</span>
              </button>
            </nav>
          )}
        </div>
      </div>

      {/* ─── 4. Modern Mobile Navigation Drawer ─── */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="lg:hidden border-t border-[#E1DAD0] bg-white/95 backdrop-blur-md px-4 py-3.5 space-y-3 font-sans shadow-lg"
          >
            {/* Mobile Clock & Status */}
            <div className="flex items-center justify-between pb-2 border-b border-secondary/40">
              <DateTimeDisplay variant="compact" />
              <span className="text-[10px] font-mono font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                {role.toUpperCase()}
              </span>
            </div>

            {/* Navigation Grid */}
            <div className="grid grid-cols-2 gap-2 text-xs font-semibold">
              {role !== 'kitchen' ? (
                <>
                  <button
                    onClick={() => {
                      setActiveTab('dashboard');
                      setMobileMenuOpen(false);
                    }}
                    className={`p-2.5 rounded-xl border transition flex items-center gap-2 cursor-pointer ${
                      activeTab === 'dashboard' || activeTab === 'receipt-preview'
                        ? 'bg-primary text-white border-primary shadow-xs'
                        : 'bg-white text-charcoal/80 border-[#E1DAD0] hover:bg-[#F2EEE9]'
                    }`}
                  >
                    <LayoutDashboard size={15} />
                    <span>Frontdesk</span>
                  </button>

                  <button
                    onClick={() => {
                      setActiveTab('notifications');
                      setMobileMenuOpen(false);
                    }}
                    className={`p-2.5 rounded-xl border transition flex items-center justify-between gap-2 cursor-pointer ${
                      activeTab === 'notifications'
                        ? 'bg-primary text-white border-primary shadow-xs'
                        : 'bg-white text-charcoal/80 border-[#E1DAD0] hover:bg-[#F2EEE9]'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Bell size={15} />
                      <span>Notifications</span>
                    </div>
                    {notificationCount > 0 && (
                      <span className="px-1.5 py-0.2 rounded-full text-[9px] font-mono font-black bg-rose-600 text-white">
                        {notificationCount}
                      </span>
                    )}
                  </button>

                  <button
                    onClick={() => {
                      setActiveTab('bookings');
                      setMobileMenuOpen(false);
                    }}
                    className={`p-2.5 rounded-xl border transition flex items-center gap-2 cursor-pointer ${
                      activeTab === 'bookings'
                        ? 'bg-primary text-white border-primary shadow-xs'
                        : 'bg-white text-charcoal/80 border-[#E1DAD0] hover:bg-[#F2EEE9]'
                    }`}
                  >
                    <Calendar size={15} />
                    <span>Bookings</span>
                  </button>

                  <button
                    onClick={() => {
                      setActiveTab('pos');
                      setMobileMenuOpen(false);
                    }}
                    className={`p-2.5 rounded-xl border transition flex items-center gap-2 cursor-pointer ${
                      activeTab === 'pos'
                        ? 'bg-primary text-white border-primary shadow-xs'
                        : 'bg-white text-charcoal/80 border-[#E1DAD0] hover:bg-[#F2EEE9]'
                    }`}
                  >
                    <ShoppingCart size={15} />
                    <span>POS Catalog</span>
                  </button>

                  <button
                    onClick={() => {
                      setActiveTab('ledger');
                      setMobileMenuOpen(false);
                    }}
                    className={`p-2.5 rounded-xl border transition flex items-center gap-2 cursor-pointer ${
                      activeTab === 'ledger'
                        ? 'bg-primary text-white border-primary shadow-xs'
                        : 'bg-white text-charcoal/80 border-[#E1DAD0] hover:bg-[#F2EEE9]'
                    }`}
                  >
                    <BookOpen size={15} />
                    <span>Ledger</span>
                  </button>

                  <button
                    onClick={() => {
                      setActiveTab('shift-settlement');
                      setMobileMenuOpen(false);
                    }}
                    className={`p-2.5 rounded-xl border transition flex items-center gap-2 cursor-pointer ${
                      activeTab === 'shift-settlement'
                        ? 'bg-primary text-white border-primary shadow-xs'
                        : 'bg-white text-charcoal/80 border-[#E1DAD0] hover:bg-[#F2EEE9]'
                    }`}
                  >
                    <Wallet size={15} />
                    <span>Shift Settlement</span>
                  </button>

                  {(role === 'admin' || role === 'owner') && (
                    <button
                      onClick={() => {
                        setActiveTab('weekly-reports');
                        setMobileMenuOpen(false);
                      }}
                      className={`p-2.5 rounded-xl border transition flex items-center gap-2 cursor-pointer ${
                        activeTab === 'weekly-reports'
                          ? 'bg-primary text-white border-primary shadow-xs'
                          : 'bg-white text-charcoal/80 border-[#E1DAD0] hover:bg-[#F2EEE9]'
                      }`}
                    >
                      <FileSpreadsheet size={15} />
                      <span>Weekly Reports</span>
                    </button>
                  )}

                  {(role === 'admin' || role === 'owner') && (
                    <button
                      onClick={() => {
                        setActiveTab('reports');
                        setMobileMenuOpen(false);
                      }}
                      className={`p-2.5 rounded-xl border transition flex items-center gap-2 cursor-pointer ${
                        activeTab === 'reports'
                          ? 'bg-primary text-white border-primary shadow-xs'
                          : 'bg-white text-charcoal/80 border-[#E1DAD0] hover:bg-[#F2EEE9]'
                      }`}
                    >
                      <BarChart3 size={15} />
                      <span>Shift Performance</span>
                    </button>
                  )}

                  <button
                    onClick={() => {
                      setActiveTab('settings');
                      setMobileMenuOpen(false);
                    }}
                    className={`p-2.5 rounded-xl border transition flex items-center gap-2 cursor-pointer col-span-2 ${
                      activeTab === 'settings'
                        ? 'bg-primary text-white border-primary shadow-xs'
                        : 'bg-white text-charcoal/80 border-[#E1DAD0] hover:bg-[#F2EEE9]'
                    }`}
                  >
                    <Settings size={15} />
                    <span>System Settings</span>
                  </button>
                </>
              ) : (
                /* Kitchen Staff Mobile Menu */
                <>
                  <button
                    onClick={() => {
                      setActiveTab('kitchen-view');
                      setMobileMenuOpen(false);
                    }}
                    className={`p-2.5 rounded-xl border transition flex items-center gap-2 cursor-pointer ${
                      activeTab === 'kitchen-view'
                        ? 'bg-amber-800 text-white border-amber-800 shadow-xs'
                        : 'bg-white text-amber-900 border-amber-200'
                    }`}
                  >
                    <UtensilsCrossed size={15} />
                    <span>Orders Queue Board</span>
                  </button>

                  <button
                    onClick={() => {
                      setActiveTab('kitchen-tv');
                      setMobileMenuOpen(false);
                    }}
                    className={`p-2.5 rounded-xl border transition flex items-center gap-2 cursor-pointer ${
                      activeTab === 'kitchen-tv'
                        ? 'bg-amber-800 text-white border-amber-800 shadow-xs'
                        : 'bg-white text-amber-900 border-amber-200'
                    }`}
                  >
                    <Tv size={15} />
                    <span>Kitchen TV Display</span>
                  </button>
                </>
              )}
            </div>

            {/* Mobile Footer with Cashier Selector & Logout */}
            <div className="pt-2 border-t border-secondary/40 flex items-center justify-between">
              <span className="text-xs font-mono text-charcoal/60">
                Station: {activeCashier}
              </span>

              <button
                onClick={onLogout}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-mono text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 transition-colors cursor-pointer shadow-2xs"
              >
                <LogOut size={14} className="text-rose-600" />
                <span>Log Out</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
};

export default Header;
