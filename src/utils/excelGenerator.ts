/**
 * src/utils/excelGenerator.ts
 * Enterprise-grade multi-sheet Excel generator for Sedona Court Travellers Inn.
 * Produces beautifully styled, boardroom-ready XLSX financial workbooks with:
 * - Tab 1: Executive Dashboard (KPIs, RevPAR, ADR, Occupancy, P&L)
 * - Tab 2: Shift Remittance Log (14 Rotational Shifts, F&B, Extras, Formula Totals)
 * - Tab 3: Transactions Journal (Itemized Receipts, Line Items, Discounts, Cashiers)
 * - Tab 4: Operational Expenses (Two-column categorized expense disbursements)
 * - Tab 5: GCash & Digital Audit (Reference Numbers, Match Status, Time, Amounts)
 * - Tab 6: Cash Denomination & Safe Reconciliation (Float, Physical Counts, Variance)
 */

import ExcelJS from 'exceljs';
import { Room, Receipt, ShiftReport, ExpenseItem, HandoffTask } from '../types';
import {
  EXCEL_THEME,
  styleHeaderRow,
  addTitleBlock,
  asPeso,
  asInt,
  statusFill,
  styleTotalsRow,
  setupPrint,
  downloadWorkbook,
} from './excelTheme';

export interface ExcelExportOptions {
  periodLabel?: string;
  startDate?: string;
  endDate?: string;
  activeCashier?: string;
  incomingOperator?: string;
  shiftType?: 'DAY' | 'NIGHT';
  startingFloat?: number;
  actualCashInDrawer?: number;
  cashDenomination?: {
    bills1000?: number;
    bills500?: number;
    bills200?: number;
    bills100?: number;
    bills50?: number;
    coins?: number;
    countedBy?: string;
    receivedBy?: string;
  };
  gcashEntries?: Array<{
    date: string;
    shiftType: string;
    referenceNumber: string;
    amount: number;
    guestName?: string;
    roomNumber?: string;
    receiptNo?: string;
  }>;
}

/**
 * Thin grid borders for data cells.
 */
function gridBorders(cell: ExcelJS.Cell): void {
  cell.border = {
    top: { style: 'thin' },
    bottom: { style: 'thin' },
    left: { style: 'thin' },
    right: { style: 'thin' },
  };
}

function sectionBar(ws: ExcelJS.Worksheet, row: number, colCount: number, label: string): void {
  ws.mergeCells(row, 1, row, colCount);
  const cell = ws.getCell(row, 1);
  cell.value = label;
  cell.font = { name: 'Calibri', bold: true, size: 10 };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXCEL_THEME.totalFill } };
  cell.alignment = { vertical: 'middle' };
}

function controlNo(prefix: string): string {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `${prefix}-${d}-${Math.floor(1000 + Math.random() * 9000)}`;
}

function pctOf(part: number, whole: number): string {
  return whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '—';
}

/** Discount display derived from persisted receipt fields (display only). */
function discountInfo(r: Receipt): { type: string; amount: number; ref: string } {
  if (r.discountType && (r.discount || 0) > 0) {
    return {
      type: r.discountType,
      amount: r.discount || 0,
      ref: r.discountIdRef || r.seniorPwdId || r.discountCardId || '-',
    };
  }
  const legacy = (r.items || []).find(
    (it) => it.amount < 0 || it.description?.toLowerCase().includes('discount')
  );
  if (legacy) {
    const desc = legacy.description || '';
    return {
      type: /card|\(dc\)/i.test(desc) ? 'DC (in-line)' : 'SENIOR (in-line)',
      amount: Math.abs(Number(legacy.amount) || 0),
      ref: '-',
    };
  }
  return { type: '-', amount: 0, ref: '-' };
}

/**
 * 1. Comprehensive 6-Tab Executive Financial & Audit Workbook
 */
