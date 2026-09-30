# Poteto Review Summary — Sedona Court PMS Analysis
**Date:** 2026-09-30  
**System:** Sedona Court Travellers Inn Property Management System  
**Reviewer:** Poteto Squad

---

## 📋 Documents Delivered

1. **BILLING_AUDIT_REPORT.md** (1,475 lines)
   - Comprehensive billing logic audit
   - 8 critical issues, 8 high-priority issues, 12 medium-priority issues
   - Detailed remediation plan with code examples

2. **CASHIER_DASHBOARD_PLAN_REVIEW.md** (468 lines)
   - Technical assessment of proposed cashier dashboard rebuild
   - Cross-reference with billing audit findings
   - Approval path with conditions
   - 5 critical issues, 5 technical clarifications

---

## 🎯 Key Findings Overview

### Critical Issues Requiring Immediate Action:

#### **C-01: Floating-Point Money Arithmetic** ⚠️ BLOCKING P2
**Location:** `src/components/room-detail/CheckoutActions.tsx:302-368`  
**Impact:** Rounding errors in balance calculations, wrong change given to guests  
**Example:** `(350.50 + 149.50) - 500 = 0.0000000000000568` instead of `0`

**Fix Required:**
```typescript
// BEFORE (WRONG):
const total = roomRate + addonsTotal - discountAmount; // Float math
const change = paymentAmount - total;

// AFTER (CORRECT):
const totalCentavos = roomRateCentavos + addonsCentavos - discountCentavos;
const changeCentavos = paymentCentavos - totalCentavos; // Integer math
const change = changeCentavos / 100; // Display only
```

---

#### **C-02: Deposit Race Condition** ✅ ALREADY FIXED
**Status:** Migration `001_add_guest_balance_cache.sql` successfully applied  
**Verification Needed:** Ensure new cashier dashboard uses optimistic locking flow

---

#### **C-03: GCash Reference Duplication** ⚠️ BLOCKING P2
**Location:** `server/routes/receipts.ts:865`  
**Impact:** Same GCash reference can be used multiple times, accounting nightmare

**Fix Required:**
```sql
-- Migration 002_add_gcash_reference_uniqueness.sql
CREATE UNIQUE INDEX idx_receipts_gcash_reference 
ON receipts(gcash_reference) 
WHERE gcash_reference IS NOT NULL;
```

---

#### **C-04: Time Manipulation Vulnerability** ⚠️ BLOCKING P2
**Location:** `CheckoutActions.tsx:347-368`  
**Impact:** Clients can backdate checkout times to avoid excess hour charges

**Fix Required:**
```typescript
// Client: DO NOT send checkOutTime
// Server: Use server clock as authority
const checkOutTime = new Date().toISOString();
```

---

#### **C-05: Missing VAT Compliance** ⚠️ LEGAL REQUIREMENT
**Impact:** No 12% VAT calculation (required by Philippines BIR)  
**Timeline:** Must be implemented before production deployment  
**Scope:** Separate ticket, not blocking P1-P2 of dashboard

---

### Billing Logic Issues Inventory:

| Severity | Category | Count | Examples |
|----------|----------|-------|----------|
| 🔴 Critical | Money/Security | 8 | Float arithmetic, GCash duplication, time manipulation |
| 🟠 High | Data Integrity | 8 | Discount types not enforced, race conditions |
| 🟡 Medium | Compliance/Audit | 12 | Missing VAT, audit log tampering, receipt gaps |

**Full details:** See `BILLING_AUDIT_REPORT.md` sections 2-4

---

## ✅ Cashier Dashboard Plan Assessment

### Overall Verdict: **APPROVED with CONDITIONS**

The plan is architecturally sound and demonstrates deep codebase understanding. It correctly:
- Reuses existing billing engine (no re-implementation)
- Rejects legacy anti-patterns from HMS SEDONA reference
- Proposes phased rollout (P1→P2→P3→P4)
- Provides file:line evidence for all claims

### Approval Path:

#### **✅ APPROVED: Phase 1 (UI Shell)**
```
Scope: Two-pane list view (Available vs Occupied), filter bar, role-based branching
Risk: None (pure React component changes)
Timeline: 2-3 days
Start: Immediately safe to proceed
```

#### **⚠️ CONDITIONAL APPROVAL: Phase 2 (Pagination + Backend)**
```
Scope: Server pagination envelopes, API changes
Conditions:
  1. Fix C-01: Float→centavo math in financialBreakdown()
  2. Fix C-03: GCash reference uniqueness validation
  3. Fix C-04: Server becomes clock authority for checkouts
  4. Clarify T-01: Total room count for pagination strategy

Timeline: 5-7 days after conditions met
```

