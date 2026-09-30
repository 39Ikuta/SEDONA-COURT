# Cashier Dashboard Plan Review — Poteto Technical Assessment
**Date:** 2026-09-30  
**Plan Source:** `2026-09-30 - cashier-list-dashboard-report.md`  
**Target System:** Sedona Court PMS  
**Reviewer:** Poteto Squad (BEETLE + TEA + ENGINE-O collaboration)

---

## Executive Summary

**Overall Verdict:** ✅ **APPROVED with CONDITIONS**

The plan is **architecturally sound, well-researched, and appropriately scoped**. It correctly identifies the UX gap (cashier needs list view, not grid), reuses the existing billing engine without re-implementing it, and follows the project's no-router/no-state-library constraints. The phased approach is risk-managed and verification steps are evidence-based.

**However, 3 critical issues from the billing audit must be addressed before or during implementation, and 5 technical clarifications are needed.**

---

## ✅ Strengths

### 1. **Surgical Scope — No Over-Engineering**
- Keeps 100% of the new billing engine (`CheckoutActions.tsx`, `RoomDetailSidebar.tsx`, server-authoritative receipt sequencing, centavo math, idempotency)
- Only borrows the *mental model* (Available vs Occupied) from legacy HMS SEDONA — **does not port PHP/SQL anti-patterns**
- Correctly rejects: raw SQL interpolation, `MAX+1` races, state-changing GETs, double money, client-only validation

### 2. **Deep Codebase Understanding**
- Plan references exact file:line evidence (`App.tsx:85,1139-1216`, `RoomDetailSidebar.tsx:42-880`, `CheckoutActions.tsx:1-1077`)
- Correctly identifies existing components to reuse (`TransactionLedger.tsx` table template, `PrintableKitchenTicket.tsx`, `GuestDepositSection.tsx`)
- Understands the stack constraints: no router (ScreenState), no state lib (useState + sessionStorage), no test runner installed (manual `npx tsx`)

### 3. **Phased Risk Management**
- **P1 (UI shell)**: No backend changes — safe to validate UX
- **P2 (pagination)**: Backend envelope pattern — isolated API change
- **P3 (Slip/Dep ports)**: Reuse existing endpoints — no new financial logic
- **P4 (realtime/a11y)**: Polish layer — doesn't block cashier workflow

### 4. **Correct Interpretation of Legacy Reference**
The plan extracts **portable UX patterns** (two-pane mental model, sortable columns, autofocus payment) while rejecting **anti-patterns** (14× `async:false`, 35× auto-`window.print()`, `eval()`, `skip_xss=true`, `$_POST` direct injection).

### 5. **Role-Based View Branching**
Plan correctly identifies `App.tsx:82` role resolution and proposes clean branching:
```tsx
role === 'cashier' ? <CashierDashboard/> : <Sidebar+RoomGrid/>
```
This preserves admin/owner grid view while giving cashiers the list view they need.

---

## ⚠️ Critical Issues (Must Address Before Implementation)

### C-01: **Floating-Point Money in Frontend** (from Billing Audit)
**Problem:** `CheckoutActions.tsx:302-368 financialBreakdown()` uses JavaScript floats for money calculations, causing rounding errors.

**Why This Matters for Cashier Dashboard:**
- Plan §3 proposes "Balance preview" column reading from `financialBreakdown`
- Plan §4 ports "Dep (Deposit Receipt)" which calculates change
- Floating-point errors compound: `(350.50 + 149.50) - 500 = 0.0000000000000568` (not `0`)

**Required Fix:** 
```typescript
// Current (WRONG):
const total = roomRate + addonsTotal + excessCharge - discountAmount - depositApplied;
const change = paymentAmount - total; // ❌ Float math

// Required (CORRECT):
const totalCentavos = roomRateCentavos + addonsCentavos + excessCentavos - discountCentavos - depositCentavos;
const changeCentavos = paymentCentavos - totalCentavos; // ✅ Integer math
const change = changeCentavos / 100; // Convert only for display
```