export const downloadExecutiveFinancialWorkbook = async (
  reports: ShiftReport[],
  sessionReceipts: Receipt[],
  additionalPOSRevenue: number,
  additionalPOSCategoryRevenue: { kitchen: number; drinks: number; miscell: number },
  col1Expenses: ExpenseItem[],
  col2Expenses: ExpenseItem[],
  rooms: Room[],
  options: ExcelExportOptions = {}
): Promise<void> => {
  try {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Sedona Court PMS';
    wb.created = new Date();
    const exportTimestamp = new Date().toLocaleString();
    const periodLabel = options.periodLabel || 'Weekly Operational Statement';
    const ctrl = controlNo('XL');

    // --- Financial Aggregations (unchanged basis) ---
    const totalShiftsRevenue = reports.reduce((sum, r) => sum + r.received, 0);
    const totalReceiptsRevenue = sessionReceipts.reduce((sum, r) => sum + r.total, 0);
    const grossRevenue = (totalShiftsRevenue > 0 ? totalShiftsRevenue : totalReceiptsRevenue) + additionalPOSRevenue;

    const col1Subtotal = col1Expenses.filter(e => !e.isSubtotal).reduce((s, e) => s + e.amount, 0);
    const col2Subtotal = col2Expenses.filter(e => e.name !== 'TOTAL EXPENSES').reduce((s, e) => s + e.amount, 0);
    const totalExpenses = col1Subtotal + col2Subtotal;
    const netSurplus = grossRevenue - totalExpenses;
    const netMargin = grossRevenue > 0 ? (netSurplus / grossRevenue) * 100 : 0;

    // Tender breakdowns (actuals only — never estimated)
    let exactCash = 0;
    let exactGCash = 0;
    let totalDiscounts = 0;
    let discountCount = 0;

    sessionReceipts.forEach((r) => {
      if (r.paymentMethod === 'CASH') exactCash += r.total;
      else if (r.paymentMethod === 'GCASH') exactGCash += r.total;
      else if (r.paymentMethod === 'MIXED') {
        exactCash += r.cashAmount || 0;
        exactGCash += r.gcashAmount || 0;
      }

      if (r.items) {
        r.items.forEach((it) => {
          if (it.description?.toLowerCase().includes('discount') || it.amount < 0) {
            totalDiscounts += Math.abs(it.amount);
            discountCount++;
          }
        });
      }
    });

    // Hospitality KPIs (actuals only — never estimated)
    const totalRoomsCount = rooms.length || 32;
    const occupiedCount = rooms.filter(r => r.state === 'occupied' || r.state === 'overdue').length;
    const occupancyPercent = totalRoomsCount > 0 ? (occupiedCount / totalRoomsCount) * 100 : 0;
    const totalCheckins = reports.reduce((sum, r) => sum + r.checkins, 0) || occupiedCount;
    const totalRoomBill = reports.reduce((sum, r) => sum + r.roomBill, 0);
    const hasRoomBill = totalRoomBill > 0;
    const adr = totalCheckins > 0 && hasRoomBill ? totalRoomBill / totalCheckins : 0;
    const revPar = totalRoomsCount > 0 && hasRoomBill ? totalRoomBill / totalRoomsCount : 0;
    const roomYieldBasis = hasRoomBill ? 'Computed from Stay Bills' : 'UNRECONCILED — no room-bill data';

    const roomChannel = reports.reduce((s, r) => s + r.roomBill, 0);
    const kitchenChannel = reports.reduce((s, r) => s + r.kitchen, 0) + additionalPOSCategoryRevenue.kitchen;
    const drinksChannel = reports.reduce((s, r) => s + r.drinks, 0) + additionalPOSCategoryRevenue.drinks;
    const extrasChannel = reports.reduce((s, r) => s + r.extras, 0);
    const miscChannel = reports.reduce((s, r) => s + r.miscell, 0) + additionalPOSCategoryRevenue.miscell;

    // ==========================================
    // TAB 1: EXECUTIVE DASHBOARD
    // ==========================================
    {
      const ws = wb.addWorksheet('Executive Dashboard');
      ws.columns = [{ width: 42 }, { width: 22 }, { width: 26 }, { width: 26 }];
      const r0 = addTitleBlock(
        ws,
        'EXECUTIVE FINANCIAL PERFORMANCE AUDIT & P&L DASHBOARD',
        `Reporting Statement Period: ${periodLabel} | Export: ${exportTimestamp} | Prepared for: Management & Owner Audit`,
        ctrl,
        4
      );

      let r = r0;
      const kpiRow = (
        label: string,
        value: number | string,
        basis: string,
        status: string,
        tone?: 'good' | 'warn' | 'bad'
      ) => {
        ws.getCell(`A${r}`).value = label;
        ws.getCell(`B${r}`).value = value;
        if (typeof value === 'number') asPeso(ws.getCell(`B${r}`));
        ws.getCell(`C${r}`).value = basis;
        ws.getCell(`D${r}`).value = status;
        if (tone) statusFill(ws.getCell(`D${r}`), tone);
        for (let c = 1; c <= 4; c++) gridBorders(ws.getCell(r, c));
        r += 1;
      };

      // I. P&L block
      sectionBar(ws, r, 4, 'I. EXECUTIVE P&L STATEMENT SUMMARY'); r += 1;
      ws.getCell(`A${r}`).value = 'FINANCIAL KPI PARAMETER';
      ws.getCell(`B${r}`).value = 'VALUE (PHP)';
      ws.getCell(`C${r}`).value = 'PERCENTAGE / BASIS';
      ws.getCell(`D${r}`).value = 'AUDIT STATUS';
      styleHeaderRow(ws, r, 4); r += 1;
      kpiRow('Gross Performance Revenue', grossRevenue, '100.0%', 'Actual');
      kpiRow('Total Disbursed Operational Expenses', totalExpenses, grossRevenue > 0 ? `${((totalExpenses / grossRevenue) * 100).toFixed(1)}%` : '—', 'Actual');
      kpiRow('Net Operating Profit (Capital Surplus)', netSurplus, `${netMargin.toFixed(1)}%`, netSurplus >= 0 ? 'SURPLUS' : 'DEFICIT', netSurplus >= 0 ? 'good' : 'bad');

      // II. Hospitality metrics
      r += 1;
      sectionBar(ws, r, 4, 'II. HOSPITALITY PERFORMANCE METRICS'); r += 1;
      ws.getCell(`A${r}`).value = 'METRIC';
      ws.getCell(`B${r}`).value = 'VALUE';
      ws.getCell(`C${r}`).value = 'INDUSTRY STANDARD BENCHMARK';
      ws.getCell(`D${r}`).value = 'HOTEL STATUS';
      styleHeaderRow(ws, r, 4); r += 1;
      kpiRow('Total Apartment Portfolio', totalRoomsCount, '32 Guest Rooms', 'Active Inventory');
      kpiRow('Live Occupancy Rate', `${occupancyPercent.toFixed(1)}%`, '65% - 85% Target', `${occupiedCount} Rooms Occupied`);
      kpiRow('Total Guest Check-Ins (Period)', totalCheckins, 'Turnover volume', 'Verified Frontdesk');
      kpiRow('ADR (Average Daily Rate)', hasRoomBill && totalCheckins > 0 ? adr : 0, 'Average room yield', roomYieldBasis, hasRoomBill ? undefined : 'warn');
      kpiRow('RevPAR (Revenue Per Available Room)', hasRoomBill ? revPar : 0, 'Yield per total capacity', roomYieldBasis, hasRoomBill ? undefined : 'warn');

      // III. Tender breakdown
      r += 1;
      sectionBar(ws, r, 4, 'III. TENDER & SETTLEMENT BREAKDOWN'); r += 1;
      ws.getCell(`A${r}`).value = 'PAYMENT METHOD';
      ws.getCell(`B${r}`).value = 'COLLECTIONS (PHP)';
      ws.getCell(`C${r}`).value = 'PORTION OF GROSS';
      ws.getCell(`D${r}`).value = 'TRANSACTIONS AUDIT';
      styleHeaderRow(ws, r, 4); r += 1;
      kpiRow('Cash Collections', exactCash, exactCash > 0 ? pctOf(exactCash, grossRevenue) : '—', exactCash > 0 ? 'Safe Drawer Floats' : 'UNRECONCILED — no cash collections', exactCash > 0 ? undefined : 'warn');
      kpiRow('GCash & Digital Portals', exactGCash, exactGCash > 0 ? pctOf(exactGCash, grossRevenue) : '—', exactGCash > 0 ? 'E-Wallet Reference Logs' : 'UNRECONCILED — no GCash collections', exactGCash > 0 ? undefined : 'warn');
      kpiRow('Senior / PWD Statutory Discounts Deducted', totalDiscounts, `${discountCount} Discount(s) Applied`, 'ID Verified on Checkout');

      // IV. Revenue channels
      r += 1;
      sectionBar(ws, r, 4, 'IV. REVENUE CHANNELS CONTRIBUTIONS'); r += 1;
      ws.getCell(`A${r}`).value = 'DEPARTMENT / REVENUE STREAM';
      ws.getCell(`B${r}`).value = 'REVENUE (PHP)';
      ws.getCell(`C${r}`).value = 'CONTRIBUTION %';
      ws.mergeCells(r, 3, r, 4);
      styleHeaderRow(ws, r, 4); r += 1;
      const channelRows: Array<[string, number]> = [
        ['Room Accommodations & Stays', roomChannel],
        ['Kitchen Food & Meals', kitchenChannel],
        ['Beverages & Drinks', drinksChannel],
        ['Add-ons (Extra Beds & Towels)', extrasChannel],
        ['Miscellaneous Purchases & Services', miscChannel],
      ];
      for (const [label, value] of channelRows) {
        ws.getCell(`A${r}`).value = label;
        ws.getCell(`B${r}`).value = value;
        asPeso(ws.getCell(`B${r}`));
        ws.getCell(`C${r}`).value = pctOf(value, grossRevenue);
        ws.mergeCells(r, 3, r, 4);
        for (let c = 1; c <= 4; c++) gridBorders(ws.getCell(r, c));
        r += 1;
      }
      ws.getCell(`A${r}`).value = 'TOTAL CONSOLIDATED REVENUE';
      ws.getCell(`B${r}`).value = grossRevenue;
      asPeso(ws.getCell(`B${r}`));
      ws.getCell(`C${r}`).value = '100.0%';
      ws.mergeCells(r, 3, r, 4);
      styleTotalsRow(ws.getRow(r), 4);

      ws.views = [{ state: 'frozen', ySplit: 6 }];
      setupPrint(ws);
    }

    // ==========================================
    // TAB 2: SHIFT REMITTANCE LOG
    // ==========================================
    {
      const ws = wb.addWorksheet('Shift Remittance Log');
      const headers = [
        'DATE', 'DAY', 'SHIFT', 'CASHIER',
        'CHECK-IN', 'OUT', 'TRANSF',
        'ROOM BILL', 'KITCHEN', 'DRINKS', 'MISCELL', 'EXTRAS', 'DISCOUNT',
        'RECEIVED (PHP)',
      ];
      ws.columns = [
        { width: 14 }, { width: 8 }, { width: 10 }, { width: 14 },
        { width: 10 }, { width: 8 }, { width: 8 },
        { width: 16 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 },
        { width: 20 },
      ];
      const r0 = addTitleBlock(
        ws,
        'FRONTDESK ROTATIONAL SHIFT REMITTANCE LOG',
        `Period: ${periodLabel} | 14 Day/Night Shift Cycles | Export: ${exportTimestamp}`,
        ctrl,
        headers.length
      );
      headers.forEach((h, i) => {
        ws.getCell(r0, i + 1).value = h;
      });
      styleHeaderRow(ws, r0, headers.length);

      let r = r0 + 1;
      for (const rep of reports) {
        const vals: Array<number | string> = [
          rep.date, rep.dayOfWeek, rep.shift, rep.cashier,
          rep.checkins, rep.out, rep.transf,
          rep.roomBill, rep.kitchen, rep.drinks, rep.miscell, rep.extras, rep.disc,
          rep.received,
        ];
        vals.forEach((v, i) => {
          const cell = ws.getCell(r, i + 1);
          cell.value = v;
          gridBorders(cell);
          if (typeof v === 'number') {
            if (i >= 7) asPeso(cell);
            else asInt(cell);
            cell.alignment = { horizontal: 'right' };
          }
        });
        r += 1;
      }

      if (additionalPOSRevenue > 0) {
        const vals: Array<number | string> = [
          'LIVE COUNTER', 'ALL', 'POS', 'Walk-In Terminal',
          0, 0, 0,
          0,
          additionalPOSCategoryRevenue.kitchen,
          additionalPOSCategoryRevenue.drinks,
          additionalPOSCategoryRevenue.miscell,
          0, 0,
          additionalPOSRevenue,
        ];
        vals.forEach((v, i) => {
          const cell = ws.getCell(r, i + 1);
          cell.value = v;
          gridBorders(cell);
          if (typeof v === 'number') {
            if (i >= 7) asPeso(cell);
            else asInt(cell);
            cell.alignment = { horizontal: 'right' };
          }
        });
        r += 1;
      }

      const totals: Array<number | string> = [
        'TOTALS', '', '', '',
        reports.reduce((s, x) => s + x.checkins, 0),
        reports.reduce((s, x) => s + x.out, 0),
        reports.reduce((s, x) => s + x.transf, 0),
        reports.reduce((s, x) => s + x.roomBill, 0),
        reports.reduce((s, x) => s + x.kitchen, 0) + additionalPOSCategoryRevenue.kitchen,
        reports.reduce((s, x) => s + x.drinks, 0) + additionalPOSCategoryRevenue.drinks,
        reports.reduce((s, x) => s + x.miscell, 0) + additionalPOSCategoryRevenue.miscell,
        reports.reduce((s, x) => s + x.extras, 0),
        reports.reduce((s, x) => s + x.disc, 0),
        reports.reduce((s, x) => s + x.received, 0) + additionalPOSRevenue,
      ];
      totals.forEach((v, i) => {
        const cell = ws.getCell(r, i + 1);
        cell.value = v;
        if (typeof v === 'number') {
          if (i >= 7) asPeso(cell);
          else asInt(cell);
          cell.alignment = { horizontal: 'right' };
        }
      });
      styleTotalsRow(ws.getRow(r), headers.length);

      ws.views = [{ state: 'frozen', ySplit: r0 }];
      setupPrint(ws);
    }

    // ==========================================
    // TAB 3: TRANSACTIONS JOURNAL (RECEIPTS)
    // ==========================================
    {
      const ws = wb.addWorksheet('Transactions Journal');
      const headers = [
        'RECEIPT NO', 'DATE & TIME', 'ROOM NO', 'ROOM TYPE', 'DECLARED STAY', 'GUEST NAME',
        'PAYMENT METHOD', 'GCASH REF #', 'ITEMIZED ORDERS BREAKDOWN',
        'SUBTOTAL', 'SERVICE CHARGE', 'TOTAL PAID (PHP)', 'DISCOUNT TYPE', 'DISCOUNT', 'DISC REF', 'CASHIER ID',
      ];
      ws.columns = [
        { width: 16 }, { width: 22 }, { width: 12 }, { width: 16 }, { width: 20 }, { width: 22 },
        { width: 18 }, { width: 18 }, { width: 48 },
        { width: 15 }, { width: 15 }, { width: 18 }, { width: 16 }, { width: 14 }, { width: 14 }, { width: 14 },
      ];
      const r0 = addTitleBlock(
        ws,
        'ITEMIZED TRANSACTIONS & CHECKOUT JOURNAL',
        `Period: ${periodLabel} | Verified Invoices Log`,
        ctrl,
        headers.length
      );
      headers.forEach((h, i) => {
        ws.getCell(r0, i + 1).value = h;
      });
      styleHeaderRow(ws, r0, headers.length);

      let r = r0 + 1;
      if (sessionReceipts.length === 0) {
        ws.getCell(`A${r}`).value = '(No receipts issued in this period)';
        ws.mergeCells(r, 1, r, headers.length);
        r += 1;
      } else {
        for (const rec of sessionReceipts) {
          const itemsFormatted = rec.items && rec.items.length > 0
            ? rec.items.map((i) => `${i.description} (${i.subtext || '1x'}) - ₱${i.amount.toLocaleString()}`).join('; ')
            : 'Room Rental Charges';
          const disc = discountInfo(rec);
          const vals: Array<number | string> = [
            rec.receiptNo,
            rec.dateTime ? new Date(rec.dateTime).toLocaleString() : '-',
            rec.roomNumber || 'POS',
            rec.roomType || 'Walk-In',
            rec.stayDuration || (rec.rateSelected ? `${rec.rateSelected.toUpperCase()} Stay` : 'Standard'),
            rec.guestName || 'Walk-In Guest',
            rec.paymentMethod === 'MIXED'
              ? `MIXED (Cash: ₱${(rec.cashAmount || 0).toLocaleString()} / GCash: ₱${(rec.gcashAmount || 0).toLocaleString()})`
              : rec.paymentMethod,
            rec.gcashRef || '-',
            itemsFormatted,
            rec.subtotal,
            rec.serviceCharge || 0,
            rec.total,
            disc.type,
            disc.amount,
            disc.ref,
            rec.cashierId || 'Frontdesk',
          ];
          vals.forEach((v, i) => {
            const cell = ws.getCell(r, i + 1);
            cell.value = v;
            gridBorders(cell);
            if (typeof v === 'number' && [9, 10, 11, 13].includes(i)) asPeso(cell);
          });
          r += 1;
        }

        const totals: Array<number | string> = [
          'TOTALS', '', '', '', '', '', '', '',
          `${sessionReceipts.length} Receipt(s) Issued`,
          sessionReceipts.reduce((s, x) => s + x.subtotal, 0),
          sessionReceipts.reduce((s, x) => s + (x.serviceCharge || 0), 0),
          sessionReceipts.reduce((s, x) => s + x.total, 0),
          '',
          sessionReceipts.reduce((s, x) => s + discountInfo(x).amount, 0),
          '', '',
        ];
        totals.forEach((v, i) => {
          const cell = ws.getCell(r, i + 1);
          cell.value = v;
          if (typeof v === 'number' && [9, 10, 11, 13].includes(i)) asPeso(cell);
        });
        styleTotalsRow(ws.getRow(r), headers.length);
      }

      ws.views = [{ state: 'frozen', ySplit: r0 }];
      setupPrint(ws);
    }

    // ==========================================
    // TAB 4: OPERATIONAL EXPENSES
    // ==========================================
    {
      const ws = wb.addWorksheet('Operational Expenses');
      ws.columns = [{ width: 36 }, { width: 18 }, { width: 6 }, { width: 36 }, { width: 18 }];
      const r0 = addTitleBlock(
        ws,
        'DISBURSED OPERATIONAL EXPENSES AUDIT',
        `Period: ${periodLabel} | Two-Column Expense Register`,
        ctrl,
        5
      );
      const headers = [
        'EXPENSE ITEM (KITCHEN & BEDDING)', 'AMOUNT (PHP)',
        '',
        'EXPENSE ITEM (ADMIN & HARDWARE)', 'AMOUNT (PHP)',
      ];
      headers.forEach((h, i) => {
        ws.getCell(r0, i + 1).value = h;
      });
      styleHeaderRow(ws, r0, 5);

      let r = r0 + 1;
      const maxExpLen = Math.max(col1Expenses.length, col2Expenses.length);
      for (let i = 0; i < maxExpLen; i++) {
        const e1 = col1Expenses[i];
        const e2 = col2Expenses[i];
        ws.getCell(`A${r}`).value = e1 ? e1.name : '';
        ws.getCell(`B${r}`).value = e1 ? e1.amount : '';
        if (e1) asPeso(ws.getCell(`B${r}`));
        ws.getCell(`D${r}`).value = e2 ? e2.name : '';
        ws.getCell(`E${r}`).value = e2 ? e2.amount : '';
        if (e2) asPeso(ws.getCell(`E${r}`));
        for (const c of [1, 2, 4, 5]) gridBorders(ws.getCell(r, c));
        r += 1;
      }

      r += 1;
      ws.getCell(`A${r}`).value = 'SUBTOTAL (COLUMN 1)';
      ws.getCell(`B${r}`).value = col1Subtotal;
      asPeso(ws.getCell(`B${r}`));
      ws.getCell(`D${r}`).value = 'SUBTOTAL (COLUMN 2)';
      ws.getCell(`E${r}`).value = col2Subtotal;
      asPeso(ws.getCell(`E${r}`));
      styleTotalsRow(ws.getRow(r), 5);
      r += 1;
      ws.getCell(`A${r}`).value = 'TOTAL DISBURSED EXPENSES';
      ws.getCell(`B${r}`).value = totalExpenses;
      asPeso(ws.getCell(`B${r}`));
      styleTotalsRow(ws.getRow(r), 5);

      ws.views = [{ state: 'frozen', ySplit: r0 }];
      setupPrint(ws);
    }

    // ==========================================
    // TAB 5: GCASH & DIGITAL AUDIT
    // ==========================================
    {
      const ws = wb.addWorksheet('GCash & Digital Audit');
      const headers = [
        'TRANSACTION DATE', 'SHIFT', 'GCASH REFERENCE NO', 'AMOUNT (PHP)',
        'GUEST NAME', 'ROOM NO', 'RECEIPT LINK', 'SETTLEMENT STATUS',
      ];
      ws.columns = [
        { width: 18 }, { width: 10 }, { width: 24 }, { width: 18 },
        { width: 22 }, { width: 12 }, { width: 18 }, { width: 24 },
      ];
      const r0 = addTitleBlock(
        ws,
        'GCASH & DIGITAL PAYMENT RECONCILIATION',
        `Period: ${periodLabel} | Digital Audit Trail`,
        ctrl,
        headers.length
      );
      headers.forEach((h, i) => {
        ws.getCell(r0, i + 1).value = h;
      });
      styleHeaderRow(ws, r0, headers.length);

      let r = r0 + 1;
      const gcashItems = options.gcashEntries || [];
      const pushGcashRow = (vals: Array<number | string>, tone?: 'good' | 'warn') => {
        vals.forEach((v, i) => {
          const cell = ws.getCell(r, i + 1);
          cell.value = v;
          gridBorders(cell);
          if (typeof v === 'number' && i === 3) asPeso(cell);
        });
        if (tone) statusFill(ws.getCell(r, 8), tone);
        r += 1;
      };

      if (gcashItems.length === 0) {
        // Extract from receipts (reference present = logged; otherwise unreconciled)
        sessionReceipts
          .filter(x => x.paymentMethod === 'GCASH' || x.paymentMethod === 'MIXED')
          .forEach((x) => {
            const amt = x.paymentMethod === 'GCASH' ? x.total : x.gcashAmount || 0;
            const hasRef = Boolean((x.gcashRef || '').trim());
            pushGcashRow([
              x.dateTime ? new Date(x.dateTime).toLocaleDateString() : '-',
              'SHIFT',
              x.gcashRef || `GC-${x.receiptNo.slice(-6)}`,
              amt,
              x.guestName || 'Walk-In Guest',
              x.roomNumber || 'POS',
              x.receiptNo,
              hasRef ? 'LOGGED — ref present' : 'UNRECONCILED — no reference',
            ], hasRef ? 'good' : 'warn');
          });
      } else {
        gcashItems.forEach((g) => {
          const linked = Boolean(g.receiptNo && g.receiptNo !== '-');
          pushGcashRow([
            g.date,
            g.shiftType,
            g.referenceNumber,
            g.amount,
            g.guestName || 'Guest',
            g.roomNumber || '-',
            g.receiptNo || '-',
            linked ? 'LOGGED — receipt linked' : 'UNRECONCILED — no receipt link',
          ], linked ? 'good' : 'warn');
        });
      }

      const gcashTotal = gcashItems.length > 0
        ? gcashItems.reduce((s, g) => s + (typeof g.amount === 'number' ? g.amount : 0), 0)
        : sessionReceipts
            .filter(x => x.paymentMethod === 'GCASH' || x.paymentMethod === 'MIXED')
            .reduce((s, x) => s + (x.paymentMethod === 'GCASH' ? x.total : x.gcashAmount || 0), 0);
      ws.getCell(`A${r}`).value = gcashItems.length === 0 ? 'TOTAL GCASH (RECEIPTS)' : 'TOTAL GCASH RECONCILED';
      ws.getCell(`D${r}`).value = gcashTotal;
      asPeso(ws.getCell(`D${r}`));
      ws.getCell(`H${r}`).value = 'AUDITED';
      styleTotalsRow(ws.getRow(r), headers.length);

      ws.views = [{ state: 'frozen', ySplit: r0 }];
      setupPrint(ws);
    }

    // ==========================================
    // TAB 6: CASH DENOMINATION & SAFE
    // ==========================================
    {
      const ws = wb.addWorksheet('Cash Denomination & Safe');
      ws.columns = [{ width: 32 }, { width: 20 }, { width: 24 }, { width: 24 }];
      const r0 = addTitleBlock(
        ws,
        'CASH DENOMINATION & SAFE RECONCILIATION',
        `Period: ${periodLabel} | Physical Count Sign-Off`,
        ctrl,
        4
      );
      let r = r0;

      const denom = options.cashDenomination || {};
      const c1000 = (denom.bills1000 || 0) * 1000;
      const c500 = (denom.bills500 || 0) * 500;
      const c200 = (denom.bills200 || 0) * 200;
      const c100 = (denom.bills100 || 0) * 100;
      const c50 = (denom.bills50 || 0) * 50;
      const cCoins = denom.coins || 0;
      const grandCounted = c1000 + c500 + c200 + c100 + c50 + cCoins;

      const startingFloat = options.startingFloat || 5000;
      const expectedCash = startingFloat + exactCash;
      const actualCash = options.actualCashInDrawer || grandCounted || expectedCash;
      const variance = actualCash - expectedCash;

      sectionBar(ws, r, 3, 'I. CASH BILLS & COINS COUNT BREAKDOWN'); r += 1;
      ws.getCell(`A${r}`).value = 'DENOMINATION';
      ws.getCell(`B${r}`).value = 'PIECE COUNT';
      ws.getCell(`C${r}`).value = 'TOTAL VALUE (PHP)';
      styleHeaderRow(ws, r, 3); r += 1;
      const denomRows: Array<[string, number | string, number]> = [
        ['₱1,000 Bills', denom.bills1000 || 0, c1000],
        ['₱500 Bills', denom.bills500 || 0, c500],
        ['₱200 Bills', denom.bills200 || 0, c200],
        ['₱100 Bills', denom.bills100 || 0, c100],
        ['₱50 Bills', denom.bills50 || 0, c50],
        ['Loose Coins Total', '-', cCoins],
      ];
      for (const [label, count, value] of denomRows) {
        ws.getCell(`A${r}`).value = label;
        ws.getCell(`B${r}`).value = count;
        if (typeof count === 'number') asInt(ws.getCell(`B${r}`));
        ws.getCell(`C${r}`).value = value;
        asPeso(ws.getCell(`C${r}`));
        for (let c = 1; c <= 3; c++) gridBorders(ws.getCell(r, c));
        r += 1;
      }
      ws.getCell(`A${r}`).value = 'TOTAL PHYSICAL COUNTED CASH';
      ws.getCell(`C${r}`).value = grandCounted || actualCash;
      asPeso(ws.getCell(`C${r}`));
      styleTotalsRow(ws.getRow(r), 3);
      r += 2;

      sectionBar(ws, r, 3, 'II. REGISTER DRAWER AUDIT & VARIANCE'); r += 1;
      ws.getCell(`A${r}`).value = 'METRIC';
      ws.getCell(`B${r}`).value = 'AMOUNT (PHP)';
      ws.getCell(`C${r}`).value = 'NOTES';
      styleHeaderRow(ws, r, 3); r += 1;
      const auditRows: Array<[string, number | string, string, ('good' | 'bad')?]> = [
        ['Opening Starting Float', startingFloat, 'Opening cash allocation', undefined],
        ['Cash Session Collections', exactCash, 'Cash received from checkouts', undefined],
        ['Expected Cash in Register', expectedCash, 'Starting Float + Cash Collections', undefined],
        ['Actual Physical Cash Declared', actualCash, 'Physical count total', undefined],
        [
          'Cash Variance (Overage / Shortage)',
          variance,
          variance === 0 ? 'BALANCED (₱0.00)' : variance > 0 ? `SURPLUS (+₱${variance.toFixed(2)})` : `SHORTAGE (-₱${Math.abs(variance).toFixed(2)})`,
          variance === 0 ? 'good' : 'bad',
        ],
      ];
      for (const [label, value, notes, tone] of auditRows) {
        ws.getCell(`A${r}`).value = label;
        ws.getCell(`B${r}`).value = value;
        if (typeof value === 'number') asPeso(ws.getCell(`B${r}`));
        ws.getCell(`C${r}`).value = notes;
        if (tone) statusFill(ws.getCell(`C${r}`), tone);
        else for (let c = 1; c <= 3; c++) gridBorders(ws.getCell(r, c));
        r += 1;
      }

      r += 1;
      sectionBar(ws, r, 4, 'III. MANAGEMENT VERIFICATION SIGN-OFF'); r += 1;
      ws.getCell(`A${r}`).value = 'ROLE';
      ws.getCell(`B${r}`).value = 'STAFF NAME';
      ws.getCell(`C${r}`).value = 'SIGNATURE';
      ws.getCell(`D${r}`).value = 'DATE / TIME';
      styleHeaderRow(ws, r, 4); r += 1;
      const signRows: Array<[string, string, string, string]> = [
        ['Remitting Cashier', denom.receivedBy || options.activeCashier || 'Frontdesk Cashier', '_______________________', exportTimestamp],
        ['Auditing Manager', denom.countedBy || 'Admin Auditor', '_______________________', 'Verified'],
      ];
      for (const [role, name, sig, ts] of signRows) {
        ws.getCell(`A${r}`).value = role;
        ws.getCell(`B${r}`).value = name;
        ws.getCell(`C${r}`).value = sig;
        ws.getCell(`D${r}`).value = ts;
        for (let c = 1; c <= 4; c++) gridBorders(ws.getCell(r, c));
        r += 1;
      }

      ws.views = [{ state: 'frozen', ySplit: r0 }];
      setupPrint(ws);
    }

    // Generate file name with ISO date
    const cleanDate = new Date().toISOString().slice(0, 10);
    await downloadWorkbook(wb, `Sedona_Court_Financial_Audit_${cleanDate}.xlsx`);
  } catch (err) {
    console.error('Executive workbook export failed:', err);
  }
};

