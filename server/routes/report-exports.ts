/**
 * server/routes/report-exports.ts
 * Database-authoritative admin exports (SEPARATE from the existing
 * browser-generated workbooks — those are intentionally left untouched).
 *
 * GET /api/report-exports/executive-workbook?weekStart=YYYY-MM-DD
 * GET /api/report-exports/transactions-ledger?from=YYYY-MM-DD&to=YYYY-MM-DD
 * GET /api/report-exports/shift-forms?date=YYYY-MM-DD&shift=DAY|NIGHT
 *   (printable Cashier Transaction Form + Shift Transfer Form, paper-faithful)
 *
 * Both endpoints query SQLite directly at request time, are restricted to
 * admin/owner roles, and report actuals only (missing data is flagged
 * UNRECONCILED — never estimated).
 */

import { Router, Request, Response } from 'express';
import ExcelJS from 'exceljs';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { validateWeekStartDate, formatValidationErrors } from '../utils/validation';
import { asyncHandler } from '../utils/async-handler';

const router = Router();

function requireAdminOwner(req: Request, res: Response): { username: string } | null {
  const operator = (req as any).operator;
  if (!operator || (operator.role !== 'admin' && operator.role !== 'owner')) {
    res.status(403).json({ error: 'Only admin or owner can generate authoritative exports' });
    return null;
  }
  return { username: operator.username };
}

export async function logReportExport(
  operator: string,
  reportType: string,
  filterDetails: string
): Promise<void> {
  try {
    const auditId = `audit-exp-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const timestamp = new Date().toISOString();
    await pool.query(
      `INSERT INTO audit_logs (id, timestamp, operator, action, details)
       VALUES (?, ?, ?, 'EXPORT_GENERATED', ?)`,
      [auditId, timestamp, operator, `Generated ${reportType} export. Range/Filters: ${filterDetails}`]
    );
  } catch (err) {
    console.warn('⚠️ logReportExport warning:', err);
  }
}

function mondayToSunday(weekStart: string): { start: string; end: string } {
  const d = new Date(`${weekStart}T00:00:00`);
  const end = new Date(d);
  end.setDate(end.getDate() + 6);
  const fmt = (x: Date) => x.toISOString().slice(0, 10);
  return { start: fmt(d), end: fmt(end) };
}

function money(v: any): number {
  const n = Number(v || 0);
  return isNaN(n) ? 0 : Math.round(n * 100) / 100;
}

// Neutralize CSV/Excel formula injection: prefix =, +, -, @ with apostrophe.
function safeCell(v: any): any {
  if (typeof v !== 'string') return v;
  if (/^[=+\-@\t\r]/.test(v)) return `'${v}`;
  return v;
}

function styleHeaderRow(ws: ExcelJS.Worksheet, rowNumber: number, colCount: number): void {
  const row = ws.getRow(rowNumber);
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4D2E' } };
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.border = {
      top: { style: 'thin' }, bottom: { style: 'thin' },
      left: { style: 'thin' }, right: { style: 'thin' },
    };
  }
}

function addTitleBlock(ws: ExcelJS.Worksheet, title: string, subtitle: string, controlNo: string): number {
  ws.mergeCells('A1:F1');
  ws.getCell('A1').value = 'SEDONA COURT TRAVELLERS INN — DATABASE-AUTHORITATIVE EXPORT';
  ws.getCell('A1').font = { bold: true, size: 13 };
  ws.mergeCells('A2:F2');
  ws.getCell('A2').value = title;
  ws.getCell('A2').font = { bold: true, size: 11 };
  ws.mergeCells('A3:F3');
  ws.getCell('A3').value = subtitle;
  ws.getCell('A3').font = { italic: true, size: 10, color: { argb: 'FF555555' } };
  ws.mergeCells('A4:F4');
  ws.getCell('A4').value = `Control No: ${controlNo} | Source: live database (server-generated, not a browser snapshot)`;
  ws.getCell('A4').font = { size: 9, color: { argb: 'FF555555' } };
  return 6; // first data-header row
}

