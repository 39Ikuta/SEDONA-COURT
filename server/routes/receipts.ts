/**
 * server/routes/receipts.ts
 * GET  /api/receipts     — list all receipts (optionally filter by ?cashier=&date=)
 * POST /api/receipts     — create a new receipt on checkout (server-computed, idempotent, transactional)
 */

import { Router, Request, Response } from 'express';
import { pool, withTransaction } from '../db/pool';
import { requireAuth, requireCashierStaff, requireAdmin } from '../middleware/auth';
import { socketManager } from '../websocket/socket-manager';
import { weeklyReportAggregator } from '../services/weekly-report-aggregator';
import { calculateStayRate, DEFAULT_TIER_RATES, formatStayDuration, calculateExcessHours } from '../utils/pricing';
import { getDiscountAmount, normalizeDiscountType } from '../utils/discount-rates';
import { asyncHandler } from '../utils/async-handler';
import { inventoryService } from '../services/inventory-service';
import { sequenceService, formatConsumedTime, maskDiscountCardId } from '../services/sequence-service';
import { safeCentavosAdd, validateCentavos, validateSplitPaymentCentavos, validateReasonableBill, centavosToPesos } from '../utils/money';
import { buildReceiptEscPosBuffer } from '../utils/escpos';
import { getBusinessDateAndShift, resolveDateRange, analyticsService } from '../services/analytics-service';

const router = Router();

function rowToReceipt(row: any) {
  let items = [];
  if (row.items) {
    try {
      items = typeof row.items === 'string' ? JSON.parse(row.items) : row.items;
    } catch (parseErr) {
      console.warn(`rowToReceipt: Failed to parse items JSON for receipt ${row.receipt_no}:`, parseErr);
      items = [];
    }
  }

  // Derive rateSelected and stayDuration from items or metadata
  const rentItem = items.find((it: any) => it.description?.toLowerCase().includes('rent') || it.subtext?.toLowerCase().includes('stay') || it.subtext?.toLowerCase().includes('base'));
  let rateSelected = row.rate_selected;
  let stayDuration = row.stay_duration;
  if (!rateSelected && rentItem?.subtext) {
    if (rentItem.subtext.toLowerCase().includes('3h') || rentItem.subtext.toLowerCase().includes('3 hour')) rateSelected = '3h';
    else if (rentItem.subtext.toLowerCase().includes('6h') || rentItem.subtext.toLowerCase().includes('6 hour')) rateSelected = '6h';
    else if (rentItem.subtext.toLowerCase().includes('12h') || rentItem.subtext.toLowerCase().includes('12 hour')) rateSelected = '12h';
    else if (rentItem.subtext.toLowerCase().includes('promo')) rateSelected = 'promo';
    else if (rentItem.subtext.toLowerCase().includes('24h') || rentItem.subtext.toLowerCase().includes('24 hour')) rateSelected = '24h';
  }
  if (!stayDuration && rateSelected) {
    stayDuration = formatStayDuration(rateSelected);
  }

  // Derive discount info: prefer persisted DB columns, fall back to item-parsing for legacy receipts
  let discount: number | undefined;
  let discountType: string | undefined;
  let discountIdRef: string | undefined;

  if (row.discount_amount && Number(row.discount_amount) > 0) {
    // Use persisted discount fields from DB
    discount = Number(row.discount_amount);
    discountType = row.discount_type || undefined;
    discountIdRef = row.discount_id_ref || undefined;
  } else {
    // Fallback: derive from items for receipts created before discount column migration
    const discountItem = items.find((it: any) => it.amount < 0 || it.description?.toLowerCase().includes('discount'));
    if (discountItem) {
      discount = Math.abs(Number(discountItem.amount) || 0);
      if (discountItem.description?.toLowerCase().includes('card') || discountItem.description?.includes('(DC)')) {
        discountType = 'DC';
      } else {
        discountType = 'SENIOR';
      }
      const match = discountItem.subtext?.match(/\[(?:ID|Card #|Ref):\s*([^\]]+)\]/i);
      if (match) {
        discountIdRef = match[1].trim();
      }
    }
  }

  // Integer centavos amount tendered & change resolution
  const amountTenderedCents = row.amount_tendered_cents != null ? Number(row.amount_tendered_cents) : undefined;
  const changeCents = row.change_cents != null ? Number(row.change_cents) : undefined;
  const amountTendered = amountTenderedCents != null
    ? amountTenderedCents / 100
    : (row.payment_method === 'CASH' ? parseFloat(row.total || 0) : undefined);
  const changeAmount = changeCents != null ? changeCents / 100 : 0;

  // Consumed time resolution (stored minutes + formatted string)
  const consumedMinutes = row.consumed_minutes != null ? Number(row.consumed_minutes) : undefined;
  const timeConsumed = consumedMinutes != null ? formatConsumedTime(consumedMinutes) : undefined;

  let receiptSnapshot = null;
  if (row.receipt_snapshot) {
    try {
      receiptSnapshot = typeof row.receipt_snapshot === 'string' ? JSON.parse(row.receipt_snapshot) : row.receipt_snapshot;
    } catch (e) {
      receiptSnapshot = null;
    }
  }

  return {
    receiptNo: row.receipt_no,
    dateTime: row.date_time instanceof Date ? row.date_time.toISOString() : String(row.date_time),
    guestName: row.guest_name,
    roomNumber: String(row.room_number || ''),
    roomType: row.room_type,
    paymentMethod: row.payment_method,
    gcashRef: row.gcash_ref,
    cashAmount: row.cash_amount ? parseFloat(row.cash_amount) : undefined,
    gcashAmount: row.gcash_amount ? parseFloat(row.gcash_amount) : undefined,
    amountTendered,
    changeAmount,
    amountTenderedCents,
    changeCents,
    consumedMinutes,
    timeConsumed,
    checkIn: row.check_in instanceof Date ? row.check_in.toISOString() : (row.check_in ? String(row.check_in) : undefined),
    checkOut: row.check_out instanceof Date ? row.check_out.toISOString() : (row.check_out ? String(row.check_out) : undefined),
    items: items,
    subtotal: parseFloat(row.subtotal || 0),
    serviceCharge: parseFloat(row.service_charge || 0),
    total: parseFloat(row.total || 0),
    discount: discount,
    discountType: discountType,
    discountIdRef: discountIdRef,
    cashierId: row.cashier_id,
    rateSelected: rateSelected,
    stayDuration: stayDuration,
    status: row.status || 'valid',
    voidReason: row.void_reason || undefined,
    voidedAt: row.voided_at || undefined,
    voidedBy: row.voided_by || undefined,
    reprintCount: Number(row.reprint_count || 0),
    lastReprintedAt: row.last_reprinted_at || undefined,
    lastReprintedBy: row.last_reprinted_by || undefined,
    idempotencyKey: row.idempotency_key || undefined,
    receiptSnapshot,
  };
}

// GET /api/receipts/ledger — Section 9: Live Ledger Invoices with server-side filtering, sorting, pagination, and grouping
export async function handleGetReceiptsLedger(req: Request, res: Response): Promise<void> {
  const operator = (req as any).operator;
  if (!operator || !['cashier', 'admin', 'owner'].includes(operator.role)) {
    res.status(403).json({ error: 'Access denied: only cashier, admin, or owner can view transaction ledger' });
    return;
  }

  const {
    date,
    from,
    to,
    shift: shiftParam,
    businessDayStart = '06:00',
    type = 'sales', // 'sales' | 'deposits' | 'all'
    status: statusParam = 'all', // 'all' | 'valid' | 'void'
    paymentMethod,
    cashier,
    sortBy = 'date_time',
    sortOrder = 'DESC',
    page = '1',
    limit = '50',
    groupBy = 'none', // 'none' | 'shift' | 'date'
  } = req.query as Record<string, string>;

  const range = resolveDateRange({
    date,
    from,
    to,
    shift: shiftParam as any,
    businessDayStart,
  });

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.max(1, Math.min(500, parseInt(limit, 10) || 50));
  const isAsc = String(sortOrder).toUpperCase() === 'ASC';

  // 1. Fetch Sales Receipts from database
  let receiptsList: any[] = [];
  if (type === 'sales' || type === 'all') {
    let sql = `SELECT * FROM receipts WHERE date_time >= ? AND date_time < ?`;
    const params: any[] = [range.startIso, range.endIso];

    if (statusParam === 'valid') {
      sql += ` AND status = 'valid'`;
    } else if (statusParam === 'void') {
      sql += ` AND status = 'void'`;
    }

    if (paymentMethod && paymentMethod !== 'ALL') {
      sql += ` AND UPPER(payment_method) = UPPER(?)`;
      params.push(paymentMethod);
    }

    if (cashier) {
      sql += ` AND LOWER(cashier_id) LIKE LOWER(?)`;
      params.push(`%${cashier}%`);
    }

    const recResult = await pool.query(sql, params);
    receiptsList = recResult.rows;
  }

  // 2. Fetch Security Deposits if requested
  let depositsList: any[] = [];
  if (type === 'deposits' || type === 'all') {
    let depSql = `SELECT * FROM deposits WHERE created_at >= ? AND created_at < ?`;
    const depParams: any[] = [range.startIso, range.endIso];

    if (cashier) {
      depSql += ` AND (LOWER(collected_by) LIKE LOWER(?) OR LOWER(resolved_by) LIKE LOWER(?))`;
      depParams.push(`%${cashier}%`, `%${cashier}%`);
    }

    const depResult = await pool.query(depSql, depParams);
    depositsList = depResult.rows;
  }

  // Map & normalize records
  const allFormattedRecords: any[] = [];

  for (const r of receiptsList) {
    const cin = r.check_in ? new Date(r.check_in).toISOString() : undefined;
    const cout = r.check_out ? new Date(r.check_out).toISOString() : undefined;
    const { businessDate, shift } = getBusinessDateAndShift(r.date_time, businessDayStart);

    let items = [];
    if (r.items) {
      try {
        items = typeof r.items === 'string' ? JSON.parse(r.items) : r.items;
      } catch (_) {
        items = [];
      }
    }

    const consumedMinutes = r.consumed_minutes != null ? Number(r.consumed_minutes) : undefined;

    // Filter by shift if shift parameter specified
    if (shiftParam && shiftParam !== 'ALL' && shift !== shiftParam) {
      continue;
    }

    allFormattedRecords.push({
      receiptNo: r.receipt_no,
      receiptNumber: r.receipt_no,
      dateTime: r.date_time,
      finalized_at: r.date_time,
      guestName: r.guest_name || 'Walk-in Guest',
      roomNumber: r.room_number ? String(r.room_number) : 'POS',
      roomType: r.room_type || 'Standard Room',
      paymentMethod: r.payment_method || 'CASH',
      cashAmount: r.cash_amount != null ? parseFloat(r.cash_amount) : undefined,
      gcashAmount: r.gcash_amount != null ? parseFloat(r.gcash_amount) : undefined,
      gcashRef: r.gcash_ref || undefined,
      amountTendered: r.amount_tendered_cents != null ? r.amount_tendered_cents / 100 : (r.payment_method === 'CASH' ? parseFloat(r.total || 0) : undefined),
      changeAmount: r.change_cents != null ? r.change_cents / 100 : 0,
      checkIn: cin,
      checkOut: cout,
      consumedMinutes,
      timeConsumed: consumedMinutes != null ? `${Math.floor(consumedMinutes / 60)}h ${consumedMinutes % 60}m` : undefined,
      items,
      subtotal: parseFloat(r.subtotal || 0),
      serviceCharge: parseFloat(r.service_charge || 0),
      total: parseFloat(r.total || 0),
      discount: r.discount_amount != null ? parseFloat(r.discount_amount) : undefined,
      discountType: r.discount_type || undefined,
      discountIdRef: r.discount_id_ref || undefined,
      cashierId: r.cashier_id,
      rateSelected: r.rate_selected || undefined,
      stayDuration: r.stay_duration || undefined,
      status: r.status || 'valid',
      voidReason: r.void_reason || undefined,
      voidedAt: r.voided_at || undefined,
      voidedBy: r.voided_by || undefined,
      reprintCount: Number(r.reprint_count || 0),
      lastReprintedAt: r.last_reprinted_at || undefined,
      lastReprintedBy: r.last_reprinted_by || undefined,
      businessDate,
      shift,
      recordType: 'sale',
    });
  }

  for (const d of depositsList) {
    const { businessDate, shift } = getBusinessDateAndShift(d.created_at, businessDayStart);
    if (shiftParam && shiftParam !== 'ALL' && shift !== shiftParam) {
      continue;
    }

    const amountPesos = Number(d.amount_cents || 0) / 100;
    const refundPesos = Number(d.refund_amount_cents || 0) / 100;
    const appliedPesos = Number(d.applied_amount_cents || 0) / 100;

    allFormattedRecords.push({
      receiptNo: d.deposit_number,
      receiptNumber: d.deposit_number,
      dateTime: d.created_at,
      finalized_at: d.created_at,
      guestName: 'Deposit Holder',
      roomNumber: d.room_id ? String(d.room_id) : '-',
      roomType: 'Security Deposit',
      paymentMethod: 'CASH',
      cashAmount: amountPesos,
      gcashAmount: 0,
      amountTendered: amountPesos,
      changeAmount: 0,
      items: [{ description: 'Security Deposit', amount: amountPesos }],
      subtotal: amountPesos,
      serviceCharge: 0,
      total: amountPesos,
      depositStatus: d.status, // 'held' | 'refunded' | 'applied' | 'forfeited'
      refundAmount: refundPesos,
      appliedAmount: appliedPesos,
      cashierId: d.collected_by,
      status: 'valid',
      notes: d.notes || undefined,
      linkedReceiptNo: d.linked_receipt_no || undefined,
      businessDate,
      shift,
      recordType: 'deposit',
    });
  }

  // 3. Compute Filtered Set Global Summary
  const validSales = allFormattedRecords.filter(r => r.recordType === 'sale' && r.status === 'valid');
  const voidSales = allFormattedRecords.filter(r => r.recordType === 'sale' && r.status === 'void');
  const depositsOnly = allFormattedRecords.filter(r => r.recordType === 'deposit');

  const totalInvoiceCount = allFormattedRecords.filter(r => r.recordType === 'sale').length;
  const validInvoiceCount = validSales.length;
  const voidInvoiceCount = voidSales.length;
  const totalSalesAmount = validSales.reduce((sum, r) => sum + Math.round(r.total * 100), 0) / 100;
  const totalSubtotal = validSales.reduce((sum, r) => sum + Math.round(r.subtotal * 100), 0) / 100;
  const totalDiscountAmount = validSales.reduce((sum, r) => sum + Math.round((r.discount || 0) * 100), 0) / 100;
  const totalCashAmount = validSales.reduce((sum, r) => sum + Math.round((r.cashAmount || (r.paymentMethod === 'CASH' ? r.total : 0)) * 100), 0) / 100;
  const totalGCashAmount = validSales.reduce((sum, r) => sum + Math.round((r.gcashAmount || (r.paymentMethod === 'GCASH' ? r.total : 0)) * 100), 0) / 100;

  const totalDepositsCount = depositsOnly.length;
  const totalDepositsAmount = depositsOnly.reduce((sum, d) => sum + Math.round(d.total * 100), 0) / 100;

  // 4. Server-Side Sorting
  allFormattedRecords.sort((a, b) => {
    let valA: any;
    let valB: any;

    if (sortBy === 'receipt_no' || sortBy === 'receipt_number') {
      valA = a.receiptNo || '';
      valB = b.receiptNo || '';
    } else if (sortBy === 'total') {
      valA = a.total || 0;
      valB = b.total || 0;
    } else if (sortBy === 'guest_name') {
      valA = (a.guestName || '').toLowerCase();
      valB = (b.guestName || '').toLowerCase();
    } else if (sortBy === 'room_number') {
      valA = parseInt(a.roomNumber, 10) || 0;
      valB = parseInt(b.roomNumber, 10) || 0;
    } else {
      // Default: date_time / finalized_at
      valA = new Date(a.dateTime).getTime();
      valB = new Date(b.dateTime).getTime();
    }

    if (valA < valB) return isAsc ? -1 : 1;
    if (valA > valB) return isAsc ? 1 : -1;

    // Secondary default tie-breaker: receipt_no DESC
    return b.receiptNo.localeCompare(a.receiptNo);
  });

  // 5. Grouping or Pagination
  let groups: any[] | undefined = undefined;

  if (groupBy === 'shift' || groupBy === 'date') {
    const groupMap = new Map<string, { groupKey: string; businessDate: string; shift?: string; count: number; totalSales: number; totalDeposits: number; records: any[] }>();

    for (const r of allFormattedRecords) {
      const key = groupBy === 'shift' ? `${r.businessDate}_${r.shift}` : r.businessDate;
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          groupKey: key,
          businessDate: r.businessDate,
          shift: groupBy === 'shift' ? r.shift : undefined,
          count: 0,
          totalSales: 0,
          totalDeposits: 0,
          records: [],
        });
      }
      const g = groupMap.get(key)!;
      g.count++;
      if (r.recordType === 'sale' && r.status === 'valid') {
        g.totalSales = parseFloat((g.totalSales + r.total).toFixed(2));
      } else if (r.recordType === 'deposit') {
        g.totalDeposits = parseFloat((g.totalDeposits + r.total).toFixed(2));
      }
      g.records.push(r);
    }

    groups = Array.from(groupMap.values());
  }

  // Paginate records
  const totalRecords = allFormattedRecords.length;
  const totalPages = Math.ceil(totalRecords / limitNum) || 1;
  const startIndex = (pageNum - 1) * limitNum;
  const paginatedRecords = allFormattedRecords.slice(startIndex, startIndex + limitNum);

  res.json({
    summary: {
      totalInvoiceCount,
      validInvoiceCount,
      voidInvoiceCount,
      totalSalesAmount,
      totalDepositsAmount,
      totalDepositsCount,
      totalSubtotal,
      totalDiscountAmount,
      totalCashAmount,
      totalGCashAmount,
      totalAmount: parseFloat((totalSalesAmount + (type === 'all' ? totalDepositsAmount : 0)).toFixed(2)),
    },
    period: {
      start: range.startIso,
      end: range.endIso,
      label: range.label,
      businessDate: range.businessDate,
      shift: range.shift,
    },
    pagination: {
      page: pageNum,
      limit: limitNum,
      totalRecords,
      totalPages,
    },
    sorting: {
      sortBy,
      sortOrder: isAsc ? 'ASC' : 'DESC',
    },
    records: paginatedRecords,
    groups: groups || undefined,
  });
}

