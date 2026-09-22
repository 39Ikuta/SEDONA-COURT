# Sedona Court Travellers Inn — Property Management System (PMS)
## Comprehensive Technical & Product Specification Document

---

## 1. Executive Summary

The Sedona Court Travellers Inn Property Management System (PMS) is a purpose-built, full-service hospitality operations and front-desk software platform engineered specifically for the 32-room Sedona Court Travellers Inn in the Philippines. The product unifies all daily lodge operations into a synchronized, real-time web application: live room occupancy tracking across three physical floors, walk-in check-in and checkout processing with time-based rate tiers, advance reservation scheduling, point-of-sale (POS) dining and amenity billing, automated kitchen order dispatch, cashier shift turnovers, and weekly financial remittances. Built to eliminate manual record-keeping errors and prevent revenue leakage, the system automatically aggregates guest bills into shift summaries, enforces strict supervisory controls over unpaid stays, tracks mobile payments alongside cash floats, and generates management-ready financial reports and Excel exports directly from verified front-desk transactions.

---

## 2. Core Features

The system's user-facing capabilities are organized into nine modular functional domains. Each capability has been verified against active source code in the repository.

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│                       SEDONA COURT PMS — FUNCTIONAL MODULES                       │
├──────────────────────┬──────────────────────┬─────────────────────────────────────┤
│ 1. Front Desk & Rooms│ 4. Kitchen Orders &  │ 7. Shift Handoff & Tasks            │
│    Management        │    TV Display        │                                     │
├──────────────────────┼──────────────────────┼─────────────────────────────────────┤
│ 2. Booking Calendar  │ 5. Billing, Invoices │ 8. Executive Analytics &            │
│    & Reservations    │    & Checkout        │    Audit Logging                    │
├──────────────────────┼──────────────────────┼─────────────────────────────────────┤
│ 3. Point of Sale     │ 6. Force Check-Out   │ 9. Settings & Dynamic Pricing       │
│    (POS) & Catalog   │    & Loss Management │                                     │
└──────────────────────┴──────────────────────┴─────────────────────────────────────┘
```

### 2.1 Room Inventory & Front Desk Operations

| Capability | Description | User Roles | Implementation Source |
| :--- | :--- | :--- | :--- |
| **32-Room Visual Board** | Real-time interactive grid displaying all 32 physical property rooms organized by floor: Floor 1 (Rooms 1–5 VIP Suite, Rooms 6–11 Classic), Floor 2 (Room 12 Staff House, Rooms 13–26 Premium), Floor 3 (Rooms 27–32 Classic). | Cashier, Admin, Owner | `src/components/RoomGrid.tsx`<br>`src/data.ts` (lines 25–82) |
| **Room State Lifecycle** | Tracks five discrete operational states: `available` (green), `occupied` (red), `cleaning` (amber), `overdue` (purple), and `maintenance` (gray). State changes sync across all connected screens. | Cashier, Admin, Owner | `src/types.ts` (line 7)<br>`server/routes/rooms.ts` (`PUT /api/rooms/:number`) |
| **Walk-In Guest Check-In** | Captures guest full name, identification card number (Passport/Driver's License), headcount (pax), stay duration tier (`3h`, `6h`, `12h`, `24h`, `promo`), and check-in timestamp. Sets room to `occupied`. | Cashier, Admin, Owner | `src/components/room-detail/WalkInCheckIn.tsx`<br>`src/components/RoomDetailSidebar.tsx` |
| **Amenity & Surcharge Billing** | Dynamically calculates and attaches extra bedding (₱250/bed), extra towel sets (₱100/set), extra person charges (₱150/person beyond 2 guests), and excess hour charges (₱130/hr) directly to the active room folio. | Cashier, Admin, Owner | `src/components/room-detail/OccupiedRoomView.tsx`<br>`server/utils/pricing.ts` (lines 130–138) |
| **Live Stay Countdown & Overdue Transition** | A 1,000ms reactive timer loop calculates remaining stay hours/minutes. When `checkOutTime` passes, the system automatically flips the room state to `overdue` with a count-up timer (`+Xh Ym`). | Cashier, Admin, Owner | `src/App.tsx` (lines 307–355)<br>`src/utils/roomStatus.ts` |
| **Tiered Alarm Notifications** | Three-stage acoustic and visual chime alerts: 15-minute checkout warning, exact checkout expiration, and 15-minute overdue grace period violation. Includes 5-minute snooze and manual wake. | Cashier, Admin, Owner | `src/App.tsx` (lines 266–304, 363–380)<br>`src/utils/audio.ts`<br>`public/sounds/` |
| **Staff House Quarters (Room 12)** | Dedicated operational mode for Room 12 designated as permanent employee quarters. Disables lodging rental charges while allowing staff meals, beverages, and amenity charges to be logged and settled. | Cashier, Admin, Owner | `src/components/room-detail/StaffHouseView.tsx`<br>`src/data.ts` (lines 41–57) |
| **Operational Board Reset** | Administrative utility that purges active bookings, receipts, kitchen orders, tasks, shift reports, and resets all 32 rooms to clean seed defaults. | Admin, Owner only | `server/routes/rooms.ts` (`POST /api/rooms/reset`) |

### 2.2 Booking Calendar & Advance Reservations

| Capability | Description | User Roles | Implementation Source |
| :--- | :--- | :--- | :--- |
| **Reservation Calendar** | Monthly interactive calendar for viewing, scheduling, and rescheduling advance room bookings. | Cashier, Admin, Owner | `src/components/BookingCalendar.tsx`<br>`server/routes/bookings.ts` (`GET /api/bookings`) |
| **Booking Creation & Conflict Prevention** | Books specific rooms with guest credentials, rate tiers, and date ranges. Automatically queries database to prevent overlapping dates for the same room. | Cashier, Admin, Owner | `server/routes/bookings.ts` (`POST /api/bookings`) |
| **Reservation Check-In Conversion** | Converts an advance scheduled reservation (`scheduled`) into an active occupied room stay (`checked-in`), automatically transferring reservation data into the room folio. | Cashier, Admin, Owner | `server/routes/bookings.ts` (`PUT /api/bookings/:id`)<br>`src/components/BookingCalendar.tsx` |
| **Reservation Cancellation & Deletion** | Cancels or hard-deletes bookings with immediate WebSocket notification to all front-desk terminals. | Cashier, Admin, Owner | `server/routes/bookings.ts` (`DELETE /api/bookings/:id`) |

### 2.3 Point of Sale (POS) & Catalog Management

| Capability | Description | User Roles | Implementation Source |
| :--- | :--- | :--- | :--- |
| **Official Food & Drinks Catalog** | 51 official items categorized across **Breakfast** (Bangsilog, Porksilog, Chicksilog, Tapsilog, Longsilog, Hotsilog), **Favorites** (Calamares, Lechon Kawali, Chicharong Bulaklak, Buffalo Wings, Buttered Chicken\*, Garlic Chicken\*, Tokwa't Baboy\*, Sizzling Tofu\*, Sizzling Sisig with Egg\*, Sizzling Hotdog\*, Pancit Canton, Lomi, French Fries), **Kitchen Extras** (Plain Rice, Garlic Rice, Egg, Ice Bucket, Hot Water), **Drinks** (Coke/Coke Zero, Sprite/Royal, Pineapple Juice, C2 Apple, Mineral Water, Coffee, Milo, San Miguel Beer, San Mig Light, Redhorse), and **Miscellaneous** (Cup Noodles, Chips, Candies, Marlboro, Lighter, Condoms, Toiletries). | Cashier, Admin, Owner | `src/components/POSCatalog.tsx`<br>`src/data.ts` (`POS_CATALOG`, `DEFAULT_BILLABLE_SERVICES`) |
| **Kitchen Operating Schedule Enforcement** | Prominently displays kitchen operational rules: **Hot kitchen open 6:00 AM – 10:00 PM daily**; **Drinks & Miscellaneous available 24/7**. Visual status indicators guide front desk order placement. | Cashier, Admin, Owner | `src/components/POSCatalog.tsx`<br>`src/components/room-detail/RoomServicePanel.tsx` |
| **Charge to Room** | Room service ordering workflow that appends ordered dishes, drinks, and amenities directly into the active room's `charged_food` JSON array for settlement upon checkout. | Cashier, Admin, Owner | `src/components/room-detail/RoomServicePanel.tsx`<br>`src/components/RoomDetailSidebar.tsx` |
| **Direct Walk-In POS Sales** | Standalone retail POS cart and checkout workflow for non-lodging walk-in customers purchasing food, drinks, or sundries directly at the front desk. | Cashier, Admin, Owner | `src/components/POSCatalog.tsx` |
| **Daily Category Sales Aggregation** | Aggregates daily point-of-sale revenues broken down into kitchen (Breakfast, Favorites, Kitchen Extras), beverages (Drinks), and miscellaneous retail categories. | Cashier, Admin, Owner | `server/routes/pos-revenue.ts` (`GET/POST /api/pos-revenue/add`) |

### 2.4 Kitchen Order Management & TV Display

| Capability | Description | User Roles | Implementation Source |
| :--- | :--- | :--- | :--- |
| **Read-Only Kitchen TV Display** | High-contrast, full-screen display designed for wall-mounted 40–55" kitchen screens. Displays pending and preparing orders grouped by room, itemized order lines, special instructions, elapsed timers, and urgency color codes (Green <5m, Yellow 5–10m, Red >10m). | Kitchen, Cashier, Admin, Owner (View only) | `src/components/KitchenTVDisplay.tsx`<br>`server/routes/kitchen.ts` (`GET /api/kitchen/tv/display`) |
| **Real-Time Audio Order Chime** | Plays an audible kitchen chime (`/sounds/kitchen-chime.mp3`) through the display terminal whenever a new food or drink order is submitted by a cashier. | Automated (Kitchen Screen) | `src/components/KitchenTVDisplay.tsx` (lines 85–88)<br>`public/sounds/kitchen-chime.mp3` |
| **Interactive Kitchen Staff Board** | Dedicated tablet/desktop interface for kitchen personnel to view active room order queues, review dish notes, and claim orders. | Kitchen, Cashier, Admin, Owner | `src/components/KitchenStaffView.tsx`<br>`server/routes/kitchen.ts` (`GET /api/kitchen/queue`) |
| **Order Lifecycle Transitions** | Tracks kitchen order progression through five statuses: `new` → `preparing` → `ready` → `delivered` → `cancelled`. Status updates broadcast instantly via WebSockets. | Cashier, Admin, Owner, Kitchen | `server/routes/kitchen.ts` (`PUT /api/kitchen/orders/:id/status`, `POST /api/kitchen/room/:roomNumber/status`) |
| **Stale Order Cleanup** | Administrative utility that automatically sweeps and cancels unfulfilled kitchen orders older than a specified age threshold (default: 15 minutes). | Admin, Owner | `server/routes/kitchen.ts` (`POST /api/kitchen/cleanup-stale`) |

### 2.5 Billing, Invoicing & Checkout Processing

| Capability | Description | User Roles | Implementation Source |
| :--- | :--- | :--- | :--- |
| **Server-Computed Invoicing** | Checkout receipts are strictly calculated on the backend from database rates and service definitions to prevent client-side price tampering. | Cashier, Admin, Owner | `server/routes/receipts.ts` (`POST /api/receipts`)<br>`server/utils/pricing.ts` |
| **Senior Citizen & PWD Discount** | Implements the mandatory Philippine 20% discount on room lodging. Enforces server-side validation requiring a non-empty Senior/PWD identification card number before discount can be applied. | Cashier, Admin, Owner | `server/routes/receipts.ts` (lines 141–153)<br>`src/components/room-detail/CheckoutActions.tsx` |
| **Multi-Tender Payments** | Supports `CASH`, `GCASH`, and `MIXED` (split payment) settlement. Enforces mandatory GCash transaction reference entry for electronic tenders. | Cashier, Admin, Owner | `server/routes/receipts.ts` (lines 155–160, 274–291)<br>`src/components/room-detail/CheckoutActions.tsx` |
| **Thermal Receipt Generation** | Generates standardized 80mm thermal receipt previews with unique receipt numbering (`SCTI-######`), room details, check-in/out timestamps, VAT breakdown, cashier identification, and print triggers. | Cashier, Admin, Owner | `src/components/ReceiptPreview.tsx` |
| **Checkout State Transition** | Upon checkout receipt creation within an atomic database transaction, the room is automatically reset and transitioned to `cleaning` ("Housekeep") status. | Cashier, Admin, Owner | `server/routes/receipts.ts` (lines 313–324) |
| **Searchable Transaction Ledger** | Full historical ledger of all issued receipts with real-time filtering by cashier, date range, and payment method, plus one-click Excel export. | Cashier, Admin, Owner | `src/components/TransactionLedger.tsx`<br>`src/utils/excelGenerator.ts` |

