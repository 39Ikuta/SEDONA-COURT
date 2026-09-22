/**
 * src/utils/weeklyReportExporter.ts
 * Generates Excel files matching the WEEKLY REPORT & REMITTANCE format.
 * Uses exceljs for rich styling (colors, borders, merges).
 */

import ExcelJS from 'exceljs';
import { format, endOfWeek, eachDayOfInterval, getDay } from 'date-fns';
import { EXCEL_THEME, setupPrint } from './excelTheme';

export interface WeeklyShiftEntry {
  date: string;
  dayOfWeek: string;
  shiftType: 'DAY' | 'NIGHT';
  cashier: string;
  totalCheckins: number;
  checkoutCount: number;
  transferCount: number;
  roomBill: number;
  kitchenBill: number;
  drinksBill: number;
  miscellPurchases: number;
  extras: number;
  discount: number;
  paymentReceived: number;
}

export interface WeeklyExpenses {
  col1: {
    kitchen: number;
    wilkinsPure: number;
    ateLanieBeddings: number;
    kricoGasLaundry: number;
    tissueFlexiCling: number;
    miscellaneous: number;
    kovi: number;
    cmSurcRh: number;
    lempo: number;
    marbont: number;
    aquapura: number;
    andengStore: number;
    georgeCable: number;
    rhMeat: number;
    cokeZero: number;
    shortPau: number;
    venyenZonrox: number;
    subtotal: number;
  };
  col2: {
    valePauCamId: number;
    adminGretchSa: number;
    subtotal: number;
  };
  customExpenses: Array<{ name: string; amount: number; category: string }>;
  total: number;
}

export interface CashDenomination {
  bills1000Count: number;
  bills500Count: number;
  bills200Count: number;
  bills100Count: number;
  bills50Count: number;
  coinsTotal: number;
  total1000: number;
  total500: number;
  total200: number;
  total100: number;
  total50: number;
  grandTotal: number;
  receivedBy?: string;
  countedBy?: string;
}

export interface GCashEntry {
  id?: number | string;
  date: string;
  shiftType: string;
  referenceNumber: string;
  amount: number;
  guestName?: string;
  roomNumber?: string;
  receiptNo?: string;
}

const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/**
 * Common styling constants
 */
const COLORS = {
  blueFill: 'DDEBF7',
  yellowFill: 'FFF2CC',
  redText: 'FF0000',
  greenText: '00B050',
  blackText: '000000',
  whiteFill: 'FFFFFF',
};

const BORDERS: Partial<ExcelJS.Borders> = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' },
};

function formatAmount(amount: number | undefined): number | string {
  if (amount === undefined || amount === 0) return '-';
  return amount;
}

/**
 * Set up the worksheet columns and general layout
 */
function setupWorksheet(ws: ExcelJS.Worksheet) {
  ws.columns = [
    { key: 'date', width: 12 },
    { key: 'shift', width: 8 },
    { key: 'spacer1', width: 2 },
    { key: 'cashier', width: 12 },
    { key: 'checkins', width: 12 },
    { key: 'checkout', width: 12 },
    { key: 'transfer', width: 12 },
    { key: 'room', width: 14 },
    { key: 'kitchen', width: 14 },
    { key: 'drinks', width: 14 },
    { key: 'miscell', width: 14 },
    { key: 'extras', width: 14 },
    { key: 'discount', width: 14 },
    { key: 'payment', width: 16 },
  ];
}

/**
 * Draw the shift grid (rows 4-20)
 */