**Action:** Add to P2 acceptance criteria: "Balance preview matches server centavo math within 1 centavo"

---

### C-02: **Deposit Race Condition** (ALREADY FIXED ✅)
**Problem:** Two concurrent deposit requests could both pass balance checks and create negative balances.

**Status:** ✅ **RESOLVED** — Migration `001_add_guest_balance_cache.sql` applied successfully (see earlier task).

**Verification Needed:** Plan §4 "Dep (Deposit Receipt)" port must use the new optimistic-locking flow:
```typescript
// In GuestDepositSection.tsx, verify this pattern exists:
POST /deposits/security → reads guest_balance_cache.lock_version → writes with if_version check
```

**Action:** Add to P3 acceptance test: "Two concurrent deposits for same guest → second returns 409 Conflict"

---

### C-03: **GCash Reference Not Validated for Uniqueness** (from Billing Audit)
**Problem:** `CheckoutActions.tsx:435-478` accepts GCash 13-digit reference but doesn't check if it was already used in another transaction.

**Why This Matters for Cashier Dashboard:**
- Cashier dashboard will increase checkout volume (faster UX = more transactions/hour)
- Duplicate GCash references → accounting reconciliation nightmare
- No server-side validation today: `server/routes/receipts.ts:865` INSERT has no UNIQUE constraint on `gcash_reference`

**Required Fix (server-side):**
```sql
-- Migration 002_add_gcash_reference_uniqueness.sql
CREATE UNIQUE INDEX idx_receipts_gcash_reference 
ON receipts(gcash_reference) 
WHERE gcash_reference IS NOT NULL AND gcash_reference != '';

-- Then in server/routes/receipts.ts:
if (gcashRefNum) {
  const existing = db.prepare('SELECT receipt_no FROM receipts WHERE gcash_reference = ?').get(gcashRefNum);
  if (existing) {
    return res.status(409).json({ error: `GCash reference ${gcashRefNum} already used in ${existing.receipt_no}` });
  }
}
```

**Action:** Add to P2 backend changes: "GCash reference uniqueness validation + migration"

---

### C-04: **Time Manipulation Vulnerability** (from Billing Audit)
**Problem:** `CheckoutActions.tsx:347-368` sends `checkOutTime` from client to server, allowing backdated checkouts to bypass excess hour charges.

**Why This Matters:**
- Cashier dashboard increases checkout velocity → more opportunity for time manipulation
- Legacy HMS SEDONA had 15-min grace period hidden in code — plan correctly rejects this
- Server must be clock authority: `server/routes/receipts.ts:865` should use `new Date()` server-side, not trust client

**Required Fix:**
```typescript
// CheckoutActions.tsx — DO NOT send checkOutTime from client
const response = await fetch('/api/receipts', {
  body: JSON.stringify({
    // ❌ REMOVE: checkOutTime: new Date().toISOString()
    // Server will use its own clock
  })
});

// server/routes/receipts.ts:865 — Server is clock authority
const checkOutTime = new Date().toISOString(); // ✅ Server decides
```

**Action:** Add to P2 backend changes: "Remove client-sent checkOutTime, server becomes clock authority"

---

### C-05: **Missing VAT Compliance** (from Billing Audit)
**Problem:** No VAT calculation in any receipt flow. Philippines law requires 12% VAT on accommodation services.

**Why This Matters:**
- Plan §4 ports "Dep (Deposit Receipt)" and "Slip (Order Slip)" — both need VAT
- `ReceiptPreview.tsx:18-747` renders receipts but has no VAT line
- BIR audit failure risk increases with cashier dashboard (higher transaction volume)

**Required Fix (P3 or separate ticket):**
```typescript
// In financialBreakdown() and server receipt calculation:
const vatableAmount = subtotal - discountAmount; // Discounts reduce VAT base
const vatAmount = Math.round(vatableAmount * 0.12); // 12% VAT, rounded to centavos
const totalWithVAT = vatableAmount + vatAmount;

// Receipt line items:
// Subtotal:        ₱500.00
// Less Discount:   -₱50.00
// Vatable Amount:   ₱450.00
// Add VAT (12%):    ₱54.00
// TOTAL DUE:        ₱504.00
```

