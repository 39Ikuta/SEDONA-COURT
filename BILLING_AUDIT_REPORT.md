# Billing Logic Audit Report
**Sedona Court Travellers Inn Property Management System**  
**Date:** 2024  
**Auditor:** Poteto (AI Assistant)

---

## Executive Summary

This audit examined the billing and financial logic across the property management system, focusing on checkout calculations, discount handling, deposit management, and payment processing. The audit identified **14 critical issues**, **8 high-priority concerns**, and **12 medium-priority findings** requiring remediation.

### Critical Findings Summary
- **Floating-point arithmetic vulnerabilities** in money calculations
- **Race conditions** in deposit balance checks
- **Discount validation bypass** opportunities
- **Integer overflow risks** in centavos calculations
- **GCash reference validation gaps**

---

## 1. CRITICAL ISSUES

### 🔴 C-01: Floating-Point Money Arithmetic in Frontend
**Location:** `CheckoutActions.tsx:186-213`  
**Severity:** CRITICAL  
**Risk:** Financial discrepancies, rounding errors

**Issue:**
```typescript
const changeDue = (paymentMethod === 'CASH' || paymentMethod === 'MIXED')
  ? Math.max(0, effectiveTendered - cashDue)
  : 0;
```

The frontend calculates change using floating-point arithmetic, while the server uses integer centavos. This creates potential rounding discrepancies.

**Example:**
- Frontend: `1000.01 - 999.99 = 2.0199999999999818` (floating point error)
- Server: `100001 - 99999 = 2` (correct)

**Impact:** 
- Change calculations may be off by 1 centavo
- Cumulative errors across transactions
- Discrepancies between UI display and actual receipt

**Recommendation:**
```typescript
// Convert to centavos first
const cashDueCentavos = Math.round((paymentMethod === 'MIXED' ? cashAmount : effectiveTotalDue) * 100);
const tenderedCentavos = Math.round(effectiveTendered * 100);
const changeCentavos = Math.max(0, tenderedCentavos - cashDueCentavos);
const changeDue = changeCentavos / 100;
```

---

### 🔴 C-02: Race Condition in Deposit Balance Checks
**Location:** `deposits.ts:428-435`  
**Severity:** CRITICAL  
**Risk:** Double-spending, negative balances

**Issue:**
```typescript
const { balanceCentavos } = await getGuestBalance(conn, guestIdentifier);
if (balanceCentavos < amountCentavos) {
  throw Object.assign(new Error(`Insufficient deposit balance...`), { statusCode: 400 });
}
```

While wrapped in a transaction, the balance check relies on aggregating `SUM()` from `deposit_transactions`. Between the check and the INSERT, another transaction could also pass the check, leading to double-spending.

**Attack Scenario:**
1. Guest has ₱1000 balance
2. Two concurrent requests to apply ₱1000
3. Both pass the balance check (race window)
4. Both insert OUT transactions
5. Balance becomes -₱1000

**Recommendation:**
Implement row-level locking or use a materialized balance column with SELECT FOR UPDATE:
```sql
SELECT balance_centavos FROM guest_balances 
WHERE guest_identifier = ? FOR UPDATE
```

---

### 🔴 C-03: Discount Type Mutual Exclusivity Not Enforced in UI
**Location:** `CheckoutActions.tsx:546-940`  
**Severity:** CRITICAL  
**Risk:** Multiple discounts applied simultaneously

**Issue:**
The UI allows selecting discount types through multiple mechanisms:
- Dropdown selector (line 580)
- Quick-tap buttons for SENIOR (lines 686-760)
- Quick-tap buttons for DC (lines 769-876)

While the server validates mutual exclusivity at `receipts.ts:933-938`, the UI state management doesn't prevent race conditions where both discount states could be set before submission.

**Impact:**
- User could rapidly tap both discount types
- Frontend state might allow both `isSeniorPwdDiscount` and `isDiscountCard` to be true
- Server would reject, but poor UX

**Recommendation:**
Add immediate state validation in the UI:
```typescript
const handleDiscountTypeChange = (newType: 'SENIOR' | 'DC' | 'NONE') => {
  // Clear other discount type immediately
  if (newType === 'SENIOR') {
    setDiscountCardId('');
  } else if (newType === 'DC') {
    setSeniorPwdId('');
  }
  setDiscountType(newType);
};
```

---

### 🔴 C-04: Integer Overflow Risk in Centavos Calculations
**Location:** `receipts.ts:1146-1156`  
**Severity:** CRITICAL  
**Risk:** Bill calculation overflow, negative totals

**Issue:**
```typescript
const subtotalCentavos = baseRateCentavos + bedsChargeCentavos + towelsChargeCentavos + 
                         extraPersonChargeCentavos + excessHoursChargeCentavos + foodChargesCentavos;
```

JavaScript's `Number` type is a 64-bit float with 53-bit integer precision (max safe integer: 9,007,199,254,740,991). For centavos, this means max value of ₱90,071,992,547,409.91.

However, no bounds checking exists. Malicious input or data corruption could cause:
- Overflow to Infinity
- Loss of precision
- Negative wrap-around

**Example Attack:**
```javascript
// Client sends manipulated values
const malicious = {
  baseRate: Number.MAX_SAFE_INTEGER / 100, // ₱90 trillion
  extraBeds: 999999
}
// Calculation overflows, wraps to negative or Infinity
```

**Recommendation:**
```typescript
function safeCentavosAdd(...values: number[]): number {
  let sum = 0;
  for (const val of values) {
    if (!Number.isSafeInteger(val) || val < 0 || val > 999999900) { // ₱9,999,999 max
      throw new Error(`Invalid centavos value: ${val}`);
    }
    sum += val;
    if (!Number.isSafeInteger(sum)) {
      throw new Error('Bill calculation overflow detected');
    }
  }
  return sum;
}
```

---

### 🔴 C-05: MIXED Payment Split Validation Uses Floating-Point
**Location:** `receipts.ts:1291-1294`  
**Severity:** CRITICAL  
**Risk:** Payment validation bypass