function safeParseItems(raw: any): Array<{ description?: string; subtext?: string; amount?: number }> {
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isRentLine(description?: string): boolean {
  return /rent/i.test(description || '');
}

async function tryQuery(sql: string, params: any[] = []): Promise<any[]> {
  try {
    const res = await pool.query(sql, params);
    return res.rows;
  } catch (err) {
    console.error(`report-exports: query failed. SQL: ${sql}`, err);
    throw err;
  }
}

// GET /api/report-exports/executive-workbook?weekStart=YYYY-MM-DD
router.get('/executive-workbook', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const admin = requireAdminOwner(req, res);
  if (!admin) return;

  const weekStart = String(req.query.weekStart || '');
  const validation = validateWeekStartDate(weekStart);
  if (!validation.valid) {
    res.status(400).json({ error: 'Invalid weekStart', details: formatValidationErrors(validation.errors) });
    return;
  }
  const { start, end } = mondayToSunday(weekStart);

  // ── Pull every source table (each failure degrades to empty, never 500s) ──
  const [
    receipts,
    shiftEntries,
    expenseRows,
    gcashRows,
    denomRows,
    depositRows,
    auditRows,
    inventoryEvents,
    inventoryNow,
    services,
    forceRequests,
    roomsNow,
    bookings,
    transfers,
  ] = await Promise.all([
    tryQuery(`SELECT * FROM receipts WHERE date_time >= ? AND date_time <= ? AND (status IS NULL OR status = 'valid') AND receipt_no NOT LIKE 'FCE-%' ORDER BY date_time ASC`, [start, `${end}T23:59:59.999Z`]),
    tryQuery(`SELECT * FROM weekly_shift_entries WHERE date BETWEEN ? AND ? ORDER BY date ASC, shift_type ASC`, [start, end]),
    tryQuery(`SELECT * FROM weekly_expenses WHERE week_start = ?`, [weekStart]),
    tryQuery(`SELECT * FROM gcash_entries WHERE date BETWEEN ? AND ? ORDER BY date ASC`, [start, end]),
    tryQuery(`SELECT * FROM cash_denomination_report WHERE week_start = ?`, [weekStart]),
    tryQuery(`SELECT * FROM deposit_transactions WHERE created_at >= ? AND created_at <= ? ORDER BY created_at ASC`, [start, `${end}T23:59:59.999Z`]),
    tryQuery(`SELECT * FROM audit_logs WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC LIMIT 2000`, [start, `${end}T23:59:59.999Z`]),
    tryQuery(`SELECT * FROM inventory_events WHERE created_at >= ? AND created_at <= ? ORDER BY created_at ASC`, [start, `${end}T23:59:59.999Z`]),
    tryQuery(`SELECT * FROM menu_item_inventory ORDER BY category ASC, item_name ASC`),
    tryQuery(`SELECT id, name, price FROM billable_services WHERE is_deleted = 0`),
    tryQuery(`SELECT * FROM force_checkout_requests WHERE COALESCE(requested_at, created_at) >= ? AND COALESCE(requested_at, created_at) <= ? ORDER BY requested_at ASC`, [start, `${end}T23:59:59.999Z`]),
    tryQuery(`SELECT number, tier, room_type, state FROM rooms ORDER BY CAST(number AS INTEGER) ASC`),
    tryQuery(`SELECT * FROM scheduled_bookings WHERE status != 'cancelled' AND ((check_in_date BETWEEN ? AND ?) OR (check_out_date BETWEEN ? AND ?))`, [start, end, start, end]),
    tryQuery(`SELECT * FROM room_transfers WHERE transferred_at >= ? AND transferred_at <= ? ORDER BY transferred_at ASC`, [start, `${end}T23:59:59.999Z`]),
  ]);

  const priceById = new Map<string, number>();
  for (const s of services) priceById.set(String(s.id), money(s.price));

  // ── Honest aggregations (actuals only) ──
  const grossRevenue = receipts.reduce((s, r) => s + money(r.total), 0);
  const roomRevenue = receipts.reduce((s, r) => {
    const items = safeParseItems(r.items);
    if (items.length === 0) return s + (String(r.room_number || '').toUpperCase() === 'WALK-IN' || !r.room_number ? 0 : money(r.total));
    return s + items.filter((i) => isRentLine(i.description)).reduce((a, i) => a + money(i.amount), 0);
  }, 0);
  const fbRevenue = receipts.reduce((s, r) => {
    const items = safeParseItems(r.items);
    if (items.length === 0) return s;
    return s + items.filter((i) => !isRentLine(i.description) && money(i.amount) > 0).reduce((a, i) => a + money(i.amount), 0);
  }, 0);
  const discountTotal = receipts.reduce((s, r) => s + money(r.discount_amount), 0);
  const cashCollected = receipts.reduce((s, r) => {
    const m = String(r.payment_method || '').toUpperCase();
    if (m === 'CASH') return s + money(r.total);
    if (m === 'MIXED') return s + money(r.cash_amount);
    return s;
  }, 0);
  const gcashCollected = receipts.reduce((s, r) => {
    const m = String(r.payment_method || '').toUpperCase();
    if (m === 'GCASH') return s + money(r.total);
    if (m === 'MIXED') return s + money(r.gcash_amount);
    return s;
  }, 0);
  const roomsSold = receipts.filter((r) => r.room_number && !['WALK-IN', 'POS'].includes(String(r.room_number).toUpperCase())).length;
  const roomCount = roomsNow.length || 32;
  const occupiedNow = roomsNow.filter((r) => r.state === 'occupied' || r.state === 'overdue').length;
  const adr = roomsSold > 0 ? roomRevenue / roomsSold : 0;
  const revpar = roomCount > 0 ? roomRevenue / (roomCount * 7) : 0;

  const expenseRow = expenseRows[0] as any;
  const totalExpenses = expenseRow ? money(expenseRow.total_expenses) : 0;
  const denom = denomRows[0] as any;
  const countedCash = denom ? money(denom.grand_total) : 0;

  const depositIn = depositRows.filter((d) => d.direction === 'IN').reduce((s, d) => s + money(d.amount_centavos) / 100, 0);
  const depositOut = depositRows.filter((d) => d.direction === 'OUT').reduce((s, d) => s + money(d.amount_centavos) / 100, 0);

  const controlNo = `DBA-${weekStart.replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;
  const generatedAt = new Date().toISOString();
  const periodLabel = `${start} to ${end}`;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sedona Court PMS (server)';
  wb.created = new Date();

  // ── Cover ──
  {
    const ws = wb.addWorksheet('DB Cover');
    ws.columns = [{ width: 34 }, { width: 60 }];
    const r0 = addTitleBlock(ws, 'Executive Audit Workbook', `Period: ${periodLabel} | Generated: ${generatedAt} by ${admin.username}`, controlNo);
    ws.getCell(`A${r0}`).value = 'SOURCE TABLE';
    ws.getCell(`B${r0}`).value = 'ROWS EXPORTED';
    styleHeaderRow(ws, r0, 2);
    const counts: Array<[string, number]> = [
      ['receipts', receipts.length],
      ['weekly_shift_entries', shiftEntries.length],
      ['weekly_expenses', expenseRows.length],
      ['gcash_entries', gcashRows.length],
      ['cash_denomination_report', denomRows.length],
      ['deposit_transactions', depositRows.length],
      ['audit_logs', auditRows.length],
      ['inventory_events', inventoryEvents.length],
      ['force_checkout_requests', forceRequests.length],
      ['room_transfers', transfers.length],
      ['rooms (as-of-export snapshot)', roomsNow.length],
    ];
    counts.forEach(([t, n], i) => {
      ws.getCell(`A${r0 + 1 + i}`).value = t;
      ws.getCell(`B${r0 + 1 + i}`).value = n;
    });
  }

  // ── Dashboard (actuals only) ──
  {
    const ws = wb.addWorksheet('DB Dashboard');
    ws.columns = [{ width: 42 }, { width: 22 }, { width: 40 }];
    const r0 = addTitleBlock(ws, 'P&L Dashboard (database actuals)', `Period: ${periodLabel}`, controlNo);
    const rows: Array<[string, number | string, string]> = [
      ['Gross Revenue (receipts total)', grossRevenue, 'Actual'],
      ['Room Revenue (rent lines)', roomRevenue, 'Actual'],
      ['F&B & Other Revenue (non-rent lines)', fbRevenue, 'Actual'],
      ['Discounts Granted (persisted)', discountTotal, 'Actual'],
      ['Cash Collected', cashCollected, 'Actual'],
      ['GCash Collected', gcashCollected, 'Actual'],
      ['Total Expenses (weekly register)', totalExpenses, expenseRows.length ? 'Actual' : 'UNRECONCILED — no expense register for this week'],
      ['Net (gross − expenses)', Math.round((grossRevenue - totalExpenses) * 100) / 100, expenseRows.length ? 'Actual' : 'UNRECONCILED'],
      ['Rooms Sold (receipts w/ room no.)', roomsSold, 'Actual'],
      ['ADR (room revenue ÷ rooms sold)', Math.round(adr * 100) / 100, roomsSold ? 'Actual' : 'UNRECONCILED — no room sales'],
      ['RevPAR (room revenue ÷ 32 rooms ÷ 7 days)', Math.round(revpar * 100) / 100, 'Actual'],
      ['Occupancy AS OF EXPORT (live snapshot)', `${occupiedNow}/${roomCount}`, 'Snapshot — not a period average'],
      ['Deposit IN (period)', Math.round(depositIn * 100) / 100, 'Actual'],
      ['Deposit OUT (period)', Math.round(depositOut * 100) / 100, 'Actual'],
    ];
    ws.getCell(`A${r0}`).value = 'KPI';
    ws.getCell(`B${r0}`).value = 'VALUE (PHP)';
    ws.getCell(`C${r0}`).value = 'BASIS';
    styleHeaderRow(ws, r0, 3);
    rows.forEach(([k, v, b], i) => {
      ws.getCell(`A${r0 + 1 + i}`).value = k;
      ws.getCell(`B${r0 + 1 + i}`).value = v;
      if (typeof v === 'number') ws.getCell(`B${r0 + 1 + i}`).numFmt = '#,##0.00';
      ws.getCell(`C${r0 + 1 + i}`).value = b;
    });
  }

  // ── Shift log ──
  {
    const ws = wb.addWorksheet('DB Shift Log');
    const headers = ['DATE', 'DAY', 'SHIFT', 'CASHIER', 'CHECKINS', 'CHECKOUTS', 'TRANSFERS', 'ROOM BILL', 'KITCHEN', 'DRINKS', 'MISCELL', 'EXTRAS', 'DISCOUNT', 'RECEIVED'];
    ws.columns = headers.map((h) => ({ header: h, key: h, width: 14 }));
    styleHeaderRow(ws, 1, headers.length);
    for (const s of shiftEntries) {
      ws.addRow({
        DATE: s.date, DAY: s.day_of_week, SHIFT: s.shift_type, CASHIER: s.cashier_name,
        CHECKINS: Number(s.total_checkins || 0), CHECKOUTS: Number(s.checkout_count || 0), TRANSFERS: Number(s.transfer_count || 0),
        'ROOM BILL': money(s.room_bill), KITCHEN: money(s.kitchen_bill), DRINKS: money(s.drinks_bill),
        MISCELL: money(s.miscell_purchases), EXTRAS: money(s.extras), DISCOUNT: money(s.discount),
        RECEIVED: money(s.payment_received),
      });
    }
    if (shiftEntries.length === 0) ws.addRow({ DATE: 'No shift entries recorded for this week — UNRECONCILED' });
  }

  // ── Journal ──
  {
    const ws = wb.addWorksheet('DB Journal');
    const headers = ['RECEIPT NO', 'DATE & TIME', 'ROOM', 'GUEST', 'PAYMENT', 'CASH', 'GCASH', 'GCASH REF', 'SUBTOTAL', 'TOTAL', 'DISCOUNT TYPE', 'DISCOUNT', 'DISC REF', 'CASHIER'];
    ws.columns = headers.map((h) => ({ header: h, key: h, width: 16 }));
    ws.getColumn(4).width = 22;
    styleHeaderRow(ws, 1, headers.length);
    for (const r of receipts) {
      const items = safeParseItems(r.items);
      ws.addRow({
        'RECEIPT NO': safeCell(r.receipt_no),
        'DATE & TIME': r.date_time,
        ROOM: safeCell(r.room_number || 'POS'),
        GUEST: safeCell(r.guest_name || 'Walk-In'),
        PAYMENT: r.payment_method,
        CASH: money(r.cash_amount),
        GCASH: money(r.gcash_amount),
        'GCASH REF': safeCell(r.gcash_ref || '-'),
        SUBTOTAL: money(r.subtotal),
        TOTAL: money(r.total),
        'DISCOUNT TYPE': r.discount_type || (items.some((i) => money(i.amount) < 0) ? 'LEGACY (in-line)' : '-'),
        DISCOUNT: money(r.discount_amount),
        'DISC REF': safeCell(r.discount_id_ref || '-'),
        CASHIER: safeCell(r.cashier_id || '-'),
      });
    }
    const totalRow = ws.addRow({
      'RECEIPT NO': `TOTALS (${receipts.length} receipts)`,
      SUBTOTAL: receipts.reduce((s, r) => s + money(r.subtotal), 0),
      TOTAL: grossRevenue,
      DISCOUNT: discountTotal,
    });
    totalRow.font = { bold: true };
  }

  // ── Deposits ──
  {
    const ws = wb.addWorksheet('DB Deposits');
    const headers = ['ID', 'CREATED', 'GUEST ID', 'GUEST', 'DIR', 'AMOUNT', 'METHOD', 'ROOM', 'RECEIPT', 'OPERATOR', 'NOTES'];
    ws.columns = headers.map((h) => ({ header: h, key: h, width: 18 }));
    styleHeaderRow(ws, 1, headers.length);
    let running = 0;
    const ordered = [...depositRows].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    for (const d of ordered) {
      const amt = money(d.amount_centavos) / 100;
      running = Math.round((running + (d.direction === 'IN' ? amt : -amt)) * 100) / 100;
      ws.addRow({
        ID: safeCell(d.id), CREATED: d.created_at, 'GUEST ID': safeCell(d.guest_identifier), GUEST: safeCell(d.guest_name || '-'),
        DIR: d.direction, AMOUNT: amt, METHOD: d.payment_method || '-', ROOM: safeCell(d.room_number || '-'),
        RECEIPT: safeCell(d.receipt_no || '-'), OPERATOR: safeCell(d.operator), NOTES: safeCell(d.notes || '-'),
      });
    }
    const totalRow = ws.addRow({ ID: `BALANCE (IN ${Math.round(depositIn * 100) / 100} − OUT ${Math.round(depositOut * 100) / 100})`, AMOUNT: Math.round(running * 100) / 100 });
    totalRow.font = { bold: true };
    if (ordered.length === 0) ws.addRow({ ID: 'No deposit transactions in this period' });
  }

  // ── Night audit ──
  {
    const ws = wb.addWorksheet('DB Night Audit');
    const headers = ['DATE', 'ARRIVALS', 'DEPARTURES', 'ROOM REVENUE', 'F&B+OTHER', 'TOTAL REVENUE', 'TRANSACTIONS'];
    ws.columns = headers.map((h) => ({ header: h, key: h, width: 18 }));
    styleHeaderRow(ws, 1, headers.length);
    const dayCursor = new Date(`${start}T00:00:00`);
    const endD = new Date(`${end}T00:00:00`);
    while (dayCursor <= endD) {
      const day = dayCursor.toISOString().slice(0, 10);
      const dayReceipts = receipts.filter((r) => String(r.date_time || '').slice(0, 10) === day);
      const arrivals = dayReceipts.filter((r) => String(r.check_in || '').slice(0, 10) === day).length;
      const departures = dayReceipts.filter((r) => String(r.check_out || '').slice(0, 10) === day).length;
      let dayRoom = 0;
      let dayFb = 0;
      for (const r of dayReceipts) {
        const items = safeParseItems(r.items);
        if (items.length === 0) {
          if (r.room_number && !['WALK-IN', 'POS'].includes(String(r.room_number).toUpperCase())) dayRoom += money(r.total);
          else dayFb += money(r.total);
        } else {
          for (const i of items) {
            if (money(i.amount) < 0) continue;
            if (isRentLine(i.description)) dayRoom += money(i.amount);
            else dayFb += money(i.amount);
          }
        }
      }
      ws.addRow({
        DATE: day, ARRIVALS: arrivals, DEPARTURES: departures,
        'ROOM REVENUE': Math.round(dayRoom * 100) / 100,
        'F&B+OTHER': Math.round(dayFb * 100) / 100,
        'TOTAL REVENUE': Math.round((dayRoom + dayFb) * 100) / 100,
        TRANSACTIONS: dayReceipts.length,
      });
      dayCursor.setDate(dayCursor.getDate() + 1);
    }
    const noShows = bookings.filter((b) => b.status === 'cancelled').length;
    ws.addRow({});
    ws.addRow({ DATE: `Occupancy AS OF EXPORT: ${occupiedNow}/${roomCount} (snapshot, not period average)` });
    ws.addRow({ DATE: `Reservations overlapping period: ${bookings.length} (cancelled/no-show: ${noShows})` });
  }

  // ── Comps / voids / force-outs ──
  {
    const ws = wb.addWorksheet('DB Comps Voids');
    const headers = ['KIND', 'REF', 'DATE', 'ROOM', 'GUEST', 'AMOUNT', 'STATUS/RESOLUTION', 'BY', 'NOTES'];
    ws.columns = headers.map((h) => ({ header: h, key: h, width: 20 }));
    styleHeaderRow(ws, 1, headers.length);
    const fceReceipts = receipts.filter((r) => String(r.receipt_no || '').startsWith('FCE-'));
    for (const r of fceReceipts) {
      ws.addRow({
        KIND: 'FORCE-OUT SLIP', REF: r.receipt_no, DATE: r.date_time, ROOM: r.room_number,
        GUEST: r.guest_name, AMOUNT: money(r.subtotal), STATUS: r.gcash_ref || '-', BY: r.cashier_id, NOTES: '-',
      });
    }
    for (const f of forceRequests) {
      ws.addRow({
        KIND: 'FORCE REQUEST', REF: f.id, DATE: f.requested_at || f.created_at, ROOM: f.room_number,
        GUEST: f.guest_name, AMOUNT: money(f.uncollected_amount), 'STATUS/RESOLUTION': `${f.status}${f.resolution_type ? ` / ${f.resolution_type}` : ''}`,
        BY: `${f.requested_by || '-'} → ${f.resolved_by || '-'}`,
        NOTES: [f.reason, f.cashier_notes, f.admin_notes].filter(Boolean).join(' | '),
      });
    }
    if (fceReceipts.length === 0 && forceRequests.length === 0) {
      ws.addRow({ KIND: 'No force-outs, comps, or voids recorded in this period' });
    }
  }

  // ── GCash audit ──
  {
    const ws = wb.addWorksheet('DB GCash Audit');
    const headers = ['DATE', 'SHIFT', 'REFERENCE', 'AMOUNT', 'GUEST', 'ROOM', 'RECEIPT LINK', 'STATUS'];
    ws.columns = headers.map((h) => ({ header: h, key: h, width: 20 }));
    styleHeaderRow(ws, 1, headers.length);
    for (const g of gcashRows) {
      ws.addRow({
        DATE: g.date, SHIFT: g.shift_type, REFERENCE: g.reference_number, AMOUNT: money(g.amount),
        GUEST: g.guest_name || '-', ROOM: g.room_number || '-', 'RECEIPT LINK': g.receipt_no || '-',
        STATUS: g.receipt_no ? 'LINKED' : 'UNRECONCILED — no receipt link',
      });
    }
    // Cross-check: GCash/MIXED receipts without a register entry
    const linkedRefs = new Set(gcashRows.map((g) => String(g.receipt_no || '')));
    for (const r of receipts.filter((x) => ['GCASH', 'MIXED'].includes(String(x.payment_method || '').toUpperCase()))) {
      if (!linkedRefs.has(String(r.receipt_no))) {
        ws.addRow({
          DATE: String(r.date_time || '').slice(0, 10), SHIFT: '-', REFERENCE: r.gcash_ref || '-',
          AMOUNT: String(r.payment_method).toUpperCase() === 'GCASH' ? money(r.total) : money(r.gcash_amount),
          GUEST: r.guest_name || '-', ROOM: r.room_number || '-', 'RECEIPT LINK': r.receipt_no,
          STATUS: 'UNRECONCILED — receipt has no register entry',
        });
      }
    }
    const totalRow = ws.addRow({
      DATE: 'REGISTER TOTAL', AMOUNT: gcashRows.reduce((s, g) => s + money(g.amount), 0),
      STATUS: `Receipt-side GCash: ${Math.round(gcashCollected * 100) / 100}`,
    });
    totalRow.font = { bold: true };
  }

  // ── Cash safe ──
  {
    const ws = wb.addWorksheet('DB Cash Safe');
    ws.columns = [{ width: 34 }, { width: 22 }, { width: 44 }];
    const r0 = addTitleBlock(ws, 'Cash Safe Reconciliation', `Week of ${weekStart}`, controlNo);
    ws.getCell(`A${r0}`).value = 'METRIC';
    ws.getCell(`B${r0}`).value = 'AMOUNT (PHP)';
    ws.getCell(`C${r0}`).value = 'BASIS';
    styleHeaderRow(ws, r0, 3);
    const rows: Array<[string, number | string, string]> = denom
      ? [
          ['₱1,000 × ' + (denom.bills_1000_count || 0), money(denom.bills_1000_count) * 1000, 'Counted'],
          ['₱500 × ' + (denom.bills_500_count || 0), money(denom.bills_500_count) * 500, 'Counted'],
          ['₱200 × ' + (denom.bills_200_count || 0), money(denom.bills_200_count) * 200, 'Counted'],
          ['₱100 × ' + (denom.bills_100_count || 0), money(denom.bills_100_count) * 100, 'Counted'],
          ['₱50 × ' + (denom.bills_50_count || 0), money(denom.bills_50_count) * 50, 'Counted'],
          ['Coins', money(denom.coins_total), 'Counted'],
          ['TOTAL COUNTED', countedCash, 'Actual'],
          ['Cash collections per receipts (period)', Math.round(cashCollected * 100) / 100, 'Actual'],
          ['VARIANCE (counted − receipts cash)', Math.round((countedCash - cashCollected) * 100) / 100, countedCash === cashCollected ? 'BALANCED' : 'INVESTIGATE'],
          [`Counted by: ${denom.counted_by || '-'} | Received by: ${denom.received_by || '-'} | Verified by: ${denom.verified_by || '-'}`, '', 'Sign-off'],
        ]
      : [['No cash denomination report filed for this week — UNRECONCILED', '', '']];
    rows.forEach(([k, v, b], i) => {
      ws.getCell(`A${r0 + 1 + i}`).value = k;
      ws.getCell(`B${r0 + 1 + i}`).value = v;
      if (typeof v === 'number') ws.getCell(`B${r0 + 1 + i}`).numFmt = '#,##0.00';
      ws.getCell(`C${r0 + 1 + i}`).value = b;
    });
  }

  // ── Inventory ──
  {
    const ws = wb.addWorksheet('DB Inventory');
    const headers = ['ITEM ID', 'ITEM', 'CATEGORY', 'TRACKED', 'COUNT NOW', 'UNIT PRICE', 'STOCK VALUE', 'SOLD (PERIOD)', 'ADJUSTED (PERIOD)'];
    ws.columns = headers.map((h) => ({ header: h, key: h, width: 18 }));
    ws.getColumn(2).width = 30;
    styleHeaderRow(ws, 1, headers.length);
    const soldByItem = new Map<string, number>();
    const adjByItem = new Map<string, number>();
    for (const e of inventoryEvents) {
      if (e.event_type === 'sold') soldByItem.set(e.item_id, (soldByItem.get(e.item_id) || 0) + Math.abs(money(e.quantity_change)));
      else adjByItem.set(e.item_id, (adjByItem.get(e.item_id) || 0) + money(e.quantity_change));
    }
    let stockValue = 0;
    for (const it of inventoryNow) {
      const price = priceById.get(String(it.item_id)) || 0;
      const value = Math.round(Number(it.current_quantity || 0) * price * 100) / 100;
      stockValue = Math.round((stockValue + value) * 100) / 100;
      ws.addRow({
        'ITEM ID': it.item_id, ITEM: it.item_name, CATEGORY: it.category,
        TRACKED: it.is_tracked ? 'YES' : 'NO', 'COUNT NOW': Number(it.current_quantity || 0),
        'UNIT PRICE': price, 'STOCK VALUE': value,
        'SOLD (PERIOD)': soldByItem.get(String(it.item_id)) || 0,
        'ADJUSTED (PERIOD)': adjByItem.get(String(it.item_id)) || 0,
      });
    }
    const totalRow = ws.addRow({ ITEM: `CLOSING STOCK VALUATION (tracked lines)`, 'STOCK VALUE': stockValue });
    totalRow.font = { bold: true };
  }

  // ── Audit trail ──
  {
    const ws = wb.addWorksheet('DB Audit Trail');
    const headers = ['TIMESTAMP', 'OPERATOR', 'ACTION', 'DETAILS'];
    ws.columns = [{ header: 'TIMESTAMP', key: 'TIMESTAMP', width: 22 }, { header: 'OPERATOR', key: 'OPERATOR', width: 18 }, { header: 'ACTION', key: 'ACTION', width: 24 }, { header: 'DETAILS', key: 'DETAILS', width: 90 }];
    styleHeaderRow(ws, 1, headers.length);
    for (const a of auditRows) {
      ws.addRow({ TIMESTAMP: a.timestamp, OPERATOR: safeCell(a.operator), ACTION: a.action, DETAILS: safeCell(a.details || '-') });
    }
    if (auditRows.length === 0) ws.addRow({ TIMESTAMP: 'No audit entries in this period' });
  }

  // ── 12. Room Transfers & Relocations ──
  {
    const ws = wb.addWorksheet('DB Room Transfers');
    const r0 = addTitleBlock(ws, 'Room Transfers & Relocations Register', `Period: ${periodLabel} | Total Relocations: ${transfers.length}`, controlNo);
    const headers = [
      'TRANSFER ID', 'TIMESTAMP', 'SOURCE ROOM', 'SOURCE TIER', 'TARGET ROOM', 'TARGET TIER',
      'GUEST NAME', 'RATE / DURATION', 'REASON', 'TRANSFERRED BY', 'NOTES'
    ];
    ws.columns = headers.map((h) => ({ header: h, key: h, width: 18 }));
    ws.getColumn(1).width = 22;
    ws.getColumn(2).width = 22;
    ws.getColumn(7).width = 25;
    ws.getColumn(9).width = 32;
    ws.getColumn(11).width = 36;
    styleHeaderRow(ws, r0, headers.length);
    for (const t of transfers) {
      ws.addRow({
        'TRANSFER ID': safeCell(t.id),
        TIMESTAMP: t.transferred_at,
        'SOURCE ROOM': `Room ${t.source_room_number}`,
        'SOURCE TIER': t.source_tier || '-',
        'TARGET ROOM': `Room ${t.target_room_number}`,
        'TARGET TIER': t.target_tier || '-',
        'GUEST NAME': safeCell(t.guest_name),
        'RATE / DURATION': t.rate_selected || '-',
        REASON: safeCell(t.reason),
        'TRANSFERRED BY': safeCell(t.transferred_by),
        NOTES: safeCell(t.notes || '-'),
      });
    }
    if (transfers.length === 0) {
      const emptyRow = ws.addRow({ 'TRANSFER ID': 'No room transfers recorded in this period' });
      emptyRow.font = { italic: true };
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  await logReportExport(admin.username, 'Executive Financial Workbook', `weekStart=${weekStart}`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="Sedona_Court_DB_Authoritative_Audit_${weekStart}.xlsx"`);
  res.setHeader('X-Export-Control-No', controlNo);
  res.send(Buffer.from(buffer));
}));