### 2.6 Force Check-Out & Incident Loss Management

| Capability | Description | User Roles | Implementation Source |
| :--- | :--- | :--- | :--- |
| **Cashier Escalation Request** | Allows front-desk cashiers to formally escalate non-standard departures (guest skip-out, unreachable overstay, disputed bill, emergency eviction, or system error) to management with documented notes and uncollected balance. | Cashier, Admin, Owner | `src/components/ForceCheckoutModal.tsx`<br>`server/routes/force-checkout.ts` (`POST /api/force-checkout`) |
| **Real-Time Admin Alert Badge** | Displays a pulsing, color-coded escalation counter in the top navigation bar when pending force check-out requests require manager intervention. | Admin, Owner | `src/components/Header.tsx` (lines 394–414) |
| **Administrative Adjudication** | Admin/Owner reviews incident details and approves (`loss_write_off`, `deposit_forfeit`, `void_mistake`, `manual_settle`) or rejects the escalation with administrative notes. | Admin, Owner only | `src/components/AdminForceCheckoutManager.tsx`<br>`server/routes/force-checkout.ts` (`POST /api/force-checkout/:id/approve`, `POST /api/force-checkout/:id/reject`) |
| **Audited Loss Slip Generation** | When approving a force check-out, the system creates an audited loss receipt (`FCE-######`) recording ₱0 cash received to prevent cash drawer shortages while releasing the room to `cleaning`. | Admin, Owner only | `server/routes/force-checkout.ts` (lines 201–238) |
| **Direct Manager Override** | Allows an Admin or Owner to immediately force check out a room in emergency situations without a prior cashier request. | Admin, Owner only | `server/routes/force-checkout.ts` (`POST /api/force-checkout/direct-override`) |