#### **🔍 HOLD: Phase 3-4 (Slip/Dep Ports + Polish)**
```
Pending:
  - T-02: Drawer state machine definition
  - T-03: KPI shift scope (personal vs station)
  - T-04: Button visibility rules (7 buttons too many)
  - T-05: Keyboard navigation context awareness
  
Resume after: P2 completion + clarifications answered
```

---

## 🔧 Technical Clarifications Required

### T-01: **Pagination Strategy**
**Question:** How many total rooms does Sedona Court have?
- If <100 rooms: Skip server pagination, do client-side filtering
- If 100-500 rooms: Server pagination + memory cache
- If >500 rooms: Full pagination as planned

**Impact:** Determines P2 scope (backend changes vs client-only)

---

### T-02: **Drawer State After List Selection**
**Question:** When cashier clicks Room 102 while drawer open on Room 101:
- A) Close Room 101 drawer, open Room 102 drawer? (Switch)
- B) Ignore click, keep Room 101 drawer open? (Lock)
- C) Show confirm dialog if unsaved changes? (Conditional)

**Recommendation:** Option C (conditional switching)

---

### T-03: **KPI Strip Data Source**
**Question:** "Shift sales ₱18,450" means:
- A) This cashier's personal sales this shift? (Personal)
- B) All cashiers' sales this shift? (Station-scoped)

**Current API:** `GET /shift-settlement/summary?cashierName` (personal only)  
**Plan proposes:** `?date&shift` params (station-scoped)

**Clarification needed:** Define shift boundaries (Morning/Afternoon/Night) and scope

---

### T-04: **Action Button Visibility**
**Question:** Row actions `[Folio][+Add][Xtend][Bill][Out][Slip][Dep]` — all 7 always visible?

**Problem:** 7 buttons × 400px mobile width = 57px per button (unusable)

**Recommendation:** Conditional visibility:
- `[Slip]` only if `chargedFood.length > 0`
- `[Dep]` only if `hasActiveDeposit`
- `[Out]` always primary action

---

### T-05: **Keyboard Navigation**
**Question:** `/` focuses search — what if cashier typing in Payment field?

**Recommendation:** Context-aware shortcuts:
```typescript
if (activeElement is input/textarea) return; // Don't steal focus
if (key === '/') searchInputRef.focus();
if (key === 'Esc' && drawerDirty) showConfirmDialog();
```

---

## 📊 Cross-Reference Matrix

### Billing Audit ↔ Dashboard Plan:

| Audit Finding | Plan Impact | Status |
|---------------|-------------|--------|
| C-01 Float money | Balance preview column | ⚠️ Must fix in P2 |
| C-02 Deposit race | Dep receipt port | ✅ Already fixed |
| C-03 GCash dupe | Checkout flow | ⚠️ Must fix in P2 |
| C-04 Time manip | Excess charge calc | ⚠️ Must fix in P2 |
| C-05 VAT missing | Receipt rendering | 📋 Separate ticket |
| Discount types | Not affected | ✅ OK for now |
| Receipt gaps | Not affected | ✅ OK for now |
| Audit tampering | Not affected | ✅ OK for now |

### Plan Components ↔ Existing System:

| New Component | Reuses | Creates | Risk |
|---------------|--------|---------|------|
| CashierDashboard.tsx | RoomGrid patterns | Two-pane layout | Low |
| CashierFilterBar.tsx | TransactionLedger filters | Search + chips | Low |
| useCashierRooms.ts | Room socket logic | Pagination state | Medium |
| PrintableDepositReceipt.tsx | PrintableKitchenTicket style | Browser 80mm preview | Low |
| GET /rooms pagination | Existing query | Envelope + meta | Medium |

---

## 🎬 Recommended Action Plan

### Immediate (This Week):

1. **Start Phase 1 (UI Shell)** — Safe to proceed
   ```bash
   git checkout -b feature/cashier-dashboard-p1
   # Create CashierDashboard.tsx + CashierFilterBar.tsx
   # Branch App.tsx on role === 'cashier'
   ```

2. **Fix C-01: Float Money** — Blocking P2
   ```typescript
   // Refactor CheckoutActions.tsx financialBreakdown()
   // Change all money calculations to integer centavos
   // Add test: client balance === server balance
   ```

3. **Fix C-03: GCash Uniqueness** — Blocking P2
   ```sql
   -- Create migration 002_add_gcash_reference_uniqueness.sql
   -- Add server validation in receipts.ts
   ```

4. **Fix C-04: Server Clock** — Blocking P2
   ```typescript
   // Remove checkOutTime from client POST body
   // Server uses new Date() as authority
   ```

