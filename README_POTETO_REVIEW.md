# Poteto Review Package — Quick Reference Card

**Date:** 2026-09-30  
**System:** Sedona Court Travellers Inn Property Management System

---

## 📦 What's Included

Three comprehensive documents analyzing the billing system and proposed cashier dashboard:

### 1. **POTETO_REVIEW_SUMMARY.md** ⭐ START HERE
**Purpose:** Executive summary with action plan  
**Read Time:** 10 minutes  
**Key Sections:**
- Critical issues requiring immediate action (C-01 to C-05)
- Approval path (P1 approved, P2 conditional, P3-P4 hold)
- Technical clarifications needed (T-01 to T-05)
- Recommended action plan with timeline

**Best For:** Product owners, engineering leads, project managers

---

### 2. **BILLING_AUDIT_REPORT.md**
**Purpose:** Deep-dive billing logic audit with 28 findings  
**Read Time:** 45 minutes  
**Length:** 1,475 lines

**Key Sections:**
- §2: Critical Issues (8 items)
  - Floating-point money arithmetic
  - Race conditions in deposits
  - GCash reference duplication
  - Time manipulation vulnerability
  
- §3: High-Priority Issues (8 items)
  - Missing VAT compliance
  - Discount type enforcement gaps
  - Receipt numbering race conditions
  
- §4: Medium-Priority Issues (12 items)
  - Audit log tampering risks
  - Mixed timestamp formats
  - Deposit idempotency edge cases

- §5: Prioritized Remediation Plan
  - Week 1-2: Money arithmetic fixes
  - Week 3-4: Security hardening
  - Week 5-6: Compliance and polish

**Best For:** Backend engineers, security reviewers, QA engineers

---

### 3. **CASHIER_DASHBOARD_PLAN_REVIEW.md**
**Purpose:** Technical assessment of proposed dashboard rebuild  
**Read Time:** 30 minutes  
**Length:** 468 lines

**Key Sections:**
- Strengths: Surgical scope, deep research, correct rejection of anti-patterns
- Critical Issues: 5 issues cross-referenced with billing audit
- Technical Clarifications: 5 unresolved questions (T-01 to T-05)
- Approval Path: P1 approved, P2 conditional, P3-P4 hold
- Verification Requirements: Tests, benchmarks, audits

**Best For:** Frontend engineers, UX designers, technical leads

---

## 🚦 Quick Status Dashboard

### Critical Blockers (Must Fix Before P2):

| ID | Issue | Impact | Status | ETA |
|----|-------|--------|--------|-----|
| C-01 | Float money arithmetic | Wrong change calculations | 🔴 BLOCKING | 2 days |
| C-03 | GCash reference duplication | Accounting nightmare | 🔴 BLOCKING | 1 day |
| C-04 | Time manipulation | Revenue loss | 🔴 BLOCKING | 1 day |
| C-02 | Deposit race condition | Negative balances | ✅ FIXED | Done |

### Legal Requirements (Parallel Track):

| ID | Issue | Impact | Status | ETA |
|----|-------|--------|--------|-----|
| C-05 | Missing VAT (12%) | BIR audit failure | 🟠 REQUIRED | 1 week |

### Technical Questions (Must Answer Before P3):

| ID | Question | Impact | Status |
|----|----------|--------|--------|
| T-01 | Total room count? | Pagination strategy | ⚪ PENDING |
| T-02 | Drawer state rules? | UX clarity | ⚪ PENDING |
| T-03 | KPI shift scope? | Data accuracy | ⚪ PENDING |
| T-04 | Button visibility? | Mobile usability | ⚪ PENDING |
| T-05 | Keyboard shortcuts? | Context awareness | ⚪ PENDING |

---

## 📍 Navigation Guide

### If you want to...

**Understand the big picture:**
→ Read `POTETO_REVIEW_SUMMARY.md` from top to bottom

**Fix critical money bugs:**
→ Jump to `BILLING_AUDIT_REPORT.md` §2.1 (Floating-Point Arithmetic)

**Implement Phase 1 dashboard:**
→ Jump to `CASHIER_DASHBOARD_PLAN_REVIEW.md` §1 (Current State) + §3 (Target UX)

**Understand approval conditions:**
→ Jump to `POTETO_REVIEW_SUMMARY.md` §"Recommended Action Plan"

**Review security issues:**
→ Jump to `BILLING_AUDIT_REPORT.md` §2.3-2.8 (Security Gaps)

**See test requirements:**
→ Jump to `CASHIER_DASHBOARD_PLAN_REVIEW.md` §"Additional Verification Requirements"

**Check compliance gaps:**
→ Jump to `BILLING_AUDIT_REPORT.md` §2.5 (VAT) + §3.4 (Audit Logs)