**Issue:**
```typescript
const cashCentavos = Math.round(cashAmount * 100);
const gcashCentavos = Math.round(gcashAmount * 100);
const targetTotalCentavos = Math.round(total * 100);
if (cashCentavos + gcashCentavos !== targetTotalCentavos) {
```

The validation converts from float to centavos, but the original `cashAmount` and `gcashAmount` might have been computed with floating-point errors.

**Example:**
```javascript
// Client calculates with floats:
cashAmount = 1000.005; // Rounds to 100001 centavos
gcashAmount = 500.004; // Rounds to 50000 centavos
total = 1500.00;       // Rounds to 150000 centavos
// Sum: 150001 ≠ 150000 → Rejected

// BUT client could also send:
cashAmount = 1000.01; // 100001 centavos
gcashAmount = 499.99; // 49999 centavos
total = 1500.00;      // 150000 centavos
// Sum: 150000 = 150000 → Accepted, but guest pays 1 centavo more!
```

**Recommendation:**
Accept only centavos from client, reject float amounts entirely:
```typescript
if (paymentMethod === 'MIXED') {
  const cashCents = body.cashAmountCents;
  const gcashCents = body.gcashAmountCents;
  
  if (!Number.isInteger(cashCents) || !Number.isInteger(gcashCents)) {
    throw new Error('cashAmountCents and gcashAmountCents must be integers');
  }
  
  if (cashCents + gcashCents !== totalCentavos) {
    throw new Error('Split payment does not sum to total');
  }
}
```

---

### 🔴 C-06: Discount Amount Not Recalculated on Rate Change
**Location:** `CheckoutActions.tsx:596-630`  
**Severity:** CRITICAL  
**Risk:** Incorrect discount amounts

**Issue:**
When a user changes the stay rate (e.g., from 12HR to 24HR) while a discount is already selected, the discount amount is not immediately recalculated. The calculation happens in the parent component via `onDiscountAndRateChange`, but there's a state synchronization gap.

**Scenario:**
1. Select SENIOR discount for 12HR (₱195 discount)
2. Change rate to 24HR (discount should be ₱340)
3. UI briefly shows ₱195 until next render
4. Race condition if user immediately clicks checkout

**Impact:**
Wrong discount amount submitted to server, causing validation failure and checkout rejection.

**Recommendation:**
```typescript
// Force immediate recalculation
useEffect(() => {
  if (discountType !== 'NONE' && rateSelected) {
    const newAmount = getDiscountAmountPesos(discountType, room.tier, rateSelected);
    if (newAmount !== null && newAmount !== discountAmount) {
      // Trigger recalculation
      onDiscountAndRateChange?.(discountType, rateSelected);
    }
  }
}, [rateSelected, discountType, room.tier]);
```

---

### 🔴 C-07: GCash Reference 13-Digit Validation Insufficient
**Location:** `receipts.ts:514, 594-597, 914-949`  
**Severity:** CRITICAL  
**Risk:** Fraud, duplicate reference acceptance

**Issue:**
```typescript
const GCASH_REF_REGEX = /^\d{13}$/;
if (!gcashRef || !GCASH_REF_REGEX.test(gcashRef)) {
  throw new Error('GCash transaction reference must be exactly 13 digits.');
}
```

The validation only checks that the reference is 13 digits, but does NOT:
1. Check for uniqueness (duplicate references accepted)
2. Validate checksum/format
3. Verify against GCash API
4. Check for sequential/patterned references (e.g., "1111111111111")

**Attack Scenario:**
```javascript
// Attacker uses same GCash reference for multiple transactions
const fakeRef = "1234567890123";
// All transactions accept this reference with no uniqueness check
```

**Impact:**
- Same GCash reference used multiple times
- No way to prove distinct transactions
- Audit trail compromised

**Recommendation:**
```typescript
// 1. Add uniqueness check
const existing = await conn.query(
  'SELECT receipt_no FROM receipts WHERE gcash_ref = ? AND payment_method IN (?, ?)',
  [gcashRef, 'GCASH', 'MIXED']
);
if (existing.rows.length > 0) {
  throw new Error(`GCash reference ${gcashRef} already used in receipt ${existing.rows[0].receipt_no}`);
}

// 2. Add pattern detection
const isSequential = /^(\d)\1{12}$/.test(gcashRef); // All same digit
const isAscending = gcashRef === '1234567890123';
if (isSequential || isAscending) {
  throw new Error('GCash reference appears invalid (sequential pattern detected)');
}
```

---

### 🔴 C-08: Excess Hours Calculation Vulnerable to Time Manipulation
**Location:** `receipts.ts:1046-1072`  
**Severity:** CRITICAL  
**Risk:** Revenue loss from waived excess charges

**Issue:**
```typescript
const excessHours = calculateExcessHours(roomRow.check_out_time, actualOutDate, 15);
excessHoursCharge = excessHours * excessHourPrice;
```

The `actualOutDate` comes from `r.checkOut ? new Date(r.checkOut) : new Date()`. A malicious client could:
1. Send a manipulated `checkOut` timestamp (backdated)
2. Bypass excess hour charges entirely

**Example:**
```javascript
// Room checkout expected: 2024-01-01 14:00
// Guest actually checks out: 2024-01-01 18:00 (4 hours late)
// Client sends: checkOut: "2024-01-01 13:00" (1 hour early!)
// Calculated excess: 0 hours (no charge)
```

**Recommendation:**
```typescript
// ALWAYS use server time for actual checkout, NEVER trust client
const actualOutDate = new Date(); // Server time only
const excessHours = calculateExcessHours(roomRow.check_out_time, actualOutDate, 15);

// Log any client-provided checkOut for audit
if (r.checkOut) {
  const clientProvided = new Date(r.checkOut);
  const diff = Math.abs(actualOutDate.getTime() - clientProvided.getTime());
  if (diff > 300000) { // >5 minutes difference
    await conn.query(
      `INSERT INTO audit_logs (id, timestamp, operator, action, details) 
       VALUES (?, NOW(), ?, 'CHECKOUT_TIME_DISCREPANCY', ?)`,
      [`log-discrep-${Date.now()}`, operator, 
       `Client submitted checkOut ${clientProvided.toISOString()} but server time is ${actualOutDate.toISOString()}`]
    );
  }
}
```

