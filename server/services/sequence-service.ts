/**
 * server/services/sequence-service.ts
 * Atomic sequential counter allocator and configuration engine for official receipts and deposit slips.
 *
 * Requirements:
 * 1. Format: {CASHIER}-{SHIFT}-{MMDDYY}-{SEQ} (e.g. T-N-092926-001)
 *    - CASHIER: Initial(s) of cashier (e.g. T, TE, TEA) derived and disambiguated.
 *    - SHIFT: D (day) or N (night) from active shift session.
 *    - MMDDYY: Start date of shift (night shift crossing midnight keeps start date).
 *    - SEQ: Atomic counter incremented via `receipt_counters` (cashier_code, shift_code, business_date, last_value).
 * 2. Deposit format: DEP-{CASHIER}-{SHIFT}-{MMDDYY}-{SEQ} via `deposit_counters`.
 * 3. Backward compatibility with legacy SCTI-xxxxxx format.
 * 4. Consumed stay duration formatting: "1 hr 25 mins", "5 mins", "Less than 1 min".
 */

import { TransactionClient, pool, withTransaction } from '../db/pool';
import { getBusinessDateAndShift } from './analytics-service';

export interface SequentialReceiptInfo {
  receiptNo: string;
  cashierCode: string;
  shiftCode: 'D' | 'N';
  businessDate: string; // MMDDYY
  sequenceNumber: number;
}

export interface SequentialDepositInfo {
  depositNumber: string;
  depositNo?: string;
  cashierCode: string;
  shiftCode: 'D' | 'N';
  businessDate: string; // MMDDYY
  sequenceNumber: number;
}

export interface SequenceInfo {
  name: string;
  prefix: string;
  lastValue: number;
  nextReceiptNo: string;
}

/**
 * Derives unique cashier code from cashier name/username.
 * If collisions exist among known cashiers, extends to 2 letters, then 3 letters.
 * e.g., "Teresa" -> "T" (or "TE" if "Tina" exists, "TER" if "Ted" and "Tess" exist).
 */
export function resolveCashierCode(cashierName: string, existingList: string[] = []): string {
  const cleanName = (cashierName || 'Frontdesk').trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (!cleanName) return 'F';

  if (!existingList || existingList.length === 0) {
    return cleanName.slice(0, 1) || 'F';
  }

  const upperList = existingList.map(n => n.trim().toUpperCase()).filter(Boolean);

  for (let len = 1; len <= Math.min(4, cleanName.length); len++) {
    const candidate = cleanName.slice(0, len);
    const isCodeCollision = upperList.includes(candidate);
    const isNameConflict = upperList.some(n => n.length > 4 && n !== cleanName && n.startsWith(candidate));
    if (!isCodeCollision && !isNameConflict) {
      return candidate;
    }
  }

  return cleanName.slice(0, 3) || cleanName.slice(0, 2) || cleanName.slice(0, 1) || 'F';
}

export const deriveCashierCode = resolveCashierCode;

/**
 * Normalizes shift input to 'D' (Day) or 'N' (Night).
 */
export function formatShiftCode(shiftInput: string | null | undefined): 'D' | 'N' {
  if (!shiftInput) return 'D';
  const upper = String(shiftInput).trim().toUpperCase();
  if (upper === 'NIGHT' || upper === 'N') return 'N';
  return 'D';
}

/**
 * Formats a Date or ISO string into MMDDYY (e.g. 2026-09-29 -> "092926").
 */