### 2.7 Weekly Financial Reporting & Remittance

| Capability | Description | User Roles | Implementation Source |
| :--- | :--- | :--- | :--- |
| **14-Shift Auto-Population Matrix** | Organizes weekly operations into 14 distinct shifts (7 days × 2 shifts: DAY 6:00 AM–6:00 PM, NIGHT 6:00 PM–6:00 AM). Automatically populates room bills, kitchen bills, drinks, extras, and discounts from checkout receipts in real time. | Cashier, Admin, Owner | `server/services/weekly-report-aggregator.ts`<br>`server/routes/weekly-reports.ts`<br>`src/components/WeeklyReportManager.tsx` |
| **Two-Column Expense Tracking** | Structured weekly expense tracking matching property ledger sheets: Column 1 covers 17 standard operating items (Wilkins Pure, laundry, gas, linens, groceries, cable, meat, etc.); Column 2 covers management allowances; supports custom line items. | Cashier, Admin, Owner | `server/db/schema.sqlite.sql` (lines 233–268)<br>`server/routes/weekly-reports.ts` (`POST /api/weekly-reports/:weekStart/expenses`) |
| **GCash Electronic Payment Audit** | Dedicated electronic audit sub-ledger recording every GCash transaction, reference number, customer name, room number, shift association, and cashier ID. | Cashier, Admin, Owner | `server/routes/weekly-reports.ts` (`GET /api/weekly-reports/:weekStart/gcash`) |
| **Cash Denomination Reconciliation** | Shift-end physical cash drawer count sheet capturing individual bill counts (₱1,000, ₱500, ₱200, ₱100, ₱50), total coins, and staff signatures ("counted by" and "received by"). | Cashier, Admin, Owner | `server/routes/weekly-reports.ts` (`POST /api/weekly-reports/:weekStart/cash-denom`) |
| **One-Click Excel Export** | Generates professionally formatted `.xlsx` remittance workbooks directly from the browser matching the property's accounting layout with formatted currency, borders, and shift totals. | Cashier, Admin, Owner | `src/utils/weeklyReportExporter.ts` |
| **Weekly Report Finalization** | Administrative lock that freezes shift entries, expenses, and cash counts for the selected week to prevent tampering prior to management review. | Admin, Owner only | `server/routes/weekly-reports.ts` (`POST /api/weekly-reports/:weekStart/finalize`) |

### 2.8 Shift Turnover & Handoff Tasks