---

## 🎯 Priority Reading Order

### For Product Owner (30 min):
1. `POTETO_REVIEW_SUMMARY.md` → Full read
2. `CASHIER_DASHBOARD_PLAN_REVIEW.md` → §"Approval Path" only
3. `BILLING_AUDIT_REPORT.md` → §1 (Executive Summary) only

### For Engineering Lead (60 min):
1. `POTETO_REVIEW_SUMMARY.md` → §"Critical Issues" + §"Action Plan"
2. `BILLING_AUDIT_REPORT.md` → §2 (Critical) + §3 (High-Priority)
3. `CASHIER_DASHBOARD_PLAN_REVIEW.md` → §"Critical Issues" + §"Technical Clarifications"

### For Backend Engineer (90 min):
1. `BILLING_AUDIT_REPORT.md` → Full read (focus §2-4)
2. `POTETO_REVIEW_SUMMARY.md` → §"Immediate Actions" (C-01, C-03, C-04 fixes)
3. `CASHIER_DASHBOARD_PLAN_REVIEW.md` → §"Cross-Reference with Billing Audit"

### For Frontend Engineer (60 min):
1. `CASHIER_DASHBOARD_PLAN_REVIEW.md` → Full read
2. `POTETO_REVIEW_SUMMARY.md` → §"Phase 1 Success Criteria"
3. `BILLING_AUDIT_REPORT.md` → §2.1 only (float math impacts frontend)

### For QA Engineer (90 min):
1. `POTETO_REVIEW_SUMMARY.md` → §"For QA Team" section
2. `BILLING_AUDIT_REPORT.md` → §2-3 (all critical + high-priority)
3. `CASHIER_DASHBOARD_PLAN_REVIEW.md` → §"Additional Verification Requirements"

---

## 🔢 By the Numbers

### Billing Audit:
- **28 total findings**
- **8 critical issues** (money, security, race conditions)
- **8 high-priority issues** (data integrity, compliance)
- **12 medium-priority issues** (audit, observability)
- **1,475 lines** of detailed analysis
- **4-6 weeks** estimated remediation time

### Dashboard Plan Review:
- **5 critical blockers** identified (C-01 to C-05)
- **5 technical clarifications** needed (T-01 to T-05)
- **4 implementation phases** (P1 approved, P2 conditional, P3-P4 hold)
- **468 lines** of technical assessment
- **2-4 weeks** estimated implementation time (after blockers cleared)

### Combined Impact:
- **3 blocking issues** must be fixed immediately (C-01, C-03, C-04)
- **1 legal requirement** must be addressed before production (C-05 VAT)
- **5 technical questions** must be answered before P3-P4
- **10 test scenarios** defined across all phases

---

## ⚡ Quick Wins (Can Start Today)

### Phase 1 Implementation (Safe to Start):
```bash
cd C:\Users\Luna\Downloads\sedona-court-travellers-inn-property-management-system
git checkout -b feature/cashier-dashboard-p1

# Create new components (no backend changes):
# - src/components/CashierDashboard.tsx
# - src/components/CashierFilterBar.tsx
# - Branch App.tsx on role === 'cashier'

# Acceptance: Cashier sees lists, admin sees grid
```

### Float Money Fix (2 days):
```typescript
// File: src/components/room-detail/CheckoutActions.tsx
// Change all money calculations from float to centavos:
const totalCentavos = roomRateCentavos + addonsCentavos - discountCentavos;
const changeCentavos = paymentCentavos - totalCentavos;

// Test: Balance preview matches server within 1 centavo
```

### GCash Uniqueness (1 day):
```sql
-- File: server/migrations/002_add_gcash_reference_uniqueness.sql
CREATE UNIQUE INDEX idx_receipts_gcash_reference 
ON receipts(gcash_reference) 
WHERE gcash_reference IS NOT NULL;

-- Server validation in routes/receipts.ts
if (existing) return res.status(409).json({error: 'GCash ref already used'});

// Test: Second checkout with same ref returns 409
```

### Server Clock Authority (1 day):
```typescript
// File: server/routes/receipts.ts
const checkOutTime = new Date().toISOString(); // Server decides, not client

// Test: Client-sent checkOutTime ignored by server
```

---

## 🚨 Red Flags to Watch

During implementation, **STOP IMMEDIATELY** if you see:

- ❌ Any new money calculation using `+` or `-` on floats
- ❌ Any timestamp coming from `req.body` instead of `new Date()`
- ❌ Any payment reference (GCash, card) without uniqueness check
- ❌ Any balance calculation without integer centavo conversion
- ❌ Any 7-button row that doesn't fit mobile width
- ❌ Any keyboard shortcut that steals focus from input fields

