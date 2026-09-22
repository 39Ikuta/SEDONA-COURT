# Kitchen TV Display System - Implementation Plan

## 🎯 Project Goal

Create a **read-only TV display** for the kitchen showing real-time orders with room assignments and inventory monitoring. Kitchen staff view what to cook on a large screen, while all control (status updates, inventory management) happens from cashier/admin terminals.

**Key Design Decision**: 
- Kitchen role = **VIEW ONLY** (no mouse/keyboard interaction)
- Display optimized for large TV screens (40-55 inches)
- Auto-refreshing, self-updating display
- All actions performed by cashiers/admins at their stations

---

## 📋 System Overview

### **Core Features**

1. **Kitchen TV Display (Read-Only)**
   - Full-screen display of active orders
   - Shows: Order number, room, guest, items, time elapsed
   - Color-coded by urgency (green → yellow → red)
   - Auto-updates every 2 seconds via WebSocket
   - Large fonts readable from 10+ feet away
   - Audio chime when new orders arrive
   - No buttons, no interaction needed

2. **Cashier/Admin Control Panel**
   - Manage order lifecycle from their POS terminal
   - Update order status: New → Preparing → Ready → Delivered
   - View same orders as kitchen (but with controls)
   - Manage inventory intake/outtake
   - Generate reports

3. **Inventory Management (Admin Only)**
   - Track stock levels for ingredients
   - Intake (receiving stock) with batch tracking
   - Auto-deduct inventory when orders marked "preparing"
   - Low stock alerts on admin dashboard
   - Reports and analytics

4. **Recipe Management (Admin Only)**
   - Define ingredient requirements per menu item
   - Auto-calculate inventory impact
   - Cost tracking per dish

---

## 🗄️ Database Schema (Same as before)

All tables remain the same:
- `kitchen_orders` - Order tracking
- `inventory_items` - Stock tracking
- `inventory_transactions` - Intake/outtake history
- `recipe_ingredients` - Menu item → ingredient mapping
- `stock_alerts` - Low stock notifications

*(See KITCHEN_SYSTEM_PLAN.md for full schema)*

---

## 🎨 Frontend UI Design

### **Kitchen TV Display (Read-Only, Full Screen)**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│                     🍳 SEDONA COURT KITCHEN ORDERS                           │
│                                                                              │
│                           [12:34:56 PM]                                      │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   PENDING ORDERS (3)                    PREPARING (2)                        │
│                                                                              │
│   ┌─────────────────────────────────┐   ┌─────────────────────────────────┐ │
│   │ 🔴 K-0042  [URGENT]             │   │ 🟡 K-0039                       │ │
│   │                                 │   │                                 │ │
│   │ 📍 Room 14                      │   │ 📍 Room 22                      │ │
│   │ 👤 Dela Cruz, K.                │   │ 👤 Roxas, M.                    │ │
│   │                                 │   │                                 │ │
│   │ ⏱️  15 minutes ago               │   │ ⏱️  8 minutes ago                │ │
│   │                                 │   │                                 │ │
│   │ 📋 ORDER:                       │   │ 📋 ORDER:                       │ │
│   │   • Silog Special      x2       │   │   • Clubhouse Sandwich  x1      │ │
│   │   • Brewed Coffee      x2       │   │   • Fresh Mango Shake   x1      │ │
│   │   • Extra Rice         x1       │   │                                 │ │
│   │                                 │   │ 📝 Note: No onions              │ │
│   │ 📝 Special: Extra garlic rice   │   │                                 │ │
│   └─────────────────────────────────┘   └─────────────────────────────────┘ │
│                                                                              │
│   ┌─────────────────────────────────┐   ┌─────────────────────────────────┐ │
│   │ 🟢 K-0043                       │   │ 🟡 K-0040                       │ │
│   │                                 │   │                                 │ │
│   │ 📍 Room 18                      │   │ 📍 Room 2                       │ │
│   │ 👤 Aquino, B.                   │   │ 👤 Marcos, F.                   │ │
│   │                                 │   │                                 │ │
│   │ ⏱️  2 minutes ago                │   │ ⏱️  5 minutes ago                │ │
│   │                                 │   │                                 │ │
│   │ 📋 ORDER:                       │   │ 📋 ORDER:                       │ │
│   │   • Pancit Guisado     x1       │   │   • San Miguel Pale     x6      │ │
│   │   • San Miguel Pale    x4       │   │   • Fresh Mango Shake   x2      │ │
│   └─────────────────────────────────┘   └─────────────────────────────────┘ │
│                                                                              │
│   ┌─────────────────────────────────┐                                       │
│   │ 🟢 K-0044                       │                                       │
│   │ 📍 Room 5  👤 Ramos, J.          │                                       │
│   │ ⏱️  Just now                     │                                       │
│   │ • Clubhouse Sandwich    x1      │                                       │
│   └─────────────────────────────────┘                                       │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ⚠️  LOW STOCK ALERTS:  🥩 Beef (5kg) | 🧃 San Miguel (8 btls)              │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘

[🔄 Auto-updating every 2 seconds]
```

**Design Features**:
- **Large text**: 24-36px fonts (readable from 10+ feet)
- **Color coding**: 
  - 🔴 Red: >10 minutes old (URGENT)
  - 🟡 Yellow: 5-10 minutes old (ATTENTION)
  - 🟢 Green: <5 minutes old (NEW)
- **No buttons**: Pure display, no interaction
- **Auto-scroll**: If more than 6 orders, gentle auto-scroll
- **Audio**: Chime sound on new order
- **Full screen**: No browser chrome, just content

### **Cashier Order Management Panel (Interactive)**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  🍽️ ORDER MANAGEMENT                                         👤 ann [Close]  │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Active Orders (5)  |  History (23 today)  |  Kitchen View                  │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Order #      Room    Guest           Items  Status      Time      Actions  │
│  ────────────────────────────────────────────────────────────────────────── │
│  K-0042       14      Dela Cruz, K.   3      🆕 New       15m     [▶️ Start] │
│  K-0043       18      Aquino, B.      2      🆕 New       2m      [▶️ Start] │
│  K-0044       5       Ramos, J.       1      🆕 New       0m      [▶️ Start] │
│  K-0039       22      Roxas, M.       2      ⏳ Preparing 8m      [✅ Ready] │
│  K-0040       2       Marcos, F.      2      ⏳ Preparing 5m      [✅ Ready] │
│                                                                              │
│  [+ New Order]                                               [View Kitchen]  │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘

Order Details Panel (when row clicked):
┌─────────────────────────────────────────┐
│ Order K-0042                            │
│ Room 14 - Dela Cruz, K.                 │
│ Ordered: 12:19 PM (15 minutes ago)      │
├─────────────────────────────────────────┤
│ Items:                                  │
│  • Silog Special      x2  ₱ 370.00     │
│  • Brewed Coffee      x2  ₱ 170.00     │
│  • Extra Rice         x1  ₱  30.00     │
│                                         │
│ Total: ₱ 570.00                         │
│                                         │
│ Special Instructions:                   │
│ Extra garlic on rice                    │
├─────────────────────────────────────────┤
│ Status: 🆕 New                          │
│                                         │
│ Actions:                                │
│ [Start Preparing]  [Cancel Order]       │
└─────────────────────────────────────────┘
```

### **Admin Inventory Dashboard (Interactive)**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  📦 INVENTORY MANAGEMENT                                                     │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Item Name              Stock    Unit   Min   Status       Actions          │
│  ─────────────────────────────────────────────────────────────────────────  │
│  🥩 Beef (Tapa)         5.2 kg   kg     10    ⚠️ Low       [+ Intake]       │
│  🍚 Rice (Jasmine)      45.0 kg  kg     20    ✅ Good      [View]           │
│  🥚 Eggs (Large)        120 pcs  pcs    50    ✅ Good      [View]           │
│  🧃 San Miguel Pale     8 btls   btls   24    🚨 Critical  [+ Intake]       │
│  🥭 Mangoes             2.5 kg   kg     5     ⚠️ Low       [+ Intake]       │
│                                                                              │
│  [+ Add Item]  [📥 Record Intake]  [📊 Reports]  [🔧 Recipes]               │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔄 System Workflow (Updated for TV Display)

### **Order Flow**

```
1. CASHIER CREATES ORDER (POS Terminal)
   ├─ Guest orders food at front desk
   ├─ Items added to receipt
   └─ Click "Send to Kitchen"

2. SYSTEM CREATES KITCHEN ORDER
   ├─ Auto-generate order number (K-####)
   ├─ Status: "new"
   ├─ Parse items from receipt/POS
   └─ WebSocket broadcast to kitchen TV

3. KITCHEN TV DISPLAYS ORDER (Auto)
   ├─ 🔔 Audio chime plays
   ├─ Order appears on TV in "PENDING" section
   ├─ Shows: Room, Guest, Items, Timer
   └─ Color: 🟢 Green (new)

4. CASHIER MARKS "PREPARING" (When Kitchen Starts)
   ├─ Cashier clicks [Start Preparing] on their terminal
   ├─ Status: "preparing"
   ├─ Kitchen TV updates: Order moves to "PREPARING" column
   ├─ Color changes: 🟡 Yellow
   ├─ Timer continues
   └─ Inventory auto-deducted (if recipes configured)

5. CASHIER MARKS "READY" (When Kitchen Signals)
   ├─ Kitchen staff verbally tells cashier "Order K-0042 ready"
   ├─ Cashier clicks [Mark Ready]
   ├─ Status: "ready"
   ├─ Kitchen TV: Order moves to "READY" section (or disappears)
   └─ Order queued for delivery

6. CASHIER MARKS "DELIVERED" (After Room Delivery)
   ├─ Staff delivers to guest room
   ├─ Cashier clicks [Mark Delivered]
   ├─ Status: "delivered"
   └─ Order removed from Kitchen TV display

KITCHEN STAFF WORKFLOW:
├─ Glance at TV screen
├─ See new orders in PENDING column
├─ Start cooking (no button press needed)
├─ Verbally tell cashier when starting/ready
└─ Cashier updates system from their terminal
```