| Capability | Description | User Roles | Implementation Source |
| :--- | :--- | :--- | :--- |
| **Shift Task Checklist** | Inter-shift operational task list allowing outgoing cashiers to document handover items, maintenance follow-ups, and special guest requests. | Cashier, Admin, Owner | `src/components/ShiftHandoff.tsx`<br>`server/routes/tasks.ts` (`GET/POST /api/tasks`) |
| **Priority & Assignment Tracking** | Tasks support priority tags (`low`, `medium`, `high`), assigned personnel names, and completion toggles. | Cashier, Admin, Owner | `server/routes/tasks.ts` (`PUT/DELETE /api/tasks/:id`) |

### 2.9 Executive Analytics & Administrative Audit Trail

| Capability | Description | User Roles | Implementation Source |
| :--- | :--- | :--- | :--- |
| **Hospitality KPI Dashboard** | Aggregates Gross Revenue, Total Operating Expenses, Net Operating Profit, Net Profit Margin %, Occupancy Rate %, Average Daily Rate (ADR), and Revenue Per Available Room (RevPAR). | Admin, Owner only | `src/components/ReportsPanel.tsx`<br>`server/routes/analytics.ts` (`GET /api/analytics/financial-summary`) |
| **Tender & Departmental Splits** | Breakdown charts displaying payment distributions (Cash % vs. GCash %) and departmental revenues (Rooms, Kitchen, Beverages, Add-ons, Miscellaneous). | Admin, Owner only | `server/routes/analytics.ts` |
| **Administrative Audit Trail** | Immutable, queryable log recording operator username, timestamp, action type, and details for sensitive actions (rate modifications, checkouts, force check-outs, and service deletions). | Admin, Owner only | `server/routes/audit-logs.ts`<br>`src/components/SettingsPanel.tsx` |
| **Dynamic Rate & Catalog Settings** | Administrative configuration panel to set base rates per tier/duration, configure weekday/weekend/seasonal price overrides, and manage user credentials. | Admin, Owner only | `src/components/SettingsPanel.tsx`<br>`server/routes/billable-services.ts` |

---

## 3. System Architecture

### 3.1 Stack Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│                             CLIENT TIER                                │
│   React 19 (SPA)  •  Vite 6  •  Tailwind CSS 4  •  Framer Motion       │
│   Socket.IO Client (Real-time events)  •  Lucide Icons  •  SheetJS     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTP / REST  (Bearer JWT)
                                    │ WebSocket    (Bidirectional)