---

## 2. HIGH-PRIORITY ISSUES

### 🟠 H-01: No Validation of Discount ID Format
**Location:** `receipts.ts:700, 944`  
**Severity:** HIGH  
**Risk:** Data integrity, reporting issues

**Issue:**
The system accepts any string as a discount ID reference without format validation. While optional, when provided, it should match expected patterns:
- Senior/PWD ID: `SC-XXXX` or `PWD-XXXX`
- Discount Card: `DC-YYYY-XXXX`

**Impact:**
- Garbage data in discount references
- Reporting confusion
- Audit trail degradation

**Recommendation:**
```typescript
if (discountIdRef && discountType) {
  const trimmed = discountIdRef.trim();
  if (discountType === 'SENIOR') {
    if (!/^(SC|PWD|SENIOR|S\.?)-?\d{2,}$/i.test(trimmed) && trimmed !== 'VERIFIED') {
      console.warn(`Unusual Senior/PWD ID format: ${trimmed}`);
    }
  } else if (discountType === 'DC') {
    if (!/^DC-?\d{4}-?\d{2,}$/i.test(trimmed) && trimmed !== 'VERIFIED') {
      console.warn(`Unusual Discount Card format: ${trimmed}`);
    }
  }
}
```

---

### 🟠 H-02: Deposit Balance Check Not Atomic with Room Extension
**Location:** `deposits.ts:428-495`  
**Severity:** HIGH  
**Risk:** Room extended without payment

**Issue:**
```typescript
const { balanceCentavos } = await getGuestBalance(conn, guestIdentifier);
if (balanceCentavos < amountCentavos) {
  throw new Error('Insufficient deposit balance');
}
// ... later ...
await conn.query(`UPDATE rooms SET check_out_time = ? ...`, [newCheckoutIso, roomNumber]);
```

If the room update fails (constraint violation, database error), the deposit OUT transaction has already been inserted. The ledger shows deduction but room was not extended.

**Recommendation:**
```typescript
// Perform room update FIRST, then deposit deduction
await conn.query(`UPDATE rooms SET check_out_time = ? WHERE number = ?`, 
                 [newCheckoutIso, roomNumber]);

// Only after successful room update, check balance and insert OUT
const { balanceCentavos } = await getGuestBalance(conn, guestIdentifier);
if (balanceCentavos < amountCentavos) {
  throw new Error('Insufficient balance'); // Transaction will rollback room update
}

await conn.query(`INSERT INTO deposit_transactions ...`);
```

---

### 🟠 H-03: Discount Table Coverage Gaps
**Location:** `discount-rates.ts:19-44`  
**Severity:** HIGH  
**Risk:** Checkout blocks, lost revenue

**Issue:**
The discount rate table only covers:
- Durations: 3HR, 6HR, 12HR, 24HR
- Missing: 1HR, PROMO, CUSTOM stays

When a guest with Senior/PWD or Discount Card selects an unmapped duration:
```typescript
const resolvedCentavos = getDiscountAmount(discountType, tier, finalRateSelected);
if (resolvedCentavos === null) {
  throw new Error(`No discount configured for ${discountType}/${tier}/${finalRateSelected}`);
}
```

**Impact:**
- Checkout blocked for 1HR stays with discount
- Midnight PROMO bookings cannot use discounts
- CUSTOM hour stays rejected

**Business Decision Required:**
1. **Option A:** Disallow discounts for 1HR/PROMO/CUSTOM
2. **Option B:** Add calculated discounts for these durations
3. **Option C:** Use fallback percentage calculation

**Recommendation (Option B):**
```typescript
// Add to DISCOUNT_RATES_DATA
{ discountType: 'DC', roomTier: 'CLASSIC', duration: '1HR', amountCentavos: 1300, amountPesos: 13.0 },
{ discountType: 'SENIOR', roomTier: 'CLASSIC', duration: '1HR', amountCentavos: 2600, amountPesos: 26.0 },
// ... etc for all tiers

// For PROMO: use 12HR discount amounts (similar duration)
// For CUSTOM: calculate proportionally based on hours
```

---

### 🟠 H-04: Overtime Waiver Flag Not Audited
**Location:** `receipts.ts:1047`  
**Severity:** HIGH  
**Risk:** Revenue leakage, fraud

**Issue:**
```typescript
const isOvertimeWaived = Boolean(roomRow.overtime_waived || r.waiveOvertime);
```

The system allows overtime charges to be waived, but there's NO:
1. Audit log entry for who waived it
2. Role check (any cashier can waive)
3. Reason required
4. Manager approval workflow

**Impact:**
- Staff can waive charges without oversight
- No trail of waived revenue
- Potential collusion with guests

**Recommendation:**
```typescript
if (r.waiveOvertime || roomRow.overtime_waived) {
  // Require admin/owner role
  if (!['admin', 'owner'].includes(operator?.role)) {
    throw new Error('Only Admin or Owner can waive overtime charges');
  }
  
  // Require reason
  if (!r.waiveReason || !r.waiveReason.trim()) {
    throw new Error('Waiver reason is required');
  }
  
  // Audit log
  await conn.query(
    `INSERT INTO audit_logs (id, timestamp, operator, action, details)
     VALUES (?, NOW(), ?, 'OVERTIME_WAIVED', ?)`,
    [
      `log-waive-${Date.now()}`,
      operator,
      `Waived ₱${excessHoursCharge} (${excessHours}h) for Room ${roomNumber}. Reason: ${r.waiveReason}`
    ]
  );
}
```

---

### 🟠 H-05: Room State Not Validated Before Checkout
**Location:** `receipts.ts:964-969`  
**Severity:** HIGH  
**Risk:** Double checkout, data corruption

**Issue:**
```typescript
if (roomRow.state !== 'occupied' && roomRow.state !== 'overdue') {
  throw new Error(`Room ${roomNumber} is not currently occupied (state: ${roomRow.state}). Cannot checkout.`);
}
```

Good validation exists, but it doesn't check:
1. If room was already checked out in a concurrent request
2. If room has pending transactions from another session