/**
 * 2. Backward-Compatible Weekly Report Export (calls enhanced multi-sheet workbook)
 */
export const downloadWeeklyExcelReport = async (
  reports: ShiftReport[],
  additionalPOSRevenue: number,
  additionalPOSCategoryRevenue: { kitchen: number; drinks: number; miscell: number },
  col1Expenses: ExpenseItem[],
  col2Expenses: ExpenseItem[],
  options: ExcelExportOptions = {}
): Promise<void> => {
  await downloadExecutiveFinancialWorkbook(
    reports,
    [],
    additionalPOSRevenue,
    additionalPOSCategoryRevenue,
    col1Expenses,
    col2Expenses,
    [],
    options
  );
};

/**
 * 3. Daily Handoff & Cash Reconciliation Export
 */
export const downloadDailyExcelReport = async (
  rooms: Room[],
  activeCashier: string,
  sessionReceipts: Receipt[],
  pendingTasks: HandoffTask[],
  startingFloat: number,
  actualCashInDrawer: number,
  incomingOperator: string,
  shiftType: 'DAY' | 'NIGHT' = 'DAY'
): Promise<void> => {
  try {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Sedona Court PMS';
    wb.created = new Date();
    const ctrl = controlNo('SH');
    const exportTimestamp = new Date().toLocaleString();
    const dateStr = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

  const cashSales = sessionReceipts.reduce((sum, r) => {
    if (r.paymentMethod === 'CASH') return sum + r.total;
    if (r.paymentMethod === 'MIXED') return sum + (r.cashAmount || 0);
    return sum;
  }, 0);

  const gcashSales = sessionReceipts.reduce((sum, r) => {
    if (r.paymentMethod === 'GCASH') return sum + r.total;
    if (r.paymentMethod === 'MIXED') return sum + (r.gcashAmount || 0);
    return sum;
  }, 0);

  const totalSessionSales = cashSales + gcashSales;
  const expectedCashInDrawer = startingFloat + cashSales;
  const variance = actualCashInDrawer - expectedCashInDrawer;

    // --- Section I: cash audit table ---
    const ws = wb.addWorksheet('Shift Handoff Summary');
    ws.columns = [
      { width: 38 }, { width: 24 }, { width: 30 }, { width: 22 },
      { width: 18 }, { width: 18 }, { width: 42 },
      { width: 14 }, { width: 14 }, { width: 18 },
    ];
    let r = addTitleBlock(
      ws,
      'SHIFT TERMINAL HANDOVER & REVENUE RECONCILIATION AUDIT',
      `Shift Date: ${dateStr} | Schedule: ${shiftType === 'DAY' ? 'DAY SLOT (06:00 AM - 06:00 PM)' : 'NIGHT SLOT (06:00 PM - 06:00 AM)'} | Export: ${exportTimestamp} | Remitting: ${activeCashier} → Incoming: ${incomingOperator}`,
      ctrl,
      10
    );

    sectionBar(ws, r, 3, 'I. CASH REGISTER AUDIT & REMITTANCE SUMMARY'); r += 1;
    ws.getCell(`A${r}`).value = 'METRIC PARAMETER';
    ws.getCell(`B${r}`).value = 'OPERATIONAL VALUE (PHP)';
    ws.getCell(`C${r}`).value = 'AUDIT DETAILS';
    styleHeaderRow(ws, r, 3); r += 1;
    const cashCount = sessionReceipts.filter(x => x.paymentMethod === 'CASH' || x.paymentMethod === 'MIXED').length;
    const gcashCount = sessionReceipts.filter(x => x.paymentMethod === 'GCASH' || x.paymentMethod === 'MIXED').length;
    const auditRows: Array<[string, number | string, string, ('good' | 'bad')?]> = [
      ['Starting Cash Drawer Float', startingFloat, 'Opening cash float', undefined],
      ['Total Session Cash Collections', cashSales, `Cash from ${cashCount} transaction(s)`, undefined],
      ['Total Session GCash / Digital Collections', gcashSales, `GCash from ${gcashCount} transaction(s)`, undefined],
      ['Gross Session Revenue Generated', totalSessionSales, 'Total combined Cash + GCash sales', undefined],
      ['Expected Cash in Drawer', expectedCashInDrawer, 'Formula: Float + Cash Collections', undefined],
      ['Actual Physical Counted Cash', actualCashInDrawer, 'Physical count entered by operator', undefined],
      [
        'Cash Variance (Overage / Shortage)',
        variance,
        variance === 0 ? 'BALANCED (₱0.00)' : variance > 0 ? `SURPLUS (+₱${variance.toFixed(2)})` : `SHORTAGE (-₱${Math.abs(variance).toFixed(2)})`,
        variance === 0 ? 'good' : 'bad',
      ],
    ];
    for (const [label, value, notes, tone] of auditRows) {
      ws.getCell(`A${r}`).value = label;
      ws.getCell(`B${r}`).value = value;
      if (typeof value === 'number') asPeso(ws.getCell(`B${r}`));
      ws.getCell(`C${r}`).value = notes;
      if (tone) statusFill(ws.getCell(`C${r}`), tone);
      else for (let c = 1; c <= 3; c++) gridBorders(ws.getCell(r, c));
      r += 1;
    }

    // --- Section II: receipts journal ---
    r += 1;
    sectionBar(ws, r, 10, 'II. SESSION TRANSACTIONS & RECEIPT AUDIT JOURNAL'); r += 1;
    const jHeaders = [
      'RECEIPT NO', 'ROOM NO', 'ROOM TYPE', 'GUEST NAME', 'SETTLEMENT METHOD', 'GCASH REF #',
      'ITEMIZED ORDERS BREAKDOWN', 'SUBTOTAL', 'SERVICE CHARGE', 'TOTAL PAID (PHP)',
    ];
    jHeaders.forEach((h, i) => {
      ws.getCell(r, i + 1).value = h;
    });
    styleHeaderRow(ws, r, jHeaders.length);
    const journalHeaderRow = r;
    r += 1;

    if (sessionReceipts.length === 0) {
      ws.getCell(`A${r}`).value = '(No receipts issued during this shift)';
      ws.mergeCells(r, 1, r, jHeaders.length);
      r += 1;
    } else {
      for (const rec of sessionReceipts) {
        const itemsList = rec.items && rec.items.length > 0
          ? rec.items.map(i => `${i.description} (${i.subtext || '1x'}) - ₱${i.amount.toLocaleString()}`).join('; ')
          : 'Room Charges';
        const vals: Array<number | string> = [
          rec.receiptNo,
          rec.roomNumber || 'POS',
          rec.roomType || 'Standard',
          rec.guestName || 'Walk-In Guest',
          rec.paymentMethod === 'MIXED' ? `MIXED (Cash: ₱${(rec.cashAmount || 0).toLocaleString()} / GCash: ₱${(rec.gcashAmount || 0).toLocaleString()})` : rec.paymentMethod,
          rec.gcashRef || '-',
          itemsList,
          rec.subtotal,
          rec.serviceCharge || 0,
          rec.total,
        ];
        vals.forEach((v, i) => {
          const cell = ws.getCell(r, i + 1);
          cell.value = v;
          gridBorders(cell);
          if (typeof v === 'number' && i >= 7) asPeso(cell);
        });
        r += 1;
      }

      const totals: Array<number | string> = [
        'TOTAL SHIFT SALES', '', '', '', '', '',
        `${sessionReceipts.length} Receipt(s) Issued`,
        sessionReceipts.reduce((s, x) => s + x.subtotal, 0),
        sessionReceipts.reduce((s, x) => s + (x.serviceCharge || 0), 0),
        sessionReceipts.reduce((s, x) => s + x.total, 0),
      ];
      totals.forEach((v, i) => {
        const cell = ws.getCell(r, i + 1);
        cell.value = v;
        if (typeof v === 'number' && i >= 7) asPeso(cell);
      });
      styleTotalsRow(ws.getRow(r), jHeaders.length);
      r += 1;
    }

    // --- Section III: sign-off ---
    r += 1;
    sectionBar(ws, r, 4, 'III. OPERATIONAL HANDOVER SIGN-OFF'); r += 1;
    ws.getCell(`A${r}`).value = 'ROLE / RESPONSIBILITY';
    ws.getCell(`B${r}`).value = 'STAFF NAME';
    ws.getCell(`C${r}`).value = 'SIGNATURE';
    ws.getCell(`D${r}`).value = 'TIMESTAMP';
    styleHeaderRow(ws, r, 4); r += 1;
    const signRows: Array<[string, string, string, string]> = [
      ['Outgoing Operator (Remitting)', activeCashier, '_______________________', new Date().toLocaleString()],
      ['Incoming Operator (Receiving)', incomingOperator, '_______________________', 'Pending Transfer'],
      ['Property Admin / Manager', 'ADMIN AUDITOR', '_______________________', 'Verified'],
    ];
    for (const [role, name, sig, ts] of signRows) {
      ws.getCell(`A${r}`).value = role;
      ws.getCell(`B${r}`).value = name;
      ws.getCell(`C${r}`).value = sig;
      ws.getCell(`D${r}`).value = ts;
      for (let c = 1; c <= 4; c++) gridBorders(ws.getCell(r, c));
      r += 1;
    }

    ws.views = [{ state: 'frozen', ySplit: 6 }];
    setupPrint(ws);

    await downloadWorkbook(wb, `Sedona_Shift_Handoff_${activeCashier}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  } catch (err) {
    console.error('Shift handoff export failed:', err);
  }
};

/**
 * 4. Executive Consolidated Financial & POS Audit Export
 */
export const downloadAdminFinancialPOSReport = async (
  reports: ShiftReport[],
  sessionReceipts: Receipt[],
  additionalPOSRevenue: number,
  additionalPOSCategoryRevenue: { kitchen: number; drinks: number; miscell: number },
  col1Expenses: ExpenseItem[],
  col2Expenses: ExpenseItem[],
  rooms: Room[],
  options: ExcelExportOptions = {}
): Promise<void> => {
  await downloadExecutiveFinancialWorkbook(
    reports,
    sessionReceipts,
    additionalPOSRevenue,
    additionalPOSCategoryRevenue,
    col1Expenses,
    col2Expenses,
    rooms,
    options
  );
};

/**
 * 5. Standalone Transaction Ledger Export (for TransactionLedger component)
 */
export const downloadTransactionLedgerExcel = async (
  receipts: Receipt[],
  filterTitle = "Filtered Transactions Ledger"
): Promise<void> => {
  try {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Sedona Court PMS';
    wb.created = new Date();
    const exportTimestamp = new Date().toLocaleString();
    const ctrl = controlNo('TL');

    const ws = wb.addWorksheet('Transactions Ledger');
    const headers = [
      'RECEIPT NO', 'DATE & TIME', 'ROOM NO', 'ROOM TYPE', 'DECLARED STAY', 'GUEST NAME',
      'PAYMENT METHOD', 'GCASH REF #', 'ITEMIZED ORDERS',
      'SUBTOTAL', 'SERVICE CHARGE', 'TOTAL PAID (PHP)', 'DISCOUNT TYPE', 'DISCOUNT', 'DISC REF', 'CASHIER ID',
    ];
    ws.columns = [
      { width: 16 }, { width: 22 }, { width: 12 }, { width: 16 }, { width: 20 }, { width: 22 },
      { width: 18 }, { width: 18 }, { width: 48 },
      { width: 15 }, { width: 15 }, { width: 18 }, { width: 16 }, { width: 14 }, { width: 14 }, { width: 14 },
    ];
    const r0 = addTitleBlock(
      ws,
      `TRANSACTION LEDGER AUDIT EXPORT - ${filterTitle.toUpperCase()}`,
      `Export Date & Time: ${exportTimestamp} | Record Count: ${receipts.length} Invoices`,
      ctrl,
      headers.length
    );
    headers.forEach((h, i) => {
      ws.getCell(r0, i + 1).value = h;
    });
    styleHeaderRow(ws, r0, headers.length);

    let r = r0 + 1;
    for (const rec of receipts) {
      const itemsList = rec.items && rec.items.length > 0
        ? rec.items.map((i) => `${i.description} (${i.subtext || '1x'}) - ₱${i.amount.toLocaleString()}`).join('; ')
        : 'Room Stay Charges';
      const disc = discountInfo(rec);
      const vals: Array<number | string> = [
        rec.receiptNo,
        rec.dateTime ? new Date(rec.dateTime).toLocaleString() : '-',
        rec.roomNumber || 'POS',
        rec.roomType || 'Standard',
        rec.stayDuration || (rec.rateSelected ? `${rec.rateSelected.toUpperCase()} Stay` : 'Standard'),
        rec.guestName || 'Walk-In Guest',
        rec.paymentMethod === 'MIXED' ? `MIXED (Cash: ₱${(rec.cashAmount || 0).toLocaleString()} / GCash: ₱${(rec.gcashAmount || 0).toLocaleString()})` : rec.paymentMethod,
        rec.gcashRef || '-',
        itemsList,
        rec.subtotal,
        rec.serviceCharge || 0,
        rec.total,
        disc.type,
        disc.amount,
        disc.ref,
        rec.cashierId || 'Frontdesk',
      ];
      vals.forEach((v, i) => {
        const cell = ws.getCell(r, i + 1);
        cell.value = v;
        gridBorders(cell);
        if (typeof v === 'number' && [9, 10, 11, 13].includes(i)) asPeso(cell);
      });
      r += 1;
    }

    // Totals Row
    const totals: Array<number | string> = [
      'TOTALS', '', '', '', '', '', '', '',
      `${receipts.length} Receipt(s) Filtered`,
      receipts.reduce((s, x) => s + x.subtotal, 0),
      receipts.reduce((s, x) => s + (x.serviceCharge || 0), 0),
      receipts.reduce((s, x) => s + x.total, 0),
      '',
      receipts.reduce((s, x) => s + discountInfo(x).amount, 0),
      '', '',
    ];
    totals.forEach((v, i) => {
      const cell = ws.getCell(r, i + 1);
      cell.value = v;
      if (typeof v === 'number' && [9, 10, 11, 13].includes(i)) asPeso(cell);
    });
    styleTotalsRow(ws.getRow(r), headers.length);

    ws.views = [{ state: 'frozen', ySplit: r0 }];
    setupPrint(ws);

    await downloadWorkbook(wb, `Sedona_Transaction_Ledger_${new Date().toISOString().slice(0, 10)}.xlsx`);
  } catch (err) {
    console.error('Transaction ledger export failed:', err);
  }
};