┌───────────────────────────────────▼────────────────────────────────────┐
│                           APPLICATION TIER                             │
│   Node.js  •  Express 4.21 (REST API)  •  TypeScript (tsx watch)       │
│   Socket.IO Server (Event Broadcasts)  •  JWT Auth Middleware          │
│   Pricing Calculation Engine  •  Weekly Report Aggregator              │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Local Disk / IPC
┌───────────────────────────────────▼────────────────────────────────────┐
│                              DATA TIER                                 │
│   SQLite 3 Engine (better-sqlite3)  •  WAL Journaling Mode             │
│   Atomic Transactions (withTransaction)  •  Dual MySQL/SQLite Dialect  │
│   Storage File: server/data/sedona_pms.db                              │
└────────────────────────────────────────────────────────────────────────┘
```

- **Frontend Tier**: Single-page application built with **React 19.0.1** and TypeScript, bundled with **Vite 6.2.3**. Styling is implemented using **Tailwind CSS 4.1.14** via the `@tailwindcss/vite` plugin. UI micro-animations and slide drawers use **Framer Motion 12.23.24**. Tabular data and ledger exports utilize **SheetJS (`xlsx`)** and **`exceljs`**.
- **Application Tier**: Built on **Node.js** with **Express 4.21.2** and written entirely in TypeScript, executed via `tsx` (4.21.0). Real-time bidirectionality is driven by **Socket.IO 4.8.3** attached to the Express HTTP server (`server/index.ts`).
- **Data Tier**: Primary active storage is an embedded **SQLite 3** database managed via **`better-sqlite3` 13.0.3** (`server/db/pool.ts`). The database file resides at `server/data/sedona_pms.db`.
- **Query Compatibility Layer**: `server/db/pool.ts` provides a custom SQL translation engine (`convertSqlForSqlite` and `convertPgQueryToMysql`) that translates PostgreSQL `$1, $2` parameters and MySQL `ON DUPLICATE KEY UPDATE` / `NOW()` / `DATE()` queries into native SQLite statements. A full production MySQL schema (`server/db/schema.mysql.sql`) and migration runner (`server/db/migration-runner.ts`) exist in the repository for environments connecting to external MySQL servers via `DATABASE_URL`.

### 3.2 Real-Time Synchronization Strategy

The system uses a hybrid real-time synchronization strategy to balance low network overhead with instant multi-screen updates:

1. **WebSocket Broadcasts (`server/websocket/socket-manager.ts`)**:
   - When any state-changing mutation occurs (room update, checkout, booking creation, kitchen order status change, or force check-out escalation), the server writes to the database and immediately broadcasts an event to connected clients.
   - Events emitted:
     - `room:update` / `room:updated`: Broadcasts room number, new state, guest name, and timestamps.
     - `room:alarm`: Broadcasts checkout expiration alarms.
     - `booking:event`: Broadcasts booking created, updated, checked-in, or cancelled.
     - `receipt:created`: Broadcasts newly generated checkout receipts.
     - `kitchen:new_order`: Notifies kitchen screens of incoming orders and triggers chime playback.
     - `kitchen:order_updated` / `kitchen:queue_updated`: Synchronizes kitchen TV and staff order queues.
     - `kitchen:order_completed`: Removes completed orders from display queues.
     - `force_checkout:requested` / `force_checkout:resolved`: Alerts managers of pending/resolved escalations.
     - `system:notification`: Broadcasts global administrative alerts (e.g., board resets).

2. **Client-Side Interval Calculation (`src/App.tsx` lines 307–380)**:
   - Stay countdowns (`2h 14m` down to seconds) are computed purely on the client inside a 1-second interval loop. This eliminates continuous database write load while ensuring second-by-second countdown accuracy on front-desk cards.

3. **Fallback Polling**:
   - The Kitchen TV Display (`src/components/KitchenTVDisplay.tsx` line 96) runs an auxiliary 5-second polling interval against `GET /api/kitchen/tv/display` to guarantee screen recovery in the event of transient local network or WebSocket drops.

### 3.3 Transactional Consistency & Financial Integrity

- **Atomic Checkout Transactions (`server/routes/receipts.ts` lines 296–350)**:
  - Checkout processing executes inside `withTransaction` (`BEGIN IMMEDIATE` ... `COMMIT` / `ROLLBACK`). Within a single database transaction, the system:
    1. Writes the final immutable `receipts` record.
    2. Resets the room fields and transitions state to `cleaning`.
    3. Writes an administrative `audit_logs` record.
    4. Upserts category totals in `pos_revenue`.
    5. Dispatches shift revenue aggregation to `weekly_shift_entries`.
  - If any step fails, all operations roll back completely, preventing orphaned receipts or dirty room states.
- **Server-Side Pricing Engine (`server/utils/pricing.ts`)**:
  - The server independently queries `billable_services` to re-evaluate base stay rates, extra bed/towel fees, extra person surcharges, and charged food totals. Client-submitted price totals are disregarded during receipt creation to eliminate client-side price tampering.

---

## 4. User Roles & Access Control

The PMS defines four discrete user roles (`UserRole` in `src/types.ts`). Permissions are enforced both on the client (UI menu hiding and navigation guards) and on the backend (`requireAuth` middleware and inline role checks).

```
┌────────────────────────────────────────────────────────────────────────┐
│                        ROLE PERMISSION MATRIX                          │
├────────────────────────────┬─────────┬─────────┬────────┬──────────────┤
│ Capability / Resource      │ Kitchen │ Cashier │ Admin  │ Owner        │
├────────────────────────────┼─────────┼─────────┼────────┼──────────────┤
│ View Kitchen TV Display    │   YES   │   YES   │  YES   │     YES      │
│ Interactive Kitchen Queue  │   YES   │   YES   │  YES   │     YES      │
│ Update Kitchen Order Status│   YES   │   YES   │  YES   │     YES      │
│ Front Desk Room Grid       │   NO    │   YES   │  YES   │     YES      │
│ Guest Check-In / Walk-In   │   NO    │   YES   │  YES   │     YES      │
│ Guest Checkout & Receipts  │   NO    │   YES   │  YES   │     YES      │
│ Booking Calendar           │   NO    │   YES   │  YES   │     YES      │
│ POS Catalog & Cart         │   NO    │   YES   │  YES   │     YES      │
│ Transaction Ledger View    │   NO    │   YES   │  YES   │     YES      │
│ Shift Handoff Tasks        │   NO    │   YES   │  YES   │     YES      │
│ Weekly Reports View/Edit   │   NO    │   YES   │  YES   │     YES      │
│ Cash Count Reconciliation  │   NO    │   YES   │  YES   │     YES      │
│ Submit Force Out Request   │   NO    │   YES   │  YES   │     YES      │
│ Approve/Reject Force Out   │   NO    │   NO    │  YES   │     YES      │
│ Direct Force Out Override  │   NO    │   NO    │  YES   │     YES      │
│ Finalize Weekly Report     │   NO    │   NO    │  YES   │     YES      │
│ Financial Analytics & P&L  │   NO    │   NO    │  YES   │     YES      │
│ Rates & Services Settings  │   NO    │   NO    │  YES   │     YES      │
│ Administrative Audit Logs  │   NO    │   NO    │  YES   │     YES      │
│ Reset Property Board       │   NO    │   NO    │  YES   │     YES      │
│ Reset POS Revenue          │   NO    │   NO    │  YES   │     YES      │
│ Cancel Kitchen Orders      │   NO    │   NO    │  YES   │     YES      │
└────────────────────────────┴─────────┴─────────┴────────┴──────────────┘
```

### 4.1 Detailed Role Responsibilities

1. **Kitchen (`role: 'kitchen'`)**:
   - Navigation is strictly isolated to `kitchen-view` (Orders Queue Board) and `kitchen-tv` (Kitchen TV Display).
   - Can view incoming room food orders and update dish preparation statuses (`new` → `preparing` → `ready`).
   - Blocked from all lodging, billing, financial, and front-desk modules (`src/components/Header.tsx` lines 135, 313–345).

2. **Cashier (`role: 'cashier'`)**:
   - Operates the front desk: performs walk-in check-ins, assigns rooms, logs room service, processes checkouts, prints receipts, and manages bookings.
   - Manages shift handoff tasks and inputs weekly expense lines and cash drawer counts.
   - Can submit Force Check-Out escalation requests for managerial review when stays are disputed or guests skip out.
   - Blocked from financial analytics, executive reports, rate/service configuration, weekly report finalization, board resets, and force check-out approvals.

3. **Admin (`role: 'admin'`)**:
   - Full operational and administrative supervisory control.
   - Adjudicates cashier Force Check-Out requests (approves write-offs or rejects), or executes direct manager force check-outs.
   - Finalizes weekly reports, locking financial data against further edits (`server/routes/weekly-reports.ts` line 417).
   - Modifies room rates, overrides, menu items, and services in Settings (`server/routes/billable-services.ts`).
   - Accesses executive performance metrics (RevPAR, ADR, Net Operating Profit) and administrative audit trails.

4. **Owner (`role: 'owner'`)**:
   - Highest managerial privilege level. Retains identical backend access to `admin` (`operator.role !== 'admin' && operator.role !== 'owner'`), distinguished in the UI with an executive rose badge (`bg-rose-50 border-rose-200 text-rose-700`).

---

## 5. Data Model

The data layer consists of 14 operational tables defined in `server/db/schema.sqlite.sql` (and mirrored for MySQL in `server/db/schema.mysql.sql`).

```
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│      users      │       │      rooms      │       │scheduled_booking│
├─────────────────┤       ├─────────────────┤       ├─────────────────┤
│ id (PK)         │       │ number (PK/UQ)  │       │ id (PK)         │
│ username (UQ)   │       │ tier, floor     │       │ room_number     │
│ role            │       │ state, guest_nam│       │ guest_name      │
│ access_code_hash│       │ check_in/out    │       │ check_in/out_dat│
│ created_at      │       │ charged_food    │       │ status          │
└─────────────────┘       └────────┬────────┘       └─────────────────┘
                                   │
                                   │ 1:N
                                   ▼