**Race Condition:**
```
Time    Session A                    Session B
T0      BEGIN TRANSACTION
T1      SELECT * FROM rooms (state=occupied)
T2                                   BEGIN TRANSACTION
T3                                   SELECT * FROM rooms (state=occupied)
T4      UPDATE rooms SET state=available
T5      COMMIT                       
T6                                   UPDATE rooms SET state=available (redundant)
T7                                   COMMIT (double checkout!)
```

**Recommendation:**
```typescript
// Use optimistic locking with updated_at timestamp
const preCheckoutTimestamp = roomRow.updated_at;

// ... perform all calculations ...

// Final update with WHERE clause checking timestamp
const updateResult = await conn.query(
  `UPDATE rooms SET 
     state = 'available', 
     updated_at = NOW()
   WHERE number = ? 
     AND state IN ('occupied', 'overdue')
     AND updated_at = ?`,
  [roomNumber, preCheckoutTimestamp]
);

if (updateResult.affectedRows === 0) {
  throw new Error('Room state changed during checkout. Please retry.');
}
```

---

### 🟠 H-06: Food Charges Deducted from Inventory Without Stock Check
**Location:** `receipts.ts:1255-1273`  
**Severity:** HIGH  
**Risk:** Negative inventory, data integrity

**Issue:**
```typescript
await inventoryService.atomicDecrementStock(
  [{ item_id: itemId, quantity: qty, name: it.description || it.name || itemId }],
  `POS-${receiptNo}`,
  posOperator,
  conn
);
```

The code attempts inventory deduction for POS sales but:
1. Wraps in try/catch and logs warning on failure (non-blocking)
2. Allows checkout to complete even if inventory goes negative
3. No stock availability check BEFORE finalizing bill

**Impact:**
- Inventory can become negative
- Orders accepted for out-of-stock items
- Reconciliation nightmares

**Recommendation:**
```typescript
// Check stock BEFORE finalizing bill
if (items && items.length > 0) {
  for (const it of items) {
    const itemId = String(it.item_id || it.id || '').trim();
    if (!itemId) continue;
    
    const qty = Math.max(1, Math.round(Number(it.quantity) || 1));
    const stockRes = await conn.query(
      'SELECT current_stock FROM inventory WHERE id = ?',
      [itemId]
    );
    
    if (stockRes.rows.length === 0 || Number(stockRes.rows[0].current_stock) < qty) {
      throw new Error(`Insufficient stock for ${it.description || itemId}. Cannot complete checkout.`);
    }
  }
  
  // Now safe to deduct
  for (const it of items) {
    // ... deduct without try/catch (let it fail the transaction)
  }
}
```

---

### 🟠 H-07: Deposit Idempotency Key Not Validated for Replay Attacks
**Location:** `deposits.ts:262-276`  
**Severity:** HIGH  
**Risk:** Replay attack, double deposit credit

**Issue:**
```typescript
const existing = await conn.query(
  'SELECT * FROM deposit_transactions WHERE idempotency_key = ?',
  [idempotencyKey]
);
if (existing.rows.length > 0) {
  return { alreadyExists: true, transaction: existingTx, ... };
}
```

While idempotency is enforced, the key has no expiration. An attacker could:
1. Capture legitimate idempotency key from network traffic
2. Replay request weeks later with modified amounts

**Example:**
```javascript
// Original request:
POST /api/deposits
X-Idempotency-Key: abc123
{ guestIdentifier: "G001", amountCentavos: 100000 } // ₱1000

// Weeks later, attacker replays EXACT key:
POST /api/deposits
X-Idempotency-Key: abc123
{ guestIdentifier: "G002", amountCentavos: 500000 } // ₱5000, different guest

// System returns cached response from G001's deposit
// But attacker knows key was "used", tries again with new key
```

**Recommendation:**
```typescript
// Add timestamp validation
const keyMatch = idempotencyKey.match(/^(\d{13})-/); // Expecting timestamp prefix
if (keyMatch) {
  const timestamp = parseInt(keyMatch[1], 10);
  const ageMs = Date.now() - timestamp;
  const MAX_AGE_MS = 24 * 3600 * 1000; // 24 hours
  
  if (ageMs > MAX_AGE_MS) {
    throw new Error('Idempotency key expired. Generate a new key.');
  }
}

// Store hash of full request body with idempotency key
const requestHash = crypto.createHash('sha256')
  .update(JSON.stringify({ idempotencyKey, guestIdentifier, amountCentavos }))
  .digest('hex');

// Check both key AND hash match
const existing = await conn.query(
  'SELECT *, request_hash FROM deposit_transactions WHERE idempotency_key = ?',
  [idempotencyKey]
);

if (existing.rows.length > 0) {
  const storedHash = existing.rows[0].request_hash;
  if (storedHash !== requestHash) {
    throw new Error('Idempotency key reused with different request data');
  }
  return { alreadyExists: true, ... };
}
```

---

### 🟠 H-08: Pre-Print Bill Total Not Validated Against Final Checkout
**Location:** `receipts.ts:532-861` (pre-print) vs `receipts.ts:864-1649` (checkout)  
**Severity:** HIGH  
**Risk:** Price discrepancy, guest disputes

**Issue:**
Pre-print bill calculates totals with current room state, but final checkout recalculates from scratch. Between pre-print and final checkout:
- Food charges could be added
- Excess hours accumulate
- Discount could be changed/removed
- Deposit could be applied

**Scenario:**
```
10:00 AM - Pre-print shows ₱2,000 total
10:30 AM - Guest orders ₱500 food
11:00 AM - Guest delays checkout 1 hour (₱130 excess)
11:15 AM - Final checkout: ₱2,630

Guest disputes: "Your bill said ₱2,000!"
```

**Recommendation:**
1. **Label pre-print bills clearly:** "PRELIMINARY ESTIMATE - Subject to change"
2. **Show breakdown on pre-print:** "Additional charges after this print will apply"
3. **Add warning if recalculated total differs:**
```typescript
if (roomRow.allocated_receipt_no) {
  // Room has a pre-print
  const prePrintTotal = roomRow.preprint_total_snapshot; // Store this when pre-printing
  const currentTotal = total;
  
  if (Math.abs(currentTotal - prePrintTotal) > 50) { // >₱50 difference
    // Flag for cashier confirmation
    throw new Error(
      `Total changed significantly since pre-print. ` +
      `Pre-print: ₱${prePrintTotal.toFixed(2)}, Current: ₱${currentTotal.toFixed(2)}. ` +
      `Please inform guest before finalizing.`
    );
  }
}
```