**Action:** File separate ticket "VAT Compliance Implementation" — blocking for production, not P1-P2

---

## 🔍 Technical Clarifications Needed

### T-01: **Pagination Strategy — Server vs Client**
**Plan §2 states:** "No `page/limit` anywhere" in current APIs  
**Plan §5 proposes:** `GET /rooms?q&status&page&limit&sort → {data,meta}`

**Questions:**
1. **Initial load size:** How many rooms does Sedona Court have? If <100 rooms, client-side pagination on full array may be simpler than server envelopes
2. **Socket patch strategy:** Plan §4 mentions "row-patch sockets" — does this mean:
   - Server broadcasts room update → client patches single row in-memory? (efficient)
   - OR server broadcasts → client re-fetches paginated page? (wasteful)

**Recommendation:**
- If total rooms <100: Skip P2 backend pagination, do client-side filtering on full array
- If total rooms 100-500: Implement server pagination but cache full dataset in memory
- If total rooms >500: Full pagination + socket row-patch as planned

**Action:** Clarify total room count before approving P2 scope

---

### T-02: **Drawer State After List Selection**
**Plan §3 wireframe:** "Row click → existing RoomDetailSidebar drawer"

**Questions:**
1. **Multi-select prevention:** Can cashier open drawer for Room 101, then click Room 102 while drawer is open?
   - Current `RoomGrid.tsx:209 onSelectRoom` calls `setSelectedRoomNumber` directly
   - Should list view close previous drawer first? Or allow rapid drawer switching?

2. **Drawer dismiss behavior:** After checkout completes, should:
   - Drawer auto-close + list row disappears (moves to Available pane)?
   - Drawer stay open + show "Room checked out" message?

**Recommendation:**
```typescript
// In CashierDashboard.tsx:
const handleSelectRoom = (roomNumber: string) => {
  if (selectedRoomNumber === roomNumber) {
    setSelectedRoomNumber(null); // Toggle off if same room clicked
  } else {
    setSelectedRoomNumber(roomNumber); // Switch to new room
  }
};
// After successful checkout: setSelectedRoomNumber(null) to auto-close
```

**Action:** Document drawer state machine in P1 acceptance criteria

---

### T-03: **KPI Strip Data Source**
**Plan §3 KPI:** "Shift sales (`GET /shift-settlement/summary?date&shift`)"

**Problem:**
- Current `CashierShiftSettlement.tsx:74-1213` calls `GET /shift-settlement/summary?cashierName`
- Plan proposes `?date&shift` params — does this API exist?
- "Shift Day" label in wireframe — what are the shift definitions? (Morning 6AM-2PM, Afternoon 2PM-10PM, Night 10PM-6AM?)

**Questions:**
1. Does KPI strip show:
   - **This cashier's shift sales** (current operator only)? 
   - OR **All cashiers on this shift** (station-scoped)?
2. If station-scoped, how does system know which "shift" it is? Clock-based auto-detect or manual shift selection?

**Recommendation:**
```typescript
// Clarify in CashierDashboard.tsx props:
interface CashierDashboardProps {
  activeCashier: string; // From App.tsx:97
  shiftScope: 'personal' | 'station'; // Personal = this cashier only, Station = all cashiers this shift
  shiftDefinition?: 'auto' | 'manual'; // Auto = clock-based, Manual = user selects
}
```

**Action:** Define KPI scope in P3 acceptance criteria

---

### T-04: **"Slip" and "Dep" Button Placement**
**Plan §4:** `[Folio][+Add][Xtend][Bill][Out][Slip][Dep]` — 7 buttons per row

**Problems:**
1. **Mobile layout:** 7 buttons at 400px width = 57px per button = unusable
2. **Conditional visibility:** 
   - `Slip` only if room has kitchen orders (`chargedFood.length > 0`)?
   - `Dep` only if room has active deposit (`GET /deposits/active/:room`)?
   - If all 7 buttons always visible → cognitive overload