function buildShiftGrid(
  ws: ExcelJS.Worksheet,
  shifts: WeeklyShiftEntry[],
  daysToProcess: Date[],
  startRow: number
) {
  // Headers (Row 4-5)
  ws.mergeCells(`A${startRow}:A${startRow + 1}`);
  ws.getCell(`A${startRow}`).value = 'DATE';

  ws.mergeCells(`B${startRow}:B${startRow + 1}`);
  ws.getCell(`B${startRow}`).value = 'SHIFT';

  // C is spacer
  ws.mergeCells(`C${startRow}:C${startRow + 1}`);

  ws.mergeCells(`D${startRow}:D${startRow + 1}`);
  ws.getCell(`D${startRow}`).value = 'CASHIER';

  ws.mergeCells(`E${startRow}:E${startRow + 1}`);
  ws.getCell(`E${startRow}`).value = 'TOTAL\nCHECK-INS';

  ws.mergeCells(`F${startRow}:F${startRow + 1}`);
  ws.getCell(`F${startRow}`).value = 'CHECK OUT';

  ws.mergeCells(`G${startRow}:G${startRow + 1}`);
  ws.getCell(`G${startRow}`).value = 'TRANSFER';

  ws.mergeCells(`H${startRow}:H${startRow + 1}`);
  ws.getCell(`H${startRow}`).value = 'Room\nBILL';

  ws.mergeCells(`I${startRow}:I${startRow + 1}`);
  ws.getCell(`I${startRow}`).value = 'KITCHEN\nBILL';

  ws.mergeCells(`J${startRow}:J${startRow + 1}`);
  ws.getCell(`J${startRow}`).value = 'DRINKS\nBILL';

  ws.mergeCells(`K${startRow}:K${startRow + 1}`);
  ws.getCell(`K${startRow}`).value = 'MISCELL\nPurchases';

  ws.mergeCells(`L${startRow}:L${startRow + 1}`);
  ws.getCell(`L${startRow}`).value = 'EXTRAS';

  ws.mergeCells(`M${startRow}:M${startRow + 1}`);
  ws.getCell(`M${startRow}`).value = 'DISCOUNT';

  ws.mergeCells(`N${startRow}:N${startRow + 1}`);
  ws.getCell(`N${startRow}`).value = 'PAYMENT\nRECEIVED';

  // Style Headers (shared DB-workbook theme)
  for (let c = 1; c <= 14; c++) {
    if (c === 3) continue; // skip spacer
    const cell = ws.getCell(startRow, c);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXCEL_THEME.headerFill } };
    cell.font = { name: 'Calibri', bold: true, size: 9, color: { argb: EXCEL_THEME.headerFont } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = BORDERS;
  }

  let currentRow = startRow + 2;

  // Data Rows
  daysToProcess.forEach((day) => {
    const dateStr = format(day, 'MMM-dd');
    const dayOfWeek = DAY_NAMES[getDay(day)];
    const dbDateStr = format(day, 'yyyy-MM-dd');

    const dayShift = shifts.find(s => s.date === dbDateStr && s.shiftType === 'DAY');
    const nightShift = shifts.find(s => s.date === dbDateStr && s.shiftType === 'NIGHT');

    // DAY
    const dayRow = ws.getRow(currentRow);
    dayRow.getCell(1).value = dateStr;
    dayRow.getCell(1).font = { color: { argb: COLORS.blackText }, size: 9 };
    dayRow.getCell(2).value = 'DAY';
    dayRow.getCell(4).value = dayShift?.cashier || '';
    dayRow.getCell(5).value = dayShift?.totalCheckins || 0;
    dayRow.getCell(6).value = dayShift?.checkoutCount || 0;
    dayRow.getCell(7).value = dayShift?.transferCount || 0;
    dayRow.getCell(8).value = formatAmount(dayShift?.roomBill);
    dayRow.getCell(9).value = formatAmount(dayShift?.kitchenBill);
    dayRow.getCell(10).value = formatAmount(dayShift?.drinksBill);
    dayRow.getCell(11).value = formatAmount(dayShift?.miscellPurchases);
    dayRow.getCell(12).value = formatAmount(dayShift?.extras);
    dayRow.getCell(13).value = formatAmount(dayShift?.discount);
    dayRow.getCell(14).value = formatAmount(dayShift?.paymentReceived);

    // NIGHT
    const nightRow = ws.getRow(currentRow + 1);
    nightRow.getCell(1).value = dayOfWeek;
    nightRow.getCell(1).font = { color: { argb: 'FF334155' }, size: 9 };
    nightRow.getCell(2).value = 'NIGHT';
    nightRow.getCell(4).value = nightShift?.cashier || '';
    nightRow.getCell(5).value = nightShift?.totalCheckins || 0;
    nightRow.getCell(6).value = nightShift?.checkoutCount || 0;
    nightRow.getCell(7).value = nightShift?.transferCount || 0;
    nightRow.getCell(8).value = formatAmount(nightShift?.roomBill);
    nightRow.getCell(9).value = formatAmount(nightShift?.kitchenBill);
    nightRow.getCell(10).value = formatAmount(nightShift?.drinksBill);
    nightRow.getCell(11).value = formatAmount(nightShift?.miscellPurchases);
    nightRow.getCell(12).value = formatAmount(nightShift?.extras);
    nightRow.getCell(13).value = formatAmount(nightShift?.discount);
    nightRow.getCell(14).value = formatAmount(nightShift?.paymentReceived);

    // Styling for these two rows
    [currentRow, currentRow + 1].forEach(r => {
      for (let c = 1; c <= 14; c++) {
        if (c === 3) continue;
        const cell = ws.getCell(r, c);
        cell.border = BORDERS;
        cell.alignment = { horizontal: c <= 4 ? 'center' : 'right', vertical: 'middle' };
        if (c >= 8 && typeof cell.value === 'number') {
           cell.numFmt = '#,##0.00';
        }
      }
    });

    currentRow += 2;
  });

  // Totals Row
  const totalsRow = ws.getRow(currentRow);
  const totalCheckins = shifts.reduce((sum, s) => sum + s.totalCheckins, 0);
  const totalPaymentReceived = shifts.reduce((sum, s) => sum + s.paymentReceived, 0);

  totalsRow.getCell(5).value = totalCheckins;
  totalsRow.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXCEL_THEME.totalFill } };
  totalsRow.getCell(5).font = { bold: true };
  totalsRow.getCell(5).alignment = { horizontal: 'center' };
  
  totalsRow.getCell(14).value = totalPaymentReceived;
  totalsRow.getCell(14).numFmt = '#,##0.00';
  totalsRow.getCell(14).alignment = { horizontal: 'right' };
  totalsRow.getCell(14).border = { bottom: { style: 'thin' } };

  return currentRow + 2; // Next available row
}