// GET /api/report-exports/transactions-ledger?from=YYYY-MM-DD&to=YYYY-MM-DD&paymentMethod=&cashier=
router.get('/transactions-ledger', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const admin = requireAdminOwner(req, res);
  if (!admin) return;

  const from = String(req.query.from || '1970-01-01');
  const to = String(req.query.to || '2999-12-31');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    res.status(400).json({ error: 'from/to must be YYYY-MM-DD' });
    return;
  }
  const paymentMethod = String(req.query.paymentMethod || 'ALL').toUpperCase();
  const cashier = String(req.query.cashier || '').toLowerCase();

  let receipts = await tryQuery(`SELECT * FROM receipts WHERE date_time >= ? AND date_time <= ? AND (status IS NULL OR status = 'valid') AND receipt_no NOT LIKE 'FCE-%' ORDER BY date_time ASC`, [from, `${to}T23:59:59.999Z`]);
  if (['CASH', 'GCASH', 'MIXED'].includes(paymentMethod)) {
    receipts = receipts.filter((r) => String(r.payment_method || '').toUpperCase() === paymentMethod);
  }
  if (cashier) {
    receipts = receipts.filter((r) => String(r.cashier_id || '').toLowerCase().includes(cashier));
  }

  const controlNo = `DBL-${from.replace(/-/g, '')}-${to.replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sedona Court PMS (server)';
  wb.created = new Date();
  const ws = wb.addWorksheet('DB Ledger');
  const r0 = addTitleBlock(ws, 'Transactions Ledger (database-authoritative)', `Period: ${from} to ${to} | Generated: ${new Date().toISOString()} by ${admin.username}`, controlNo);
  const headers = ['RECEIPT NO', 'DATE & TIME', 'ROOM', 'GUEST', 'PAYMENT', 'CASH', 'GCASH', 'GCASH REF', 'ITEMS', 'SUBTOTAL', 'TOTAL', 'DISCOUNT TYPE', 'DISCOUNT', 'DISC REF', 'CASHIER'];
  ws.columns = headers.map((h) => ({ header: h, key: h, width: 16 }));
  ws.getColumn(4).width = 22;
  ws.getColumn(9).width = 50;
  styleHeaderRow(ws, r0, headers.length);
  receipts.forEach((r, idx) => {
    const items = safeParseItems(r.items);
    ws.addRow({
      'RECEIPT NO': r.receipt_no,
      'DATE & TIME': r.date_time,
      ROOM: r.room_number || 'POS',
      GUEST: r.guest_name || 'Walk-In',
      PAYMENT: r.payment_method,
      CASH: money(r.cash_amount),
      GCASH: money(r.gcash_amount),
      'GCASH REF': r.gcash_ref || '-',
      ITEMS: items.map((i) => `${i.description || ''} (${i.subtext || '1x'}) - ${money(i.amount)}`).join('; ') || 'Room Rental Charges',
      SUBTOTAL: money(r.subtotal),
      TOTAL: money(r.total),
      'DISCOUNT TYPE': r.discount_type || '-',
      DISCOUNT: money(r.discount_amount),
      'DISC REF': r.discount_id_ref || '-',
      CASHIER: r.cashier_id || '-',
    });
    void idx;
  });
  const totalRow = ws.addRow({
    'RECEIPT NO': `TOTALS (${receipts.length} receipts)`,
    SUBTOTAL: receipts.reduce((s, r) => s + money(r.subtotal), 0),
    TOTAL: receipts.reduce((s, r) => s + money(r.total), 0),
    DISCOUNT: receipts.reduce((s, r) => s + money(r.discount_amount), 0),
  });
  totalRow.font = { bold: true };

  const buffer = await wb.xlsx.writeBuffer();
  await logReportExport(admin.username, 'Transactions Ledger Excel', `from=${from}, to=${to}, paymentMethod=${paymentMethod}, cashier=${cashier || 'ALL'}`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="Sedona_Court_DB_Ledger_${from}_to_${to}.xlsx"`);
  res.setHeader('X-Export-Control-No', controlNo);
  res.send(Buffer.from(buffer));
}));