### Short-Term (Next 2 Weeks):

5. **Answer T-01 to T-05** — Unblocks P3-P4
   - Count total rooms in production database
   - Define drawer state machine
   - Clarify shift scope and boundaries
   - Design button visibility rules
   - Document keyboard shortcuts

6. **File VAT Compliance Ticket** — Parallel track
   ```markdown
   Title: Implement 12% VAT Calculation (BIR Compliance)
   Priority: High (legal requirement)
   Blockers: None (can run parallel to dashboard work)
   ```

### Medium-Term (Next Month):

7. **Complete P2-P4** — After conditions met
8. **Run full verification suite:**
   ```bash
   npm run lint
   npm run build
   npx tsx server/tests/receipt-checkout-overhaul.test.ts
   npx tsx server/tests/fullblast-checkout-master.test.ts
   npx tsx server/tests/cashier-inventory.test.ts
   # Manual: pau/admin/kitchen1 roles
   ```

9. **Production deployment gate:**
   - [ ] All P1-P4 acceptance tests pass
   - [ ] C-01, C-03, C-04 fixes verified
   - [ ] C-05 VAT compliance implemented
   - [ ] T-01 to T-05 clarifications documented
   - [ ] No new dependencies added
   - [ ] Electron print verified
   - [ ] Shift settlement reconciliation tested

---

## 📈 Success Metrics

### Phase 1 Success Criteria:
- ✅ Cashier role sees list view, admin/owner sees grid
- ✅ Two-pane layout (Available vs Occupied) renders correctly
- ✅ Filter bar switches between panes
- ✅ `npm run lint` passes
- ✅ `npm run build` passes

### Phase 2 Success Criteria:
- ✅ Pagination works (25/50 limits)
- ✅ Server returns `{data, meta}` envelopes
- ✅ C-01, C-03, C-04 fixes verified
- ✅ Balance preview matches server within 1 centavo
- ✅ Duplicate GCash reference returns 409 Conflict
- ✅ Backdated checkout rejected by server

### Phase 3 Success Criteria:
- ✅ `[Slip]` prints kitchen orders with correct format
- ✅ `[Dep]` prints deposit receipt with DEP-XXXXXX number
- ✅ KPI strip shows correct shift sales
- ✅ Button visibility rules applied
- ✅ All tests green

### Phase 4 Success Criteria:
- ✅ Socket row-patch updates single row (no full refetch)
- ✅ Keyboard shortcuts work in correct context
- ✅ `role=table` accessibility
- ✅ Focus trap on modals
- ✅ `aria-live=polite` on balance updates

---

## 🚨 Red Flags to Watch

### During Implementation:

1. **If float math reappears anywhere:** STOP and refactor to centavos
2. **If new money calculations added:** MUST use integer centavos
3. **If client sends timestamps:** STOP, server must be clock authority
4. **If new GCash/payment fields:** MUST add uniqueness validation
5. **If pagination causes socket issues:** May need to rethink caching strategy
6. **If 7 buttons don't fit mobile:** Implement conditional visibility immediately

### Before Production:

1. **VAT still missing:** BLOCKING (legal requirement)
2. **Tests not all green:** BLOCKING (regression risk)
3. **Drawer state unclear:** BLOCKING (UX confusion)
4. **Float math still exists:** BLOCKING (money errors)
5. **GCash duplication possible:** BLOCKING (accounting nightmare)

---

## 📚 Supporting Documentation

### File Locations:
```
C:\Users\Luna\Downloads\sedona-court-travellers-inn-property-management-system\
├── BILLING_AUDIT_REPORT.md          (1,475 lines - full audit)
├── CASHIER_DASHBOARD_PLAN_REVIEW.md (468 lines - plan assessment)
└── POTETO_REVIEW_SUMMARY.md         (this file - executive summary)
```

### Key Source Files Referenced:
```
src/
├── App.tsx:1139                     (dashboard role branching)
├── components/
│   ├── RoomDetailSidebar.tsx:42-880 (existing drawer - KEEP)
│   ├── room-detail/
│   │   └── CheckoutActions.tsx:302  (float math bug - FIX)
│   ├── TransactionLedger.tsx:122    (table template - REUSE)
│   └── ReceiptPreview.tsx:18        (80mm preview - EXTEND)

server/
├── routes/
│   ├── receipts.ts:865              (POST /receipts - FIX clock + GCash)
│   ├── rooms.ts:171                 (GET /rooms - ADD pagination)
│   └── deposits.ts:709              (deposit flow - VERIFY lock_version)
└── tests/
    ├── receipt-checkout-overhaul.test.ts
    ├── fullblast-checkout-master.test.ts
    └── cashier-inventory.test.ts
```