/**
 * Generate standard weekly report
 */
export async function generateWeeklyReportExcel(
  weekStart: Date,
  shifts: WeeklyShiftEntry[],
  expenses: WeeklyExpenses,
  gcashEntries: GCashEntry[],
  cashDenom: CashDenomination | null,
  receivedBy: string = ''
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Weekly Report');
  setupWorksheet(ws);

  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
  const weekStartStr = format(weekStart, 'MMM dd');
  const weekEndStr = format(weekEnd, 'MMM dd, yyyy');
  const weekLabel = `${weekStartStr} - ${weekEndStr}`;

  const year = weekStart.getFullYear();
  const weekNum = Math.ceil(((weekStart.getDate() + 6 - getDay(weekStart)) % 35) / 7) + 1;
  const srCode = `SR ${(year % 100).toString().padStart(2, '0')} WK ${weekNum}`;

  // Title (shared DB-workbook theme)
  ws.mergeCells('D1:L2');
  const titleCell = ws.getCell('D1');
  titleCell.value = 'WEEKLY REPORT & REMITTANCE';
  titleCell.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FF1F2937' } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

  // Subtitle
  const dateCell = ws.getCell('A3');
  dateCell.value = weekLabel;
  dateCell.font = { name: 'Calibri', size: 11, color: { argb: 'FF6B7280' }, italic: true, bold: true };
  
  const srCell = ws.getCell('N3');
  srCell.value = srCode;
  srCell.font = { name: 'Calibri', size: 11, color: { argb: 'FF6B7280' }, italic: true, bold: true };
  srCell.alignment = { horizontal: 'right' };

  const daysToProcess = eachDayOfInterval({ start: weekStart, end: weekEnd });
  let r = buildShiftGrid(ws, shifts, daysToProcess, 4);

  // BUILD EXPENSES AND GCASH BLOCKS
  r++; // spacer

  // EXPENSES HEADERS
  ws.mergeCells(`A${r}:C${r}`);
  ws.getCell(`A${r}`).value = 'EXPENSES:';
  ws.getCell(`A${r}`).font = { bold: true };
  ws.getCell(`A${r}`).alignment = { horizontal: 'center' };
  ws.getCell(`A${r}`).border = BORDERS;

  ws.mergeCells(`D${r}:F${r}`);
  ws.getCell(`D${r}`).value = 'EXPENSES:';
  ws.getCell(`D${r}`).font = { bold: true };
  ws.getCell(`D${r}`).alignment = { horizontal: 'center' };
  ws.getCell(`D${r}`).border = BORDERS;

  ws.mergeCells(`G${r}:I${r}`);
  ws.getCell(`G${r}`).value = 'GCASH:';
  ws.getCell(`G${r}`).font = { bold: true };
  ws.getCell(`G${r}`).alignment = { horizontal: 'center' };
  ws.getCell(`G${r}`).border = BORDERS;

  ws.mergeCells(`J${r}:L${r}`);
  ws.getCell(`J${r}`).value = 'GCASH:';
  ws.getCell(`J${r}`).font = { bold: true };
  ws.getCell(`J${r}`).alignment = { horizontal: 'center' };
  ws.getCell(`J${r}`).border = BORDERS;

  const expHeaderRow = r;
  r++;

  const expenseCol1Items = [
    { n: 'kitchen', v: expenses.col1.kitchen },
    { n: 'wilkins pure', v: expenses.col1.wilkinsPure },
    { n: 'ate lanie beddings', v: expenses.col1.ateLanieBeddings },
    { n: 'k.rico gas new laundry', v: expenses.col1.kricoGasLaundry },
    { n: 'tissue flexi cling', v: expenses.col1.tissueFlexiCling },
    { n: 'miscellaneous', v: expenses.col1.miscellaneous },
    { n: 'kovi', v: expenses.col1.kovi },
    { n: 'CM SURC rh', v: expenses.col1.cmSurcRh },
    { n: 'LIEMPO', v: expenses.col1.lempo },
    { n: 'marbont', v: expenses.col1.marbont },
    { n: 'aquapura', v: expenses.col1.aquapura },
    { n: 'andeng store', v: expenses.col1.andengStore },
    { n: 'george cable', v: expenses.col1.georgeCable },
    { n: 'rh meat', v: expenses.col1.rhMeat },
    { n: 'coke zero', v: expenses.col1.cokeZero },
    { n: 'short pau', v: expenses.col1.shortPau },
    { n: 'venyen zonrox', v: expenses.col1.venyenZonrox },
  ];

  const expenseCol2Items = [
    { n: 'vale pau cam id', v: expenses.col2.valePauCamId },
    { n: 'admin gretch sa', v: expenses.col2.adminGretchSa },
  ];

  expenses.customExpenses.forEach((item) => {
    if (item.category === 'col1') expenseCol1Items.push({ n: item.name, v: item.amount });
    else expenseCol2Items.push({ n: item.name, v: item.amount });
  });

  const gcashEntriesList = gcashEntries.map(g => ({ n: g.referenceNumber || g.receiptNo, v: g.amount }));
  const halfGcash = Math.ceil(gcashEntriesList.length / 2);
  const gcashCol1 = gcashEntriesList.slice(0, halfGcash);
  const gcashCol2 = gcashEntriesList.slice(halfGcash);

  const maxRows = Math.max(
    expenseCol1Items.length,
    expenseCol2Items.length,
    gcashCol1.length,
    gcashCol2.length,
    10 // minimum empty rows
  );

  for (let i = 0; i < maxRows; i++) {
    const row = ws.getRow(r + i);
    
    // Col 1 Exp
    if (expenseCol1Items[i]) {
      ws.mergeCells(`A${r+i}:B${r+i}`);
      row.getCell(1).value = expenseCol1Items[i].n;
      row.getCell(3).value = formatAmount(expenseCol1Items[i].v);
    } else {
      ws.mergeCells(`A${r+i}:B${r+i}`);
    }
    row.getCell(1).border = BORDERS; row.getCell(2).border = BORDERS; row.getCell(3).border = BORDERS;
    
    // Col 2 Exp
    if (expenseCol2Items[i]) {
      ws.mergeCells(`D${r+i}:E${r+i}`);
      row.getCell(4).value = expenseCol2Items[i].n;
      row.getCell(6).value = formatAmount(expenseCol2Items[i].v);
    } else {
      ws.mergeCells(`D${r+i}:E${r+i}`);
    }
    row.getCell(4).border = BORDERS; row.getCell(5).border = BORDERS; row.getCell(6).border = BORDERS;

    // GCash 1
    if (gcashCol1[i]) {
      ws.mergeCells(`G${r+i}:H${r+i}`);
      row.getCell(7).value = gcashCol1[i].n;
      row.getCell(9).value = formatAmount(gcashCol1[i].v);
    } else {
      ws.mergeCells(`G${r+i}:H${r+i}`);
    }
    row.getCell(7).border = BORDERS; row.getCell(8).border = BORDERS; row.getCell(9).border = BORDERS;

    // GCash 2
    if (gcashCol2[i]) {
      ws.mergeCells(`J${r+i}:K${r+i}`);
      row.getCell(10).value = gcashCol2[i].n;
      row.getCell(12).value = formatAmount(gcashCol2[i].v);
    } else {
      ws.mergeCells(`J${r+i}:K${r+i}`);
    }
    row.getCell(10).border = BORDERS; row.getCell(11).border = BORDERS; row.getCell(12).border = BORDERS;
  }

  r += maxRows;

  // Subtotals
  const row = ws.getRow(r);
  row.getCell(3).value = formatAmount(expenses.col1.subtotal);
  row.getCell(3).border = { bottom: { style: 'thin' } };
  row.getCell(6).value = formatAmount(expenses.col2.subtotal);
  row.getCell(6).border = { bottom: { style: 'thin' } };
  
  // Right side Summary Block (rows expHeaderRow to r)
  ws.getCell(`M${expHeaderRow + 2}`).value = 'expenses:';
  ws.getCell(`M${expHeaderRow + 2}`).alignment = { horizontal: 'right' };
  ws.getCell(`N${expHeaderRow + 2}`).value = formatAmount(expenses.total);
  ws.getCell(`N${expHeaderRow + 2}`).border = { top: { style: 'thin' }, bottom: { style: 'thin' } };
  ws.getCell(`N${expHeaderRow + 2}`).numFmt = '#,##0.00';
  
  ws.getCell(`M${expHeaderRow + 4}`).value = 'gcash';
  ws.getCell(`M${expHeaderRow + 4}`).alignment = { horizontal: 'right' };
  const totalGcash = gcashEntries.reduce((s, g) => s + g.amount, 0);
  ws.getCell(`N${expHeaderRow + 4}`).value = formatAmount(totalGcash);
  ws.getCell(`N${expHeaderRow + 4}`).border = { top: { style: 'thin' }, bottom: { style: 'double' } };
  ws.getCell(`N${expHeaderRow + 4}`).numFmt = '#,##0.00';

  r += 3;

  // DELIVERABLES AND CASH DENOM
  if (cashDenom) {
    const denomData = [
      { num: '1000', label: '1. GCASH REPORT', val: cashDenom.total1000 },
      { num: '500', label: '2. WEEKLY REPORT', val: cashDenom.total500 },
      { num: '200', label: '3. WEEKLY RECEIPT', val: cashDenom.total200 },
      { num: '100', label: '4. CASH REPORT', val: cashDenom.total100 },
      { num: '50', label: '', val: cashDenom.total50 },
      { num: 'COINS', label: '', val: cashDenom.coinsTotal },
    ];

    denomData.forEach((d, idx) => {
      const dr = ws.getRow(r + idx);
      if (d.label) {
        dr.getCell(10).value = d.label;
        dr.getCell(10).font = { bold: true, color: { argb: COLORS.blackText } };
      }
      dr.getCell(11).value = d.num;
      dr.getCell(11).alignment = { horizontal: 'right' };
      dr.getCell(12).value = '=';
      dr.getCell(12).alignment = { horizontal: 'center' };
      
      dr.getCell(14).value = formatAmount(d.val);
      dr.getCell(14).border = { bottom: { style: 'thin' } };
      dr.getCell(14).numFmt = '#,##0.00';
    });

    r += 6;
    
    ws.getCell(`L${r}`).value = 'TOTAL:';
    ws.getCell(`L${r}`).font = { bold: true, color: { argb: 'FF1F2937' } };
    ws.getCell(`L${r}`).alignment = { horizontal: 'right' };
    ws.getCell(`N${r}`).value = formatAmount(cashDenom.grandTotal);
    ws.getCell(`N${r}`).border = { bottom: { style: 'double' } };
    ws.getCell(`N${r}`).numFmt = '#,##0.00';
    ws.getCell(`N${r}`).font = { bold: true };
  }

  r += 3;

  ws.getCell(`K${r}`).value = 'RECEIVED BY:';
  ws.getCell(`K${r}`).alignment = { horizontal: 'right' };
  ws.mergeCells(`L${r}:N${r}`);
  ws.getCell(`L${r}`).value = receivedBy;
  ws.getCell(`L${r}`).border = { bottom: { style: 'thin' } };

  // Write and Save
  ws.views = [{ state: 'frozen', ySplit: 6 }];
  setupPrint(ws);
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Sedona_Weekly_Report_${format(weekStart, 'yyyy-MM-dd')}.xlsx`;
  a.click();
  window.URL.revokeObjectURL(url);
}

/**
 * Generate daily report
 */
export async function generateDailyReportExcel(
  date: Date,
  shifts: WeeklyShiftEntry[],
  expenses: WeeklyExpenses,
  gcashEntries: GCashEntry[],
  cashDenom: CashDenomination | null,
  receivedBy: string = ''
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Daily Report');
  setupWorksheet(ws);

  const dateLabel = format(date, 'MMM dd, yyyy');
  const year = date.getFullYear();
  const weekNum = Math.ceil(((date.getDate() + 6 - getDay(date)) % 35) / 7) + 1;
  const srCode = `DR ${(year % 100).toString().padStart(2, '0')} Day ${getDay(date) || 7}`;

  // Title (shared DB-workbook theme)
  ws.mergeCells('D1:L2');
  const titleCell = ws.getCell('D1');
  titleCell.value = 'DAILY REPORT & REMITTANCE';
  titleCell.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FF1F2937' } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

  // Subtitle
  const dateCell = ws.getCell('A3');
  dateCell.value = dateLabel;
  dateCell.font = { name: 'Calibri', size: 11, color: { argb: 'FF6B7280' }, italic: true, bold: true };
  
  const srCell = ws.getCell('N3');
  srCell.value = srCode;
  srCell.font = { name: 'Calibri', size: 11, color: { argb: 'FF6B7280' }, italic: true, bold: true };
  srCell.alignment = { horizontal: 'right' };

  let r = buildShiftGrid(ws, shifts, [date], 4);

  // BUILD EXPENSES AND GCASH BLOCKS (same logic as weekly but with filtered data)
  r++; // spacer

  // EXPENSES HEADERS
  ws.mergeCells(`A${r}:C${r}`);
  ws.getCell(`A${r}`).value = 'EXPENSES:';
  ws.getCell(`A${r}`).font = { bold: true };
  ws.getCell(`A${r}`).alignment = { horizontal: 'center' };
  ws.getCell(`A${r}`).border = BORDERS;

  ws.mergeCells(`D${r}:F${r}`);
  ws.getCell(`D${r}`).value = 'EXPENSES:';
  ws.getCell(`D${r}`).font = { bold: true };
  ws.getCell(`D${r}`).alignment = { horizontal: 'center' };
  ws.getCell(`D${r}`).border = BORDERS;

  ws.mergeCells(`G${r}:I${r}`);
  ws.getCell(`G${r}`).value = 'GCASH:';
  ws.getCell(`G${r}`).font = { bold: true };
  ws.getCell(`G${r}`).alignment = { horizontal: 'center' };
  ws.getCell(`G${r}`).border = BORDERS;

  ws.mergeCells(`J${r}:L${r}`);
  ws.getCell(`J${r}`).value = 'GCASH:';
  ws.getCell(`J${r}`).font = { bold: true };
  ws.getCell(`J${r}`).alignment = { horizontal: 'center' };
  ws.getCell(`J${r}`).border = BORDERS;

  const expHeaderRow = r;
  r++;

  const expenseCol1Items = [
    { n: 'kitchen', v: expenses.col1.kitchen },
    { n: 'wilkins pure', v: expenses.col1.wilkinsPure },
    { n: 'ate lanie beddings', v: expenses.col1.ateLanieBeddings },
    { n: 'k.rico gas new laundry', v: expenses.col1.kricoGasLaundry },
    { n: 'tissue flexi cling', v: expenses.col1.tissueFlexiCling },
    { n: 'miscellaneous', v: expenses.col1.miscellaneous },
    { n: 'kovi', v: expenses.col1.kovi },
    { n: 'CM SURC rh', v: expenses.col1.cmSurcRh },
    { n: 'LIEMPO', v: expenses.col1.lempo },
    { n: 'marbont', v: expenses.col1.marbont },
    { n: 'aquapura', v: expenses.col1.aquapura },
    { n: 'andeng store', v: expenses.col1.andengStore },
    { n: 'george cable', v: expenses.col1.georgeCable },
    { n: 'rh meat', v: expenses.col1.rhMeat },
    { n: 'coke zero', v: expenses.col1.cokeZero },
    { n: 'short pau', v: expenses.col1.shortPau },
    { n: 'venyen zonrox', v: expenses.col1.venyenZonrox },
  ];

  const expenseCol2Items = [
    { n: 'vale pau cam id', v: expenses.col2.valePauCamId },
    { n: 'admin gretch sa', v: expenses.col2.adminGretchSa },
  ];

  expenses.customExpenses.forEach((item) => {
    if (item.category === 'col1') expenseCol1Items.push({ n: item.name, v: item.amount });
    else expenseCol2Items.push({ n: item.name, v: item.amount });
  });

  const dailyDateStr = format(date, 'yyyy-MM-dd');
  const filteredGcashEntries = gcashEntries.filter(g => g.date === dailyDateStr || g.date.startsWith(dailyDateStr));
  const gcashEntriesList = filteredGcashEntries.map(g => ({ n: g.referenceNumber || g.receiptNo, v: g.amount }));
  const halfGcash = Math.ceil(gcashEntriesList.length / 2);
  const gcashCol1 = gcashEntriesList.slice(0, halfGcash);
  const gcashCol2 = gcashEntriesList.slice(halfGcash);

  const maxRows = Math.max(
    expenseCol1Items.length,
    expenseCol2Items.length,
    gcashCol1.length,
    gcashCol2.length,
    10 // minimum empty rows
  );

  for (let i = 0; i < maxRows; i++) {
    const row = ws.getRow(r + i);
    
    // Col 1 Exp
    if (expenseCol1Items[i]) {
      ws.mergeCells(`A${r+i}:B${r+i}`);
      row.getCell(1).value = expenseCol1Items[i].n;
      row.getCell(3).value = formatAmount(expenseCol1Items[i].v);
    } else {
      ws.mergeCells(`A${r+i}:B${r+i}`);
    }
    row.getCell(1).border = BORDERS; row.getCell(2).border = BORDERS; row.getCell(3).border = BORDERS;
    
    // Col 2 Exp
    if (expenseCol2Items[i]) {
      ws.mergeCells(`D${r+i}:E${r+i}`);
      row.getCell(4).value = expenseCol2Items[i].n;
      row.getCell(6).value = formatAmount(expenseCol2Items[i].v);
    } else {
      ws.mergeCells(`D${r+i}:E${r+i}`);
    }
    row.getCell(4).border = BORDERS; row.getCell(5).border = BORDERS; row.getCell(6).border = BORDERS;

    // GCash 1
    if (gcashCol1[i]) {
      ws.mergeCells(`G${r+i}:H${r+i}`);
      row.getCell(7).value = gcashCol1[i].n;
      row.getCell(9).value = formatAmount(gcashCol1[i].v);
    } else {
      ws.mergeCells(`G${r+i}:H${r+i}`);
    }
    row.getCell(7).border = BORDERS; row.getCell(8).border = BORDERS; row.getCell(9).border = BORDERS;

    // GCash 2
    if (gcashCol2[i]) {
      ws.mergeCells(`J${r+i}:K${r+i}`);
      row.getCell(10).value = gcashCol2[i].n;
      row.getCell(12).value = formatAmount(gcashCol2[i].v);
    } else {
      ws.mergeCells(`J${r+i}:K${r+i}`);
    }
    row.getCell(10).border = BORDERS; row.getCell(11).border = BORDERS; row.getCell(12).border = BORDERS;
  }

  r += maxRows;

  // Subtotals
  const row = ws.getRow(r);
  row.getCell(3).value = formatAmount(expenses.col1.subtotal);
  row.getCell(3).border = { bottom: { style: 'thin' } };
  row.getCell(6).value = formatAmount(expenses.col2.subtotal);
  row.getCell(6).border = { bottom: { style: 'thin' } };
  
  // Right side Summary Block (rows expHeaderRow to r)
  ws.getCell(`M${expHeaderRow + 2}`).value = 'expenses:';
  ws.getCell(`M${expHeaderRow + 2}`).alignment = { horizontal: 'right' };
  ws.getCell(`N${expHeaderRow + 2}`).value = formatAmount(expenses.total);
  ws.getCell(`N${expHeaderRow + 2}`).border = { top: { style: 'thin' }, bottom: { style: 'thin' } };
  ws.getCell(`N${expHeaderRow + 2}`).numFmt = '#,##0.00';
  
  ws.getCell(`M${expHeaderRow + 4}`).value = 'gcash';
  ws.getCell(`M${expHeaderRow + 4}`).alignment = { horizontal: 'right' };
  const totalGcash = gcashEntries.reduce((s, g) => s + g.amount, 0);
  ws.getCell(`N${expHeaderRow + 4}`).value = formatAmount(totalGcash);
  ws.getCell(`N${expHeaderRow + 4}`).border = { top: { style: 'thin' }, bottom: { style: 'double' } };
  ws.getCell(`N${expHeaderRow + 4}`).numFmt = '#,##0.00';

  r += 3;

  // DELIVERABLES AND CASH DENOM
  if (cashDenom) {
    const denomData = [
      { num: '1000', label: '1. GCASH REPORT', val: cashDenom.total1000 },
      { num: '500', label: '2. DAILY REPORT', val: cashDenom.total500 },
      { num: '200', label: '3. DAILY RECEIPT', val: cashDenom.total200 },
      { num: '100', label: '4. CASH REPORT', val: cashDenom.total100 },
      { num: '50', label: '', val: cashDenom.total50 },
      { num: 'COINS', label: '', val: cashDenom.coinsTotal },
    ];

    denomData.forEach((d, idx) => {
      const dr = ws.getRow(r + idx);
      if (d.label) {
        dr.getCell(10).value = d.label;
        dr.getCell(10).font = { bold: true, color: { argb: COLORS.blackText } };
      }
      dr.getCell(11).value = d.num;
      dr.getCell(11).alignment = { horizontal: 'right' };
      dr.getCell(12).value = '=';
      dr.getCell(12).alignment = { horizontal: 'center' };
      
      dr.getCell(14).value = formatAmount(d.val);
      dr.getCell(14).border = { bottom: { style: 'thin' } };
      dr.getCell(14).numFmt = '#,##0.00';
    });

    r += 6;
    
    ws.getCell(`L${r}`).value = 'TOTAL:';
    ws.getCell(`L${r}`).font = { bold: true, color: { argb: 'FF1F2937' } };
    ws.getCell(`L${r}`).alignment = { horizontal: 'right' };
    ws.getCell(`N${r}`).value = formatAmount(cashDenom.grandTotal);
    ws.getCell(`N${r}`).border = { bottom: { style: 'double' } };
    ws.getCell(`N${r}`).numFmt = '#,##0.00';
    ws.getCell(`N${r}`).font = { bold: true };
  }

  r += 3;

  ws.getCell(`K${r}`).value = 'RECEIVED BY:';
  ws.getCell(`K${r}`).alignment = { horizontal: 'right' };
  ws.mergeCells(`L${r}:N${r}`);
  ws.getCell(`L${r}`).value = receivedBy;
  ws.getCell(`L${r}`).border = { bottom: { style: 'thin' } };

  // Write and Save
  ws.views = [{ state: 'frozen', ySplit: 6 }];
  setupPrint(ws);
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Sedona_Daily_Report_${format(date, 'yyyy-MM-dd')}.xlsx`;
  a.click();
  window.URL.revokeObjectURL(url);
}