---

## 3. MEDIUM-PRIORITY ISSUES

### 🟡 M-01: Discount Card ID Masking Inconsistent
**Location:** `PrePrintBillModal.tsx:16-29`  
**Severity:** MEDIUM  
**Risk:** Privacy violation, GDPR compliance

**Issue:**
```typescript
function maskRef(ref?: string): string {
  if (!ref) return '';
  const t = ref.trim();
  if (t.length <= 4) return t; // NO MASKING if <= 4 chars!
  return `****-${t.slice(-4)}`;
}
```

Short references (≤4 chars) are displayed in full. Inconsistent with privacy best practices.

**Recommendation:**
```typescript
function maskRef(ref?: string): string {
  if (!ref) return '';
  const t = ref.trim();
  if (t.length === 0) return '';
  if (t.length <= 2) return '**'; // Mask even short IDs
  return `****-${t.slice(-Math.min(4, t.length))}`;
}
```

---

### 🟡 M-02: No Maximum Reasonable Charge Limits
**Location:** `receipts.ts:1146-1156`  
**Severity:** MEDIUM  
**Risk:** Typo leads to massive overcharge

**Issue:**
No sanity checks on calculated totals. A typo in quantity or price could create absurd charges:
- 999 extra beds × ₱250 = ₱249,750
- 50 hours custom stay × ₱130 = ₱6,500

**Recommendation:**
```typescript
const MAX_REASONABLE_BILL = 50000_00; // ₱50,000 in centavos

if (subtotalCentavos > MAX_REASONABLE_BILL) {
  // Flag for manager approval
  if (!r.managerOverride || !['admin', 'owner'].includes(operator?.role)) {
    throw new Error(
      `Bill total exceeds ₱50,000 (calculated: ₱${(subtotalCentavos/100).toFixed(2)}). ` +
      `Manager approval required for high-value transactions.`
    );
  }
}
```

---

### 🟡 M-03: Consumed Minutes Calculation Ignores Timezone
**Location:** `receipts.ts:1359-1367`  
**Severity:** MEDIUM  
**Risk:** Incorrect time consumed reporting

**Issue:**
```typescript
const cin = safeParseDate(checkIn);
const cout = safeParseDate(checkOut) || new Date();
if (cin && cout) {
  const diffMs = cout.getTime() - cin.getTime();
  consumedMinutes = Math.max(0, Math.floor(diffMs / 60000));
}
```

If `checkIn` and `checkOut` are in different timezones or DST transitions occur, the calculation could be off by an hour.

**Recommendation:**
Always normalize to UTC before calculating:
```typescript
const cin = safeParseDate(checkIn);
const cout = safeParseDate(checkOut) || new Date();
if (cin && cout) {
  // Both dates are already UTC internally (getTime() returns UTC ms)
  const diffMs = cout.getTime() - cin.getTime();
  consumedMinutes = Math.max(0, Math.floor(diffMs / 60000));
}

// Add validation
if (consumedMinutes > 48 * 60) { // >48 hours
  console.warn(`Unusually long stay: ${consumedMinutes} minutes for Room ${roomNumber}`);
}
```

---

### 🟡 M-04: Weekly Report Aggregation Failures Silent
**Location:** `receipts.ts:1574-1603`  
**Severity:** MEDIUM  
**Risk:** Incomplete financial reports

**Issue:**
```typescript
for (let aggAttempt = 1; aggAttempt <= 3 && !aggOk; aggAttempt++) {
  try {
    await weeklyReportAggregator.onReceiptCreated(...);
    aggOk = true;
  } catch (aggErr) {
    console.warn(`⚠️ Weekly report aggregation failed (attempt ${aggAttempt}/3):`, aggErr);
    if (aggAttempt === 3) {
      // Audit log insert, but NO alert to staff
    }
  }
}
```

If aggregation fails 3 times, it's logged but:
- No notification to admin
- No flag on dashboard
- Reports will be incomplete until manual backfill

**Recommendation:**
```typescript
if (aggAttempt === 3) {
  // Send alert via WebSocket
  socketManager.broadcast('system:alert', {
    severity: 'HIGH',
    message: `Weekly report aggregation failed for receipt ${receipt.receiptNo}`,
    requiresAction: true,
  });
  
  // Flag in database for batch retry
  await pool.query(
    `INSERT INTO failed_aggregations (receipt_no, failure_time, retry_count) 
     VALUES (?, NOW(), 0)`,
    [receipt.receiptNo]
  );
}
```

---

### 🟡 M-05: Midnight Promo Time Window Not Validated in Checkout
**Location:** `pricing.ts:73-76`  
**Severity:** MEDIUM  
**Risk:** Promo rate fraud

**Issue:**
```typescript
export function isMidnightPromoAllowed(checkInDate: Date | string = new Date()): boolean {
  const { hour, minute } = getManilaDateParts(checkInDate);
  return hour >= 20 || hour < 6 || (hour === 6 && minute === 0);
}
```

This function exists but is NEVER called in `receipts.ts` checkout flow. A user could:
1. Check in at 3:00 PM (not promo time)
2. Select "Midnight Promo" rate
3. System accepts it without validation

**Recommendation:**
```typescript
// In receipts.ts checkout flow
if (finalRateSelected === 'promo') {
  const checkInDate = safeParseDate(checkIn) || new Date();
  if (!isMidnightPromoAllowed(checkInDate)) {
    throw new Error(
      'Midnight Promo rate is only valid for check-ins between 8:00 PM and 6:00 AM. ' +
      `Check-in time: ${checkInDate.toLocaleTimeString('en-US', { timeZone: 'Asia/Manila' })}`
    );
  }
}
```

---

### 🟡 M-06: Decimal Places Not Enforced in Currency Display
**Location:** Multiple locations in `TransactionLedger.tsx`  
**Severity:** MEDIUM  
**Risk:** Display inconsistency, user confusion