┌─────────────────────────┐       ┌─────────────────────────┐
│        receipts         │       │     kitchen_orders      │
├─────────────────────────┤       ├─────────────────────────┤
│ receipt_no (PK)         │       │ order_number (PK/UQ)    │
│ room_number             │       │ room_number             │
│ payment_method          │       │ items (JSON)            │
│ cash/gcash_amount       │       │ status                  │
│ total, subtotal         │       │ ordered_at, ready_at    │
│ cashier_id              │       └─────────────────────────┘
└───────────┬─────────────┘
            │
            ├────────────────────────────────────────┐
            │ triggers auto-population               │ audit link
            ▼                                        ▼
┌─────────────────────────┐                ┌──────────────────┐
│  weekly_shift_entries   │                │  gcash_entries   │
├─────────────────────────┤                ├──────────────────┤
│ date, shift_type (UQ)   │                │ id (PK)          │
│ cashier_name            │                │ reference_number │
│ room/kitchen/drink_bill │                │ amount           │
│ week_number, year       │                │ receipt_no       │
└─────────────────────────┘                └──────────────────┘
```

### 5.1 Key Entity Descriptions

1. **`users` (`server/db/schema.sqlite.sql` lines 11–18)**:
   - Stores operator accounts. Passwords are saved as bcrypt salted hashes (`access_code_hash`). Roles are restricted to `'kitchen'`, `'cashier'`, `'admin'`, and `'owner'`.
2. **`rooms` (`server/db/schema.sqlite.sql` lines 25–48)**:
   - Master room inventory (32 rooms). Stores current physical state (`available`, `occupied`, `cleaning`, `overdue`, `maintenance`), room type, occupant names, rate selected, extra bed/towel counters, ISO check-in/out timestamps, and active room service orders in `charged_food` (serialized JSON array).
3. **`scheduled_bookings` (`server/db/schema.sqlite.sql` lines 53–68)**:
   - Advance reservations. Links room designations to expected arrival/departure dates, guest details, and booking status (`scheduled`, `checked-in`, `cancelled`).
4. **`receipts` (`server/db/schema.sqlite.sql` lines 74–96)**:
   - Immutable financial transaction records generated on checkout or direct POS sale. Records payment method (`CASH`, `GCASH`, `MIXED`), GCash reference, cash/GCash tender splits, itemized breakdown (JSON), subtotal, and grand total. Receipts are never updated or deleted.
5. **`billable_services` (`server/db/schema.sqlite.sql` lines 101–123)**:
   - Master service and pricing catalog. Stores base prices for room rates, menu items, and hotel add-ons. Contains columns for weekday overrides, weekend overrides, and seasonal start/end dates. Supports soft-deletion (`is_deleted = 1`).
6. **`kitchen_orders` (`server/db/schema.sqlite.sql` lines 173–201)**:
   - Kitchen queue orders. Stores order numbers (`K-####`), room number, guest name, itemized dishes with quantities (JSON), preparation status (`new`, `preparing`, `ready`, `delivered`, `cancelled`), and completion timestamps.
7. **`weekly_shift_entries` (`server/db/schema.sqlite.sql` lines 206–231)**:
   - 14 shift records per week (7 days × 2 shifts). Stores check-in count, checkout count, room bills, kitchen bills, beverage bills, extras, discounts, and net payments received per shift. Unique constraint on `(date, shift_type)`.
8. **`weekly_expenses` (`server/db/schema.sqlite.sql` lines 236–268)**:
   - Property operational expenses. Stores two distinct subtotal columns (Column 1 operating supplies, Column 2 management items) and a `custom_expenses` JSON column. Unique constraint on `week_start`.
9. **`gcash_entries` (`server/db/schema.sqlite.sql` lines 273–290)**:
   - Dedicated electronic audit trail for all mobile payments. Links GCash reference numbers, transaction amounts, guest names, rooms, receipt numbers, and cashier IDs.
10. **`cash_denomination_report` (`server/db/schema.sqlite.sql` lines 295–320)**:
    - Physical cash reconciliation report. Stores piece counts for ₱1000, ₱500, ₱200, ₱100, and ₱50 banknotes, coin totals, calculated grand totals, and staff signatures. Unique constraint on `report_date`.
11. **`force_checkout_requests` (`server/db/schema.sqlite.sql` lines 325–350)**:
    - Escalation records for uncollected or disputed stays. Stores reason (`skip_out`, `overstay_unreachable`, `disputed_bill`, `emergency_eviction`, `system_error`), cashier notes, uncollected balance, itemized breakdown (JSON), manager resolution (`loss_write_off`, etc.), and administrative resolution notes.
12. **`pos_revenue` (`server/db/schema.sqlite.sql` lines 157–168)**:
    - Aggregated daily point-of-sale revenues broken down by department (`kitchen`, `drinks`, `miscell`).
13. **`handoff_tasks` (`server/db/schema.sqlite.sql` lines 143–152)**:
    - Inter-shift staff task list with completion flags and priority levels.
14. **`audit_logs` (`server/db/schema.sqlite.sql` lines 128–138)**:
    - Append-only administrative event log with operator username, timestamp, action type, and details.

