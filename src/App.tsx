import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Room, Receipt, ScreenState, HandoffTask, ScheduledBooking, BillableService, AuditLogEntry, NotificationLogItem } from './types';
import { playChime, stopAlarm } from './utils/audio';
import { INITIAL_ROOMS, USER_ACCOUNTS, DEFAULT_BILLABLE_SERVICES } from './data';
import { Login } from './components/Login';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { RoomGrid } from './components/RoomGrid';
import { RoomDetailSidebar } from './components/RoomDetailSidebar';
import { ReceiptPreview } from './components/ReceiptPreview';
import { ReportsPanel } from './components/ReportsPanel';
import { TransactionLedger } from './components/TransactionLedger';
import { POSCatalog } from './components/POSCatalog';
import { SettingsPanel } from './components/SettingsPanel';
import { ShiftHandoff } from './components/ShiftHandoff';
import { BookingCalendar } from './components/BookingCalendar';
import { WeeklyReportManager } from './components/WeeklyReportManager';
import { KitchenTVDisplay } from './components/KitchenTVDisplay';
import { KitchenStaffView } from './components/KitchenStaffView';
import { CustomerDisplay } from './components/CustomerDisplay';
import { AdminForceCheckoutManager } from './components/AdminForceCheckoutManager';
import { CashierShiftSettlement } from './components/CashierShiftSettlement';
import { DateTimeDisplay } from './components/DateTimeDisplay';
import { NotificationsCenter } from './components/NotificationsCenter';
import { useToast } from './components/ui/Toast';
import { ConfirmDialog } from './components/ui/ConfirmDialog';
import { KeyRound, RefreshCw, Calendar, Sparkles, BellOff, Clock, Volume2, X, Bell, LayoutGrid } from 'lucide-react';
import { LaunchAnimation } from './components/LaunchAnimation';
// API client modules
import { login as apiLogin, logout as apiLogout } from './api/auth';
import { getRooms, updateRoom as apiUpdateRoom, resetRooms } from './api/rooms';
import { getBookings, addBooking as apiAddBooking, deleteBooking as apiDeleteBooking, updateBookingStatus } from './api/bookings';
import { getReceipts, createReceipt } from './api/receipts';
import { getServices, addService as apiAddService, updateService as apiUpdateService, deleteService as apiDeleteService } from './api/services';
import { getAuditLogs, createAuditLog } from './api/auditLogs';
import { getTasks, addTask as apiAddTask, updateTask as apiUpdateTask, deleteTask as apiDeleteTask } from './api/tasks';
import { getPOSRevenue, addPOSRevenue, resetPOSRevenue } from './api/posRevenue';
import { kitchenOrderService } from './api/kitchen';
import { getForceCheckoutRequests } from './api/force-checkout';
import { socket } from './api/socket';

interface SnoozedAlarmItem {
  roomNumber: string;
  type: 'warning' | 'checkout' | 'grace';
  message: string;
  snoozedUntil: number;
}