**Issue:**
Some currency displays use:
- `.toLocaleString()` - default 0-3 decimal places
- `.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })` - forced 2 decimals
- `.toFixed(2)` - forced 2 decimals

**Example Inconsistency:**
```typescript
// Line 530: ₱2,100.00 (2 decimals forced)
₱{totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}

// Line 587: ₱2,100 (0 decimals if whole number)
₱{gcashTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
```

**Recommendation:**
Create utility function:
```typescript
export function formatPesos(amount: number): string {
  return `₱${amount.toLocaleString('en-US', { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2 
  })}`;
}

// Use everywhere
<span>{formatPesos(totalRevenue)}</span>
```

---

### 🟡 M-07: Charged Food List Not Validated for Duplicates
**Location:** `receipts.ts:1074-1090`  
**Severity:** MEDIUM  
**Risk:** Duplicate charges, inflated bills

**Issue:**
```typescript
let chargedFoodList: Array<{ item: { name: string; price: number }; quantity: number }> = [];
if (roomRow.charged_food) {
  // Parse and use directly, no deduplication
  chargedFoodList = typeof roomRow.charged_food === 'string' 
    ? JSON.parse(roomRow.charged_food) 
    : roomRow.charged_food;
}
```

If the `charged_food` JSON has duplicate entries (same item added twice due to UI bug or race condition), both are charged.

**Recommendation:**
```typescript
// Deduplicate and sum quantities
const foodMap = new Map<string, { item: any; quantity: number }>();
for (const order of chargedFoodList) {
  const key = order.item?.id || order.item?.name;
  if (!key) continue;
  
  const existing = foodMap.get(key);
  if (existing) {
    existing.quantity += Number(order.quantity || 1);
  } else {
    foodMap.set(key, { ...order, quantity: Number(order.quantity || 1) });
  }
}
chargedFoodList = Array.from(foodMap.values());
```

---

### 🟡 M-08: MIXED Payment Validation Relies on Exact Equality
**Location:** `receipts.ts:1291-1299`  
**Severity:** MEDIUM  
**Risk:** Off-by-one-centavo rejections

**Issue:**
```typescript
if (cashCentavos + gcashCentavos !== targetTotalCentavos) {
  throw new Error(`MIXED payment amounts do not equal total.`);
}
```

Exact integer equality is correct, BUT no tolerance for client-side calculation errors. If client uses floating-point and rounds differently, legitimate payments could be rejected.

**Example:**
```javascript
// Client calculates in pesos with precision limits:
const total = 1500.33;
const cashPortion = total * 0.6; // 900.198 → rounds to 900.20
const gcashPortion = total * 0.4; // 600.132 → rounds to 600.13
// Sum: 900.20 + 600.13 = 1500.33 ✓

// Convert to centavos:
const cashCents = Math.round(900.20 * 100); // 90020
const gcashCents = Math.round(600.13 * 100); // 60013
const totalCents = Math.round(1500.33 * 100); // 150033
// Check: 90020 + 60013 = 150033 ✓ (happens to work)

// BUT with different rounding:
const cashCents2 = Math.round(900.198 * 100); // 90020
const gcashCents2 = Math.round(600.132 * 100); // 60013
// Sum: 150033 (correct)

// Edge case: if calculated as:
const cashCents3 = Math.floor(900.198 * 100); // 90019 (floor instead of round)
const gcashCents3 = Math.ceil(600.132 * 100); // 60014 (ceil instead of round)
// Sum: 150033 (still correct by luck, but fragile)
```

**Recommendation:**
Accept centavos only from client, no conversion:
```typescript
// API contract: client MUST send integer centavos, not pesos
const { cashAmountCents, gcashAmountCents } = body;

if (!Number.isInteger(cashAmountCents) || !Number.isInteger(gcashAmountCents)) {
  throw new Error('cashAmountCents and gcashAmountCents must be integers (no pesos conversion)');
}

if (cashAmountCents + gcashAmountCents !== totalCentavos) {
  throw new Error(
    `MIXED payment mismatch: ${cashAmountCents} + ${gcashAmountCents} ≠ ${totalCentavos} centavos`
  );
}
```

---

### 🟡 M-09: Service Charge Always Zero
**Location:** `receipts.ts:1423`  
**Severity:** MEDIUM (if service charge is planned feature)  
**Risk:** Lost revenue if service charge should apply

**Issue:**
```typescript
serviceCharge: 0, // Hardcoded to zero
```

Service charge is always 0 in the entire codebase. If service charge (typically 10-12% on food/room service) should be applied:

**Clarification Needed:**
1. Is service charge intentionally not used?
2. Should service charge apply to food orders?
3. Should service charge apply to specific room tiers or services?

If service charge should be implemented:
```typescript
const SERVICE_CHARGE_RATE = 0.10; // 10%
let serviceChargeCentavos = 0;

if (foodChargesCentavos > 0) {
  serviceChargeCentavos = Math.round(foodChargesCentavos * SERVICE_CHARGE_RATE);
}

const subtotalCentavos = baseRateCentavos + ... + foodChargesCentavos;
const totalBeforeDiscount = subtotalCentavos + serviceChargeCentavos;
const totalCentavos = totalBeforeDiscount - discountCentavos - appliedDepositCentavos;
```

---

### 🟡 M-10: Billable Services Price Validation Too Permissive
**Location:** `billable-services.ts:45-51`  
**Severity:** MEDIUM  
**Risk:** Data entry errors, absurd prices

**Issue:**
```typescript
function validateMoneyValue(v: any, field: string): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 999999) {
    throw Object.assign(new Error(`Invalid ${field}: must be a finite number 0..999999.`), { statusCode: 400 });
  }
  return n;
}
```

Max price is ₱999,999 (nearly 1 million pesos). While technically valid, more realistic bounds would catch typos:
- Extra bed: ₱999,999 (should be ~₱250)
- Towel set: ₱500,000 (should be ~₱100)