---

## 6. Deployment & Infrastructure

### 6.1 Process Execution & Scripts

Application execution is orchestrated via `package.json` scripts:

```bash
# Install dependencies
npm install

# Database initialization (Runs migrations and seeds default users, rooms, and services)
npm run db:setup

# Run full development stack (Frontend on 3000 + Backend on 4000)
npm run dev:all

# Run backend API server independently
npm run server

# Run frontend development server independently
npm run dev

# Compile production frontend bundle
npm run build

# Preview compiled production frontend
npm run preview

# Execute TypeScript type verification across codebase
npm run lint

# Reset operational database records
npm run db:reset
```

### 6.2 Environment Configuration

Environment variables are validated on backend startup via `server/utils/env-validator.ts`. The system reads configurations from `.env.local`:

| Variable | Required | Default in Code | Purpose & Valid Formats |
| :--- | :--- | :--- | :--- |
| `DATABASE_URL` | **Yes** | `sqlite://server/data/sedona_pms.db` | Database connection string. Supports `sqlite://<path>`, `file:<path>`, `mysql://<user>:<pass>@<host>:<port>/<db>`, or `postgresql://...` (`server/utils/env-validator.ts` lines 65–74). |
| `API_PORT` | No | `4000` | Port for the Express REST and WebSocket server. |
| `APP_URL` | No | `http://localhost:4000` | Base URL used by CORS validation to permit browser access. |
| `JWT_SECRET` | No | Internal hardened fallback | Secret key used for HMAC SHA-256 JWT signing (`server/utils/jwt.ts` line 9). |
| `GEMINI_API_KEY`| No | None | Optional Google Gemini API key declared in `.env.example`. |
| `TZ` | No | `Asia/Manila` | Explicitly enforced server timezone (`server/index.ts` line 11). |

### 6.3 Local Reverse Proxy Configuration

In the development environment, Vite acts as a local reverse proxy (`vite.config.ts` lines 29–39):
- Traffic to `/api/*` is proxied to `http://localhost:4000`.
- Traffic to `/socket.io/*` is proxied to `http://localhost:4000` with WebSocket upgrade enabled (`ws: true`).

### 6.4 Production Infrastructure Status

- **Containerization**: There are **no Dockerfile or docker-compose.yml files** committed in this repository.
- **Process Supervision**: There are **no PM2 (`ecosystem.config.js`), systemd unit files, or Procfiles** committed in this repository.
- **Web Server Configuration**: There are **no Nginx, Apache (`.htaccess`), or Caddyfile server configurations** in the repository. Production process management and reverse proxy routing must be configured at the host level by the infrastructure deployment team.

---

## 7. Internet Exposure & Cloudflare Release Audit

### 7.1 Cloudflare Setup Audit Findings

A comprehensive search of the repository confirms that **no Cloudflare configurations, scripts, or documentation exist within this codebase**:
- No Cloudflare Tunnel (`cloudflared`) configuration files or ingress rules.
- No Cloudflare Workers or Pages configurations (`wrangler.toml`).
- No Cloudflare DNS, SSL/TLS, Caching, or Web Application Firewall (WAF) rule definitions.

> [!NOTE]
> Any Cloudflare setup in place for the live system (e.g., Cloudflare Zero Trust Tunnel, CDN proxying, or DNS records pointing to the property) was established out-of-band directly through the Cloudflare Dashboard or via a private infrastructure repository. This is an operational detail that must be confirmed directly with the systems administrator who provisioned the hosting environment.

### 7.2 Implemented Remote Exposure: ngrok Development Tunnel

The repository contains an explicit, verified remote tunnel configuration using **ngrok**:

1. **Tunnel Scripts (`package.json` lines 20–21)**:
   ```json
   "tunnel": "ngrok http --domain=doretta-unordained-josiah.ngrok-free.dev 3000",
   "dev:tunnel": "concurrently \"npm run dev\" \"npm run server\" \"npm run tunnel\""
   ```
2. **CORS Allowlist (`server/index.ts` lines 44–69)**:
   - The Express server explicitly allows origins matching:
     - `https://doretta-unordained-josiah.ngrok-free.dev`
     - `http://doretta-unordained-josiah.ngrok-free.dev`
     - Any domain ending in `.ngrok-free.dev`, `.ngrok.app`, or `.ngrok.io`.
3. **Vite Host Restrictions (`vite.config.ts` lines 16–23)**:
   - Vite allows incoming HTTP `Host` headers matching `doretta-unordained-josiah.ngrok-free.dev` and the `.ngrok-free.dev` domain wildcards.

---

## 8. Security Measures Implemented

All security controls below have been verified in active code and validated through automated test suites (`server/tests/security-and-data-integrity.test.ts`):

```
┌────────────────────────────────────────────────────────────────────────┐
│                      SECURITY ARCHITECTURE & CONTROLS                  │
├──────────────────────────┬─────────────────────────────────────────────┤
│ Authentication           │ Signed HMAC SHA-256 JWT Bearer tokens       │
│                          │ 14-hour shift expiry (kiosk-optimized)      │
├──────────────────────────┼─────────────────────────────────────────────┤
│ Credential Protection    │ bcrypt one-way salted password hashing      │
├──────────────────────────┼─────────────────────────────────────────────┤
│ Timing Attack Resistance │ crypto.timingSafeEqual on signature checks  │
├──────────────────────────┼─────────────────────────────────────────────┤
│ Authorization            │ Database role check on protected routes     │
│                          │ Granular endpoint access enforcement        │
├──────────────────────────┼─────────────────────────────────────────────┤
│ Financial Tamper Proofing│ Server recalculates folio rates from DB     │
│                          │ Mandatory Senior/PWD ID validation          │
│                          │ Mandatory GCash reference validation        │
├──────────────────────────┼─────────────────────────────────────────────┤
│ Database Safety          │ Fully parameterized queries (? positional)  │
│                          │ Atomic transactions with automatic rollback │
└──────────────────────────┴─────────────────────────────────────────────┘
```