// GET /api/receipts/ledger
router.get('/ledger', requireCashierStaff, asyncHandler(handleGetReceiptsLedger));

// GET /api/receipts
router.get('/', requireCashierStaff, asyncHandler(async (req: Request, res: Response) => {
  try {
    const { cashier, date } = req.query;
    let query = 'SELECT * FROM receipts WHERE 1=1';
    const params: any[] = [];

    if (cashier) {
      params.push(cashier);
      query += ` AND LOWER(cashier_id) = LOWER(?)`;
    }
    if (date) {
      params.push(date);
      query += ` AND DATE(date_time) = ?`;
    }
    query += ' ORDER BY date_time DESC';

    const result = await pool.query(query, params);
    res.json(result.rows.map(rowToReceipt));
  } catch (err) {
    console.error('GET /receipts error:', err);
    res.status(500).json({ error: 'Failed to fetch receipts' });
  }
}));

// GET /api/receipts/sequence-info — fetch current sequence state and next sequential number
router.get('/sequence-info', requireCashierStaff, asyncHandler(async (req: Request, res: Response) => {
  const sequenceName = (req.query.sequence as string) || 'default';
  const info = await sequenceService.getSequenceInfo(sequenceName);
  res.json(info);
}));

// POST /api/receipts/sequence-settings — admin-only upward starting value adjustment (strictly audit logged)
router.post('/sequence-settings', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const { startValue, prefix, sequenceName = 'default' } = req.body;
  const operator = (req as any).operator?.username || 'admin';
  const updated = await sequenceService.updateStartingValue(
    Number(startValue),
    operator,
    sequenceName,
    prefix
  );
  res.json(updated);
}));

function safeParseDate(input: any): Date | null {
  if (!input) return null;
  if (input instanceof Date) return isNaN(input.getTime()) ? null : input;

  const str = String(input).trim();
  if (!str || str === 'N/A' || str === 'null' || str === 'undefined') return null;

  const d = new Date(str);
  if (!isNaN(d.getTime())) return d;

  if (str.includes(' ')) {
    const d2 = new Date(str.replace(' ', 'T'));
    if (!isNaN(d2.getTime())) return d2;
  }

  return null;
}

function isValidDateInput(input: any): boolean {
  return safeParseDate(input) !== null;
}

function hasDateInput(input: any): boolean {
  return input !== undefined && input !== null && String(input).trim() !== '';
}

const GCASH_REF_REGEX = /^\d{13}$/;

/**
 * Stores a full ISO-8601 string (e.g. "2026-09-22T14:05:00.000Z") so that
 * the UTC offset is preserved end-to-end. SQLite/MySQL accept ISO strings
 * as TEXT and our rowToReceipt parses them back via `new Date(str).toISOString()`.
 * Previously this used `.slice(0,19)` which stripped the timezone, causing an
 * 8-hour shift whenever the server was in UTC+8.
 */
function formatSqlDateTime(date: Date | null | undefined, fallbackToNow: boolean = false): string | null {
  const d = date || (fallbackToNow ? new Date() : null);
  if (!d || isNaN(d.getTime())) {
    return fallbackToNow ? new Date().toISOString() : null;
  }
  return d.toISOString();
}