### **Kitchen Staff Perspective**

**What they see**: Large TV showing orders  
**What they do**: 
1. Look at screen
2. Cook the orders shown
3. Tell cashier "K-0042 ready!" when done

**What they DON'T do**:
- No touching screens
- No logging into system
- No button clicks
- No keyboard/mouse

---

## 🛠️ Technical Implementation

### **Backend API Endpoints**

```typescript
// Kitchen Orders
GET    /api/kitchen/orders              // Get all active orders (for TV)
GET    /api/kitchen/orders/:id          // Get specific order details
POST   /api/kitchen/orders              // Create order (from POS)
PUT    /api/kitchen/orders/:id/status   // Update status (cashier/admin only)
DELETE /api/kitchen/orders/:id          // Cancel order (admin only)

// Kitchen TV specific
GET    /api/kitchen/tv/display          // Optimized endpoint for TV display
                                         // Returns: active orders + low stock alerts
```

### **WebSocket Events**

```typescript
// Kitchen TV listens to these events:
socket.on('kitchen:new_order', (order) => {
  // Play chime sound
  // Add order to display
  // Highlight as new
});

socket.on('kitchen:order_updated', (order) => {
  // Update order status on display
  // Move to appropriate column
  // Update timer color
});

socket.on('kitchen:order_completed', (orderId) => {
  // Remove order from display
  // Play success sound (optional)
});

socket.on('inventory:low_stock', (alert) => {
  // Show alert banner at bottom
  // Update stock alert section
});
```

### **Kitchen TV Component**

```typescript
// KitchenTVDisplay.tsx
export const KitchenTVDisplay = () => {
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [alerts, setAlerts] = useState<StockAlert[]>([]);
  const audioRef = useRef<HTMLAudioElement>(null);

  // WebSocket connection
  useEffect(() => {
    const socket = io();
    
    socket.on('kitchen:new_order', (order) => {
      setOrders(prev => [order, ...prev]);
      audioRef.current?.play(); // Chime sound
    });

    socket.on('kitchen:order_updated', (updatedOrder) => {
      setOrders(prev => prev.map(o => 
        o.id === updatedOrder.id ? updatedOrder : o
      ));
    });

    socket.on('kitchen:order_completed', (orderId) => {
      setOrders(prev => prev.filter(o => o.id !== orderId));
    });

    socket.on('inventory:low_stock', (alert) => {
      setAlerts(prev => [...prev, alert]);
    });

    return () => socket.disconnect();
  }, []);

  // Auto-refresh fallback (in case WebSocket drops)
  useEffect(() => {
    const interval = setInterval(async () => {
      const response = await fetch('/api/kitchen/tv/display');
      const data = await response.json();
      setOrders(data.orders);
      setAlerts(data.alerts);
    }, 5000); // Every 5 seconds

    return () => clearInterval(interval);
  }, []);

  // Group orders by status
  const pendingOrders = orders.filter(o => o.status === 'new');
  const preparingOrders = orders.filter(o => o.status === 'preparing');

  return (
    <div className="h-screen w-screen bg-gray-900 text-white overflow-hidden">
      {/* Audio element for chime */}
      <audio ref={audioRef} src="/sounds/kitchen-chime.mp3" />

      {/* Header */}
      <header className="bg-primary py-6 text-center">
        <h1 className="text-5xl font-bold">🍳 SEDONA COURT KITCHEN ORDERS</h1>
        <p className="text-2xl mt-2">{new Date().toLocaleTimeString()}</p>
      </header>

      {/* Main display area */}
      <div className="grid grid-cols-2 gap-8 p-8 h-[calc(100vh-200px)]">
        {/* Pending column */}
        <OrderColumn 
          title="PENDING ORDERS"
          orders={pendingOrders}
          colorScheme="green"
        />

        {/* Preparing column */}
        <OrderColumn 
          title="PREPARING"
          orders={preparingOrders}
          colorScheme="yellow"
        />
      </div>

      {/* Low stock alerts footer */}
      {alerts.length > 0 && (
        <footer className="bg-red-600 py-4 px-8 text-xl">
          ⚠️ LOW STOCK ALERTS: {alerts.map(a => a.item_name).join(' | ')}
        </footer>
      )}
    </div>
  );
};
```