**Recommendation:**
```tsx
// Occupied row actions (conditional):
<div className="flex gap-1">
  <ActionButton icon={FileText} onClick={openFolio}>Folio</ActionButton>
  <ActionButton icon={Plus} onClick={addService}>Add</ActionButton>
  <ActionButton icon={Clock} onClick={extend}>Xtend</ActionButton>
  
  {/* Conditional buttons */}
  {room.chargedFood.length > 0 && (
    <ActionButton icon={Receipt} onClick={printSlip}>Slip</ActionButton>
  )}
  {room.hasActiveDeposit && (
    <ActionButton icon={Wallet} onClick={printDep}>Dep</ActionButton>
  )}
  
  {/* Primary actions always visible */}
  <ActionButton icon={Eye} onClick={prePrintBill}>Bill</ActionButton>
  <ActionButton icon={DoorOpen} onClick={checkout} variant="primary">Out</ActionButton>
</div>
```

**Action:** Define button visibility rules in P3

---

### T-05: **Keyboard Navigation Scope**
**Plan §3 interaction:** "keyboard `/`/`Enter`/`Esc`"

**Questions:**
1. **`/` focuses search:** What if cashier is typing in Payment field in drawer? Should `/` still steal focus?
2. **`Enter` on row:** Does this open drawer or trigger primary action (Check In for Available, Checkout for Occupied)?
3. **`Esc` closes drawer:** What if cashier has unsaved changes in drawer? Confirm dialog or silent discard?

**Recommendation:**
```typescript
// Keyboard shortcuts with context awareness:
useEffect(() => {
  const handleKeyPress = (e: KeyboardEvent) => {
    // Only capture if no input/textarea focused
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return;
    }
    
    if (e.key === '/') {
      e.preventDefault();
      searchInputRef.current?.focus();
    }
    if (e.key === 'Escape' && selectedRoomNumber) {
      // Check drawer isDirty state before closing
      if (drawerHasUnsavedChanges) {
        showConfirmDialog();
      } else {
        setSelectedRoomNumber(null);
      }
    }
  };
  document.addEventListener('keydown', handleKeyPress);
  return () => document.removeEventListener('keydown', handleKeyPress);
}, [selectedRoomNumber, drawerHasUnsavedChanges]);
```

**Action:** Document keyboard shortcuts in P4 acceptance criteria

---

## 📋 Cross-Reference with Billing Audit

### Audit Findings Addressed by Plan:
✅ **C-02 Deposit Race**: Migration already applied  
⚠️ **Floating-point money**: Plan must address in P2  
⚠️ **GCash reference uniqueness**: Plan must add in P2  
⚠️ **Time manipulation**: Plan must fix in P2  
⚠️ **VAT compliance**: Separate ticket (not blocking P1-P2)  

### Audit Findings NOT Addressed by Plan (OK for now):
- **Discount type enforcement** (database enum constraint) — separate data integrity ticket
- **Receipt number gaps** (transaction rollback) — low priority, existing behavior
- **Audit log tampering** (cryptographic signing) — security enhancement, not cashier UX
- **Rate limiting** (checkout endpoint DoS) — infrastructure concern, not UI

### Audit Findings Plan Should Leverage:
✅ **Server-authoritative billing** — Plan correctly keeps `CheckoutActions.tsx` untouched  
✅ **Centavo math** — Plan reuses existing engine (but must fix frontend preview float bug)  
✅ **Idempotency keys** — Plan reuses `POST /receipts` with existing guards  

---

## 🎯 Recommended Approval Path

### Option A: **Approve P1 Only (Safest)**
```bash
approve P1
```
**Scope:** UI shell only (two panes + filter bar), no backend changes  
**Risk:** None — pure React component changes  
**Timeline:** 2-3 days  
**Blockers:** None  

**Then gate P2+ on:**
1. Total room count clarification (T-01)
2. Float-to-centavo frontend fix (C-01)
3. GCash uniqueness migration (C-03)
4. Server clock authority fix (C-04)

---