// POST /api/receipts/pre-print — Allocate and return pre-print billing folio for a room
router.post('/pre-print', requireCashierStaff, asyncHandler(async (req: Request, res: Response) => {
  const r = req.body || {};
  const operator = (req as any).operator;
  const roomNumber = r.roomNumber ? String(r.roomNumber).trim() : null;
  const cashierName = operator?.username || operator?.name || r.cashierId || 'Frontdesk';

  if (!roomNumber) {
    res.status(400).json({ error: 'roomNumber is required for pre-print bill.' });
    return;
  }

  const roomRes = await pool.query('SELECT * FROM rooms WHERE number = ? FOR UPDATE', [roomNumber]);
  if (roomRes.rows.length === 0) {
    res.status(404).json({ error: `Room ${roomNumber} not found.` });
    return;
  }
  const roomRow = roomRes.rows[0];

  // Allocate or retrieve remembered receipt number for this room (atomic in DB)
  let receiptNo = roomRow.allocated_receipt_no;
  if (!receiptNo) {
    const allocated = await withTransaction(async (conn) => {
      const recheck = await conn.query('SELECT allocated_receipt_no FROM rooms WHERE number = ?', [roomNumber]);
      if (recheck.rows.length > 0 && recheck.rows[0].allocated_receipt_no) {
        return { receiptNo: recheck.rows[0].allocated_receipt_no };
      }
      const seqRes = await sequenceService.allocateNextSequentialReceiptNumber(conn, cashierName);
      await conn.query('UPDATE rooms SET allocated_receipt_no = ? WHERE number = ?', [seqRes.receiptNo, roomNumber]);
      return seqRes;
    });
    receiptNo = allocated.receiptNo;
  }

  if (hasDateInput(r.dateTime) && !isValidDateInput(r.dateTime)) {
    res.status(400).json({ error: 'Invalid dateTime: must be a valid datetime string.' });
    return;
  }
  const parsedDateTime = safeParseDate(r.dateTime) || new Date();
  const dateTime = formatSqlDateTime(parsedDateTime, true)!;
  let roomType = r.roomType || roomRow.room_type || 'Standard Room';
  let guestName = r.guestName || roomRow.guest_name || 'Walk-in Guest';
  if (hasDateInput(r.checkIn) && !isValidDateInput(r.checkIn)) {
    res.status(400).json({ error: 'Invalid checkIn: must be a valid datetime string.' });
    return;
  }
  if (hasDateInput(r.checkOut) && !isValidDateInput(r.checkOut)) {
    res.status(400).json({ error: 'Invalid checkOut: must be a valid datetime string.' });
    return;
  }
  if (!hasDateInput(r.checkIn) && hasDateInput(roomRow.check_in_time) && !isValidDateInput(roomRow.check_in_time)) {
    res.status(400).json({ error: 'Invalid stored check-in time for room. Contact admin.' });
    return;
  }
  if (hasDateInput(roomRow.check_out_time) && !isValidDateInput(roomRow.check_out_time)) {
    res.status(400).json({ error: 'Invalid stored check-out time for room. Contact admin.' });
    return;
  }
  let checkIn = formatSqlDateTime(safeParseDate(r.checkIn || roomRow.check_in_time), false) || new Date(Date.now() - 3600000).toISOString();
  let checkOut = formatSqlDateTime(safeParseDate(r.checkOut || roomRow.check_out_time), true) || new Date().toISOString();
  let paymentMethod = r.paymentMethod || 'CASH';
  let gcashRef = r.gcashRef ? String(r.gcashRef).trim() : null;
  if (paymentMethod === 'GCASH' || (paymentMethod === 'MIXED' && Number(r.gcashAmount) > 0)) {
    if (!gcashRef || !GCASH_REF_REGEX.test(gcashRef)) {
      res.status(400).json({ error: 'GCash transaction reference must be exactly 13 digits.' });
      return;
    }
  }

  const servicesResult = await pool.query('SELECT * FROM billable_services WHERE is_deleted = FALSE');
  const services = servicesResult.rows;

  const finalRateSelected = r.rateSelected || roomRow.rate_selected || '24h';
  const customHours = Number(r.customHours || roomRow.custom_hours || 1);
  const finalStayDuration = formatStayDuration(finalRateSelected, customHours);
  const roomTier = roomRow.tier || 'Standard';

  let baseRate = 0;
  if (finalRateSelected === 'custom') {
    baseRate = customHours * 130;
  } else {
    const rateService = services.find(
      (s: any) => s.type === 'room_rate' && s.category === roomTier && s.rate_type === finalRateSelected
    );
    baseRate = rateService
      ? calculateStayRate(rateService, checkIn)
      : (DEFAULT_TIER_RATES[roomTier]?.[finalRateSelected] ?? 1500);
  }

  const extraBedService = services.find((s: any) => s.id === 'extra-bed');
  const towelService = services.find((s: any) => s.id === 'towel');
  const extraPersonService = services.find((s: any) => s.id === 'extra-person');
  const excessHourService = services.find((s: any) => s.id === 'late-checkout-extension');
  const extraBedPrice = extraBedService ? Number(extraBedService.price) : 250;
  const towelPrice = towelService ? Number(towelService.price) : 100;
  const extraPersonPrice = extraPersonService ? Number(extraPersonService.price) : 150;
  const excessHourPrice = excessHourService ? Number(excessHourService.price) : 130;

  const extraBeds = Number(r.extraBeds !== undefined ? r.extraBeds : (roomRow.extra_beds || 0));
  const towelSets = Number(r.towelSets !== undefined ? r.towelSets : (roomRow.towel_sets || 0));
  const numGuests = Number(r.numGuests !== undefined ? r.numGuests : (roomRow.num_guests || 1));
  if (!Number.isFinite(extraBedPrice) || extraBedPrice < 0 || !Number.isFinite(towelPrice) || towelPrice < 0 || !Number.isFinite(extraPersonPrice) || extraPersonPrice < 0 || !Number.isFinite(excessHourPrice) || excessHourPrice < 0) {
    res.status(400).json({ error: 'Invalid service price configuration (NaN or negative).' });
    return;
  }
  if (!Number.isFinite(baseRate) || !Number.isFinite(customHours) || !Number.isFinite(extraBeds) || !Number.isFinite(towelSets) || !Number.isFinite(numGuests)) {
    res.status(400).json({ error: 'Invalid billing counts (NaN). Check extra beds, towels, guests, and hours.' });
    return;
  }
  const extraGuests = Math.max(0, numGuests - 2);

  const bedsCharge = extraBeds * extraBedPrice;
  const towelsCharge = towelSets * towelPrice;
  const extraPersonCharge = extraGuests * extraPersonPrice;

  // Excess hours calculation
  let excessHours = 0;
  let excessHoursCharge = 0;
  const isOpenTime = roomRow.billing_mode === 'open_time';
  if (isOpenTime) {
    const baseEnd = roomRow.open_time_started_at ? new Date(roomRow.open_time_started_at) : new Date(checkIn);
    const actualOutDate = new Date();
    const elapsedAfterMs = Math.max(0, actualOutDate.getTime() - baseEnd.getTime());
    const elapsedAfterMins = Math.floor(elapsedAfterMs / 60000);
    if (elapsedAfterMins > 15) {
      excessHours = Math.floor((elapsedAfterMins - 15) / 60) + 1;
      excessHoursCharge = excessHours * excessHourPrice;
    }
  } else if (roomRow.check_out_time && finalRateSelected !== 'custom') {
    excessHours = calculateExcessHours(roomRow.check_out_time, new Date(), 15);
    excessHoursCharge = excessHours * excessHourPrice;
  }

  // Charged food
  let chargedFoodList: Array<{ item: { name: string; price: number }; quantity: number }> = [];
  if (r.chargedFood && Array.isArray(r.chargedFood)) {
    chargedFoodList = r.chargedFood;
  } else if (roomRow.charged_food) {
    try {
      chargedFoodList = typeof roomRow.charged_food === 'string' ? JSON.parse(roomRow.charged_food) : roomRow.charged_food;
    } catch (_) {
      chargedFoodList = [];
    }
  }
  const foodCharges = chargedFoodList.reduce(
    (sum, order) => sum + Number(order.item?.price || 0) * Number(order.quantity || 1),
    0
  );
  if (!Number.isFinite(foodCharges)) {
    res.status(400).json({ error: 'Invalid food charges (NaN).' });
    return;
  }

  // Discount
  const isSeniorRequested = Boolean(
    r.isSeniorPwdDiscount ||
    (r.discountType && normalizeDiscountType(r.discountType) === 'SENIOR')
  );
  const isDiscountCardRequested = Boolean(
    r.isDiscountCard ||
    (r.discountType && normalizeDiscountType(r.discountType) === 'DC')
  );
  let discountType: 'SENIOR' | 'DC' | null = null;
  if (isSeniorRequested) discountType = 'SENIOR';
  else if (isDiscountCardRequested) discountType = 'DC';
  else if (roomRow.discount_type && roomRow.discount_type !== 'NONE') {
    discountType = normalizeDiscountType(roomRow.discount_type);
  }

  let discountIdRef = (r.seniorPwdId || r.discountCardId || r.discountIdRef || roomRow.discount_id_ref || '').trim();

  let discountCentavos = 0;
  if (discountType) {
    const resolvedCentavos = getDiscountAmount(discountType, roomTier, finalRateSelected);
    if (resolvedCentavos === null) {
      res.status(400).json({ error: `No discount configured for ${discountType}/${roomTier}/${finalRateSelected} (No ${discountType === 'SENIOR' ? 'Senior/PWD' : 'Discount Card'} discount configured). Remove client discount selection.` });
      return;
    }
    discountCentavos = resolvedCentavos;
  }

  // Check held deposit
  const heldDepRes = await pool.query(
    `SELECT * FROM deposits WHERE room_id = ? AND status = 'held' ORDER BY id DESC LIMIT 1`,
    [roomNumber]
  );
  let appliedDepositCentavos = 0;
  let heldDepositRow = null;
  if (heldDepRes.rows.length > 0) {
    heldDepositRow = heldDepRes.rows[0];
    if (r.depositResolution?.action === 'apply' || !r.depositResolution) {
      appliedDepositCentavos = Number(heldDepositRow.amount_cents || 0);
    }
  }

  const baseRateCentavos = Math.round(baseRate * 100);
  const bedsChargeCentavos = Math.round(bedsCharge * 100);
  const towelsChargeCentavos = Math.round(towelsCharge * 100);
  const extraPersonChargeCentavos = Math.round(extraPersonCharge * 100);
  const excessHoursChargeCentavos = Math.round(excessHoursCharge * 100);
  const foodChargesCentavos = Math.round(foodCharges * 100);

  const subtotalCentavos = baseRateCentavos + bedsChargeCentavos + towelsChargeCentavos + extraPersonChargeCentavos + excessHoursChargeCentavos + foodChargesCentavos;
  const totalCentavosBeforeDeposit = Math.max(0, subtotalCentavos - discountCentavos);
  appliedDepositCentavos = Math.min(appliedDepositCentavos, totalCentavosBeforeDeposit);
  const totalCentavos = Math.max(0, totalCentavosBeforeDeposit - appliedDepositCentavos);

  const subtotal = subtotalCentavos / 100;
  const total = totalCentavos / 100;
  const discountAmountPesos = discountCentavos / 100;

  const rateSubtext = finalRateSelected === 'custom'
    ? `${customHours} Hours × ₱130/hr`
    : `${finalStayDuration} Base Rate`;

  const items = [
    { description: `${roomType} Rent${finalRateSelected === 'custom' ? ' (Custom Stay)' : ''}`, subtext: rateSubtext, amount: baseRate },
  ];
  if (discountAmountPesos > 0 && discountType) {
    const desc = discountType === 'DC' ? 'Discount Card (DC)' : 'Senior / PWD Discount';
    const hasCustomRef = discountIdRef && discountIdRef !== 'VERIFIED';
    const sub = discountType === 'DC'
      ? (hasCustomRef ? `Fixed Card Discount [Card #: ${discountIdRef}]` : 'Fixed Card Discount')
      : (hasCustomRef ? `Fixed Statutory Discount [ID: ${discountIdRef}]` : 'Fixed Statutory Discount');
    items.push({ description: desc, subtext: sub, amount: -discountAmountPesos });
  }
  if (bedsCharge > 0) items.push({ description: 'Extra Bed Add-on', subtext: `${extraBeds} Bed(s) x ₱${extraBedPrice}`, amount: bedsCharge });
  if (towelsCharge > 0) items.push({ description: 'Extra Towels Add-on', subtext: `${towelSets} Set(s) x ₱${towelPrice}`, amount: towelsCharge });
  if (extraPersonCharge > 0) items.push({ description: 'Extra Person Surcharge', subtext: `${extraGuests} Extra Pax x ₱${extraPersonPrice}`, amount: extraPersonCharge });
  if (excessHoursCharge > 0) {
    items.push({
      description: isOpenTime ? 'Open Time Stay Overtime' : 'Excess Stay / Late Checkout Surcharge',
      subtext: `${excessHours} Overstay Hour(s) × ₱${excessHourPrice}/hr (past 15m grace)`,
      amount: excessHoursCharge,
    });
  }
  if (appliedDepositCentavos > 0 && heldDepositRow) {
    items.push({
      description: 'Security Deposit Applied',
      subtext: `Deducted from Total Due [Deposit #${heldDepositRow.deposit_number}]`,
      amount: -(appliedDepositCentavos / 100),
    });
  }
  chargedFoodList.forEach((f) => {
    items.push({
      description: f.item?.name || 'Food Order',
      subtext: `${f.quantity} Qty x ₱${f.item?.price}`,
      amount: Number(f.item?.price || 0) * Number(f.quantity || 1),
    });
  });

  // Calculate consumed time
  let consumedMinutes: number | null = null;
  if (checkIn && checkOut) {
    const cin = safeParseDate(checkIn);
    const cout = safeParseDate(checkOut) || new Date();
    if (cin && cout) {
      const diffMs = cout.getTime() - cin.getTime();
      consumedMinutes = Math.max(0, Math.floor(diffMs / 60000));
    }
  }
  const timeConsumed = consumedMinutes != null ? (consumedMinutes <= 0 ? 'Less than 1 min' : formatConsumedTime(consumedMinutes)) : 'Less than 1 min';

  const authenticatedOperator = operator?.username || operator?.name || r.cashierId || 'Frontdesk';

  const prePrintReceiptData = {
    receiptNo,
    dateTime,
    guestName,
    roomNumber: String(roomNumber),
    roomType,
    paymentMethod,
    gcashRef: gcashRef || undefined,
    cashAmount: paymentMethod === 'MIXED' ? (r.cashAmount ?? total) : (paymentMethod === 'CASH' ? total : undefined),
    gcashAmount: paymentMethod === 'MIXED' ? (r.gcashAmount ?? 0) : (paymentMethod === 'GCASH' ? total : undefined),
    amountTendered: r.amountTendered != null ? Number(r.amountTendered) : total,
    changeAmount: r.amountTendered != null ? Math.max(0, Number(r.amountTendered) - total) : 0,
    checkIn,
    checkOut,
    items,
    subtotal,
    serviceCharge: 0,
    total,
    discount: discountAmountPesos > 0 ? discountAmountPesos : undefined,
    discountType: discountType || undefined,
    discountIdRef: discountIdRef || undefined,
    seniorPwdId: discountType === 'SENIOR' ? discountIdRef : undefined,
    discountCardId: discountType === 'DC' ? discountIdRef : undefined,
    cashierId: authenticatedOperator,
    rateSelected: finalRateSelected,
    stayDuration: finalStayDuration,
    depositBalance: heldDepositRow ? Number(heldDepositRow.amount_cents) / 100 : undefined,
    consumedMinutes,
    timeConsumed,
    status: 'valid' as const,
    isPrePrint: true,
  };

  const escposBuffer = buildReceiptEscPosBuffer({
    receiptNo,
    dateTime,
    guestName,
    roomNumber: String(roomNumber),
    roomType,
    cashierId: authenticatedOperator,
    checkIn,
    checkOut,
    stayDuration: finalStayDuration,
    timeConsumed,
    items,
    subtotal,
    discount: discountAmountPesos > 0 ? discountAmountPesos : undefined,
    discountType: discountType || undefined,
    discountCardMasked: discountIdRef ? maskDiscountCardId(discountIdRef) : undefined,
    total,
    paymentMethod,
    amountTendered: prePrintReceiptData.amountTendered,
    changeAmount: prePrintReceiptData.changeAmount,
    cashAmount: prePrintReceiptData.cashAmount,
    gcashAmount: prePrintReceiptData.gcashAmount,
    gcashRef: prePrintReceiptData.gcashRef,
    depositBalance: prePrintReceiptData.depositBalance,
    isPrePrint: true,
    label: 'PRE-PRINT / NOT OFFICIAL RECEIPT',
  });

  return res.json({
    ...prePrintReceiptData,
    escposBufferBase64: escposBuffer.toString('base64'),
  });
}));