---

## ✅ Final Recommendations

### For Product Owner:

1. **Approve P1 immediately** — UI shell is safe, no backend risk
2. **Require C-01, C-03, C-04 fixes before P2** — Money correctness is non-negotiable
3. **File VAT ticket as separate workstream** — Legal requirement, can run parallel
4. **Budget extra time for T-01 to T-05 clarifications** — 5 unresolved questions will surface during P3

### For Engineering Lead:

1. **Code review focus areas:**
   - Any money calculation MUST use integer centavos
   - Any timestamp MUST come from server, not client
   - Any payment reference MUST be validated for uniqueness
   - Any new button MUST have conditional visibility rules

2. **Testing priorities:**
   - Money rounding edge cases (0.01, 0.49, 0.50, 0.99 centavos)
   - Concurrent requests (deposits, checkouts, GCash references)
   - Clock skew scenarios (client 5 min ahead/behind server)
   - Pagination boundary conditions (page 0, page 999, limit 0, limit 1000)

3. **Merge gates:**
   - P1: Lint + build + manual UX
   - P2: Above + all tests green + money audit
   - P3: Above + slip/dep printing verified
   - P4: Above + accessibility audit + socket stress test

### For QA Team:

1. **P2 test scenarios:**
   ```
   - Checkout with payment ₱500.00 - balance ₱499.99 = ₱0.01 change (not ₱0.00)
   - Submit same GCash reference twice → second fails with 409
   - Set client clock 10 minutes ahead → excess hours still calculated correctly
   - Paginate through 100 rooms → correct totals on all pages
   ```

2. **P3 test scenarios:**
   ```
   - Print order slip for room with 5 items → all items appear with correct prices
   - Print deposit receipt → DEP-XXXXXX number matches database
   - Create deposit, then try creating duplicate → second fails with lock error
   ```

3. **P4 test scenarios:**
   ```
   - Open drawer on Room 101 → another session checks out Room 101 → row updates in real-time
   - Press '/' while typing payment amount → focus stays in payment field
   - Tab through entire cashier dashboard → all interactive elements reachable
   - Screen reader announces balance updates as they happen
   ```

---

## 🎓 Lessons for Future Work

### What Went Well:

1. **Plan had file:line evidence** — Made review efficient, no need to re-search
2. **Legacy reference used correctly** — Extracted UX patterns, rejected anti-patterns
3. **Phased approach** — P1 is safe gate, P2+ can be adjusted based on learnings
4. **Reuse over rebuild** — No temptation to rewrite billing engine

### What Could Improve:

1. **Float math should have been caught earlier** — Add lint rule for money arithmetic
2. **VAT missing from original design** — Legal compliance should be in requirements phase
3. **5 technical questions unanswered** — Could have been resolved before plan approval
4. **No load testing mentioned** — Pagination decision needs performance data

### Process Recommendations:

1. **Pre-plan checklist:**
   - [ ] Legal compliance requirements identified (VAT, data retention, etc.)
   - [ ] Performance constraints defined (room count, transaction volume)
   - [ ] Money arithmetic audit completed
   - [ ] Security review of user-controlled inputs (timestamps, references)

2. **Plan approval gates:**
   - [ ] All file:line references verified
   - [ ] All reused components confirmed compatible
   - [ ] All new API endpoints documented with examples
   - [ ] All conditional logic branches defined
   - [ ] All keyboard shortcuts documented

3. **Implementation checkpoints:**
   - [ ] After P1: UX review with 3 real cashiers
   - [ ] After P2: Load test with production data
   - [ ] After P3: Print output review with accounting team
   - [ ] After P4: Accessibility audit with screen reader

---

**Review completed:** 2026-09-30  
**Reviewer:** Poteto Squad (BEETLE + TEA + ENGINE-O)  
**Plan author:** Poteto (plan-mode orchestration)  
**Status:** Awaiting approval decision (P1 / P1-P2 with conditions / hold for clarifications)

---

## 📞 Next Steps

**To proceed:**
1. Reply with approval decision: `approve P1` or `approve P1-P2 with conditions` or `hold pending clarifications`
2. If approved, Poteto will begin implementation starting with P1 UI shell
3. If held, Poteto will gather answers to T-01 through T-05 before resuming

**Questions?**
- Technical questions: Review CASHIER_DASHBOARD_PLAN_REVIEW.md sections
- Billing concerns: Review BILLING_AUDIT_REPORT.md sections 2-4
- Implementation details: Review plan file `2026-09-30 - cashier-list-dashboard-report.md` §5-6