1. **Hardened JWT Session Authentication (`server/utils/jwt.ts`, `server/middleware/auth.ts`)**:
   - Zero-dependency JSON Web Token generator using Node.js native `crypto.createHmac('sha256')`.
   - Generates Bearer tokens with an explicit 14-hour validity window matching kiosk shift durations.
   - Verifies expiration timestamps (`exp`) and protects against signature forgery.
   - Protected API routes (`requireAuth`) inspect the `Authorization: Bearer <token>` header, decode the username, and verify active user status against the `users` table before populating `req.operator`.
2. **Timing-Safe Cryptographic Comparisons (`server/utils/jwt.ts` line 103)**:
   - Compares signature buffers using `crypto.timingSafeEqual` to prevent side-channel timing attacks against JWT tokens.
3. **Access Code Encryption (`server/routes/auth.ts`, `server/db/pool.ts`)**:
   - Operator credentials are never stored in plaintext. Passwords and PIN access codes are hashed using `bcryptjs` with 10 salt rounds. Login comparison uses `bcrypt.compare`.
4. **Server-Side Financial Recomputation (`server/routes/receipts.ts` lines 188–264)**:
   - When checking out a guest, the server queries `billable_services` and recalculates base stay prices, extra bedding fees, extra towel fees, extra person fees, and room service charges from database records. It ignores client-supplied subtotal or total figures, neutralizing browser dev-tools price tampering.
5. **Mandatory Discount ID Validation (`server/routes/receipts.ts` lines 141–153)**:
   - If a Senior Citizen or PWD 20% discount is applied to a stay, the server requires a non-empty `seniorPwdId` / `discountIdRef`. Requests missing an ID are rejected with HTTP 400.
6. **Electronic Payment Audit Validation (`server/routes/receipts.ts` lines 155–160)**:
   - For all receipts settled via `GCASH` or `MIXED` with non-zero GCash amounts, the backend requires a valid `gcashRef` transaction reference string before writing the invoice.
7. **SQL Injection Defense (`server/db/pool.ts`)**:
   - All dynamic SQL statements use parameterized inputs (`?` placeholders). Database URL parsing rejects malformed connection strings immediately without insecure defaults (`server/db/pool.ts` lines 52–80).
8. **ACID Transaction Isolation (`server/db/pool.ts` lines 337–358)**:
   - Operations that mutate multiple tables (checkout, room reset, force check-out approval) are wrapped in `withTransaction`, executing within `BEGIN IMMEDIATE` / `COMMIT` blocks and rolling back completely on any error.
9. **Timezone Standardization (`server/index.ts` line 11, `server/db/pool.ts` line 24)**:
   - The Node.js server process explicitly sets `process.env.TZ = 'Asia/Manila'` on startup, ensuring that date math, shift assignment, and receipt timestamps align with Philippine Standard Time regardless of host server configuration.

---

## 9. Known Limitations & Out of Scope

To ensure client contract accuracy, the following items are documented as **explicitly out of scope or unfinished** in the current codebase:

1. **Kitchen Raw Inventory & Recipe Deduction (Documented in Plan, Not in Code)**:
   - The design plan file `KITCHEN_TV_DISPLAY_PLAN.md` proposed inventory tables (`inventory_items`, `inventory_transactions`, `recipe_ingredients`, `stock_alerts`) and automatic ingredient stock deductions when orders enter `preparing` state.
   - **Current State**: These tables and inventory deduction services **do not exist** in `schema.sqlite.sql` or the backend codebase. The kitchen system operates strictly as an order queue display and fulfillment workflow.
2. **Direct Payment Gateway Integration**:
   - The PMS does not integrate directly with GCash, Maya, or credit card payment gateway APIs (e.g., PayMongo, Xendit). Cashiers must physically verify receipt of funds on an external terminal/phone and manually enter the GCash reference number into the PMS.
3. **Floating-Point Monetary Storage**:
   - Monetary values in the database schema are defined as floating-point numbers (`REAL` in SQLite, `DECIMAL(10,2)` in MySQL schema). An explicit code TODO exists in `server/db/pool.ts` (line 13) and `server/utils/pricing.ts` (line 6) recommending future migration to integer centavos or an arbitrary-precision library (`Decimal.js`) for institutional accounting precision.
4. **Production Containerization & Hosting Scripts**:
   - No Docker containers, PM2 cluster configurations, Nginx host files, or CI/CD pipelines are included in the repository. Production server provisioning must be handled independently.
5. **Native Mobile Applications**:
   - The application is engineered as a responsive web single-page application (SPA). It runs on tablets and mobile devices via standard web browsers, but has no native iOS or Android app wrappers.
6. **Guest Self-Service Portal**:
   - There is no public guest booking engine or guest-facing self-service portal in this repository. All bookings, check-ins, and food orders must be entered by hotel staff through the cashier or administrative terminals.
7. **Multi-Property Tenancy**:
   - The system architecture is single-tenant and specifically designed for the 32 physical rooms of Sedona Court Travellers Inn. It does not support multi-property tenancy or multi-branch hotel operations.

---

## 10. Verification & Audit Trail Summary

This document was prepared by inspecting the active codebase on **September 4, 2026**. All specifications, route endpoints, table structures, and permission rules reflect the current working code state of the repository.

```
Document Reference   : SEDONA-PMS-PRODUCT-SPEC.md
Target Application   : Sedona Court Travellers Inn PMS
Runtime Components   : React 19.0.1 • Express 4.21.2 • Socket.IO 4.8.3 • SQLite 3 / MySQL
Repository Status    : Production Ready (Local / Staging Environment)
```