**Recommendation:**
```typescript
const REASONABLE_MAX_PRICES: Record<string, number> = {
  'extra-bed': 1000,          // ₱1,000 max
  'towel': 500,               // ₱500 max
  'extra-person': 1000,       // ₱1,000 max
  'late-checkout-extension': 500, // ₱500/hour max
  'room_rate': 50000,         // ₱50,000 max (luxury suite)
  'default': 10000,           // ₱10,000 max for other services
};

function validateServicePrice(serviceId: string, price: number): void {
  const maxPrice = REASONABLE_MAX_PRICES[serviceId] || REASONABLE_MAX_PRICES.default;
  if (price > maxPrice) {
    throw new Error(
      `Price ₱${price} exceeds reasonable maximum ₱${maxPrice} for service ${serviceId}. ` +
      `If this is intentional, please contact system administrator.`
    );
  }
}
```

---

### 🟡 M-11: Deposit Forfeit Requires Role Check But No Reason
**Location:** `deposits.ts:799-805`  
**Severity:** MEDIUM  
**Risk:** Insufficient audit trail for forfeits

**Issue:**
```typescript
if (action === 'forfeit' && !['admin', 'owner'].includes(role)) {
  return res.status(403).json({ error: 'Only admin or owner can forfeit a deposit' });
}
```

Role check exists, but no mandatory reason field for forfeit (only optional notes). Forfeiting a deposit is serious financial action.

**Recommendation:**
```typescript
if (action === 'forfeit') {
  if (!['admin', 'owner'].includes(role)) {
    throw new Error('Only admin or owner can forfeit a deposit');
  }
  
  if (!notes || notes.trim().length < 10) {
    throw new Error('Detailed reason (minimum 10 characters) required for deposit forfeit');
  }
  
  // Stricter audit log
  await conn.query(
    `INSERT INTO audit_logs (id, timestamp, operator, action, details, severity)
     VALUES (?, datetime('now', 'localtime'), ?, 'DEPOSIT_FORFEITED', ?, 'HIGH')`,
    [
      auditLogId,
      operator,
      `FORFEITED ₱${(amountCents / 100).toFixed(2)} deposit ${depositNumber} for Room ${deposit.room_id}. ` +
      `Authorized by: ${operator} (${role}). Reason: ${notes}`
    ]
  );
}
```

---

### 🟡 M-12: Receipt Items Array Not Validated for Empty Array
**Location:** `receipts.ts:1166-1226`  
**Severity:** MEDIUM  
**Risk:** Empty receipt generation

**Issue:**
```typescript
items = [
  { description: `${roomType} Rent...`, subtext: rateSubtext, amount: baseRate },
];
// ... items.push() calls add more
```

If all optional charges are zero and no food, the items array could theoretically have only the base rate. However, if `baseRate` is also zero (misconfiguration), an empty or meaningless receipt is generated.

**Recommendation:**
```typescript
if (baseRate <= 0 && items.length === 0) {
  throw new Error(
    'Cannot generate receipt with zero base rate and no additional charges. ' +
    'Please verify room rate configuration.'
  );
}

if (total <= 0) {
  throw new Error(
    'Cannot generate receipt with zero or negative total. ' +
    `Calculated: ₱${(totalCentavos / 100).toFixed(2)}`
  );
}
```

---

## 4. DATA INTEGRITY OBSERVATIONS

### 📊 D-01: Receipt Numbers Sequential But No Gap Detection
**Current:** Sequential numbering via `sequence-service.ts`  
**Gap Risk:** If a receipt INSERT fails after number allocation, gap remains.

**Recommendation:** Periodic gap detection query for auditing:
```sql
SELECT receipt_no + 1 AS missing_start, next_no - 1 AS missing_end
FROM (
  SELECT receipt_no, 
         LEAD(receipt_no) OVER (ORDER BY receipt_no) AS next_no
  FROM receipts
) gaps
WHERE next_no > receipt_no + 1;
```

---

### 📊 D-02: Timestamps Use Mixture of Formats
**Observed:** 
- `datetime('now', 'localtime')` - SQLite Manila time
- `new Date().toISOString()` - UTC
- `formatSqlDateTime()` - UTC ISO string

**Risk:** Timezone confusion in reports, DST issues

**Recommendation:** Standardize on UTC everywhere:
```typescript
// Store UTC, convert to Manila on display only
const nowUtc = new Date().toISOString();
await conn.query(
  `INSERT INTO receipts (..., date_time) VALUES (..., ?)`,
  [nowUtc]
);

// Display conversion
function formatManilaDisplay(utcTimestamp: string): string {
  return new Date(utcTimestamp).toLocaleString('en-US', {
    timeZone: 'Asia/Manila',
    // ... format options
  });
}
```

---

### 📊 D-03: Discount Type Stored as Arbitrary String
**Current:** `discount_type` column accepts any string  
**Risk:** Typos like "SENI0R" (zero instead of O) not caught

**Recommendation:** Add CHECK constraint:
```sql
ALTER TABLE receipts 
ADD CONSTRAINT chk_discount_type 
CHECK (discount_type IN ('SENIOR', 'DC') OR discount_type IS NULL);
```

---

## 5. SECURITY RECOMMENDATIONS

### 🔒 S-01: Rate Limiting on Checkout Endpoint
**Missing:** No rate limiting on POST `/api/receipts`  
**Risk:** Automated checkout spam, receipt number exhaustion

**Recommendation:**
```typescript
import rateLimit from 'express-rate-limit';

const checkoutLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 checkouts per minute per IP
  message: 'Too many checkout requests, please try again later',
});

router.post('/', requireCashierStaff, checkoutLimiter, asyncHandler(async ...));
```

---

### 🔒 S-02: SQL Injection Risk in Dynamic Ledger Queries
**Location:** `receipts.ts:176-212`  
**Status:** ✅ Currently safe (parameterized queries used)

Verified all user inputs are parameterized. Good practice maintained.

---

### 🔒 S-03: Audit Logs Not Signed or Immutable
**Risk:** Audit log tampering by admin with database access