// POST /api/receipts — Checkout & Receipt creation handler
router.post('/', requireCashierStaff, asyncHandler(async (req: Request, res: Response) => {
  const r = req.body;
  const operator = (req as any).operator;
  const idempotencyKey = (req.headers['x-idempotency-key'] as string) || r.idempotencyKey;

  try {
    // Wrap all writes in an atomic database transaction
    const receiptData = await withTransaction(async (conn) => {
      // Idempotency check — must be inside transaction to prevent race
      if (idempotencyKey) {
        const existing = await conn.query(
          'SELECT * FROM receipts WHERE idempotency_key = ? OR receipt_no = ?',
          [idempotencyKey, idempotencyKey]
        );
        if (existing.rows.length > 0) {
          return { alreadyExists: true, receipt: rowToReceipt(existing.rows[0]) };
        }
      }

      let roomNumber = r.roomNumber ? String(r.roomNumber).trim() : null;
      const authenticatedOperator = operator?.username || operator?.name || r.cashierId || 'Frontdesk';

      // Sequential receipt number allocation inside transaction (strictly increasing, no random component)
      let receiptNo = r.receiptNo;
      if (roomNumber) {
        const roomAllocRes = await conn.query('SELECT allocated_receipt_no FROM rooms WHERE number = ?', [roomNumber]);
        if (roomAllocRes.rows.length > 0 && roomAllocRes.rows[0].allocated_receipt_no) {
          receiptNo = roomAllocRes.rows[0].allocated_receipt_no;
        }
      }
      if (!receiptNo) {
        const allocated = await sequenceService.allocateNextSequentialReceiptNumber(conn, authenticatedOperator);
        receiptNo = allocated.receiptNo;
      }
      if (hasDateInput(r.dateTime) && !isValidDateInput(r.dateTime)) {
        throw Object.assign(new Error('Invalid dateTime: must be a valid datetime string.'), { statusCode: 400 });
      }
      const parsedDateTime = safeParseDate(r.dateTime) || new Date();
      const dateTime = formatSqlDateTime(parsedDateTime, true)!;
      let roomType = r.roomType || 'Standard Room';
      let guestName = r.guestName || 'Walk-in Guest';
      if (hasDateInput(r.checkIn) && !isValidDateInput(r.checkIn)) {
        throw Object.assign(new Error('Invalid checkIn: must be a valid datetime string.'), { statusCode: 400 });
      }
      if (hasDateInput(r.checkOut) && !isValidDateInput(r.checkOut)) {
        throw Object.assign(new Error('Invalid checkOut: must be a valid datetime string.'), { statusCode: 400 });
      }
      let checkIn = formatSqlDateTime(safeParseDate(r.checkIn), false);
      let checkOut = formatSqlDateTime(safeParseDate(r.checkOut), true)!;
      let paymentMethod = r.paymentMethod || 'CASH';
      let gcashRef = r.gcashRef ? String(r.gcashRef).trim() : null;

      let subtotal = 0;
      let total = 0;
      let items = r.items || [];
      let foodCharges = 0;
      let appliedDepositCentavos = 0;
      let heldDepositRow: any = null;

      const isSeniorRequested = Boolean(
        r.isSeniorPwdDiscount ||
        (r.discountType && normalizeDiscountType(r.discountType) === 'SENIOR')
      );
      const isDiscountCardRequested = Boolean(
        r.isDiscountCard ||
        (r.discountType && normalizeDiscountType(r.discountType) === 'DC')
      );

      // Constraint 5 & Decision Point 3: Mutual exclusivity
      if (isSeniorRequested && isDiscountCardRequested) {
        throw Object.assign(
          new Error('Only one discount type (Senior/PWD or Discount Card) may be applied per transaction.'),
          { statusCode: 400 }
        );
      }

      let discountType: 'SENIOR' | 'DC' | null = null;
      if (isSeniorRequested) discountType = 'SENIOR';
      else if (isDiscountCardRequested) discountType = 'DC';

      let discountIdRef = (r.seniorPwdId || r.discountCardId || r.discountIdRef || '').trim() || (discountType ? 'VERIFIED' : '');

      // H-01 FIX: Validate discount ID reference format for data integrity
      if (discountIdRef && discountIdRef !== 'VERIFIED' && discountType) {
        const trimmed = discountIdRef.trim();

        if (discountType === 'SENIOR') {
          // Expected formats: SC-1234, PWD-1234, SENIOR-1234, S-1234, or just digits
          if (!/^(SC|PWD|SENIOR|S\.?)-?\d{2,}$/i.test(trimmed) && !/^\d{4,}$/.test(trimmed)) {
            console.warn(`[receipts] Unusual Senior/PWD ID format: "${trimmed}". Expected format: SC-XXXX or PWD-XXXX`);
            // Don't reject, just log warning for audit
          }
        } else if (discountType === 'DC') {
          // Expected format: DC-YYYY-XXXX or DC-XXXXXXXX
          if (!/^DC-?\d{4,}$/i.test(trimmed) && !/^\d{6,}$/.test(trimmed)) {
            console.warn(`[receipts] Unusual Discount Card format: "${trimmed}". Expected format: DC-XXXX-XXXX`);
            // Don't reject, just log warning for audit
          }
        }

        // Reject obviously garbage data
        if (trimmed.length > 50) {
          throw Object.assign(
            new Error('Discount ID reference too long (max 50 characters)'),
            { statusCode: 400 }
          );
        }
        if (!/^[A-Za-z0-9\s.\-_]+$/.test(trimmed)) {
          throw Object.assign(
            new Error('Discount ID reference contains invalid characters. Only letters, numbers, spaces, dots, dashes, and underscores allowed.'),
            { statusCode: 400 }
          );
        }
      }

      if (paymentMethod === 'GCASH' || (paymentMethod === 'MIXED' && Number(r.gcashAmount) > 0)) {
        if (!gcashRef || !GCASH_REF_REGEX.test(gcashRef)) {
          throw Object.assign(new Error('GCash transaction reference must be exactly 13 digits.'), { statusCode: 400 });
        }

        // Check for uniqueness - prevent same GCash reference from being used multiple times
        const existingGcash = await conn.query(
          'SELECT receipt_no FROM receipts WHERE gcash_ref = ? AND payment_method IN (?, ?)',
          [gcashRef, 'GCASH', 'MIXED']
        );
        if (existingGcash.rows.length > 0) {
          throw Object.assign(
            new Error(`GCash reference ${gcashRef} already used in receipt ${existingGcash.rows[0].receipt_no}. Each GCash transaction must have a unique reference.`),
            { statusCode: 400 }
          );
        }

        // Pattern detection - reject obviously fake references
        const isSequential = /^(\d)\1{12}$/.test(gcashRef); // All same digit (e.g., "1111111111111")
        const isSimplePattern = ['1234567890123', '0123456789012', '9876543210987'].includes(gcashRef);
        if (isSequential || isSimplePattern) {
          throw Object.assign(
            new Error('GCash reference appears invalid (sequential or repeated pattern detected). Please verify the transaction reference.'),
            { statusCode: 400 }
          );
        }
      }

      let roomRow: any = null;
      let finalRateSelected = r.rateSelected || '24h';
      let finalStayDuration = r.stayDuration || formatStayDuration(finalRateSelected);
      let discountCentavos = 0;
      let roomTier = 'Standard';

      if (roomNumber) {
        const roomResult = await conn.query('SELECT * FROM rooms WHERE number = ? FOR UPDATE', [roomNumber]);
        if (roomResult.rows.length > 0) {
          roomRow = roomResult.rows[0];

          // H-05: Validate room is actually occupied before checkout
          if (roomRow.state !== 'occupied' && roomRow.state !== 'overdue') {
            throw Object.assign(
              new Error(`Room ${roomNumber} is not currently occupied (state: ${roomRow.state}). Cannot checkout.`),
              { statusCode: 400 }
            );
          }

          // Fallback to room's persisted discount if not explicitly passed in payload
          if (!discountType && roomRow.discount_type && roomRow.discount_type !== 'NONE') {
            discountType = normalizeDiscountType(roomRow.discount_type);
          }
          if ((!discountIdRef || discountIdRef === 'VERIFIED') && roomRow.discount_id_ref) {
            discountIdRef = roomRow.discount_id_ref.trim();
          }

          roomType = roomRow.room_type || roomType;
          guestName = roomRow.guest_name || guestName;
          if (hasDateInput(r.checkIn)) {
            const parsed = safeParseDate(r.checkIn);
            if (!parsed) {
              throw Object.assign(new Error('Invalid checkIn: must be a valid datetime string.'), { statusCode: 400 });
            }
            checkIn = formatSqlDateTime(parsed, false);
          } else if (hasDateInput(roomRow.check_in_time)) {
            const parsed = safeParseDate(roomRow.check_in_time);
            if (!parsed) {
              throw Object.assign(new Error('Invalid stored check-in time for room. Contact admin.'), { statusCode: 400 });
            }
            checkIn = formatSqlDateTime(parsed, false);
          }
          if (hasDateInput(roomRow.check_out_time) && !isValidDateInput(roomRow.check_out_time)) {
            throw Object.assign(new Error('Invalid stored check-out time for room. Contact admin.'), { statusCode: 400 });
          }

          const servicesResult = await conn.query('SELECT * FROM billable_services WHERE is_deleted = FALSE');
          const services = servicesResult.rows;

          finalRateSelected = r.rateSelected || roomRow.rate_selected || '24h';
          const customHours = Number(r.customHours || roomRow.custom_hours || 1);
          finalStayDuration = formatStayDuration(finalRateSelected, customHours);
          roomTier = roomRow.tier || 'Standard';
          const tier = roomTier;

          let baseRate = 0;
          if (finalRateSelected === 'custom') {
            baseRate = customHours * 130;
          } else {
            const rateService = services.find(
              (s: any) => s.type === 'room_rate' && s.category === tier && s.rate_type === finalRateSelected
            );
            baseRate = rateService
              ? calculateStayRate(rateService, r.checkIn || roomRow.check_in_time)
              : (DEFAULT_TIER_RATES[tier]?.[finalRateSelected] ?? 1500);
          }

          const extraBedService = services.find((s: any) => s.id === 'extra-bed');
          const towelService = services.find((s: any) => s.id === 'towel');
          const extraPersonService = services.find((s: any) => s.id === 'extra-person');
          const excessHourService = services.find((s: any) => s.id === 'late-checkout-extension');
          const extraBedPrice = extraBedService ? Number(extraBedService.price) : 250;
          const towelPrice = towelService ? Number(towelService.price) : 100;
          const extraPersonPrice = extraPersonService ? Number(extraPersonService.price) : 150;
          const excessHourPrice = excessHourService ? Number(excessHourService.price) : 130;

          const extraBeds = Number(roomRow.extra_beds || 0);
          const towelSets = Number(roomRow.towel_sets || 0);
          const numGuests = Number(roomRow.num_guests || 1);
          if (!Number.isFinite(extraBedPrice) || extraBedPrice < 0 || !Number.isFinite(towelPrice) || towelPrice < 0 || !Number.isFinite(extraPersonPrice) || extraPersonPrice < 0 || !Number.isFinite(excessHourPrice) || excessHourPrice < 0) {
            throw Object.assign(new Error('Invalid service price configuration (NaN or negative).'), { statusCode: 400 });
          }
          if (!Number.isFinite(baseRate) || !Number.isFinite(customHours) || !Number.isFinite(extraBeds) || !Number.isFinite(towelSets) || !Number.isFinite(numGuests)) {
            throw Object.assign(new Error('Invalid billing counts (NaN). Check extra beds, towels, guests, and hours.'), { statusCode: 400 });
          }
          const extraGuests = Math.max(0, numGuests - 2);

          const bedsCharge = extraBeds * extraBedPrice;
          const towelsCharge = towelSets * towelPrice;
          const extraPersonCharge = extraGuests * extraPersonPrice;

          // Compute excess hours / overtime surcharge
          let excessHours = 0;
          let excessHoursCharge = 0;
          const isOpenTime = roomRow.billing_mode === 'open_time';
          const isOvertimeWaived = Boolean(roomRow.overtime_waived || r.waiveOvertime);

          // H-04 FIX: Validate overtime waiver authorization
          if (isOvertimeWaived) {
            // Only admin or owner can waive overtime charges
            if (!['admin', 'owner'].includes(operator?.role)) {
              throw Object.assign(
                new Error('Only Admin or Owner can waive overtime charges. Please escalate to management.'),
                { statusCode: 403 }
              );
            }

            // Require detailed reason for waiver
            const waiveReason = r.waiveReason || '';
            if (!waiveReason || waiveReason.trim().length < 10) {
              throw Object.assign(
                new Error('Detailed reason (minimum 10 characters) required for overtime waiver.'),
                { statusCode: 400 }
              );
            }

            // Calculate what WOULD have been charged (for audit trail)
            let wouldBeExcessHours = 0;
            let wouldBeExcessCharge = 0;

            if (isOpenTime) {
              const baseEnd = roomRow.open_time_started_at
                ? new Date(roomRow.open_time_started_at)
                : (roomRow.expected_checkout_at ? new Date(roomRow.expected_checkout_at) : (roomRow.check_out_time ? new Date(roomRow.check_out_time) : new Date()));
              const actualOutDate = new Date();
              const elapsedAfterMs = Math.max(0, actualOutDate.getTime() - baseEnd.getTime());
              const elapsedAfterMins = Math.floor(elapsedAfterMs / 60000);
              const postGrace = 15;
              if (elapsedAfterMins > postGrace) {
                wouldBeExcessHours = Math.floor((elapsedAfterMins - postGrace) / 60) + 1;
                wouldBeExcessCharge = wouldBeExcessHours * excessHourPrice;
              }
            } else if (roomRow.check_out_time && finalRateSelected !== 'custom') {
              const actualOutDate = new Date();
              wouldBeExcessHours = calculateExcessHours(roomRow.check_out_time, actualOutDate, 15);
              wouldBeExcessCharge = wouldBeExcessHours * excessHourPrice;
            }

            // Audit log the waiver with full details
            if (wouldBeExcessCharge > 0) {
              const waiveAuditId = `log-waive-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
              await conn.query(
                `INSERT INTO audit_logs (id, timestamp, operator, action, details)
                 VALUES (?, datetime('now', 'localtime'), ?, 'OVERTIME_WAIVED', ?)`,
                [
                  waiveAuditId,
                  operator,
                  `Waived ₱${wouldBeExcessCharge.toFixed(2)} (${wouldBeExcessHours}h overtime) for Room ${roomNumber}. ` +
                  `Authorized by: ${operator} (${operator?.role}). Reason: ${waiveReason.trim()}`
                ]
              );
            }
          }

          if (isOpenTime) {
            // Open Time mode: base_end = T when open time started; elapsed_after = max(0, checkout_time - base_end)
            // overtime_hours = floor((elapsed_after - post) / 60) + 1 if elapsed_after > post, else 0
            if (!isOvertimeWaived) {
              const baseEnd = roomRow.open_time_started_at
                ? new Date(roomRow.open_time_started_at)
                : (roomRow.expected_checkout_at ? new Date(roomRow.expected_checkout_at) : (roomRow.check_out_time ? new Date(roomRow.check_out_time) : new Date()));
              const actualOutDate = r.checkOut ? new Date(r.checkOut) : new Date();
              const elapsedAfterMs = Math.max(0, actualOutDate.getTime() - baseEnd.getTime());
              const elapsedAfterMins = Math.floor(elapsedAfterMs / 60000);
              const postGrace = 15; // default 15m grace

              if (elapsedAfterMins > postGrace) {
                excessHours = Math.floor((elapsedAfterMins - postGrace) / 60) + 1;
                excessHoursCharge = excessHours * excessHourPrice;
              }
            }
          } else if (roomRow.check_out_time && finalRateSelected !== 'custom') {
            if (!isOvertimeWaived) {
              // ALWAYS use server time for actual checkout - NEVER trust client-provided checkOut time
              const actualOutDate = new Date();

              // Audit log if client provided checkOut time differs significantly from server time
              if (r.checkOut) {
                const clientProvided = new Date(r.checkOut);
                if (!isNaN(clientProvided.getTime())) {
                  const diffMs = Math.abs(actualOutDate.getTime() - clientProvided.getTime());
                  if (diffMs > 300000) { // >5 minutes difference
                    const auditId = `log-discrep-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
                    await conn.query(
                      `INSERT INTO audit_logs (id, timestamp, operator, action, details)
                       VALUES (?, datetime('now', 'localtime'), ?, 'CHECKOUT_TIME_DISCREPANCY', ?)`,
                      [
                        auditId,
                        operator,
                        `Client submitted checkOut ${clientProvided.toISOString()} but server time is ${actualOutDate.toISOString()} (diff: ${Math.round(diffMs / 1000)}s) for Room ${roomNumber}`
                      ]
                    );
                  }
                }
              }

              excessHours = calculateExcessHours(roomRow.check_out_time, actualOutDate, 15);
              excessHoursCharge = excessHours * excessHourPrice;
            }
          }

          let chargedFoodList: Array<{ item: { name: string; price: number; id?: string }; quantity: number }> = [];
          if (roomRow.charged_food) {
            if (typeof roomRow.charged_food === 'string') {
              try {
                chargedFoodList = JSON.parse(roomRow.charged_food);
              } catch (e) {
                console.warn(`[receipts] corrupt charged_food for room ${roomNumber}, ignoring: ${e}`);
                chargedFoodList = [];
              }
            } else {
              chargedFoodList = roomRow.charged_food;
            }

            // M-07 FIX: Deduplicate food items and sum quantities
            const foodMap = new Map<string, { item: any; quantity: number }>();
            for (const order of chargedFoodList) {
              const key = order.item?.id || order.item?.name || JSON.stringify(order.item);
              if (!key) continue;

              const existing = foodMap.get(key);
              if (existing) {
                existing.quantity += Number(order.quantity || 1);
              } else {
                foodMap.set(key, { item: order.item, quantity: Number(order.quantity || 1) });
              }
            }
            chargedFoodList = Array.from(foodMap.values());
          }
          foodCharges = chargedFoodList.reduce(
            (sum, order) => sum + Number(order.item?.price || 0) * Number(order.quantity || 1),
            0
          );
          if (!Number.isFinite(foodCharges)) {
            throw Object.assign(new Error('Invalid food charges (NaN).'), { statusCode: 400 });
          }

          // Authoritatively resolve discount amount from table in integer centavos (Constraint 1, 2, 3)
          discountCentavos = 0;
          if (discountType) {
            const resolvedCentavos = getDiscountAmount(discountType, tier, finalRateSelected);
            if (resolvedCentavos === null) {
              throw Object.assign(new Error(`No discount configured for ${discountType}/${tier}/${finalRateSelected} (No ${discountType === 'SENIOR' ? 'Senior/PWD' : 'Discount Card'} discount configured). Remove client discount selection.`), { statusCode: 400 });
            }
            discountCentavos = resolvedCentavos;
          }

          // Check for active held deposit for this room (Step 3: Resolve held deposits)
          heldDepositRow = null;
          appliedDepositCentavos = 0;
          const heldDepRes = await conn.query(
            `SELECT * FROM deposits WHERE room_id = ? AND status = 'held' ORDER BY id DESC LIMIT 1`,
            [roomNumber]
          );

          if (heldDepRes.rows.length > 0) {
            heldDepositRow = heldDepRes.rows[0];
            const resolution = r.depositResolution; // { action: 'apply' | 'refund' | 'forfeit', notes?: string }

            if (!resolution || !resolution.action) {
              throw Object.assign(
                new Error(`Room ${roomNumber} has an active held deposit (${heldDepositRow.deposit_number} for ₱${(Number(heldDepositRow.amount_cents) / 100).toFixed(2)}). Please specify deposit resolution (Apply to bill, Refund, or Forfeit) before completing checkout.`),
                { statusCode: 400 }
              );
            }

            const action = resolution.action;
            if (!['apply', 'refund', 'forfeit'].includes(action)) {
              throw Object.assign(
                new Error(`Invalid deposit resolution action: '${action}'. Must be 'apply', 'refund', or 'forfeit'.`),
                { statusCode: 400 }
              );
            }

            if (action === 'forfeit' && !['admin', 'owner'].includes(operator?.role || '')) {
              throw Object.assign(
                new Error('Only an Admin or Owner can forfeit a security deposit.'),
                { statusCode: 403 }
              );
            }

            const depAmountCents = Number(heldDepositRow.amount_cents || 0);
            if (action === 'apply') {
              appliedDepositCentavos = depAmountCents;
            }
          }

          // Compute bill using integer centavos arithmetic with overflow protection
          const baseRateCentavos = Math.round(baseRate * 100);
          const bedsChargeCentavos = Math.round(bedsCharge * 100);
          const towelsChargeCentavos = Math.round(towelsCharge * 100);
          const extraPersonChargeCentavos = Math.round(extraPersonCharge * 100);
          const excessHoursChargeCentavos = Math.round(excessHoursCharge * 100);
          const foodChargesCentavos = Math.round(foodCharges * 100);

          // Use safe addition with overflow detection (C-04 fix)
          const subtotalCentavos = safeCentavosAdd(
            baseRateCentavos,
            bedsChargeCentavos,
            towelsChargeCentavos,
            extraPersonChargeCentavos,
            excessHoursChargeCentavos,
            foodChargesCentavos
          );

          // Validate reasonable bill limit (M-02 fix)
          validateReasonableBill(subtotalCentavos, operator?.role || 'cashier', r.managerOverride);

          const totalCentavosBeforeDeposit = Math.max(0, subtotalCentavos - discountCentavos);
          appliedDepositCentavos = Math.min(appliedDepositCentavos, totalCentavosBeforeDeposit);
          const totalCentavos = Math.max(0, totalCentavosBeforeDeposit - appliedDepositCentavos);

          // M-12 FIX: Validate base rate and total are reasonable
          if (baseRateCentavos <= 0 && foodChargesCentavos === 0) {
            throw Object.assign(
              new Error('Cannot generate receipt with zero base rate and no food charges. Please verify room rate configuration.'),
              { statusCode: 400 }
            );
          }

          if (totalCentavos < 0) {
            throw Object.assign(
              new Error(`Cannot generate receipt with negative total: ₱${(totalCentavos / 100).toFixed(2)}. Check discount and deposit calculations.`),
              { statusCode: 400 }
            );
          }

          subtotal = subtotalCentavos / 100;
          total = totalCentavos / 100;
          const discountAmountPesos = discountCentavos / 100;

          const rateSubtext = finalRateSelected === 'custom'
            ? `${customHours} Hours × ₱130/hr`
            : `${finalStayDuration} Base Rate`;

          items = [
            { description: `${roomType} Rent${finalRateSelected === 'custom' ? ' (Custom Stay)' : ''}`, subtext: rateSubtext, amount: baseRate },
          ];
          if (discountAmountPesos > 0 && discountType) {
            const desc = discountType === 'DC' ? 'Discount Card (DC)' : 'Senior / PWD Discount';
            const hasCustomRef = discountIdRef && discountIdRef.trim() && discountIdRef.trim() !== 'VERIFIED';
            const sub = discountType === 'DC'
              ? (hasCustomRef ? `Fixed Card Discount [Card #: ${discountIdRef.trim()}]` : 'Fixed Card Discount')
              : (hasCustomRef ? `Fixed Statutory Discount [ID: ${discountIdRef.trim()}]` : 'Fixed Statutory Discount');
            items.push({
              description: desc,
              subtext: sub,
              amount: -discountAmountPesos,
            });
          }
          if (bedsCharge > 0) {
            items.push({
              description: 'Extra Bed Add-on',
              subtext: `${extraBeds} Bed(s) x ₱${extraBedPrice}`,
              amount: bedsCharge,
            });
          }
          if (towelsCharge > 0) {
            items.push({
              description: 'Extra Towels Add-on',
              subtext: `${towelSets} Set(s) x ₱${towelPrice}`,
              amount: towelsCharge,
            });
          }
          if (extraPersonCharge > 0) {
            items.push({
              description: 'Extra Person Surcharge',
              subtext: `${extraGuests} Extra Guest(s) (beyond 2) x ₱${extraPersonPrice}`,
              amount: extraPersonCharge,
            });
          }
          if (excessHoursCharge > 0) {
            const desc = isOpenTime ? 'Open Time Stay Overtime' : 'Excess Stay / Late Checkout Surcharge';
            const sub = isOpenTime
              ? `${excessHours} Open Time Hour(s) × ₱${excessHourPrice}/hr (past 15m grace)`
              : `${excessHours} Overstay Hour(s) × ₱${excessHourPrice}/hr (past 15m grace)`;
            items.push({
              description: desc,
              subtext: sub,
              amount: excessHoursCharge,
            });
          }
          if (appliedDepositCentavos > 0 && heldDepositRow) {
            items.push({
              description: 'Security Deposit Applied',
              subtext: `Deducted from Total Due [Deposit #${heldDepositRow.deposit_number}]`,
              amount: -(appliedDepositCentavos / 100),
            });
          }
          // H-06 FIX: Check inventory stock BEFORE finalizing bill with food items
          // BUG FIX: Actually deduct inventory for room-charged food items
          if (chargedFoodList.length > 0) {
            // Prepare items for inventory deduction
            const inventoryItems = chargedFoodList
              .filter(f => f.item?.id)
              .map(f => ({
                item_id: String(f.item.id),
                quantity: Number(f.quantity || 1),
                name: f.item?.name || 'Food Item'
              }));

            if (inventoryItems.length > 0) {
              // Use atomic inventory deduction (checks stock AND deducts in one transaction)
              const roomOperator = authenticatedOperator;
              await inventoryService.atomicDecrementStock(
                inventoryItems,
                receiptNo,
                roomOperator,
                conn
              );
            }
          }

          chargedFoodList.forEach((f) => {
            items.push({
              description: f.item?.name || 'Food Order',
              subtext: `${f.quantity} Qty x ₱${f.item?.price}`,
              amount: Number(f.item?.price || 0) * Number(f.quantity || 1),
            });
          });
        }
      }

      if (!roomRow) {
        // Direct POS receipt or walk-in sale — recompute securely using centavos
        let computedSubtotalCentavos = 0;
        if (items && items.length > 0) {
          const serviceRows = await conn.query('SELECT id, price FROM billable_services');
          const priceMap = new Map<string, number>();
          for (const row of serviceRows.rows) {
            priceMap.set(row.id, Number(row.price) || 0);
          }

          for (const it of items) {
            const itemId = String(it.item_id || it.id || '').trim();
            if (!itemId) {
              throw Object.assign(
                new Error(`Receipt item missing both 'item_id' and 'id' fields. Item: ${JSON.stringify(it)}`),
                { statusCode: 400 }
              );
            }
            if (!priceMap.has(itemId)) {
              throw Object.assign(
                new Error(`Invalid service ID for POS item: "${itemId}" not found in billable_services. Available IDs: ${Array.from(priceMap.keys()).slice(0, 10).join(', ')}...`),
                { statusCode: 400 }
              );
            }
            const qty = Math.max(1, Math.round(Number(it.quantity) || 1));
            const actualPrice = priceMap.get(itemId)!;

            // Use centavos arithmetic for POS items (100% accuracy fix)
            const priceCentavos = Math.round(actualPrice * 100);
            const itemTotalCentavos = priceCentavos * qty;
            validateCentavos(itemTotalCentavos, `item ${itemId} total`);

            it.amount = actualPrice * qty;
            computedSubtotalCentavos = safeCentavosAdd(computedSubtotalCentavos, itemTotalCentavos);
          }
        }
        subtotal = computedSubtotalCentavos / 100;
        total = subtotal;

        // Validate POS total is reasonable
        validateReasonableBill(computedSubtotalCentavos, operator?.role || 'cashier', r.managerOverride);

        // Bug 3 fix: deduct stock for each POS item sold directly at counter
        // H-06 FIX: Check stock BEFORE deducting (fail checkout if insufficient)
        if (items && items.length > 0) {
          // First pass: Check all stock availability
          for (const it of items) {
            const itemId = String(it.item_id || it.id || '').trim();
            if (!itemId) continue;

            const qty = Math.max(1, Math.round(Number(it.quantity) || 1));
            const stockRes = await conn.query(
              'SELECT current_stock FROM inventory WHERE id = ?',
              [itemId]
            );

            if (stockRes.rows.length > 0) {
              const currentStock = Number(stockRes.rows[0].current_stock || 0);
              if (currentStock < qty) {
                throw Object.assign(
                  new Error(
                    `Insufficient stock for POS item "${it.description || it.name || itemId}". ` +
                    `Available: ${currentStock}, Required: ${qty}. Cannot complete sale.`
                  ),
                  { statusCode: 400 }
                );
              }
            }
          }

          // Second pass: Deduct stock (only after all checks pass)
          const posOperator = operator?.username || 'Frontdesk';
          for (const it of items) {
            if (!it.item_id && !it.id) continue;
            const itemId = String(it.item_id || it.id || '').trim();
            if (!itemId) continue;
            const qty = Math.max(1, Math.round(Number(it.quantity) || 1));

            await inventoryService.atomicDecrementStock(
              [{ item_id: itemId, quantity: qty, name: it.description || it.name || itemId }],
              `POS-${receiptNo}`,
              posOperator,
              conn
            );
          }
        }
      }

      // Determine cash / gcash split based on server-computed total (Constraint 6)
      let cashAmount: number | null = null;
      let gcashAmount: number | null = null;
      if (paymentMethod === 'CASH') {
        cashAmount = total;
        gcashAmount = null;
      } else if (paymentMethod === 'GCASH') {
        gcashAmount = total;
        cashAmount = null;
      } else if (paymentMethod === 'MIXED') {
        if (r.cashAmount !== undefined && r.gcashAmount !== undefined) {
          cashAmount = Number(r.cashAmount);
          gcashAmount = Number(r.gcashAmount);
          // C-05: Validate MIXED payment amounts sum to total using strict integer centavos validation
          const cashCentavos = Math.round(cashAmount * 100);
          const gcashCentavos = Math.round(gcashAmount * 100);
          const targetTotalCentavos = Math.round(total * 100);

          // Use dedicated validation function with clear error messages
          try {
            validateSplitPaymentCentavos(cashCentavos, gcashCentavos, targetTotalCentavos);
          } catch (err: any) {
            throw Object.assign(
              new Error(`MIXED payment validation failed: ${err.message}. Cash: ₱${cashAmount.toFixed(2)}, GCash: ₱${gcashAmount.toFixed(2)}, Total: ₱${total.toFixed(2)}`),
              { statusCode: 400 }
            );
          }
        } else {
          cashAmount = total;
          gcashAmount = 0;
        }
      }

      // Server-authoritative amount tendered and change calculation (Integer Centavos)
      const totalCentavos = Math.round(total * 100);
      let amountTenderedCents: number | null = null;
      let changeCents: number | null = null;

      if (paymentMethod === 'CASH') {
        if (r.amountTendered === undefined || r.amountTendered === null || String(r.amountTendered).trim() === '' || isNaN(Number(r.amountTendered))) {
          throw Object.assign(
            new Error('Amount tendered is required for Cash payments.'),
            { statusCode: 400 }
          );
        }
        const tenderedCentavos = Math.round(Number(r.amountTendered) * 100);
        if (tenderedCentavos < totalCentavos) {
          throw Object.assign(
            new Error(
              `Amount tendered (₱${(tenderedCentavos / 100).toFixed(2)}) cannot be less than total amount due (₱${(totalCentavos / 100).toFixed(2)}).`
            ),
            { statusCode: 400 }
          );
        }
        amountTenderedCents = tenderedCentavos;
        changeCents = tenderedCentavos - totalCentavos;
      } else if (paymentMethod === 'GCASH') {
        // Non-cash sets tendered = total, no change
        amountTenderedCents = totalCentavos;
        changeCents = 0;
      } else if (paymentMethod === 'MIXED') {
        const cashDueCentavos = Math.round((cashAmount || 0) * 100);
        if (cashDueCentavos > 0) {
          if (r.amountTendered !== undefined && r.amountTendered !== null && String(r.amountTendered).trim() !== '' && !isNaN(Number(r.amountTendered))) {
            const tenderedCentavos = Math.round(Number(r.amountTendered) * 100);
            if (tenderedCentavos < cashDueCentavos) {
              throw Object.assign(
                new Error(
                  `Amount tendered for cash portion (₱${(tenderedCentavos / 100).toFixed(2)}) is less than cash due (₱${(cashDueCentavos / 100).toFixed(2)}).`
                ),
                { statusCode: 400 }
              );
            }
            amountTenderedCents = tenderedCentavos;
            changeCents = tenderedCentavos - cashDueCentavos;
          } else {
            amountTenderedCents = cashDueCentavos;
            changeCents = 0;
          }
        } else {
          amountTenderedCents = 0;
          changeCents = 0;
        }
      }

      // Compute total stay time consumed (server-side UTC diff, whole minutes floor)
      // 100% ACCURACY: Always use server time for checkout, not client-provided time
      let consumedMinutes: number | null = null;
      if (checkIn) {
        const cin = safeParseDate(checkIn);
        // CRITICAL: Use server time for actual checkout, ignore client checkOut timestamp
        const cout = new Date(); // Server time ONLY
        if (cin && cout) {
          const diffMs = cout.getTime() - cin.getTime();
          consumedMinutes = Math.max(0, Math.floor(diffMs / 60000));

          // Validate consumed time is reasonable (max 7 days = 10080 minutes)
          if (consumedMinutes > 10080) {
            console.warn(`[receipts] Unusually long stay: ${consumedMinutes} minutes (${Math.floor(consumedMinutes / 60)} hours) for Room ${roomNumber}`);
          }
        }
      }

      // Server-derived authenticated operator identity (Constraint 7)
      const cashierId = authenticatedOperator;
      const itemsStr = JSON.stringify(items);

      const receiptSnapshotObj = {
        receiptNo,
        dateTime,
        guestName,
        roomNumber: String(roomNumber || ''),
        roomType,
        paymentMethod,
        gcashRef,
        cashAmount,
        gcashAmount,
        checkIn,
        checkOut,
        items,
        subtotal,
        serviceCharge: 0,
        total,
        discount: discountCentavos / 100,
        discountType,
        discountIdRef: (discountIdRef && discountIdRef !== 'VERIFIED' ? discountIdRef.trim() : null),
        rateSelected: finalRateSelected || null,
        stayDuration: finalStayDuration || null,
        cashierId: authenticatedOperator,
        amountTenderedCents,
        changeCents,
        amountTendered: (amountTenderedCents ?? 0) / 100,
        changeAmount: (changeCents ?? 0) / 100,
        consumedMinutes,
        timeConsumed: consumedMinutes != null ? formatConsumedTime(consumedMinutes) : undefined,
        appliedDepositCents: appliedDepositCentavos,
        appliedDepositAmount: appliedDepositCentavos / 100,
        status: 'valid',
      };
      const receiptSnapshotStr = JSON.stringify(receiptSnapshotObj);

      // 1. Insert receipt (includes persisted discount, rate/duration, tendered, change, consumed minutes, idempotency_key, status, receipt_snapshot)
      await conn.query(
        `INSERT INTO receipts (
          receipt_no, date_time, guest_name, room_number, room_type,
          payment_method, gcash_ref, cash_amount, gcash_amount,
          check_in, check_out, items, subtotal, service_charge, total, cashier_id,
          discount_type, discount_amount, discount_id_ref,
          rate_selected, stay_duration,
          amount_tendered_cents, change_cents, consumed_minutes,
          idempotency_key, status, receipt_snapshot
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          receiptNo, dateTime, guestName, roomNumber, roomType,
          paymentMethod, gcashRef, cashAmount, gcashAmount,
          checkIn, checkOut,
          itemsStr,
          subtotal, 0, total, cashierId,
          discountType || null, discountCentavos / 100, (discountIdRef && discountIdRef !== 'VERIFIED' ? discountIdRef.trim() : null),
          finalRateSelected || null, finalStayDuration || null,
          amountTenderedCents, changeCents, consumedMinutes,
          idempotencyKey || null, 'valid', receiptSnapshotStr,
        ]
      );

      // Log direct POS counter sales
      if (!roomRow) {
        const posLogId = `log-pos-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
        await conn.query(
          `INSERT INTO audit_logs (id, timestamp, operator, action, details)
           VALUES (?, NOW(), ?, 'POS_SALE', ?)`,
          [
            posLogId,
            authenticatedOperator,
            `Receipt ${receiptNo}: Counter POS sale completed. Total: ₱${total.toFixed(2)}, Tendered: ₱${((amountTenderedCents ?? 0) / 100).toFixed(2)}, Change: ₱${((changeCents ?? 0) / 100).toFixed(2)}`,
          ]
        );
      }

      // Resolve held deposit record if exists
      if (heldDepositRow) {
        const action = r.depositResolution.action;
        const depAmountCents = Number(heldDepositRow.amount_cents || 0);
        const targetStatus = action === 'apply' ? 'applied' : action === 'refund' ? 'refunded' : 'forfeited';
        const refundAmountCents = action === 'apply' ? Math.max(0, depAmountCents - appliedDepositCentavos) : (action === 'refund' ? depAmountCents : 0);
        const appliedAmountCents = action === 'apply' ? appliedDepositCentavos : 0;
        const nowIso = new Date().toISOString();

        const resolutionSnapshot = {
          depositNumber: heldDepositRow.deposit_number,
          dateTime: nowIso,
          roomNumber,
          guestName: guestName || 'Valued Guest',
          cashierId: authenticatedOperator,
          originalAmount: depAmountCents / 100,
          refundAmount: refundAmountCents / 100,
          appliedAmount: appliedAmountCents / 100,
          status: targetStatus,
          linkedReceiptNo: receiptNo,
          notes: r.depositResolution.notes || '',
        };

        await conn.query(
          `UPDATE deposits SET
             status = ?,
             resolved_by = ?,
             resolved_at = ?,
             refund_amount_cents = ?,
             applied_amount_cents = ?,
             linked_receipt_no = ?,
             resolution_snapshot = ?,
             updated_at = ?
           WHERE deposit_number = ?`,
          [
            targetStatus,
            authenticatedOperator,
            nowIso,
            refundAmountCents,
            appliedAmountCents,
            receiptNo,
            JSON.stringify(resolutionSnapshot),
            nowIso,
            heldDepositRow.deposit_number,
          ]
        );

        const depLogId = `log-dep-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
        await conn.query(
          `INSERT INTO audit_logs (id, timestamp, operator, action, details)
           VALUES (?, NOW(), ?, 'DEPOSIT_RESOLVED', ?)`,
          [
            depLogId,
            authenticatedOperator,
            `Deposit ${heldDepositRow.deposit_number} (₱${(depAmountCents / 100).toFixed(2)}) resolved as ${targetStatus.toUpperCase()} on checkout of Room ${roomNumber}. Linked Receipt: ${receiptNo}`,
          ]
        );
      }

      // 2. If room checkout, transition room state to 'available' (Cleaning mode removed)
      // H-05 FIX: Use optimistic locking to prevent concurrent checkout race conditions
      if (roomNumber) {
        const preCheckoutTimestamp = roomRow.updated_at;

        const updateResult = await conn.query(
          `UPDATE rooms SET
            state = 'available', label = 'Available', guest_name = '', guest_id = '',
            num_guests = 0, rate_selected = '24h', custom_hours = NULL, extra_beds = 0, towel_sets = 0,
            check_in_time = NULL, check_out_time = NULL,
            check_in_at = NULL, expected_checkout_at = NULL,
            alarm_state = 'NORMAL', acknowledged_at = NULL, acknowledged_by = NULL,
            is_overdue = 0, charged_food = '[]',
            discount_type = 'NONE', discount_id_ref = '',
            billing_mode = 'standard', open_time_started_at = NULL, last_reminder_at = NULL,
            snoozed_until = NULL, repeat_count = 0, overtime_waived = 0,
            allocated_receipt_no = NULL,
            updated_at = NOW()
           WHERE number = ?
             AND state IN ('occupied', 'overdue')
             AND updated_at = ?`,
          [roomNumber, preCheckoutTimestamp]
        );

        // If no rows updated, room state changed during checkout (race condition detected)
        if (updateResult.affectedRows === 0) {
          throw Object.assign(
            new Error(`Room ${roomNumber} state changed during checkout. Another session may have already processed this checkout. Please refresh and verify room status.`),
            { statusCode: 409 }
          );
        }

        // 3. Write audit log (Constraint 7: server-derived operator)
        const logId = `log-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
        await conn.query(
          `INSERT INTO audit_logs (id, timestamp, operator, action, details)
           VALUES (?, NOW(), ?, 'CHECKOUT', ?)`,
          [
            logId,
            authenticatedOperator,
            `Receipt ${receiptNo}: Guest ${guestName} checked out of Room ${roomNumber}. Total: ₱${total.toLocaleString()}${discountType ? ` (${discountType} Discount: ₱${(discountCentavos / 100).toFixed(2)}, Ref: ${discountIdRef})` : ''}${appliedDepositCentavos > 0 ? ` (Deposit Applied: ₱${(appliedDepositCentavos / 100).toFixed(2)})` : ''}. Tendered: ₱${((amountTenderedCents ?? 0) / 100).toFixed(2)}, Change: ₱${((changeCents ?? 0) / 100).toFixed(2)}, Consumed: ${consumedMinutes != null ? formatConsumedTime(consumedMinutes) : 'N/A'}`,
          ]
        );

        // Dedicated audit log entry for discount application (Constraint 7)
        if (discountCentavos > 0 && discountType) {
          const discountLogId = `log-disc-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
          await conn.query(
            `INSERT INTO audit_logs (id, timestamp, operator, action, details)
             VALUES (?, NOW(), ?, 'DISCOUNT_APPLIED', ?)`,
            [
              discountLogId,
              authenticatedOperator,
              `Applied ${discountType} discount of ₱${(discountCentavos / 100).toFixed(2)} on Room ${roomNumber} (${roomTier} / ${finalStayDuration}) [Ref: ${discountIdRef}]. Checkout total: ₱${total.toFixed(2)}`,
            ]
          );
        }

        // 4. Update POS revenue if food was charged
        if (foodCharges > 0) {
          const today = new Date().toISOString().split('T')[0];
          await conn.query(
            `INSERT INTO pos_revenue (date, kitchen, drinks, miscell)
             VALUES (?, ?, 0, 0)
             ON CONFLICT (date) DO UPDATE SET kitchen = pos_revenue.kitchen + EXCLUDED.kitchen, updated_at = NOW()`,
            [today, foodCharges]
          );
        }
      }

      // Fetch created receipt within transaction
      const created = await conn.query('SELECT * FROM receipts WHERE receipt_no = ?', [receiptNo]);
      return { alreadyExists: false, receipt: rowToReceipt(created.rows[0]), roomNumber, foodCharges };
    });

    // Handle idempotent return
    if (receiptData.alreadyExists) {
      return res.status(200).json(receiptData.receipt);
    }

    const receipt = receiptData.receipt;

    // Auto-populate weekly report entry (outside transaction — retry 3x, audit on persistent failure)
    let aggOk = false;
    for (let aggAttempt = 1; aggAttempt <= 3 && !aggOk; aggAttempt++) {
      try {
        await weeklyReportAggregator.onReceiptCreated({
          receipt_no: receipt.receiptNo,
          date_time: receipt.dateTime,
          room_number: receipt.roomNumber,
          guest_name: receipt.guestName,
          items: receipt.items || [],
          subtotal: receipt.subtotal,
          service_charge: receipt.serviceCharge || 0,
          total: receipt.total,
          payment_method: receipt.paymentMethod,
          cash_amount: receipt.cashAmount,
          gcash_amount: receipt.gcashAmount,
          cashier_id: receipt.cashierId,
        });
        aggOk = true;
      } catch (aggErr) {
        console.warn(`⚠️ Weekly report aggregation failed (attempt ${aggAttempt}/3):`, aggErr);
        if (aggAttempt === 3) {
          try {
            await pool.query(
              `INSERT INTO audit_logs (id, timestamp, operator, action, details) VALUES (?, CURRENT_TIMESTAMP, ?, 'WEEKLY_AGGREGATE_FAILED', ?)`,
              [`log-aggfail-${Date.now()}`, receipt.cashierId || 'system', `Receipt ${receipt.receiptNo} committed but weekly aggregation failed 3x — needs backfill. Total: ${receipt.total}`]
            );
          } catch { /* audit best-effort */ }
        }
      }
    }

    // Broadcast receipt creation
    socketManager.broadcastReceiptCreated({
      receiptNo: receipt.receiptNo,
      roomNumber: receipt.roomNumber,
      total: receipt.total,
      cashier: receipt.cashierId,
      timestamp: new Date().toISOString(),
    });

    // Broadcast room status change: Room is now available
    if (receiptData.roomNumber) {
      socketManager.broadcastRoomUpdate({
        roomNumber: receiptData.roomNumber,
        state: 'available',
        label: 'Available',
        guestName: '',
        alarmState: 'NORMAL',
        checkInTime: undefined,
        checkOutTime: undefined,
        checkInAt: undefined,
        expectedCheckoutAt: undefined,
        acknowledgedAt: null,
        acknowledgedBy: null,
        timestamp: new Date().toISOString(),
      });
      socketManager.broadcastAlarmStateChanged({
        roomNumber: receiptData.roomNumber,
        previousState: 'OVERDUE',
        newState: 'NORMAL',
        expectedCheckoutAt: '',
        acknowledgedAt: null,
        acknowledgedBy: null,
        timestamp: new Date().toISOString(),
      });
    }

    analyticsService.notifyGuestCountsUpdated().catch(console.warn);

    return res.status(201).json(receipt);
  } catch (err: any) {
    console.error('POST /receipts error:', err);
    const status = err.statusCode && Number.isInteger(err.statusCode) ? err.statusCode : 500;
    return res.status(status).json({ error: err.message || 'Failed to create receipt' });
  }
}));

// GET /api/receipts/:receiptNo — fetch a single receipt by receipt_no
router.get('/:receiptNo', requireCashierStaff, asyncHandler(async (req: Request, res: Response) => {
  const { receiptNo } = req.params;
  const existing = await pool.query('SELECT * FROM receipts WHERE receipt_no = ?', [receiptNo]);
  if (existing.rows.length === 0) {
    return res.status(404).json({ error: `Receipt ${receiptNo} not found.` });
  }
  res.json(rowToReceipt(existing.rows[0]));
}));

// POST /api/receipts/:receiptNo/reprint — reprint an existing receipt, increments reprint_count and logs audit
router.post('/:receiptNo/reprint', requireCashierStaff, asyncHandler(async (req: Request, res: Response) => {
  const { receiptNo } = req.params;
  const operator = (req as any).operator?.username || 'cashier';

  const updatedReceipt = await withTransaction(async (conn) => {
    const existing = await conn.query('SELECT * FROM receipts WHERE receipt_no = ?', [receiptNo]);
    if (existing.rows.length === 0) {
      throw Object.assign(new Error(`Receipt ${receiptNo} not found.`), { statusCode: 404 });
    }

    const currentCount = Number(existing.rows[0].reprint_count || 0);
    const newCount = currentCount + 1;
    const now = new Date().toISOString();

    await conn.query(
      `UPDATE receipts SET
        reprint_count = ?,
        last_reprinted_at = ?,
        last_reprinted_by = ?
       WHERE receipt_no = ?`,
      [newCount, now, operator, receiptNo]
    );

    const auditId = `audit-reprint-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    await conn.query(
      `INSERT INTO audit_logs (id, timestamp, operator, action, details)
       VALUES (?, NOW(), ?, 'RECEIPT_REPRINTED', ?)`,
      [auditId, operator, `Reprint #${newCount} generated for receipt ${receiptNo}`]
    );

    const reloaded = await conn.query('SELECT * FROM receipts WHERE receipt_no = ?', [receiptNo]);
    const receiptObj = rowToReceipt(reloaded.rows[0]);

    const escposBuffer = buildReceiptEscPosBuffer({
      receiptNo: receiptObj.receiptNo,
      dateTime: receiptObj.dateTime,
      guestName: receiptObj.guestName,
      roomNumber: receiptObj.roomNumber,
      roomType: receiptObj.roomType,
      cashierId: receiptObj.cashierId,
      checkIn: receiptObj.checkIn || '',
      checkOut: receiptObj.checkOut || '',
      stayDuration: receiptObj.stayDuration,
      timeConsumed: receiptObj.timeConsumed,
      items: receiptObj.items || [],
      subtotal: receiptObj.subtotal,
      discount: receiptObj.discount,
      discountType: receiptObj.discountType,
      discountCardMasked: receiptObj.discountIdRef ? maskDiscountCardId(receiptObj.discountIdRef) : undefined,
      total: receiptObj.total,
      paymentMethod: receiptObj.paymentMethod,
      amountTendered: receiptObj.amountTendered || receiptObj.total,
      changeAmount: receiptObj.changeAmount || 0,
      cashAmount: receiptObj.cashAmount,
      gcashAmount: receiptObj.gcashAmount,
      gcashRef: receiptObj.gcashRef,
      reprintCount: newCount,
      isVoid: receiptObj.status === 'void',
      voidReason: receiptObj.voidReason,
    });

    return {
      ...receiptObj,
      escposBufferBase64: escposBuffer.toString('base64'),
    };
  });

  res.json(updatedReceipt);
}));