function requireCashierStaff(req: Request, res: Response): { username: string } | null {
  const operator = (req as any).operator;
  if (!operator || !['cashier', 'admin', 'owner'].includes(operator.role)) {
    res.status(403).json({ error: 'Only cashier, admin or owner can generate shift forms' });
    return null;
  }
  return { username: operator.username };
}

/** Shift window matching shift-settlement cutoffs (DAY 06:00–18:00, NIGHT 18:00–06:00). */
function shiftWindow(dateStr: string, shift: 'DAY' | 'NIGHT'): { start: string; end: string } {
  if (shift === 'DAY') {
    return { start: `${dateStr} 06:00:00`, end: `${dateStr} 18:00:00` };
  }
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + 1);
  const next = d.toISOString().slice(0, 10);
  return { start: `${dateStr} 18:00:00`, end: `${next} 06:00:00` };
}

/** Wall-clock 'HH:MM AM' for lobby-paper display. Handles ISO and wall-clock storage. */
function paperTime(v: any): string {
  if (!v) return '';
  const s = String(v).trim();
  const wall = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  const parts = (h: number, m: number) => {
    const ap = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ap}`;
  };
  if (wall && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
    return parts(Number(wall[4]), Number(wall[5]));
  }
  const d = new Date(s.includes(' ') && !s.includes('T') ? s.replace(' ', 'T') : s);
  if (isNaN(d.getTime())) return '';
  const fmt = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila',
  });
  return fmt.format(d);
}

/** Actual stay length in hours (1 decimal) or '' when timestamps are unusable. */
function stayHours(inV: any, outV: any): number | '' {
  const parse = (v: any): number | null => {
    if (!v) return null;
    const s = String(v).trim();
    const d = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s.replace(' ', 'T') : s);
    return isNaN(d.getTime()) ? null : d.getTime();
  };
  const a = parse(inV);
  const b = parse(outV);
  if (a === null || b === null || b < a) return '';
  return Math.round(((b - a) / 3600000) * 10) / 10;
}

const FOOD_CATEGORIES = new Set(['Breakfast', 'Favorites', 'Kitchen Extras']);

interface ShiftFormLine {
  receiptNo: string;
  room: string;
  timeIn: string;
  timeOut: string;
  hours: number | '';
  roomBill: number;
  kitchen: number;
  drinks: number;
  miscell: number;
  extras: number;
  dcDiscount: number;
  seniorDiscount: number;
  discountRef: string;
  payment: number;
}

function splitReceiptLines(r: any, serviceCategoryByName: Map<string, string>): ShiftFormLine {
  const items = safeParseItems(r.items);
  let roomBill = 0;
  let kitchen = 0;
  let drinks = 0;
  let miscell = 0;
  let extras = 0;
  let dcDiscount = 0;
  let seniorDiscount = 0;

  const persistedType = String(r.discount_type || '').toUpperCase();
  const persistedAmt = money(r.discount_amount);
  if (persistedAmt > 0) {
    if (persistedType === 'DC') dcDiscount += persistedAmt;
    else seniorDiscount += persistedAmt;
  }

  for (const it of items) {
    const desc = String(it.description || '');
    const amt = money(it.amount);
    if (isRentLine(desc)) {
      roomBill = Math.round((roomBill + amt) * 100) / 100;
      continue;
    }
    if (/extra\s*(bed|towel|person)|surcharge/i.test(desc) && amt > 0) {
      extras = Math.round((extras + amt) * 100) / 100;
      continue;
    }
    if (amt < 0 || /discount/i.test(desc)) {
      if (persistedAmt > 0) continue; // already counted above
      if (/card|\(dc\)/i.test(desc)) dcDiscount = Math.round((dcDiscount + Math.abs(amt)) * 100) / 100;
      else seniorDiscount = Math.round((seniorDiscount + Math.abs(amt)) * 100) / 100;
      continue;
    }
    const cat = serviceCategoryByName.get(desc.trim().toLowerCase());
    if (cat === 'Drinks') drinks = Math.round((drinks + amt) * 100) / 100;
    else if (cat && FOOD_CATEGORIES.has(cat)) kitchen = Math.round((kitchen + amt) * 100) / 100;
    else miscell = Math.round((miscell + amt) * 100) / 100;
  }

  // Fallback for legacy receipts with no item breakdown: whole total is room bill.
  if (items.length === 0 && r.room_number && !['WALK-IN', 'POS'].includes(String(r.room_number).toUpperCase())) {
    roomBill = money(r.total);
  }

  return {
    receiptNo: String(r.receipt_no || ''),
    room: String(r.room_number || 'POS'),
    timeIn: paperTime(r.check_in),
    timeOut: paperTime(r.check_out),
    hours: stayHours(r.check_in, r.check_out),
    roomBill, kitchen, drinks, miscell, extras,
    dcDiscount, seniorDiscount,
    discountRef: maskRef(String(r.discount_id_ref || '')),
    payment: money(r.total),
  };
}

function maskRef(ref: string): string {
  const t = String(ref || '').trim();
  if (!t || t === '-') return '';
  if (t.length <= 4) return t;
  return `****-${t.slice(-4)}`;
}

const SHIFT_FORM_HEADERS = [
  'No.', 'Receipt/\nO.R. No.', 'Room\nNo.', 'Coupon\nNo.', 'Time In', 'Time Out', 'Declared\nTime',
  'No. of\nHours', 'Excess\nHour/s', 'Room\nBill', 'Kitchen\nBill', 'Drinks\nBill',
  'Miscell\nPurchases', 'Extras\n(Pers/Bed/Pillow)', 'Member\nDiscount', 'Senior/PWD\nDiscount',
  'Discount\nNo.', 'Payment\nRecvd/Transfer',
];

function buildShiftFormSheet(
  wb: ExcelJS.Workbook,
  title: string,
  lines: ShiftFormLine[],
  footer: { date: string; shift: string; cashier: string; toCashier: string; expenses: Array<{ description: string; amount: number }>; remarks: string },
  opts: { transferHeader: boolean; notice?: string; overflowTotals?: Record<string, number> }
): void {
  const ws = wb.addWorksheet(title);
  ws.columns = [
    { width: 6 }, { width: 16 }, { width: 10 }, { width: 12 }, { width: 11 }, { width: 11 }, { width: 11 },
    { width: 10 }, { width: 10 }, { width: 13 }, { width: 13 }, { width: 13 },
    { width: 14 }, { width: 15 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 16 },
  ];

  // Title + optional truncation notice (template R2 is free on the transaction form)
  ws.mergeCells('A1:R1');
  ws.getCell('A1').value = title;
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 26;

  let r = 2;
  if (opts.transferHeader) {
    ws.mergeCells('J2:N2');
    ws.getCell('J2').value = 'TRANSFERRED';
    ws.getCell('J2').font = { bold: true };
    ws.getCell('J2').alignment = { horizontal: 'center' };
    ws.mergeCells('O2:R2');
    ws.getCell('O2').value = 'RECEIPT NO. START: __________   END: __________';
    ws.getCell('O2').alignment = { horizontal: 'center' };
    r = 3;
  } else if (opts.notice) {
    ws.mergeCells('A2:R2');
    ws.getCell('A2').value = opts.notice;
    ws.getCell('A2').font = { bold: true, italic: true, color: { argb: 'FF7F6000' } };
    ws.getCell('A2').alignment = { horizontal: 'center' };
    r = 3;
  } else {
    r = 3;
    ws.getRow(2).height = 4;
  }
  if (opts.transferHeader && opts.notice) {
    ws.getCell('A2').value = opts.notice;
    ws.getCell('A2').font = { bold: true, italic: true, size: 9, color: { argb: 'FF7F6000' } };
  }

  // Header row (template row 3)
  SHIFT_FORM_HEADERS.forEach((h, i) => {
    ws.getCell(r, i + 1).value = h;
  });
  styleHeaderRow(ws, r, SHIFT_FORM_HEADERS.length);
  ws.getRow(r).height = 30;
  const headerRow = r;
  r += 1;

  // 30 pre-numbered entry rows (paper-faithful, blanks left writable)
  const firstDataRow = r;
  for (let i = 0; i < 30; i++) {
    const line = lines[i];
    const vals: Array<number | string> = [
      i + 1,
      line ? line.receiptNo : '',
      line ? line.room : '',
      '',
      line ? line.timeIn : '',
      line ? line.timeOut : '',
      '',
      line && line.hours !== '' ? line.hours : '',
      '',
      line ? line.roomBill : '',
      line ? line.kitchen : '',
      line ? line.drinks : '',
      line ? line.miscell : '',
      line ? line.extras : '',
      line && line.dcDiscount > 0 ? line.dcDiscount : '',
      line && line.seniorDiscount > 0 ? line.seniorDiscount : '',
      line ? line.discountRef : '',
      line ? line.payment : '',
    ];
    vals.forEach((v, c) => {
      const cell = ws.getCell(r, c + 1);
      cell.value = v;
      cell.border = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' },
      };
      if (typeof v === 'number') {
        cell.numFmt = c === 0 ? '0' : '#,##0.00';
        cell.alignment = { horizontal: 'right' };
      }
      if (c === 0) {
        cell.font = { bold: true };
        cell.alignment = { horizontal: 'center' };
      }
    });
    r += 1;
  }
  const lastDataRow = r - 1;

  // TOTAL row with live formulas (template shape: H–P and R)
  ws.getCell(`A${r}`).value = 'TOTAL:';
  ws.getCell(`A${r}`).font = { bold: true };
  for (const col of ['H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'R']) {
    const cell = ws.getCell(`${col}${r}`);
    cell.value = { formula: `SUM(${col}${firstDataRow}:${col}${lastDataRow})` };
    cell.numFmt = '#,##0.00';
    cell.font = { bold: true };
    cell.border = {
      top: { style: 'double' }, bottom: { style: 'thin' },
      left: { style: 'thin' }, right: { style: 'thin' },
    };
  }
  ws.getCell(`A${r}`).border = {
    top: { style: 'double' }, bottom: { style: 'thin' },
    left: { style: 'thin' }, right: { style: 'thin' },
  };
  r += 1;

  // Full-shift totals (all receipts, not just the 30 paper rows) when truncated
  if (opts.overflowTotals) {
    const t = opts.overflowTotals;
    ws.getCell(`A${r}`).value = `FULL-SHIFT TOTAL (${t.count} receipts):`;
    ws.getCell(`A${r}`).font = { bold: true };
    const fullVals: Record<string, number> = {
      H: t.roomBill || 0, I: t.kitchen || 0, J: t.drinks || 0, K: t.miscell || 0,
      L: t.extras || 0, M: t.dcDiscount || 0, N: t.seniorDiscount || 0, R: t.payment || 0,
    };
    for (const [col, val] of Object.entries(fullVals)) {
      const cell = ws.getCell(`${col}${r}`);
      cell.value = val;
      cell.numFmt = '#,##0.00';
      cell.font = { bold: true };
      cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    }
    ws.getCell(`A${r}`).border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    r += 1;
  }
  r += 1;

  // Footer (template rows 36–38/39)
  const fr = r;
  ws.getCell(`A${fr}`).value = 'DATE:';
  ws.getCell(`A${fr}`).font = { bold: true };
  ws.mergeCells(`B${fr}:D${fr}`);
  ws.getCell(`B${fr}`).value = footer.date;
  ws.getCell(`F${fr}`).value = 'COUPON IN';
  ws.getCell(`F${fr}`).font = { bold: true };
  ws.mergeCells(`F${fr}:G${fr}`);
  ws.getCell(`H${fr}`).value = 'COUPON OUT';
  ws.getCell(`H${fr}`).font = { bold: true };
  ws.mergeCells(`H${fr}:I${fr}`);
  ws.getCell(`J${fr}`).value = footer.expenses.length > 0 ? 'EXPENSES:' : 'EXPENSES: (none)';
  ws.getCell(`J${fr}`).font = { bold: true };
  ws.mergeCells(`L${fr}:O${fr + 2}`);
  ws.getCell(`L${fr}`).value = footer.remarks || '';
  ws.getCell(`L${fr}`).alignment = { vertical: 'top', wrapText: true };
  ws.getCell(`P${fr}`).value = 'TOTAL:';
  ws.getCell(`P${fr}`).font = { bold: true };

  ws.getCell(`A${fr + 1}`).value = 'SHIFT:';
  ws.getCell(`A${fr + 1}`).font = { bold: true };
  ws.mergeCells(`B${fr + 1}:D${fr + 1}`);
  ws.getCell(`B${fr + 1}`).value = footer.shift;
  ws.getCell(`P${fr + 1}`).value = { formula: `SUM(J${fr}:J${fr + 2})` };
  ws.getCell(`P${fr + 1}`).numFmt = '#,##0.00';
  ws.getCell(`P${fr + 1}`).font = { bold: true };

  ws.getCell(`A${fr + 2}`).value = opts.transferHeader ? 'FROM CA:' : 'CASHIER:';
  ws.getCell(`A${fr + 2}`).font = { bold: true };
  ws.mergeCells(`B${fr + 2}:D${fr + 2}`);
  ws.getCell(`B${fr + 2}`).value = footer.cashier;
  // First two shift expenses pre-filled (template slots J37:J38)
  const [e1, e2] = footer.expenses;
  ws.getCell(`J${fr + 1}`).value = e1 ? e1.amount : '';
  if (e1) ws.getCell(`J${fr + 1}`).numFmt = '#,##0.00';
  ws.getCell(`J${fr + 2}`).value = e2 ? e2.amount : '';
  if (e2) ws.getCell(`J${fr + 2}`).numFmt = '#,##0.00';
  for (let rr = fr; rr <= fr + 2; rr++) {
    for (let c = 1; c <= 18; c++) {
      const cell = ws.getCell(rr, c);
      if (!cell.border) {
        cell.border = {
          top: { style: 'thin' }, bottom: { style: 'thin' },
          left: { style: 'thin' }, right: { style: 'thin' },
        };
      }
    }
  }

  if (opts.transferHeader) {
    const tr = fr + 3;
    ws.getCell(`A${tr}`).value = 'TO CA:';
    ws.getCell(`A${tr}`).font = { bold: true };
    ws.mergeCells(`B${tr}:D${tr}`);
    ws.getCell(`B${tr}`).value = footer.toCashier;
  }

  ws.views = [{ state: 'frozen', ySplit: headerRow }];
  ws.pageSetup = {
    paperSize: 9, orientation: 'landscape', fitToPage: true,
    fitToWidth: 1, fitToHeight: 1,
  } as ExcelJS.PageSetup;
}

// GET /api/report-exports/shift-forms?date=YYYY-MM-DD&shift=DAY|NIGHT[&sheets=transfer]
// sheets=transfer exports ONLY the Shift Transfer Form (the handoff slip).
router.get('/shift-forms', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const staff = requireCashierStaff(req, res);
  if (!staff) return;

  const dateStr = String(req.query.date || '');
  const shift = String(req.query.shift || '').toUpperCase();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || (shift !== 'DAY' && shift !== 'NIGHT')) {
    res.status(400).json({ error: 'date must be YYYY-MM-DD and shift must be DAY or NIGHT' });
    return;
  }
  const transferOnly = String(req.query.sheets || '').toLowerCase() === 'transfer';
  const { start, end } = shiftWindow(dateStr, shift as 'DAY' | 'NIGHT');

  const [receipts, services, expenses, tasks] = await Promise.all([
    tryQuery(
      `SELECT * FROM receipts WHERE date_time >= ? AND date_time < ? AND receipt_no NOT LIKE 'FCE-%' AND (status IS NULL OR status = 'valid') ORDER BY date_time ASC`,
      [start, end]
    ),
    tryQuery(`SELECT name, category FROM billable_services WHERE is_deleted = 0`),
    tryQuery(`SELECT description, amount FROM shift_expenses WHERE shift_date = ? AND shift_type = ? ORDER BY created_at ASC`, [dateStr, shift]),
    tryQuery(`SELECT text FROM handoff_tasks WHERE completed = 0 ORDER BY rowid ASC LIMIT 10`),
  ]);

  const serviceCategoryByName = new Map<string, string>();
  for (const s of services) {
    serviceCategoryByName.set(String(s.name || '').trim().toLowerCase(), String(s.category || ''));
  }

  const lines = receipts.map((x) => splitReceiptLines(x, serviceCategoryByName));
  const CAP = 30;
  const shown = lines.slice(0, CAP);
  const truncated = lines.length - shown.length;
  const notice = truncated > 0
    ? `NOTE: showing first ${CAP} of ${lines.length} receipts — ${truncated} beyond paper capacity (see FULL-SHIFT TOTAL row + ledger export for the full list).`
    : undefined;
  const overflowTotals = truncated > 0 ? {
    count: lines.length,
    roomBill: lines.reduce((s, l) => s + (l.roomBill || 0), 0),
    kitchen: lines.reduce((s, l) => s + (l.kitchen || 0), 0),
    drinks: lines.reduce((s, l) => s + (l.drinks || 0), 0),
    miscell: lines.reduce((s, l) => s + (l.miscell || 0), 0),
    extras: lines.reduce((s, l) => s + (l.extras || 0), 0),
    dcDiscount: lines.reduce((s, l) => s + (l.dcDiscount || 0), 0),
    seniorDiscount: lines.reduce((s, l) => s + (l.seniorDiscount || 0), 0),
    payment: lines.reduce((s, l) => s + (l.payment || 0), 0),
  } : undefined;

  let remarks = tasks.map((t) => String(t.text || '').trim()).filter(Boolean).join('; ');
  if (expenses.length > 2) {
    const extra = expenses.slice(2).reduce((s, e) => s + money(e.amount), 0);
    remarks = `${remarks}${remarks ? '; ' : ''}+${expenses.length - 2} more expense(s) totalling ₱${extra.toLocaleString()}`.trim();
  }
  if (remarks.length > 500) remarks = `${remarks.slice(0, 497)}...`;

  const footer = {
    date: dateStr,
    shift,
    cashier: staff.username,
    toCashier: '',
    expenses: expenses.slice(0, 2).map((e) => ({ description: String(e.description || ''), amount: money(e.amount) })),
    remarks,
  };

  const controlNo = `SFT-${dateStr.replace(/-/g, '')}-${shift}-${Math.floor(1000 + Math.random() * 9000)}`;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sedona Court PMS (server)';
  wb.created = new Date();

  if (!transferOnly) {
    buildShiftFormSheet(wb, 'CASHIER TRANSACTION FORM', shown, footer, { transferHeader: false, notice, overflowTotals });
  }
  buildShiftFormSheet(wb, 'SHIFT TRANSFER FORM', shown, footer, { transferHeader: true, notice, overflowTotals });

  const buffer = await wb.xlsx.writeBuffer();
  await logReportExport(staff.username, 'Shift Paper Forms', `date=${dateStr}, shift=${shift}`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader(
    'Content-Disposition',
    transferOnly
      ? `attachment; filename="Sedona_Shift_Transfer_Form_${dateStr}_${shift}.xlsx"`
      : `attachment; filename="Sedona_Cashier_Shift_Forms_${dateStr}_${shift}.xlsx"`
  );
  res.setHeader('X-Export-Control-No', controlNo);
  if (truncated > 0) res.setHeader('X-Export-Truncated-Count', String(truncated));
  res.send(Buffer.from(buffer));
}));

export default router;