---

## 🎯 Implementation Phases (Simplified)

### **Phase 1: Kitchen TV Display (Week 1)**
- ✅ Create kitchen_orders table
- ✅ API endpoints for creating/updating orders
- ✅ Kitchen TV display component (read-only)
- ✅ WebSocket integration
- ✅ Audio notifications
- ✅ Auto-refresh fallback

### **Phase 2: Cashier Control Panel (Week 2)**
- ✅ Order management UI for cashiers
- ✅ Status update buttons
- ✅ Integration with existing POS/receipt flow
- ✅ Order creation from POS

### **Phase 3: Basic Inventory (Week 3)**
- ✅ Inventory items table
- ✅ Admin inventory management UI
- ✅ Stock intake form
- ✅ Low stock alerts on Kitchen TV

### **Phase 4: Recipe & Auto-Deduction (Week 4)**
- ✅ Recipe ingredients table
- ✅ Link menu items to ingredients
- ✅ Auto-deduct inventory when order marked "preparing"
- ✅ Inventory transaction logging

### **Phase 5: Polish & Testing (Week 5)**
- ✅ Large screen optimization
- ✅ Performance testing
- ✅ TV mounting and setup
- ✅ Staff training

---

## 📺 TV Setup Recommendations

### **Hardware**
- **TV Size**: 40-55 inch screen
- **Mounting**: Wall-mounted at kitchen eye level
- **Device**: Small PC/Mini PC or Raspberry Pi 4
- **Network**: Wired Ethernet (more reliable than WiFi)
- **Power**: UPS backup (prevent disruption)

### **Software Setup**
1. Boot PC directly to browser (kiosk mode)
2. Navigate to: `http://localhost:3000/kitchen-tv`
3. Press F11 for full-screen
4. Disable screen saver
5. Auto-start on boot

### **Browser Kiosk Mode**
```bash
# Chrome kiosk mode (Windows)
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --app=http://localhost:3000/kitchen-tv

# Prevent sleep
powercfg /change standby-timeout-ac 0
powercfg /change monitor-timeout-ac 0
```

---

## 🔐 Security & Access Control (Updated)

### **Role-Based Access**

| Feature | Kitchen (TV) | Cashier | Admin | Owner |
|---------|-------------|---------|-------|-------|
| View Kitchen Orders | ✅ (Read-Only) | ✅ | ✅ | ✅ |
| Create Orders | ❌ | ✅ | ✅ | ✅ |
| Update Order Status | ❌ | ✅ | ✅ | ✅ |
| Cancel Orders | ❌ | ❌ | ✅ | ✅ |
| View Inventory | ✅ (Alerts only) | ❌ | ✅ | ✅ |
| Manage Inventory | ❌ | ❌ | ✅ | ✅ |
| View Reports | ❌ | ❌ | ✅ | ✅ |

**Kitchen TV = No login required** (public display URL)

---

## 🎨 UI/UX Principles (Updated for TV)

1. **Extra Large Text**
   - Minimum 24px for body text
   - 36-48px for order numbers
   - 64px for headers
   - Readable from 10-15 feet away

2. **High Contrast**
   - Dark background (gray/black)
   - White text
   - Color accents (green/yellow/red)
   - No subtle grays

3. **Minimal Animation**
   - Smooth transitions only
   - No distracting effects
   - Focus on content, not style

4. **Grid Layout**
   - 2 columns max
   - 3-4 orders visible per column
   - Auto-scroll if more orders

5. **Timer Display**
   - Always visible
   - Updates every second
   - Color changes: Green → Yellow → Red

---

## 📱 Mobile Access (Bonus)

Kitchen staff can also optionally check orders on mobile:
- Navigate to `/kitchen-tv` on phone
- Same display, mobile-optimized
- Still read-only
- Useful if TV is blocked or broken

---

## ✅ Success Criteria

- **Visibility**: All orders visible within 2 seconds
- **Accuracy**: 100% order display accuracy
- **Uptime**: 99.9% display availability
- **Response Time**: <500ms WebSocket updates
- **Readability**: Text readable from 15 feet
- **Audio**: Chime audible across kitchen

---

## 📝 Next Steps

1. ✅ Get TV hardware and mounting bracket
2. ✅ Set up dedicated display PC/device
3. ✅ Begin Phase 1: Kitchen TV Display
4. ✅ Test with mock orders
5. ✅ Train cashiers on order management
6. ✅ Go live with kitchen staff feedback loop

---

**Estimated Timeline**: 3-4 weeks for core system  
**Estimated Effort**: 80-100 development hours  
**Hardware Cost**: $300-500 (TV + Mini PC + mounting)

---

Ready to start implementation? 🚀