// POST /api/receipts/:receiptNo/void — mark a receipt as void (admin/owner only, audit logged)
router.post('/:receiptNo/void', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const { receiptNo } = req.params;
  const { reason } = req.body;
  const operator = (req as any).operator?.username || 'admin';

  if (!reason || typeof reason !== 'string' || !reason.trim()) {
    throw Object.assign(new Error('Void reason is required to void a receipt.'), { statusCode: 400 });
  }

  const updatedReceipt = await withTransaction(async (conn) => {
    const existing = await conn.query('SELECT * FROM receipts WHERE receipt_no = ?', [receiptNo]);
    if (existing.rows.length === 0) {
      throw Object.assign(new Error(`Receipt ${receiptNo} not found.`), { statusCode: 404 });
    }

    const row = existing.rows[0];
    if (row.status === 'void') {
      throw Object.assign(new Error(`Receipt ${receiptNo} is already marked void.`), { statusCode: 400 });
    }

    const now = new Date().toISOString();
    await conn.query(
      `UPDATE receipts SET
        status = 'void',
        void_reason = ?,
        voided_at = ?,
        voided_by = ?
       WHERE receipt_no = ?`,
      [reason.trim(), now, operator, receiptNo]
    );

    const auditId = `audit-void-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    await conn.query(
      `INSERT INTO audit_logs (id, timestamp, operator, action, details)
       VALUES (?, NOW(), ?, 'RECEIPT_VOIDED', ?)`,
      [auditId, operator, `Receipt ${receiptNo} was marked VOID. Reason: ${reason.trim()}`]
    );

    const reloaded = await conn.query('SELECT * FROM receipts WHERE receipt_no = ?', [receiptNo]);
    return rowToReceipt(reloaded.rows[0]);
  });

  // Reverse weekly/shift aggregation outside tx (warn-only, consistent with create path)
  weeklyReportAggregator.onReceiptVoided(updatedReceipt as any).catch((e: any) => console.warn('[receipts] onReceiptVoided failed:', e));

  res.json(updatedReceipt);
}));

// POST /api/receipts/void-preprint — mark an unfinalized pre-print receipt as VOID
router.post('/void-preprint', requireCashierStaff, asyncHandler(async (req: Request, res: Response) => {
  const { roomNumber, bookingId, receiptNo: explicitReceiptNo, reason } = req.body || {};
  const operator = (req as any).operator?.username || 'Frontdesk';

  if (!reason || typeof reason !== 'string' || !reason.trim()) {
    res.status(400).json({ error: 'Void reason is required to void a pre-print receipt.' });
    return;
  }

  const result = await withTransaction(async (conn) => {
    let targetReceiptNo = explicitReceiptNo ? String(explicitReceiptNo).trim() : null;
    let roomRow: any = null;

    if (roomNumber) {
      const roomRes = await conn.query('SELECT * FROM rooms WHERE number = ? FOR UPDATE', [String(roomNumber).trim()]);
      if (roomRes.rows.length > 0) {
        roomRow = roomRes.rows[0];
        if (!targetReceiptNo && roomRow.allocated_receipt_no) {
          targetReceiptNo = roomRow.allocated_receipt_no;
        }
      }
    }

    if (bookingId && !targetReceiptNo) {
      const bRes = await conn.query('SELECT * FROM scheduled_bookings WHERE id = ?', [String(bookingId).trim()]);
      if (bRes.rows.length > 0 && bRes.rows[0].allocated_receipt_no) {
        targetReceiptNo = bRes.rows[0].allocated_receipt_no;
      }
    }

    if (!targetReceiptNo) {
      throw Object.assign(new Error('No allocated pre-print receipt number found to void.'), { statusCode: 404 });
    }

    // Check if receipt already exists in receipts table
    const existing = await conn.query('SELECT * FROM receipts WHERE receipt_no = ?', [targetReceiptNo]);
    const nowIso = new Date().toISOString();

    if (existing.rows.length > 0) {
      await conn.query(
        `UPDATE receipts SET status = 'void', void_reason = ?, voided_at = ?, voided_by = ? WHERE receipt_no = ?`,
        [reason.trim(), nowIso, operator, targetReceiptNo]
      );
    } else {
      // Insert new voided receipt placeholder to prevent receipt number reuse
      await conn.query(
        `INSERT INTO receipts (
          receipt_no, date_time, guest_name, room_number, room_type,
          payment_method, check_in, check_out, items, subtotal, service_charge, total,
          cashier_id, status, void_reason, voided_at, voided_by
        ) VALUES (?, ?, ?, ?, ?, 'CASH', ?, ?, '[]', 0, 0, 0, ?, 'void', ?, ?, ?)`,
        [
          targetReceiptNo,
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

    // Clear allocated_receipt_no on room / booking
    if (roomNumber) {
      await conn.query('UPDATE rooms SET allocated_receipt_no = NULL WHERE number = ?', [String(roomNumber).trim()]);
    }
    if (bookingId) {
      await conn.query('UPDATE scheduled_bookings SET allocated_receipt_no = NULL WHERE id = ?', [String(bookingId).trim()]);
    }

    const auditId = `audit-voidpre-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    await conn.query(
      `INSERT INTO audit_logs (id, timestamp, operator, action, details)
       VALUES (?, CURRENT_TIMESTAMP, ?, 'PREPRINT_VOIDED', ?)`,
      [
        auditId,
        operator,
        `Pre-print receipt ${targetReceiptNo} for Room ${roomNumber || 'N/A'} was marked VOID. Reason: ${reason.trim()}`,
      ]
    );

    const reloaded = await conn.query('SELECT * FROM receipts WHERE receipt_no = ?', [targetReceiptNo]);
    return rowToReceipt(reloaded.rows[0]);
  });

  res.json(result);
}));

export default router;





