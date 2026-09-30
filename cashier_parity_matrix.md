# Cashier Dashboard Parity Matrix

## 1. Mapping Old Layout Elements to New System Features

| Old Layout Element | Where New System Feature Fits |
| :--- | :--- |
| **Main Dashboard Split (35% Left / 65% Right)** | 35% Left: Could house `CashierShiftSettlement` (Shift summary, Expenses, Cash count). 65% Right: `TransactionLedger` (Invoices, Deposits). Alternatively, Left = Available Rooms, Right = Occupied Rooms (containing `GuestDepositSection`). |
| **Two-Tier Header Tables & Maroon Sales Grid** | `TransactionLedger` (Official Invoices & Receipts, Security Deposits) and `CashierInventoryModal` list views. |
| **DataTables Style Search (Generic)** | `TransactionLedger` live search field. |
| **Leftmost Column Primary Actions (Red/Blue/Primary)** | `GuestDepositSection` actions: **Record Deposit** (Primary), **Apply Extension** (+₱130/hr) (Blue), **Mark 86** in Inventory (Red). |
| **Rightmost Column Secondary Actions (Pipes `\|`)** | `CashierInventoryModal` increment stock (+1, +5, +10). |
| **Form Bottom Actions (Borderless Table)** | **Submit Expense**, **Reconcile Variance**, **Print Money Count Slip**, **Export CSV/Excel**. |
| **Status Badges (Red, Blue, Primary)** | Applied to Deposit statuses (`IN`, `OUT`, `HELD`, `REFUNDED`) and Receipt statuses (`void`, `FCE-`). |

## 2. New Features with No Clear Place in Old Layout -> Proposed Placement
*   **`CashierShiftSettlement` (Physical cash count, operating expenses, over/short variances, Shift Types `DAY`/`NIGHT`)**: 
    *   *Proposed Placement*: Since the old dashboard was rigidly focused on Room status (Available vs. Occupied), we propose adding a sticky "Shift Actions" panel at the bottom of the 35% column, or a dedicated "End Shift" persistent button at the top right that opens a 50/50 split modal.
*   **Payment Methods (CASH, GCASH + Ref Number, MIXED split amounts)**:
    *   *Proposed Placement*: When clicking any checkout/payment action in the leftmost column, open a centered modal replacing the old standard form.
*   **RBAC Constraints (Date filter locked to `TODAY`, Cashier filter hidden, DB Export hidden)**:
    *   *Proposed Placement*: Invisible enforcement. The generic DataTables search box will remain, but the specific date/cashier dropdowns will be hidden from the DOM entirely for the `cashier` role.

## 3. Old Features Missing in New System (DO NOT ADD UNLESS APPROVED)
*   "Check In" triggers (if Cashiers no longer perform check-ins in the new system)
*   "Discount" application actions
*   "Print Gate Pass" button
*   "Cancel AddOn" / "X Order" (New system only mentioned marking inventory "86", not voiding a guest add-on)

---

# Layout Spec & Conflict Flags

## Target Layout Structure
1.  **Container**: `<div class="w-full max-w-full">` mimicking the `one_full` class.
2.  **Layout**: A 35% / 65% horizontal split (using Flexbox or CSS Grid) resembling the old dashboard.
    *   *Left (35%)*: Could serve as the quick-action panel or shift settlement overview.
    *   *Right (65%)*: The `TransactionLedger` and DataTables-style lists.
3.  **Visuals**: 
    *   Maroon header (`bg-[#800000] text-[#CCCCCC]`) for grids.
    *   Tight padding (`p-1` and tight line-heights) to match the dense desktop-first legacy UI.
    *   Action buttons matched to old classes: Red (`bg-red-600`), Blue (`bg-blue-600`), Primary.

## 🚩 CONFLICTS REQUIRING YOUR DECISION (STOPPING FOR APPROVAL)

**Conflict 1: Dashboard Primary Focus (Rooms vs. Ledger)**
*   *Old System*: The main dashboard is explicitly "35% AVAILABLE ROOMS" and "65% OCCUPIED ROOMS".
*   *New System*: The cashier features rely heavily on `TransactionLedger` (Invoices/Receipts/Deposits) and `CashierShiftSettlement`. 
*   **Question**: Should we retain the "Available/Occupied Rooms" as the main view (and put Ledger/Shift Settlement in modals/tabs), OR should we repurpose the 35/65 split to be "35% Shift/Expenses" and "65% Transaction Ledger"?

**Conflict 2: Action Column Placement**
*   *Old System*: Actions are scattered—primary triggers on the leftmost column, secondary on the rightmost, and form submissions at the bottom.
*   *New System*: React components usually group actions.
*   **Question**: Are you okay with me forcing the new React actions (like Record Deposit, Apply Extension) into the leftmost and rightmost table columns to strictly match the legacy UX, even if it splits related actions apart?