export default function App() {
  const toast = useToast();

  // ─── Confirm Dialog State ──────────────────────────────────────────────────
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    variant?: 'danger' | 'warning' | 'default';
    onConfirm: () => void;
  }>({ isOpen: false, title: '', message: '', onConfirm: () => {} });

  const showConfirm = (opts: Omit<typeof confirmDialog, 'isOpen'>) => {
    setConfirmDialog({ ...opts, isOpen: true });
  };
  const closeConfirm = () => setConfirmDialog(prev => ({ ...prev, isOpen: false }));

  // ─── Session Operator state (sessionStorage — cleared when tab closes) ─────
  const [loggedInUser, setLoggedInUser] = useState<string>(() => {
    return sessionStorage.getItem('scti_operator') || '';
  });

  const [operatorRole, setOperatorRole] = useState<string>(() => {
    return sessionStorage.getItem('scti_operator_role') || '';
  });

  const [isCustomerDisplayView, setIsCustomerDisplayView] = useState<boolean>(() => {
    return window.location.pathname.startsWith('/display') || window.location.search.includes('view=display');
  });

  const matchedUser = USER_ACCOUNTS.find(a => a.username.toLowerCase() === loggedInUser.toLowerCase());
  const role = operatorRole || (matchedUser ? matchedUser.role : '');

  // ─── Navigation State ──────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<ScreenState>('dashboard');

  // ─── Core Data State (hydrated from API on mount) ──────────────────────────
  const [rooms, setRooms] = useState<Room[]>(INITIAL_ROOMS);
  const [additionalPOSRevenue, setAdditionalPOSRevenue] = useState<number>(0);
  const [additionalPOSCategoryRevenue, setAdditionalPOSCategoryRevenue] = useState<{
    kitchen: number;
    drinks: number;
    miscell: number;
  }>({ kitchen: 0, drinks: 0, miscell: 0 });
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('all');
  const [selectedRoomNumber, setSelectedRoomNumber] = useState<string | null>(null);
  const [activeCashier, setActiveCashier] = useState<string>('PAU');
  const [lastReceipt, setLastReceipt] = useState<Receipt | null>(null);
  const [isHandoffOpen, setIsHandoffOpen] = useState(false);
  const [sessionReceipts, setSessionReceipts] = useState<Receipt[]>([]);
  const [pendingTasks, setPendingTasks] = useState<HandoffTask[]>([]);
  const [bookings, setBookings] = useState<ScheduledBooking[]>([]);
  const [billableServices, setBillableServices] = useState<BillableService[]>(DEFAULT_BILLABLE_SERVICES);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [apiReady, setApiReady] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [isForceCheckoutManagerOpen, setIsForceCheckoutManagerOpen] = useState(false);
  const [pendingForceCheckoutCount, setPendingForceCheckoutCount] = useState<number>(0);
  const [isLaunchAnimationOpen, setIsLaunchAnimationOpen] = useState(false);

  const handleRefreshForceCheckoutRequests = async () => {
    try {
      const forceOutRequests = await getForceCheckoutRequests('pending');
      setPendingForceCheckoutCount(forceOutRequests.length);
      const pendingRoomNumbers = new Set(forceOutRequests.map(r => r.roomNumber));
      setRooms(prev => prev.map(rm => ({
        ...rm,
        forceCheckoutPending: pendingRoomNumbers.has(rm.number),
      })));
    } catch (err) {
      console.warn('Failed to refresh force checkout requests:', err);
    }
  };

  // ─── Hydrate all state from API on login & on sleep/wake resume ────────────
  const hydrate = useCallback(async (isSilent = false) => {
    if (!loggedInUser || role === 'customer_display' || isCustomerDisplayView) return;
    try {
      const isAdminOrOwner = role === 'admin' || role === 'owner';
      const [roomsData, bookingsData, servicesData, logsData, tasksData, posRev, receiptsData, forceOutRequests] = await Promise.all([
        getRooms(),
        getBookings(),
        getServices(),
        isAdminOrOwner ? getAuditLogs() : Promise.resolve([]),
        getTasks(),
        getPOSRevenue(),
        getReceipts(),
        getForceCheckoutRequests('pending').catch(() => []),
      ]);
      const pendingRoomNumbers = new Set((forceOutRequests || []).map(r => r.roomNumber));
      setRooms(roomsData.map(rm => ({
        ...rm,
        forceCheckoutPending: pendingRoomNumbers.has(rm.number),
      })));
      setPendingForceCheckoutCount((forceOutRequests || []).length);
      setBookings(bookingsData); // Use API data directly, no fallback
      setBillableServices(servicesData.length > 0 ? servicesData : DEFAULT_BILLABLE_SERVICES);
      setAuditLogs(logsData || []);
      setPendingTasks(tasksData);
      setAdditionalPOSRevenue(posRev.total);
      setAdditionalPOSCategoryRevenue({ kitchen: posRev.kitchen, drinks: posRev.drinks, miscell: posRev.miscell });
      setSessionReceipts(receiptsData);
      setApiReady(true);
      setApiError(null);
    } catch (err: any) {
      if (!isSilent) {
        console.warn('⚠️ API unavailable, using local seed data as fallback.', err);
        setApiReady(false);
        // Surface offline mode: checkout/checkin will fail loudly instead of
        // silently diverging. Reload in this state always reverts to seed.
        setApiError(err?.message || 'Cannot reach backend at /api (is `npm run server` running on port 4000?).');
        toast.error('Database Offline', 'Backend unreachable — changes will NOT persist after reload. Start the API server with `npm run dev:all`.');
      } else {
        console.warn('⚠️ Background sleep/wake re-sync failed, will retry next tick.', err);
      }
    }
  }, [loggedInUser, role, isCustomerDisplayView, toast]);

  useEffect(() => {
    hydrate(false);
  }, [hydrate]);

  useEffect(() => {
    const handleSync = () => {
      console.log('🔄 Socket event received, syncing data...');
      hydrate(true);
    };

    socket.on('room:updated', handleSync);
    socket.on('force_checkout:requested', handleSync);
    socket.on('deposit:applied', handleSync);

    return () => {
      socket.off('room:updated', handleSync);
      socket.off('force_checkout:requested', handleSync);
      socket.off('deposit:applied', handleSync);
    };
  }, [hydrate]);

  // Handle OS sleep/wake, browser tab refocus, and network reconnects
  useEffect(() => {
    if (!loggedInUser || role === 'customer_display' || isCustomerDisplayView) return;

    const handleResume = () => {
      console.log('🔄 Application resumed from sleep/tab switch - syncing data...');
      hydrate(true);
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        handleResume();
      }
    };

    window.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('online', handleResume);
    window.addEventListener('focus', handleResume);

    return () => {
      window.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('online', handleResume);
      window.removeEventListener('focus', handleResume);
    };
  }, [loggedInUser, role, isCustomerDisplayView, hydrate]);

  // Helper to write a log (API + local state)
  const writeAuditLog = async (action: string, details: string) => {
    const operatorName = USER_ACCOUNTS.find(u => u.username.toLowerCase() === loggedInUser.toLowerCase())?.name || loggedInUser || 'System';
    const newLog: AuditLogEntry = {
      id: `log-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
      timestamp: new Date().toISOString(),
      operator: operatorName,
      action,
      details,
    };
    setAuditLogs(prev => [...prev, newLog]);
    try {
      await createAuditLog(newLog);
    } catch (err) {
      console.warn('Failed to persist audit log to API:', err);
    }
  };

  // Add Service Handler (Owner only)
  const handleAddService = async (newService: Omit<BillableService, 'id'>) => {
    if (role !== 'owner') {
      console.warn('Unauthorized: only owner can add services');
      return;
    }
    const newId = `${newService.type}-${Date.now()}`;
    const entry: BillableService = { ...newService, id: newId, isDeleted: false };
    setBillableServices(prev => [...prev, entry]);
    writeAuditLog('CREATE_SERVICE', `Created new ${newService.type.replace('_', ' ')}: "${newService.name}" under category "${newService.category}" with base price ₱${newService.price.toLocaleString()}`);
    try {
      await apiAddService(newService);
    } catch (err) {
      console.warn('Failed to persist new service to API:', err);
    }
  };

  // Update Service Handler (Owner only)
  const handleUpdateService = async (updated: BillableService) => {
    if (role !== 'owner') {
      console.warn('Unauthorized: only owner can update services');
      return;
    }
    const existing = billableServices.find(s => s.id === updated.id);
    setBillableServices(prev => prev.map(s => s.id === updated.id ? updated : s));
    if (existing) {
      let changes: string[] = [];
      if (existing.price !== updated.price) changes.push(`price changed from ₱${existing.price.toLocaleString()} to ₱${updated.price.toLocaleString()}`);
      if (existing.name !== updated.name) changes.push(`name changed from "${existing.name}" to "${updated.name}"`);
      if (existing.active !== updated.active) changes.push(`availability toggled to ${updated.active ? 'ACTIVE' : 'INACTIVE'}`);
      if (existing.weekdayOverride !== updated.weekdayOverride) changes.push(`weekday override changed from ₱${existing.weekdayOverride || 'None'} to ₱${updated.weekdayOverride || 'None'}`);
      if (existing.weekendOverride !== updated.weekendOverride) changes.push(`weekend override changed from ₱${existing.weekendOverride || 'None'} to ₱${updated.weekendOverride || 'None'}`);
      const changeMsg = changes.length > 0 ? changes.join(', ') : 'modified general properties';
      writeAuditLog('UPDATE_SERVICE', `Updated ${updated.type.replace('_', ' ')} "${updated.name}": ${changeMsg}`);
    }
    try {
      await apiUpdateService(updated);
    } catch (err) {
      console.warn('Failed to persist service update to API:', err);
    }
  };

  // Delete Service Handler (Soft-delete, Owner only)
  const handleDeleteService = async (id: string) => {
    if (role !== 'owner') {
      console.warn('Unauthorized: only owner can delete services');
      return;
    }
    const existing = billableServices.find(s => s.id === id);
    if (existing) {
      setBillableServices(prev => prev.map(s => s.id === id ? { ...s, isDeleted: true } : s));
      writeAuditLog('DELETE_SERVICE', `Soft-deleted ${existing.type.replace('_', ' ')} "${existing.name}" (removed from active catalogs but historical invoice mappings preserved)`);
      try {
        await apiDeleteService(id);
      } catch (err) {
        console.warn('Failed to persist service delete to API:', err);
      }
    }
  };

  const [triggeredAlarms, setTriggeredAlarms] = useState<{
    [stayId: string]: {
      warning?: boolean;
      checkout?: boolean;
      grace?: boolean;
    };
  }>(() => {
    const saved = localStorage.getItem('scti_triggered_alarms');
    return saved ? JSON.parse(saved) : {};
  });

  const [activeAlarms, setActiveAlarms] = useState<Array<{
    id: string;
    roomNumber: string;
    type: 'warning' | 'checkout' | 'grace';
    message: string;
    timestamp: string;
  }>>([]);

  const [snoozedAlarms, setSnoozedAlarms] = useState<Record<string, SnoozedAlarmItem>>(() => {
    const saved = localStorage.getItem('scti_snoozed_alarms');
    return saved ? JSON.parse(saved) : {};
  });

  const [notificationHistory, setNotificationHistory] = useState<NotificationLogItem[]>(() => {
    const saved = localStorage.getItem('scti_notification_history');
    return saved ? JSON.parse(saved) : [];
  });

  const roomsRef = useRef(rooms);
  const triggeredAlarmsRef = useRef(triggeredAlarms);
  const snoozedAlarmsRef = useRef(snoozedAlarms);

  useEffect(() => {
    roomsRef.current = rooms;
  }, [rooms]);

  useEffect(() => {
    triggeredAlarmsRef.current = triggeredAlarms;
  }, [triggeredAlarms]);

  useEffect(() => {
    snoozedAlarmsRef.current = snoozedAlarms;
  }, [snoozedAlarms]);

  useEffect(() => {
    localStorage.setItem('scti_triggered_alarms', JSON.stringify(triggeredAlarms));
  }, [triggeredAlarms]);

  useEffect(() => {
    localStorage.setItem('scti_snoozed_alarms', JSON.stringify(snoozedAlarms));
  }, [snoozedAlarms]);

  useEffect(() => {
    localStorage.setItem('scti_notification_history', JSON.stringify(notificationHistory));
  }, [notificationHistory]);

  const handleSnoozeAlarm = (
    alarm: { id: string; roomNumber: string; type: 'warning' | 'checkout' | 'grace'; message: string },
    minutes: number = 5
  ) => {
    stopAlarm();
    const snoozeUntil = Date.now() + minutes * 60 * 1000;
    const key = `${alarm.roomNumber}_${alarm.type}`;
    const cleanMessage = alarm.message.replace(/^⏰ \[SNOOZE EXPIRED\]\s*/, '');
    
    setSnoozedAlarms((prev) => ({
      ...prev,
      [key]: {
        roomNumber: alarm.roomNumber,
        type: alarm.type,
        message: cleanMessage,
        snoozedUntil: snoozeUntil,
      },
    }));
    setActiveAlarms((prev) => prev.filter((a) => a.id !== alarm.id));
  };

  const handleWakeSnoozedAlarm = (key: string) => {
    const alarm = snoozedAlarms[key];
    if (alarm) {
      const nextSnoozed = { ...snoozedAlarms };
      delete nextSnoozed[key];
      setSnoozedAlarms(nextSnoozed);
      setActiveAlarms((prev) => [
        ...prev,
        {
          id: `${alarm.roomNumber}_${alarm.type}_manual_wake_${Date.now()}`,
          roomNumber: alarm.roomNumber,
          type: alarm.type,
          message: alarm.message,
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
      playChime(alarm.type);
    }
  };

  // Periodic Real-time Room Time Tracker & Alarm Trigger
  const lastTickTimeRef = useRef<number>(Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      const nowMs = now.getTime();

      // If time jumped by more than 10 seconds, the system woke from sleep/standby
      if (nowMs - lastTickTimeRef.current > 10000) {
        console.log('⏰ System wake-from-sleep detected via clock skew, re-synchronizing data...');
        hydrate(true);
      }
      lastTickTimeRef.current = nowMs;

      let hasChanges = false;
      let newTriggered = { ...triggeredAlarmsRef.current };
      let triggersUpdated = false;
      const alarmToPlay: Array<'warning' | 'checkout' | 'grace'> = [];
      const notificationsToAdd: Array<{
        id: string;
        roomNumber: string;
        type: 'warning' | 'checkout' | 'grace';
        message: string;
        timestamp: string;
      }> = [];

      const updatedRooms = roomsRef.current.map((room) => {
        if (room.isStaffHouse || room.roomType === 'Staff House' || room.number === '12') {
          return {
            ...room,
            time: 'STAFF',
          };
        }

        if ((room.state === 'occupied' || room.state === 'overdue') && room.checkOutTime) {
          const checkout = new Date(room.checkOutTime);
          const diffMs = checkout.getTime() - now.getTime();
          const diffMins = diffMs / 60000;

          // Compute correct formatted time string
          let computedTime = '';
          if (diffMs > 0) {
            const hours = Math.floor(diffMs / 3600000);
            const mins = Math.floor((diffMs % 3600000) / 60000);
            const secs = Math.floor((diffMs % 60000) / 1000);
            computedTime = hours > 0 ? `${hours}h ${mins}m` : `${mins}m ${secs}s`;
          } else {
            const overdueMs = Math.abs(diffMs);
            const hours = Math.floor(overdueMs / 3600000);
            const mins = Math.floor((overdueMs % 3600000) / 60000);
            const secs = Math.floor((overdueMs % 60000) / 1000);
            computedTime = hours > 0 ? `+${hours}h ${mins}m` : `+${mins}m ${secs}s`;
          }

          // State transition if overdue
          let nextState = room.state;
          if (diffMs <= 0 && room.state === 'occupied') {
            nextState = 'overdue';
          }

          // Check triggers
          const stayKey = `${room.number}_${room.checkInTime || ''}`;
          if (!newTriggered[stayKey]) {
            newTriggered[stayKey] = {};
          }
          const triggers = { ...newTriggered[stayKey] };

          // 1. 15 minutes warning before checkout
          if (diffMins <= 15 && diffMins > 0 && !triggers.warning) {
            triggers.warning = true;
            newTriggered[stayKey] = triggers;
            triggersUpdated = true;
            alarmToPlay.push('warning');
            notificationsToAdd.push({
              id: `${room.number}_warning_${Date.now()}`,
              roomNumber: room.number,
              type: 'warning',
              message: `⚠️ Apartment ${room.number} (${room.guestName}) checkout is in 15 minutes!`,
              timestamp: now.toLocaleTimeString()
            });
          }

          // 2. Exactly checkout time
          if (diffMins <= 0 && !triggers.checkout) {
            triggers.checkout = true;
            newTriggered[stayKey] = triggers;
            triggersUpdated = true;
            alarmToPlay.push('checkout');
            notificationsToAdd.push({
              id: `${room.number}_checkout_${Date.now()}`,
              roomNumber: room.number,
              type: 'checkout',
              message: `⏰ Apartment ${room.number} (${room.guestName}) checkout time reached!`,
              timestamp: now.toLocaleTimeString()
            });
          }

          // 3. 15 minutes grace period exceeded
          if (diffMins <= -15 && !triggers.grace) {
            triggers.grace = true;
            newTriggered[stayKey] = triggers;
            triggersUpdated = true;
            alarmToPlay.push('grace');
            notificationsToAdd.push({
              id: `${room.number}_grace_${Date.now()}`,
              roomNumber: room.number,
              type: 'grace',
              message: `🚨 Apartment ${room.number} (${room.guestName}) grace period has expired! (+15 mins overdue)`,
              timestamp: now.toLocaleTimeString()
            });
          }

          if (room.time !== computedTime || room.state !== nextState) {
            hasChanges = true;
            return {
              ...room,
              time: computedTime,
              state: nextState,
              isOverdue: diffMs <= 0
            };
          }
        }
        return room;
      });

      // Check snoozed alarms expiration
      const currentSnoozed = snoozedAlarmsRef.current;
      const snoozedEntries = Object.entries(currentSnoozed) as [string, SnoozedAlarmItem][];
      if (snoozedEntries.length > 0) {
        let snoozedChanged = false;
        const nextSnoozed = { ...currentSnoozed };
        snoozedEntries.forEach(([key, item]) => {
          if (nowMs >= item.snoozedUntil) {
            delete nextSnoozed[key];
            snoozedChanged = true;
            alarmToPlay.push(item.type);
            notificationsToAdd.push({
              id: `${item.roomNumber}_${item.type}_snooze_expired_${Date.now()}`,
              roomNumber: item.roomNumber,
              type: item.type,
              message: `⏰ [SNOOZE EXPIRED] ${item.message}`,
              timestamp: now.toLocaleTimeString()
            });
          }
        });
        if (snoozedChanged) {
          setSnoozedAlarms(nextSnoozed);
        }
      }

      if (hasChanges) {
        setRooms(updatedRooms);
      }

      if (triggersUpdated) {
        setTriggeredAlarms(newTriggered);
      }

      if (alarmToPlay.length > 0) {
        const highestUrgency = alarmToPlay.includes('grace') ? 'grace' : alarmToPlay.includes('checkout') ? 'checkout' : 'warning';
        playChime(highestUrgency);
      }

      if (notificationsToAdd.length > 0) {
        setActiveAlarms((prev) => [...prev, ...notificationsToAdd]);
        const historyEntries: NotificationLogItem[] = notificationsToAdd.map((n) => ({
          id: n.id,
          roomNumber: n.roomNumber,
          guestName: roomsRef.current.find((r) => r.number === n.roomNumber)?.guestName,
          type: n.type,
          title:
            n.type === 'grace'
              ? '🚨 Grace Period Exceeded (+15m)'
              : n.type === 'checkout'
              ? '⏰ Checkout Time Reached'
              : '⚠️ 15-Minute Advance Warning',
          message: n.message,
          timestamp: n.timestamp,
          rawTime: Date.now(),
        }));
        setNotificationHistory((prev) => [...historyEntries, ...prev].slice(0, 100));
      }
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Listen for session expiry from API calls and prompt re-login
  useEffect(() => {
    const handleSessionExpired = () => {
      setLoggedInUser('');
      toast.error('Session expired. Please log in again to continue.');
    };
    window.addEventListener('scti:session-expired', handleSessionExpired);
    return () => window.removeEventListener('scti:session-expired', handleSessionExpired);
  }, [toast]);

  const handleLogin = async (user: string, userRole?: string) => {
    // apiLogin is called by the Login component; here we just update state
    setLoggedInUser(user);
    sessionStorage.setItem('scti_operator', user);
    if (userRole) {
      setOperatorRole(userRole);
      sessionStorage.setItem('scti_operator_role', userRole);
    }
    
    if (userRole === 'customer_display' || user.toLowerCase() === 'kiosk') {
      setIsCustomerDisplayView(true);
      return;
    }

    const match = USER_ACCOUNTS.find(a => a.username.toLowerCase() === user.toLowerCase());
    if (match) {
      if (match.role === 'kitchen') {
        setActiveTab('kitchen-view');
      } else {
        setActiveTab('dashboard');
      }
      if (match.role === 'cashier') {
        setActiveCashier(match.username.toUpperCase());
      } else {
        setActiveCashier('PAU');
      }
    } else {
      setActiveTab('dashboard');
    }
  };

  const handleLogout = () => {
    if (role === 'cashier') {
      setIsHandoffOpen(true);
    } else {
      handleConfirmLogout();
    }
  };

  const handleConfirmLogout = async () => {
    setIsHandoffOpen(false);
    try { await apiLogout(); } catch (_) { /* non-critical */ }
    setLoggedInUser('');
    setOperatorRole('');
    setIsCustomerDisplayView(false);
    sessionStorage.removeItem('scti_token');
    sessionStorage.removeItem('scti_operator');
    sessionStorage.removeItem('scti_operator_role');
    // Clear session receipts for the next operator to start fresh
    setSessionReceipts([]);
  };

  const handleToggleTask = async (id: string) => {
    const task = pendingTasks.find(t => t.id === id);
    if (!task) return;
    const updated = { ...task, completed: !task.completed };
    setPendingTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
    try { await apiUpdateTask(id, { completed: updated.completed }); } catch (err) { console.warn('Task toggle API error:', err); }
  };

  const handleAddTask = async (text: string, priority: 'low' | 'medium' | 'high') => {
    const newTask: HandoffTask = {
      id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      text,
      completed: false,
      priority,
    };
    setPendingTasks((prev) => [newTask, ...prev]);
    try { await apiAddTask(newTask); } catch (err) { console.warn('Add task API error:', err); }
  };

  const handleDeleteTask = async (id: string) => {
    setPendingTasks((prev) => prev.filter((t) => t.id !== id));
    try { await apiDeleteTask(id); } catch (err) { console.warn('Delete task API error:', err); }
  };

  // Find currently active room object
  const selectedRoom = rooms.find((r) => r.number === selectedRoomNumber) || null;

  // Handler to update individual room state.
  // Optimistic update with revert + throw so callers (checkout/checkin)
  // never mistake a failed DB write for success. Previously failures were
  // swallowed with console.warn, so checkout looked done in-memory but
  // reload re-hydrated the old occupied state from SQLite.
  const handleUpdateRoom = async (updatedRoom: Room) => {
    const prevRooms = roomsRef.current;
    const shouldCloseDrawer =
      updatedRoom.state === 'cleaning' && selectedRoomNumber === updatedRoom.number;
    setRooms((prev) => prev.map((r) => (r.number === updatedRoom.number ? updatedRoom : r)));
    try {
      await apiUpdateRoom(updatedRoom);
      if (shouldCloseDrawer) {
        setSelectedRoomNumber(null);
      }
    } catch (err: any) {
      // Revert optimistic update so UI never diverges from DB.
      setRooms(prevRooms);
      console.warn('Room update API error:', err);
      toast.error('Room Update Failed', err?.message || 'Could not save room to database. Check that the backend server is running (npm run dev:all).');
      throw err;
    }
  };

  // Handler to record additional revenue from POS operations
  const handlePostPOSOrderDirect = async (amount: number, category: 'kitchen' | 'drinks' | 'miscell') => {
    setAdditionalPOSRevenue((prev) => prev + amount);
    setAdditionalPOSCategoryRevenue((prev) => ({ ...prev, [category]: prev[category] + amount }));
    try {
      await addPOSRevenue(amount, category);
    } catch (err) { console.warn('POS revenue API error:', err); }
  };

  // Advanced Booking handlers
  const handleAddBooking = async (newBooking: ScheduledBooking) => {
    setBookings((prev) => [...prev, newBooking]);
    try { await apiAddBooking(newBooking); } catch (err) { console.warn('Add booking API error:', err); }
  };

  const handleCancelBooking = async (bookingId: string) => {
    showConfirm({
      title: 'Cancel Scheduled Booking',
      message: 'Are you sure you want to cancel this scheduled booking? This action cannot be undone.',
      confirmLabel: 'Cancel Booking',
      variant: 'warning',
      onConfirm: async () => {
        closeConfirm();
        setBookings((prev) => prev.filter((b) => b.id !== bookingId));
        try { await apiDeleteBooking(bookingId); } catch (err) { console.warn('Cancel booking API error:', err); }
        toast.success('Booking Cancelled', 'The scheduled booking has been removed.');
      },
    });
  };

  const handleCheckInBooking = async (booking: ScheduledBooking) => {
    const targetRoom = rooms.find((r) => r.number === booking.roomNumber);
    if (!targetRoom) return;

    if (targetRoom.state !== 'available') {
      toast.warning('Room Unavailable', `Apartment ${booking.roomNumber} is currently ${targetRoom.state.toUpperCase()}. Please check-out the current guest or finish cleaning first.`);
      return;
    }

    const stayHours = booking.rateSelected === '3h' ? 3 : booking.rateSelected === '6h' ? 6 : booking.rateSelected === '12h' ? 12 : 24;
    const checkInIso = new Date().toISOString();
    const checkOutIso = new Date(Date.now() + stayHours * 3600000).toISOString();

    const updatedRoom: Room = {
      ...targetRoom,
      state: 'occupied',
      label: booking.guestName.split(',')[0],
      guestName: booking.guestName,
      guestId: booking.guestId || '',
      numGuests: booking.numGuests,
      rateSelected: booking.rateSelected,
      time: `${stayHours}h 00m`,
      checkInTime: checkInIso,
      checkOutTime: checkOutIso
    };

    setRooms((prev) => prev.map((r) => (r.number === booking.roomNumber ? updatedRoom : r)));
    setBookings((prev) => prev.filter((b) => b.id !== booking.id));
    setSelectedRoomNumber(booking.roomNumber);
    try {
      await apiUpdateRoom(updatedRoom);
    } catch (err: any) {
      console.warn('Room update API error:', err);
      toast.error('Check-In Failed', err?.message || 'Could not save check-in to database.');
      // Revert optimistic updates
      try {
        const freshRooms = await getRooms();
        setRooms(freshRooms);
      } catch { /* keep optimistic state if refresh also fails */ }
      setBookings((prev) => [...prev, booking]);
      throw err;
    }
    toast.success('Booking Checked In', `Successfully checked in ${booking.guestName} to Apartment ${booking.roomNumber}!`);
  };

  const handleRefreshReceipts = async () => {
    try {
      const freshReceipts = await getReceipts();
      setSessionReceipts(freshReceipts);
    } catch (err) {
      console.warn('Failed to refresh receipts:', err);
    }
  };

  // Handler for checkout receipt creation.
  // POST /receipts is authoritative: the server recomputes totals from the
  // DB room row and transitions the room to 'cleaning' in the same
  // transaction. Persist FIRST, then update local state. Throw on failure so
  // RoomDetailSidebar aborts the room update instead of faking a checkout.
  const handleGenerateReceipt = async (receipt: Receipt) => {
    let saved: Receipt;
    try {
      saved = await createReceipt(receipt);
    } catch (err: any) {
      console.warn('Receipt save API error:', err);
      toast.error('Checkout Failed', err?.message || 'Could not save receipt to database. Room was NOT checked out.');
      throw err;
    }
    setLastReceipt(saved);
    setSessionReceipts((prev) => {
      if (prev.some((r) => r.receiptNo === saved.receiptNo)) return prev;
      return [saved, ...prev];
    });
    setActiveTab('receipt-preview');
    // Re-sync rooms: server already set this room to 'cleaning'.
    try {
      const freshRooms = await getRooms();
      const pending = new Set(
        roomsRef.current.filter((r) => r.forceCheckoutPending).map((r) => r.number)
      );
      setRooms(
        freshRooms.map((rm) => ({
          ...rm,
          forceCheckoutPending: pending.has(rm.number) || rm.forceCheckoutPending,
        }))
      );
    } catch (refreshErr) {
      console.warn('Failed to refresh rooms after checkout:', refreshErr);
    }
  };

  // Clear system database to defaults
  const handleResetDatabase = () => {
    showConfirm({
      title: 'Reset Entire System',
      message: 'Are you sure you want to reset all rooms and transactions to a clean, empty state? This will clear all receipts, bookings, and room states. This action cannot be undone.',
      confirmLabel: 'Reset Everything',
      variant: 'danger',
      onConfirm: async () => {
        closeConfirm();
        setAdditionalPOSRevenue(0);
        setAdditionalPOSCategoryRevenue({ kitchen: 0, drinks: 0, miscell: 0 });
        setLastReceipt(null);
        setSelectedRoomNumber(null);
        setBookings([]);
        setSessionReceipts([]);
        localStorage.removeItem('scti_col1_expenses');
        localStorage.removeItem('scti_col2_expenses');
        try {
          const [freshRooms] = await Promise.all([
            resetRooms(),
            resetPOSRevenue(),
          ]);
          setRooms(freshRooms);
          toast.success('System Reset Complete', 'All rooms, receipts, and transactions have been cleared.');
        } catch (err) {
          console.warn('Database reset API error, reverting to local defaults:', err);
          setRooms(INITIAL_ROOMS);
          toast.error('Reset Error', 'Failed to reset via API. Local defaults have been restored.');
        }
      },
    });
  };

  // Render Customer Display screen if customer_display role or kiosk view active
  if (role === 'customer_display' || isCustomerDisplayView) {
    return <CustomerDisplay onLogout={handleConfirmLogout} />;
  }

  const handleOpenCustomerDisplay = async () => {
    try {
      const res = await apiLogin('kiosk', 'kiosk123');
      handleLogin(res.username, res.role);
    } catch (_) {
      setIsCustomerDisplayView(true);
    }
  };

  // One-tap kitchen entry (mirrors Lobby Display): no credentials to type.
  const handleOpenKitchenDisplay = async () => {
    try {
      const res = await apiLogin('kitchen1', 'kitchen123');
      handleLogin(res.username, res.role);
    } catch (err: any) {
      toast.error('Kitchen Display Unavailable', err?.message || 'Could not reach the backend server.');
    }
  };

  // Render Login screen if session inactive
  if (!loggedInUser) {
    return (
      <>
        <Login
          onLogin={handleLogin}
          onOpenCustomerDisplay={handleOpenCustomerDisplay}
          onOpenKitchenDisplay={handleOpenKitchenDisplay}
          onOpenLaunchAnimation={() => setIsLaunchAnimationOpen(true)}
        />
        <AnimatePresence>
          {isLaunchAnimationOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md flex items-center justify-center p-4 sm:p-6"
            >
              <div className="relative w-full max-w-5xl bg-black rounded-3xl overflow-hidden shadow-2xl border border-white/10">
                <button
                  onClick={() => setIsLaunchAnimationOpen(false)}
                  className="absolute top-4 right-4 z-50 p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition cursor-pointer backdrop-blur-sm"
                  title="Close Animation"
                >
                  <X size={18} />
                </button>
                <LaunchAnimation
                  onComplete={() => setIsLaunchAnimationOpen(false)}
                  autoClose={false}
                  showControls={true}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </>
    );
  }

  const nowForBadge = Date.now();
  const urgentRoomsBadgeCount = rooms.filter((r) => {
    if (r.isStaffHouse || r.roomType === 'Staff House' || String(r.number) === '12') return false;
    if ((r.state === 'occupied' || r.state === 'overdue') && r.checkOutTime) {
      const diffMins = (new Date(r.checkOutTime).getTime() - nowForBadge) / 60000;
      return diffMins <= 15;
    }
    return false;
  }).length;
  const totalNotificationBadgeCount = urgentRoomsBadgeCount + Object.keys(snoozedAlarms).length;

  return (
    <div className="min-h-screen bg-cream flex flex-col font-sans selection:bg-secondary selection:text-primary">
      {/* Dynamic Header Component */}
      <Header
        activeTab={activeTab}
        setActiveTab={(tab) => {
          setActiveTab(tab);
          // Auto close sidebar when navigating screens
          setSelectedRoomNumber(null);
        }}
        activeCashier={activeCashier}
        setActiveCashier={setActiveCashier}
        onLogout={handleLogout}
        loggedInUser={loggedInUser}
        pendingForceCheckoutCount={pendingForceCheckoutCount}
        notificationCount={totalNotificationBadgeCount}
        onOpenForceCheckoutManager={() => setIsForceCheckoutManagerOpen(true)}
        onOpenLaunchAnimation={() => setIsLaunchAnimationOpen(true)}
      />

      {/* Active Alarms Notification Banner & Snooze Bar */}
      <AnimatePresence>
        {activeAlarms.length > 0 ? (
          <motion.div
            key="active-alarm-banner"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-red-600 text-white shadow-lg relative z-40 overflow-hidden"
          >
            <div className="max-w-7xl mx-auto px-6 py-3.5 flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="flex h-3 w-3 relative shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-white"></span>
                </span>
                <p className="font-display font-bold text-sm tracking-wide">
                  {activeAlarms[0].message}
                </p>
                {activeAlarms.length > 1 && (
                  <span className="bg-white/20 text-white text-[10px] font-mono font-extrabold px-2 py-0.5 rounded-full shrink-0">
                    +{activeAlarms.length - 1} more active
                  </span>
                )}
                {Object.keys(snoozedAlarms).length > 0 && (
                  <span className="bg-amber-400 text-amber-950 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full flex items-center gap-1 shrink-0">
                    <Clock size={11} /> {Object.keys(snoozedAlarms).length} Snoozed
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 flex-wrap shrink-0">
                <button
                  type="button"
                  onClick={() => playChime(activeAlarms[0].type)}
                  className="bg-white/15 hover:bg-white/25 text-white px-2.5 py-1.5 rounded-lg text-xs font-mono font-bold transition flex items-center gap-1 border border-white/20 cursor-pointer"
                  title="Replay Audio Chime"
                >
                  <Volume2 size={13} /> Replay
                </button>

                {/* Snooze 5 Minutes Primary Action */}
                <button
                  type="button"
                  id="snooze-5m-alarm-btn"
                  onClick={() => handleSnoozeAlarm(activeAlarms[0], 5)}
                  className="bg-amber-400 hover:bg-amber-300 text-amber-950 px-3.5 py-1.5 rounded-lg text-xs font-mono font-black transition shadow-sm cursor-pointer flex items-center gap-1.5 active:scale-95"
                  title="Snooze this alert for 5 minutes"
                >
                  <Clock size={13} /> Snooze 5m
                </button>

                {/* Snooze 10 Minutes Secondary Action */}
                <button
                  type="button"
                  onClick={() => handleSnoozeAlarm(activeAlarms[0], 10)}
                  className="bg-amber-500/80 hover:bg-amber-400 text-amber-950 px-2.5 py-1.5 rounded-lg text-xs font-mono font-bold transition shadow-sm cursor-pointer flex items-center gap-1 active:scale-95"
                  title="Snooze this alert for 10 minutes"
                >
                  10m
                </button>

                {/* Dismiss Action */}
                <button
                  type="button"
                  onClick={() => {
                    stopAlarm();
                    setActiveAlarms((prev) => prev.filter((a) => a.id !== activeAlarms[0].id));
                  }}
                  className="bg-white text-red-700 hover:bg-red-50 px-3.5 py-1.5 rounded-lg text-xs font-extrabold transition shadow-sm cursor-pointer"
                >
                  Dismiss / Acknowledge
                </button>
              </div>
            </div>
          </motion.div>
        ) : Object.keys(snoozedAlarms).length > 0 ? (
          <motion.div
            key="snoozed-alarms-bar"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-amber-500 text-amber-950 shadow-md relative z-40 overflow-hidden border-b border-amber-600/30"
          >
            <div className="max-w-7xl mx-auto px-6 py-2 flex items-center justify-between gap-4 text-xs font-mono">
              <div className="flex items-center gap-2 overflow-x-auto py-0.5">
                <BellOff size={14} className="shrink-0 text-amber-950" />
                <span className="font-bold uppercase tracking-wider shrink-0 text-[11px]">Snoozed Alerts ({Object.keys(snoozedAlarms).length}):</span>
                {(Object.entries(snoozedAlarms) as [string, SnoozedAlarmItem][]).map(([key, alarm]) => {
                  const remainingSecs = Math.max(0, Math.ceil((alarm.snoozedUntil - Date.now()) / 1000));
                  const mins = Math.floor(remainingSecs / 60);
                  const secs = remainingSecs % 60;
                  return (
                    <div key={key} className="bg-amber-600/20 px-2.5 py-0.5 rounded-md border border-amber-600/30 flex items-center gap-2 whitespace-nowrap text-[11px]">
                      <span>Apt {alarm.roomNumber} ({alarm.type})</span>
                      <span className="font-bold text-amber-950 bg-amber-200/80 px-1.5 py-0.2 rounded font-mono">
                        {mins}m {secs < 10 ? `0${secs}` : secs}s
                      </span>
                      <button
                        type="button"
                        onClick={() => handleWakeSnoozedAlarm(key)}
                        className="text-[10px] text-amber-950 underline hover:text-white font-bold cursor-pointer ml-1"
                      >
                        Wake Now
                      </button>
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => setSnoozedAlarms({})}
                className="bg-amber-950 text-amber-100 hover:bg-amber-900 px-2.5 py-1 rounded text-[10px] font-bold shrink-0 cursor-pointer"
              >
                Clear Snoozes
              </button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Database connection banner — checkout/checkin require the API */}
      {apiError && !isCustomerDisplayView && (
        <div className="bg-rose-700 text-white px-6 py-2.5 text-center text-xs font-mono font-bold">
          ⚠️ Database offline: {apiError} Changes will revert on reload.
        </div>
      )}

      {/* Primary Workspace Stage */}
      <main className="flex-1 p-6 md:p-8 max-w-7xl w-full mx-auto">
        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' && (
            <motion.div
              key="dashboard"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25 }}
              className="flex flex-col gap-6"
            >
              {/* Grand Station Time, Date & Operations Hub */}
              <DateTimeDisplay variant="banner" className="w-full" />

              <div className="flex flex-col-reverse lg:flex-row gap-6 items-start">
                {/* Interactive filter and statistics side strip */}
                <Sidebar
                  rooms={rooms}
                  selectedStatusFilter={selectedStatusFilter}
                  setSelectedStatusFilter={setSelectedStatusFilter}
                />

              {/* Grid block displaying the rooms layout */}
              <div className="flex-1 w-full flex flex-col gap-6">
                <div className="flex justify-between items-center bg-white px-5 py-4 rounded-2xl border border-secondary shadow-sm">
                  <div>
                    <h2 className="font-display font-black text-base text-primary uppercase tracking-tight">
                      Frontdesk Apartment Occupancy Grid
                    </h2>
                    <p className="text-[10px] uppercase font-mono tracking-wider text-charcoal/40 mt-0.5">
                      Interactive Apartment Board &bull; click any card to check in/out
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Direct Quick-jump to Notifications Center */}
                    <button
                      type="button"
                      onClick={() => setActiveTab('notifications')}
                      className={`px-3 py-1.5 rounded-xl font-mono text-xs font-bold transition border flex items-center gap-1.5 cursor-pointer shadow-2xs ${
                        totalNotificationBadgeCount > 0
                          ? 'bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-200 animate-pulse'
                          : 'bg-[#F2EEE9]/80 hover:bg-white text-charcoal/70 border-[#E1DAD0]'
                      }`}
                      title="Open Live Notifications & Room Alerts Center"
                    >
                      <Bell size={13} className={totalNotificationBadgeCount > 0 ? 'text-rose-600' : 'text-charcoal/50'} />
                      <span>Alerts</span>
                      {totalNotificationBadgeCount > 0 && (
                        <span className="px-1.5 py-0.2 rounded-full text-[9px] font-mono font-black bg-rose-600 text-white">
                          {totalNotificationBadgeCount}
                        </span>
                      )}
                    </button>

                    {/* Database Reset Option */}
                    {(role === 'admin' || role === 'owner') && (
                      <button
                        onClick={handleResetDatabase}
                        title="Reset state to clean defaults"
                        className="p-1.5 hover:bg-amber-50 text-charcoal/60 hover:text-amber-800 rounded-lg transition border border-secondary/40 hover:border-amber-300 cursor-pointer flex items-center gap-1 text-[10px] font-mono font-bold"
                      >
                        <RefreshCw size={11} /> Reset Board
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex gap-6 items-start">
                  <RoomGrid
                    rooms={rooms}
                    selectedStatusFilter={selectedStatusFilter}
                    onSelectRoom={(room) => setSelectedRoomNumber(room.number)}
                    onClearFilter={() => setSelectedStatusFilter('all')}
                  />
                </div>
              </div>
            </div>
          </motion.div>
        )}

          {activeTab === 'notifications' && (
            <motion.div
              key="notifications"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25 }}
            >
              <NotificationsCenter
                rooms={rooms}
                activeAlarms={activeAlarms}
                snoozedAlarms={snoozedAlarms}
                notificationHistory={notificationHistory}
                onSelectRoom={(roomNumber) => setSelectedRoomNumber(roomNumber)}
                onSnoozeAlarm={handleSnoozeAlarm}
                onWakeSnoozedAlarm={handleWakeSnoozedAlarm}
                onDismissAlarm={(id) => {
                  stopAlarm();
                  setActiveAlarms((prev) => prev.filter((a) => a.id !== id));
                }}
                onClearAllSnoozes={() => setSnoozedAlarms({})}
                onClearHistory={() => setNotificationHistory([])}
                onBackToDashboard={() => setActiveTab('dashboard')}
              />
            </motion.div>
          )}

          {activeTab === 'bookings' && (
            <motion.div
              key="bookings"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25 }}
            >
              <BookingCalendar
                rooms={rooms}
                bookings={bookings}
                onAddBooking={handleAddBooking}
                onCancelBooking={handleCancelBooking}
                onCheckInBooking={handleCheckInBooking}
              />
            </motion.div>
          )}

          {activeTab === 'ledger' && (
            <motion.div
              key="ledger"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25 }}
            >
              <TransactionLedger
                receipts={sessionReceipts}
                onRefreshReceipts={handleRefreshReceipts}
                onViewReceipt={(receipt) => {
                  setLastReceipt(receipt);
                  setActiveTab('receipt-preview');
                }}
                loggedInUser={loggedInUser}
                userRole={role}
              />
            </motion.div>
          )}

          {activeTab === 'pos' && (
            <motion.div
              key="pos"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25 }}
            >
              <POSCatalog
                rooms={rooms}
                activeCashier={activeCashier}
                billableServices={billableServices}
                onUpdateRoom={handleUpdateRoom}
                onGenerateReceipt={handleGenerateReceipt}
                onPostPOSOrderDirect={handlePostPOSOrderDirect}
                loggedInUser={loggedInUser}
              />
            </motion.div>
          )}

          {activeTab === 'reports' && (
            <motion.div
              key="reports"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25 }}
            >
              <ReportsPanel
                additionalPOSRevenue={additionalPOSRevenue}
                additionalPOSCategoryRevenue={additionalPOSCategoryRevenue}
                sessionReceipts={sessionReceipts}
                rooms={rooms}
                loggedInUser={loggedInUser}
              />
            </motion.div>
          )}

          {activeTab === 'weekly-reports' && (role === 'admin' || role === 'owner') && (
            <motion.div
              key="weekly-reports"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25 }}
            >
              <WeeklyReportManager />
            </motion.div>
          )}

          {activeTab === 'kitchen-tv' && (
            <motion.div
              key="kitchen-tv"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25 }}
              className="fixed inset-0 z-50"
            >
              <KitchenTVDisplay onClose={() => setActiveTab('kitchen-view')} />
            </motion.div>
          )}

          {activeTab === 'kitchen-view' && (
            <motion.div
              key="kitchen-view"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25 }}
            >
              <KitchenStaffView
                loggedInUser={loggedInUser}
                onSwitchToTV={() => setActiveTab('kitchen-tv')}
              />
            </motion.div>
          )}

          {activeTab === 'receipt-preview' && (
            <motion.div
              key="receipt-preview"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25 }}
            >
              <ReceiptPreview
                receipt={lastReceipt}
                onClose={() => {
                  setLastReceipt(null);
                  setActiveTab('dashboard');
                }}
              />
            </motion.div>
          )}



          {activeTab === 'shift-settlement' && (
            <motion.div
              key="shift-settlement"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25 }}
            >
              <CashierShiftSettlement activeCashier={activeCashier} />
            </motion.div>
          )}

          {activeTab === 'settings' && (
            <motion.div
              key="settings"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25 }}
            >
              <SettingsPanel
                billableServices={billableServices}
                auditLogs={auditLogs}
                role={(role || 'cashier') as any}
                onAddService={handleAddService}
                onUpdateService={handleUpdateService}
                onDeleteService={handleDeleteService}
                loggedInUser={loggedInUser}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Global Slide-out detail drawer with backdrop overlay */}
        <AnimatePresence>
          {selectedRoom && (
            <>
              {/* Backdrop overlay — click to close sidebar */}
              <motion.div
                key="sidebar-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 bg-black/20 backdrop-blur-[1px] z-40"
                onClick={() => setSelectedRoomNumber(null)}
              />
              <RoomDetailSidebar
                room={selectedRoom}
                onClose={() => setSelectedRoomNumber(null)}
                onUpdateRoom={handleUpdateRoom}
                onGenerateReceipt={handleGenerateReceipt}
                activeCashier={activeCashier}
                loggedInUser={loggedInUser}
                billableServices={billableServices}
                allRooms={rooms}
                onTransferSuccess={(sourceRoom, targetRoom) => {
                  setRooms(prev => prev.map(r => {
                    if (r.number === sourceRoom.number) return sourceRoom;
                    if (r.number === targetRoom.number) return targetRoom;
                    return r;
                  }));
                  setSelectedRoomNumber(targetRoom.number);
                  writeAuditLog(
                    'ROOM_TRANSFER',
                    `Transferred Guest "${targetRoom.guestName || 'Guest'}" from Room ${sourceRoom.number} to Room ${targetRoom.number}`
                  );
                }}
              />
            </>
          )}
        </AnimatePresence>
      </main>

      {/* Global Bottom Credit Bar */}
      <footer className="bg-white border-t border-secondary/40 py-4 px-6 mt-12 text-center text-[10px] font-mono text-charcoal/40 tracking-widest uppercase">
        Sedona Court Executive Property Management Dashboard &bull; Station FD-01 Core Terminal
      </footer>

      {/* Shift Handoff Verification Modal Overlay */}
      <AnimatePresence>
        {isHandoffOpen && role === 'cashier' && (
          <ShiftHandoff
            rooms={rooms}
            activeCashier={activeCashier}
            sessionReceipts={sessionReceipts}
            pendingTasks={pendingTasks}
            onToggleTask={handleToggleTask}
            onAddTask={handleAddTask}
            onDeleteTask={handleDeleteTask}
            onClose={() => setIsHandoffOpen(false)}
            onConfirmLogout={handleConfirmLogout}
          />
        )}
      </AnimatePresence>

      {/* Admin Force Check-Out Review & Approval Manager */}
      <AdminForceCheckoutManager
        isOpen={isForceCheckoutManagerOpen}
        onClose={() => {
          setIsForceCheckoutManagerOpen(false);
          handleRefreshForceCheckoutRequests();
        }}
        onRefreshRooms={async () => {
          try {
            const freshRooms = await getRooms();
            const requests = await getForceCheckoutRequests('pending').catch(() => []);
            setPendingForceCheckoutCount(requests.length);
            const pendingRoomNumbers = new Set(requests.map(r => r.roomNumber));
            setRooms(freshRooms.map(rm => ({
              ...rm,
              forceCheckoutPending: pendingRoomNumbers.has(rm.number),
            })));
          } catch (err) {
            console.warn('Error refreshing rooms:', err);
          }
        }}
        activeAdminUser={loggedInUser}
      />

      {/* Launch Animation Cinematic Modal Overlay */}
      <AnimatePresence>
        {isLaunchAnimationOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md flex items-center justify-center p-4 sm:p-6"
          >
            <div className="relative w-full max-w-5xl bg-black rounded-3xl overflow-hidden shadow-2xl border border-white/10">
              <button
                onClick={() => setIsLaunchAnimationOpen(false)}
                className="absolute top-4 right-4 z-50 p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition cursor-pointer backdrop-blur-sm"
                title="Close Animation"
              >
                <X size={18} />
              </button>
              <LaunchAnimation
                onComplete={() => setIsLaunchAnimationOpen(false)}
                autoClose={false}
                showControls={true}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Global Confirm Dialog */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmLabel={confirmDialog.confirmLabel}
        variant={confirmDialog.variant}
        onConfirm={confirmDialog.onConfirm}
        onCancel={closeConfirm}
      />
    </div>
  );
}