---

## 📞 Contact Points

### Questions About:

**Billing audit findings:**
→ Review `BILLING_AUDIT_REPORT.md` §2-4 first, then ask specific questions

**Dashboard plan approval:**
→ Review `CASHIER_DASHBOARD_PLAN_REVIEW.md` §"Approval Path" first

**Implementation details:**
→ Original plan file: `C:\Users\Luna\Pictures\Saved Pictures\OneDrive\Desktop\AI AGENTS REPORT FD\2026-09-30 - cashier-list-dashboard-report.md`

**Technical clarifications:**
→ See `POTETO_REVIEW_SUMMARY.md` §"Technical Clarifications Required"

**Remediation timeline:**
→ See `BILLING_AUDIT_REPORT.md` §5 (Prioritized Remediation Plan)

---

## ✅ Approval Decision Template

Copy-paste this for your approval decision:

```markdown
### Approval Decision — Cashier Dashboard Plan

**Phase 1 (UI Shell):** [ ] APPROVED [ ] HOLD
**Phase 2 (Pagination):** [ ] APPROVED [ ] CONDITIONAL [ ] HOLD
**Conditions for P2:**
  - [ ] C-01 Float→centavo fix completed
  - [ ] C-03 GCash uniqueness implemented
  - [ ] C-04 Server clock authority implemented
  - [ ] T-01 Room count clarified: ___ rooms

**Phase 3-4 (Slip/Dep/Polish):** [ ] APPROVED [ ] HOLD
**Pending clarifications:**
  - [ ] T-02 Drawer state rules defined
  - [ ] T-03 KPI shift scope clarified
  - [ ] T-04 Button visibility rules designed
  - [ ] T-05 Keyboard shortcuts documented

**VAT Compliance (C-05):**
  - [ ] File as separate ticket (parallel track)
  - [ ] Blocking for production deployment

**Notes:**
[Your comments here]

**Approved by:** _______________
**Date:** _______________
```

---

## 📊 Success Metrics

### After P1 Completion:
- [ ] Cashier role sees list view (not grid)
- [ ] Admin/owner still sees grid view
- [ ] Two-pane layout renders correctly
- [ ] Filter bar switches between Available/Occupied
- [ ] `npm run lint` passes
- [ ] `npm run build` passes

### After P2 Completion:
- [ ] C-01, C-03, C-04 fixes verified
- [ ] Pagination works (25/50 limits)
- [ ] Balance preview matches server
- [ ] Duplicate GCash returns 409
- [ ] Backdated checkout rejected
- [ ] All existing tests still green

### Before Production:
- [ ] VAT compliance implemented (C-05)
- [ ] All 5 technical clarifications answered
- [ ] All P1-P4 phases complete
- [ ] Accessibility audit passed
- [ ] Load testing completed
- [ ] 3 real cashiers tested and approved

---

## 🎓 Key Takeaways

### Do ✅
- Start P1 immediately (safe, no backend changes)
- Fix C-01, C-03, C-04 before P2 (money correctness)
- File VAT ticket as parallel track (legal requirement)
- Answer T-01 to T-05 before P3 (avoid rework)
- Use integer centavos for ALL money calculations
- Let server be clock authority for timestamps
- Validate payment references for uniqueness

### Don't ❌
- Don't add float money calculations anywhere
- Don't trust client-sent timestamps
- Don't skip GCash/payment reference validation
- Don't implement 7-button rows without conditional visibility
- Don't capture keyboard shortcuts in input fields
- Don't merge without all tests green
- Don't deploy to production without VAT compliance

---

**Review Package Created:** 2026-09-30  
**Reviewed By:** Poteto Squad (BEETLE + TEA + ENGINE-O)  
**Plan Author:** Poteto (plan-mode orchestration)  
**Status:** Ready for approval decision

---

## 📁 File Structure

```
C:\Users\Luna\Downloads\sedona-court-travellers-inn-property-management-system\
│
├── README_POTETO_REVIEW.md          ← YOU ARE HERE (quick reference)
├── POTETO_REVIEW_SUMMARY.md         ← Executive summary (START HERE)
├── BILLING_AUDIT_REPORT.md          ← Full billing audit (1,475 lines)
├── CASHIER_DASHBOARD_PLAN_REVIEW.md ← Dashboard plan assessment (468 lines)
│
└── [Original plan file:]
    C:\Users\Luna\Pictures\Saved Pictures\OneDrive\Desktop\AI AGENTS REPORT FD\
    └── 2026-09-30 - cashier-list-dashboard-report.md
```

---

**Next Step:** Read `POTETO_REVIEW_SUMMARY.md` for the complete picture