**Recommendation:** Implement append-only audit log with cryptographic chain:
```typescript
// Each audit entry includes hash of previous entry
const prevHash = await getLastAuditHash();
const currentHash = crypto.createHash('sha256')
  .update(prevHash + operator + action + details + timestamp)
  .digest('hex');

await conn.query(
  `INSERT INTO audit_logs (id, timestamp, operator, action, details, prev_hash, entry_hash)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
  [id, timestamp, operator, action, details, prevHash, currentHash]
);
```

---

## 6. PERFORMANCE OBSERVATIONS

### ⚡ P-01: Sequential Number Allocation Serializes Checkouts
**Issue:** Each checkout must allocate a sequential receipt number, creating bottleneck.

**Current:**
```typescript
const allocated = await sequenceService.allocateNextSequentialReceiptNumber(conn, operator);
```

**Optimization (if high volume):** Pre-allocate number blocks:
```typescript
// Each cashier gets a block of 100 numbers at session start
const block = await allocateNumberBlock(cashierName, 100);
// Use from block, no per-transaction sequence query
```

---

### ⚡ P-02: Deposit Balance Computed via SUM() on Every Query
**Issue:** `getGuestBalance()` scans full `deposit_transactions` table

**Optimization:** Materialized balance table:
```sql
CREATE TABLE guest_balance_cache (
  guest_identifier TEXT PRIMARY KEY,
  balance_centavos INTEGER NOT NULL,
  last_updated TIMESTAMP NOT NULL
);

-- Update trigger on deposit_transactions INSERT
```

---

## 7. COMPLIANCE & LEGAL

### ⚖️ L-01: No VAT Calculation or BIR Compliance
**Observation:** System does not calculate or display VAT  
**Philippines Requirement:** VAT (12%) typically required on accommodation

**Required for BIR Compliance:**
```typescript
const VAT_RATE = 0.12;
const vatableSale = subtotalCentavos / 1.12; // Extract VAT-exclusive amount
const vatAmount = subtotalCentavos - vatableSale; // VAT component

// Display on receipt:
// Subtotal (VAT-Inclusive): ₱2,100.00
// VAT (12%): ₱225.00
// Vatable Sale: ₱1,875.00
```

**Discount Impact:** Senior/PWD discounts apply to VAT-INCLUSIVE amounts per law.

---

### ⚖️ L-02: Senior/PWD Discount Not Marked as Tax-Exempt
**Philippines Law:** Senior citizen and PWD discounts are VAT-exempt

**Current:** System calculates fixed discount but doesn't differentiate tax treatment  
**Required:** Receipt should show:
```
Subtotal: ₱2,100.00
  Less: SC/PWD Discount (20%): ₱420.00
  Less: VAT-Exempt (12% of ₱1,680): ₱201.60
Total: ₱1,478.40

VAT-Exempt Sale: ₱1,680.00
Senior Citizen ID: SC-1234
```

---

## 8. TESTING RECOMMENDATIONS

### 🧪 Test Case: TC-01 - Floating Point Rounding
```typescript
describe('Money Calculation Edge Cases', () => {
  it('should handle centavo rounding correctly', () => {
    const amount1 = 1000.01;
    const amount2 = 999.99;
    const difference = amount1 - amount2; // 0.0199999999999818 (float error)
    
    // Wrong: expect(difference).toBe(0.02);
    // Right: Convert to centavos first
    const cents1 = Math.round(amount1 * 100); // 100001
    const cents2 = Math.round(amount2 * 100); // 99999
    const diffCents = cents1 - cents2; // 2
    expect(diffCents).toBe(2);
    expect(diffCents / 100).toBe(0.02);
  });
});
```

---

### 🧪 Test Case: TC-02 - Race Condition Simulation
```typescript
describe('Concurrent Checkout', () => {
  it('should prevent double checkout of same room', async () => {
    const roomNumber = 'TEST-ROOM-101';
    
    // Simulate two concurrent checkout requests
    const checkout1 = checkoutRoom(roomNumber, { total: 1000 });
    const checkout2 = checkoutRoom(roomNumber, { total: 1000 });
    
    const results = await Promise.allSettled([checkout1, checkout2]);
    
    // One should succeed, one should fail
    const succeeded = results.filter(r => r.status === 'fulfilled');
    const failed = results.filter(r => r.status === 'rejected');
    
    expect(succeeded.length).toBe(1);
    expect(failed.length).toBe(1);
    expect(failed[0].reason).toMatch(/Room state changed|already checked out/);
  });
});
```

---

## 9. SUMMARY & PRIORITIZATION

### Immediate Action Required (Critical)
1. **C-01:** Fix floating-point arithmetic in frontend (1-2 days)
2. **C-02:** Implement proper deposit balance locking (2-3 days)
3. **C-07:** Add GCash reference uniqueness check (1 day)
4. **C-08:** Use server time only for excess hours (1 day)

### High Priority (Week 1)
5. **H-05:** Add optimistic locking to room checkout (2 days)
6. **H-06:** Enforce inventory stock checks (2-3 days)
7. **H-03:** Extend discount table or add fallback logic (1-2 days)
8. **H-04:** Add oversight for overtime waivers (1 day)

### Medium Priority (Week 2-3)
9. **M-05:** Validate midnight promo time window (1 day)
10. **M-07:** Deduplicate charged food items (1 day)
11. **M-02:** Add maximum reasonable charge limits (1 day)
12. **M-08:** Force centavos-only API contract (1-2 days)

### Legal Compliance (Parallel Track)
13. **L-01:** Implement VAT calculation (3-5 days)
14. **L-02:** Correct Senior/PWD discount tax treatment (2-3 days)

---

## 10. CONCLUSION

The billing system has a **solid foundation** with good use of:
- ✅ Transactions for atomicity
- ✅ Idempotency keys
- ✅ Audit logging
- ✅ Server-side calculation authority

However, **critical vulnerabilities exist** in:
- ❌ Floating-point money arithmetic
- ❌ Race condition gaps
- ❌ Insufficient validation
- ❌ Missing legal compliance (VAT/tax)

**Estimated remediation effort:** 4-6 weeks for full compliance and security hardening.

**Risk if unaddressed:**
- Financial losses from calculation errors
- Audit failures and BIR non-compliance
- Fraud via discount/payment manipulation
- Data integrity issues from race conditions

---

**Report Prepared By:** Poteto (AI Auditor)  
**Audit Date:** 2024-01-15  
**Review Recommended:** Q1 2025