### Option B: **Approve P1-P2 with Conditions (Recommended)**
```bash
approve P1-P2 with mandatory fixes: C-01, C-03, C-04
```
**Scope:** UI shell + pagination + backend envelopes  
**Risk:** Low if conditions met  
**Timeline:** 5-7 days  
**Blockers:** 
- [ ] Fix `financialBreakdown()` float math → centavo math (C-01)
- [ ] Add GCash reference UNIQUE index + validation (C-03)
- [ ] Make server clock authority for checkouts (C-04)
- [ ] Clarify total room count for pagination strategy (T-01)

**Defer to P3:**
- Slip/Dep ports (after verifying deposit lock_version pattern)
- KPI strip (after clarifying shift scope)
- Button visibility rules (after UX review)

---

### Option C: **Approve All (P1-P4) — Not Recommended**
**Why Not:**
- P3 has 5 unresolved technical questions (T-01 to T-05)
- P4 "realtime row-patch" depends on pagination strategy decision
- VAT compliance (C-05) is legally required but not scoped in plan

**If you choose this:**
- Must answer all T-01 to T-05 questions first
- Must file VAT ticket as blocking dependency
- Must add deposit race condition test to P3 acceptance

---

## 📝 Additional Verification Requirements

### Beyond Plan §6 "Verify" Section:

1. **Money Arithmetic Audit:**
```bash
# Run this BEFORE approving P2:
npx tsx server/tests/receipt-checkout-overhaul.test.ts
# Add new test case:
describe('financialBreakdown float bug', () => {
  it('should match server centavo calculation', () => {
    const client = financialBreakdown({roomRate: 350.50, addons: 149.50, payment: 500});
    const server = calculateReceiptCentavos({roomRate: 35050, addons: 14950, payment: 50000});
    expect(client.changeCentavos).toBe(server.changeCentavos); // Must be exact
  });
});
```

2. **GCash Reference Collision Test:**
```bash
# Add to P2 acceptance:
curl -X POST /api/receipts -d '{"gcashRefNum":"1234567890123",...}' # First succeeds
curl -X POST /api/receipts -d '{"gcashRefNum":"1234567890123",...}' # Second returns 409
```

3. **Pagination Performance Benchmark:**
```bash
# If room count >100, measure P2 pagination impact:
ab -n 1000 -c 10 http://localhost:5173/api/rooms?page=1&limit=25
# Target: <100ms p95 latency
```

4. **Keyboard Accessibility Audit:**
```bash
# P4 acceptance: Full keyboard navigation without mouse
# Tab through Available list → Enter opens drawer → Tab to Payment → Esc closes drawer
```

---

## 🏁 Final Verdict

**APPROVED for P1 (UI Shell)**  
**CONDITIONAL APPROVAL for P2 (Pagination)** — gated on C-01, C-03, C-04 fixes  
**HOLD on P3-P4** — pending T-01 to T-05 clarifications  

### Strengths Summary:
✅ Deep codebase research with file:line evidence  
✅ Correct rejection of legacy anti-patterns  
✅ Surgical scope (no billing re-implementation)  
✅ Phased risk management  
✅ Reuses existing components intelligently  

### Critical Gaps:
⚠️ Floating-point money must be fixed before balance preview (C-01)  
⚠️ GCash reference uniqueness missing (C-03)  
⚠️ Client controls checkout time (C-04)  
⚠️ VAT compliance not scoped (C-05)  

### Recommended Next Steps:
1. **Immediate:** Start P1 UI shell (safe to proceed)
2. **Before P2:** Fix C-01, C-03, C-04 + clarify T-01 room count
3. **Before P3:** Answer T-02 (drawer state), T-03 (KPI scope), T-04 (button visibility)
4. **Parallel track:** File VAT compliance ticket (C-05) as separate workstream

---

**Plan Author:** Poteto (plan-mode orchestration)  
**Reviewer:** Poteto Squad (BEETLE + TEA + ENGINE-O)  
**Review Date:** 2026-09-30  
**Next Review:** After P1 completion or C-01/C-03/C-04 fixes submitted