export function formatDateMMDDYY(dateInput: Date | string = new Date()): string {
  if (typeof dateInput === 'string' && /^\d{6}$/.test(dateInput.trim())) {
    return dateInput.trim();
  }
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) return '010126';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${mm}${dd}${yy}`;
}

/**
 * Formats a Date or ISO string into MMDDYY (e.g. 2026-09-29 -> "092926")
 * using the shift's business date (night shifts preserve start date).
 */
export function formatBusinessDateMMDDYY(
  dateInput: Date | string = new Date(),
  businessDayStartStr: string = '06:00'
): { mmddyy: string; shiftCode: 'D' | 'N'; businessDateIso: string } {
  const { businessDate, shift } = getBusinessDateAndShift(dateInput, businessDayStartStr);
  const parts = businessDate.split('-');
  const yyyy = parts[0] || '2026';
  const mm = parts[1] || '01';
  const dd = parts[2] || '01';
  const yy = yyyy.slice(-2);
  const mmddyy = `${mm}${dd}${yy}`;
  const shiftCode: 'D' | 'N' = shift === 'DAY' ? 'D' : 'N';

  return { mmddyy, shiftCode, businessDateIso: businessDate };
}

/**
 * Formats full sequential receipt number {CASHIER}-{SHIFT}-{MMDDYY}-{SEQ}.
 */
export function formatSequentialReceiptNumber(
  cashierCode: string,
  shiftCode: string,
  businessDate: string,
  seq: number
): string {
  const cCode = (cashierCode || 'F').toUpperCase();
  const sCode = formatShiftCode(shiftCode);
  const dateStr = formatDateMMDDYY(businessDate);
  const seqStr = String(seq).padStart(3, '0');
  return `${cCode}-${sCode}-${dateStr}-${seqStr}`;
}

/**
 * Formats full sequential deposit number DEP-{CASHIER}-{SHIFT}-{MMDDYY}-{SEQ}.
 */
export function formatDepositSlipNumber(
  cashierCode: string,
  shiftCode: string,
  businessDate: string,
  seq: number
): string {
  const cCode = (cashierCode || 'F').toUpperCase();
  const sCode = formatShiftCode(shiftCode);
  const dateStr = formatDateMMDDYY(businessDate);
  const seqStr = String(seq).padStart(3, '0');
  return `DEP-${cCode}-${sCode}-${dateStr}-${seqStr}`;
}

export class SequenceService {
  /**
   * Derives cashier code by inspecting active users in the database for collisions.
   */
  async getDisambiguatedCashierCode(conn: TransactionClient | null, cashierName: string): Promise<string> {
    try {
      const db = conn || pool;
      const usersRes = await db.query('SELECT username, name FROM users');
      const names: string[] = [];
      for (const u of usersRes.rows) {
        if (u.username) names.push(u.username);
        if (u.name) names.push(u.name);
      }
      return resolveCashierCode(cashierName, names);
    } catch {
      return resolveCashierCode(cashierName);
    }
  }

  /**
   * Atomically increments `receipt_counters` and returns formatted receipt info.
   */
  async allocateShiftReceiptNumber(
    conn: TransactionClient,
    options: {
      cashierCode?: string;
      cashierName?: string;
      shift?: string;
      date?: string | Date;
    }
  ): Promise<SequentialReceiptInfo> {
    const cashierCode = options.cashierCode
      ? options.cashierCode.toUpperCase()
      : (await this.getDisambiguatedCashierCode(conn, options.cashierName || 'Frontdesk'));
    const shiftCode = formatShiftCode(options.shift);
    const businessDate = options.date ? formatDateMMDDYY(options.date) : formatBusinessDateMMDDYY().mmddyy;

    let res = await conn.query(
      `SELECT last_value FROM receipt_counters 
       WHERE cashier_code = ? AND shift_code = ? AND business_date = ?`,
      [cashierCode, shiftCode, businessDate]
    );

    let currentVal = 0;
    if (res.rows.length === 0) {
      await conn.query(
        `INSERT INTO receipt_counters (cashier_code, shift_code, business_date, last_value, updated_at)
         VALUES (?, ?, ?, 0, CURRENT_TIMESTAMP)`,
        [cashierCode, shiftCode, businessDate]
      );
      currentVal = 0;
    } else {
      currentVal = Number(res.rows[0].last_value || 0);
    }

    const nextVal = currentVal + 1;

    await conn.query(
      `UPDATE receipt_counters 
       SET last_value = ?, updated_at = CURRENT_TIMESTAMP
       WHERE cashier_code = ? AND shift_code = ? AND business_date = ?`,
      [nextVal, cashierCode, shiftCode, businessDate]
    );

    const receiptNo = formatSequentialReceiptNumber(cashierCode, shiftCode, businessDate, nextVal);

    return {
      receiptNo,
      cashierCode,
      shiftCode,
      businessDate,
      sequenceNumber: nextVal,
    };
  }

  /**
   * Allocates or reuses pre-print receipt number for a specific room.
   */
  async allocatePrePrintForRoom(
    conn: TransactionClient,
    roomNumber: string,
    options: {
      cashierCode?: string;
      cashierName?: string;
      shift?: string;
      date?: string | Date;
    } = {}
  ): Promise<{ receiptNo: string; isReused: boolean }> {
    const roomRes = await conn.query('SELECT allocated_receipt_no FROM rooms WHERE number = ?', [roomNumber]);
    if (roomRes.rows.length > 0 && roomRes.rows[0].allocated_receipt_no) {
      return {
        receiptNo: roomRes.rows[0].allocated_receipt_no,
        isReused: true,
      };
    }

    const alloc = await this.allocateShiftReceiptNumber(conn, options);
    await conn.query('UPDATE rooms SET allocated_receipt_no = ? WHERE number = ?', [alloc.receiptNo, roomNumber]);

    return {
      receiptNo: alloc.receiptNo,
      isReused: false,
    };
  }

  /**
   * Allocate the next sequential RECEIPT NO in format:
   * {CASHIER}-{SHIFT}-{MMDDYY}-{SEQ} (e.g. T-N-092926-001)
   */
  async allocateNextSequentialReceiptNumber(
    conn: TransactionClient,
    cashierName: string,
    overrideDate: Date | string = new Date(),
    businessDayStart: string = '06:00'
  ): Promise<SequentialReceiptInfo> {
    const cashierCode = await this.getDisambiguatedCashierCode(conn, cashierName);
    const { mmddyy, shiftCode } = formatBusinessDateMMDDYY(overrideDate, businessDayStart);

    return await this.allocateShiftReceiptNumber(conn, {
      cashierCode,
      shift: shiftCode,
      date: mmddyy,
    });
  }

  /**
   * Atomically increments `deposit_counters` and returns formatted deposit info.
   */
  async allocateShiftDepositNumber(
    conn: TransactionClient,
    options: {
      cashierCode?: string;
      cashierName?: string;
      shift?: string;
      date?: string | Date;
    }
  ): Promise<SequentialDepositInfo> {
    const cashierCode = options.cashierCode
      ? options.cashierCode.toUpperCase()
      : (await this.getDisambiguatedCashierCode(conn, options.cashierName || 'Frontdesk'));
    const shiftCode = formatShiftCode(options.shift);
    const businessDate = options.date ? formatDateMMDDYY(options.date) : formatBusinessDateMMDDYY().mmddyy;

    let res = await conn.query(
      `SELECT last_value FROM deposit_counters 
       WHERE cashier_code = ? AND shift_code = ? AND business_date = ?`,
      [cashierCode, shiftCode, businessDate]
    );

    let currentVal = 0;
    if (res.rows.length === 0) {
      await conn.query(
        `INSERT INTO deposit_counters (cashier_code, shift_code, business_date, last_value, updated_at)
         VALUES (?, ?, ?, 0, CURRENT_TIMESTAMP)`,
        [cashierCode, shiftCode, businessDate]
      );
      currentVal = 0;
    } else {
      currentVal = Number(res.rows[0].last_value || 0);
    }

    const nextVal = currentVal + 1;

    await conn.query(
      `UPDATE deposit_counters 
       SET last_value = ?, updated_at = CURRENT_TIMESTAMP
       WHERE cashier_code = ? AND shift_code = ? AND business_date = ?`,
      [nextVal, cashierCode, shiftCode, businessDate]
    );

    const depositNumber = formatDepositSlipNumber(cashierCode, shiftCode, businessDate, nextVal);

    return {
      depositNumber,
      depositNo: depositNumber,
      cashierCode,
      shiftCode,
      businessDate,
      sequenceNumber: nextVal,
    } as any;
  }

  /**
   * Marks an allocated pre-print receipt as VOID in the database with audit logging.
   */
  async voidAllocatedReceipt(
    conn: TransactionClient,
    receiptNo: string,
    reason: string,
    operator: string,
    roomNumber?: string
  ): Promise<void> {
    const existing = await conn.query('SELECT * FROM receipts WHERE receipt_no = ?', [receiptNo]);
    const nowIso = new Date().toISOString();

    if (existing.rows.length > 0) {
      await conn.query(
        `UPDATE receipts SET status = 'void', void_reason = ?, voided_at = ?, voided_by = ? WHERE receipt_no = ?`,
        [reason.trim(), nowIso, operator, receiptNo]
      );
    } else {
      let roomRow: any = null;
      if (roomNumber) {
        const roomRes = await conn.query('SELECT * FROM rooms WHERE number = ?', [roomNumber]);
        if (roomRes.rows.length > 0) roomRow = roomRes.rows[0];
      }
      await conn.query(
        `INSERT INTO receipts (
          receipt_no, date_time, guest_name, room_number, room_type,
          payment_method, check_in, check_out, items, subtotal, service_charge, total,
          cashier_id, status, void_reason, voided_at, voided_by
        ) VALUES (?, ?, ?, ?, ?, 'CASH', ?, ?, '[]', 0, 0, 0, ?, 'void', ?, ?, ?)`,
        [
          receiptNo,
          nowIso,
          roomRow?.guest_name || 'Cancelled Guest',
          roomNumber ? String(roomNumber) : 'N/A',
          roomRow?.room_type || 'Standard Room',
          roomRow?.check_in_time || nowIso,
          nowIso,
          operator,
          reason.trim(),
          nowIso,
          operator,
        ]
      );
    }

    if (roomNumber) {
      await conn.query('UPDATE rooms SET allocated_receipt_no = NULL WHERE number = ?', [roomNumber]);
    }

    const auditId = `audit-void-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    await conn.query(
      `INSERT INTO audit_logs (id, timestamp, operator, action, details)
       VALUES (?, datetime('now', 'localtime'), ?, 'RECEIPT_VOIDED', ?)`,
      [auditId, operator, `Receipt ${receiptNo} marked VOID: ${reason.trim()}`]
    );
  }

  /**
   * Allocate the next sequential DEPOSIT NO in format:
   * DEP-{CASHIER}-{SHIFT}-{MMDDYY}-{SEQ} (e.g. DEP-T-N-092926-001)
   */
  async allocateNextSequentialDepositNumber(
    conn: TransactionClient,
    cashierName: string,
    overrideDate: Date | string = new Date(),
    businessDayStart: string = '06:00'
  ): Promise<SequentialDepositInfo> {
    const cashierCode = await this.getDisambiguatedCashierCode(conn, cashierName);
    const { mmddyy, shiftCode } = formatBusinessDateMMDDYY(overrideDate, businessDayStart);

    return await this.allocateShiftDepositNumber(conn, {
      cashierCode,
      shift: shiftCode,
      date: mmddyy,
    });
  }

  /**
   * Legacy allocation method for backwards compatibility with test harness and legacy sequence counters.
   */
  async allocateNextReceiptNumber(
    conn: TransactionClient,
    sequenceName: string = 'default',
    cashierName?: string
  ): Promise<{ receiptNo: string; sequenceNumber: number; prefix: string }> {
    if (cashierName) {
      const seqRes = await this.allocateNextSequentialReceiptNumber(conn, cashierName);
      return {
        receiptNo: seqRes.receiptNo,
        sequenceNumber: seqRes.sequenceNumber,
        prefix: `${seqRes.cashierCode}-${seqRes.shiftCode}`,
      };
    }

    const name = sequenceName.trim() || 'default';
    let res = await conn.query(
      'SELECT name, prefix, last_value FROM receipt_sequences WHERE name = ?',
      [name]
    );

    if (res.rows.length === 0) {
      const defaultPrefix = name === 'deposit_default' ? 'DEP' : 'SCTI';
      const defaultStart = name === 'deposit_default' ? 0 : 43;
      await conn.query(
        `INSERT INTO receipt_sequences (name, prefix, last_value)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE updated_at = NOW()`,
        [name, defaultPrefix, defaultStart]
      );
      res = await conn.query(
        'SELECT name, prefix, last_value FROM receipt_sequences WHERE name = ?',
        [name]
      );
    }

    const row = res.rows[0];
    const prefix = row.prefix || 'SCTI';
    const currentVal = Number(row.last_value || 0);
    const nextVal = currentVal + 1;

    await conn.query(
      'UPDATE receipt_sequences SET last_value = ?, updated_at = NOW() WHERE name = ?',
      [nextVal, name]
    );

    const padded = String(Math.max(1, Math.floor(nextVal))).padStart(6, '0');
    const receiptNo = `${prefix}-${padded}`;

    return {
      receiptNo,
      sequenceNumber: nextVal,
      prefix,
    };
  }

  formatReceiptNumber(prefix: string, sequenceNumber: number): string {
    const cleanPrefix = (prefix || 'SCTI').trim().toUpperCase();
    const padded = String(Math.max(1, Math.floor(sequenceNumber))).padStart(6, '0');
    return `${cleanPrefix}-${padded}`;
  }

  async getSequenceInfo(sequenceName: string = 'default'): Promise<SequenceInfo> {
    const name = sequenceName.trim() || 'default';
    const res = await pool.query(
      'SELECT name, prefix, last_value FROM receipt_sequences WHERE name = ?',
      [name]
    );

    if (res.rows.length === 0) {
      return {
        name,
        prefix: 'SCTI',
        lastValue: 43,
        nextReceiptNo: 'SCTI-000044',
      };
    }

    const row = res.rows[0];
    const prefix = row.prefix || 'SCTI';
    const lastValue = Number(row.last_value || 0);

    return {
      name: row.name,
      prefix,
      lastValue,
      nextReceiptNo: `${prefix}-${String(lastValue + 1).padStart(6, '0')}`,
    };
  }

  async updateStartingValue(
    newStartValue: number,
    operatorUsername: string,
    sequenceName: string = 'default',
    newPrefix?: string
  ): Promise<SequenceInfo> {
    const name = sequenceName.trim() || 'default';
    const targetValue = Math.floor(Number(newStartValue));

    if (isNaN(targetValue) || targetValue < 0) {
      throw Object.assign(new Error('Starting sequence value must be a valid non-negative integer.'), { statusCode: 400 });
    }

    return await withTransaction(async (conn) => {
      let res = await conn.query(
        'SELECT name, prefix, last_value FROM receipt_sequences WHERE name = ?',
        [name]
      );

      let currentLastVal = 43;
      let currentPrefix = 'SCTI';

      if (res.rows.length > 0) {
        currentLastVal = Number(res.rows[0].last_value || 0);
        currentPrefix = res.rows[0].prefix || 'SCTI';
      }

      if (targetValue <= currentLastVal) {
        throw Object.assign(
          new Error(
            `Starting sequence value (${targetValue}) must be strictly greater than current counter (${currentLastVal}). Downward or equal changes are prohibited to prevent receipt number collisions.`
          ),
          { statusCode: 400 }
        );
      }

      const finalPrefix = (newPrefix && newPrefix.trim()) ? newPrefix.trim().toUpperCase() : currentPrefix;

      if (res.rows.length === 0) {
        await conn.query(
          'INSERT INTO receipt_sequences (name, prefix, last_value) VALUES (?, ?, ?)',
          [name, finalPrefix, targetValue]
        );
      } else {
        await conn.query(
          'UPDATE receipt_sequences SET last_value = ?, prefix = ?, updated_at = NOW() WHERE name = ?',
          [targetValue, finalPrefix, name]
        );
      }

      const auditId = `audit-seq-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
      const nextNo = `${finalPrefix}-${String(targetValue + 1).padStart(6, '0')}`;
      await conn.query(
        `INSERT INTO audit_logs (id, timestamp, operator, action, details)
         VALUES (?, NOW(), ?, 'RECEIPT_SEQUENCE_UPDATED', ?)`,
        [
          auditId,
          operatorUsername,
          `Adjusted receipt sequence "${name}" starting value from ${currentLastVal} to ${targetValue} (prefix: ${finalPrefix}, next receipt: ${nextNo})`,
        ]
      );

      return {
        name,
        prefix: finalPrefix,
        lastValue: targetValue,
        nextReceiptNo: nextNo,
      };
    });
  }
}

export const sequenceService = new SequenceService();

/**
 * Formats consumed stay minutes into `{h} hr {m} mins`, omitting zero parts.
 * Requirements:
 * - Format: "1 hr 25 mins" (IN 8:41 AM, OUT 10:06 AM)
 * - "5 mins" (IN 5:00 AM, OUT 5:05 AM)
 * - Under a minute prints "Less than 1 min".
 * - Round down (Math.floor).
 */
export function formatConsumedTime(minutes: number | null | undefined): string {
  if (minutes == null || isNaN(minutes) || minutes < 1) {
    return 'Less than 1 min';
  }

  const totalMinutes = Math.floor(minutes);
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;

  if (hours > 0 && mins > 0) {
    return `${hours} hr ${mins} mins`;
  }
  if (hours > 0 && mins === 0) {
    return `${hours} hr`;
  }
  if (hours === 0 && mins > 0) {
    return `${mins} mins`;
  }
  return 'Less than 1 min';
}

/**
 * Masks discount card reference numbers for privacy (showing last 4 digits only).
 * e.g., 'DC-2026-9876' -> '****-9876'
 *      'PWD-1234567'  -> '****-4567'
 */
export function maskDiscountCardId(cardId?: string | null): string {
  if (!cardId || typeof cardId !== 'string') return '';
  const trimmed = cardId.trim();
  if (trimmed.length <= 4) return trimmed;
  const lastFour = trimmed.slice(-4);
  return `****-${lastFour}`;
}
