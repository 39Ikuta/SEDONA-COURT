/**
 * src/utils/excelTheme.ts
 * Shared ExcelJS visual theme for ALL browser-generated exports, matching the
 * database-authoritative workbook style (server/routes/report-exports.ts).
 *
 * SERVER MIRROR: server/utils/excel-theme.ts carries identical tokens for
 * server-generated workbooks (tsconfig.server.json cannot include src/utils).
 * Keep the two files in sync when changing the theme.
 */

import ExcelJS from 'exceljs';

export const EXCEL_THEME = {
  headerFill: 'FF1F4D2E',
  headerFont: 'FFFFFFFF',
  titleSize: 13,
  subtitleSize: 10,
  pesoFmt: '#,##0.00',
  intFmt: '#,##0',
  goodFill: 'FFE2EFDA',
  goodFont: 'FF375623',
  warnFill: 'FFFFF2CC',
  warnFont: 'FF7F6000',
  badFill: 'FFFCE4EC',
  badFont: 'FF880E4F',
  mutedFont: 'FF6B7280',
  totalFill: 'FFF2F2F2',
} as const;

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin' },
  bottom: { style: 'thin' },
  left: { style: 'thin' },
  right: { style: 'thin' },
};

/** Dark-green header row with white bold text + thin grid borders. */
export function styleHeaderRow(ws: ExcelJS.Worksheet, rowNumber: number, colCount: number): void {
  const row = ws.getRow(rowNumber);
  row.font = { name: 'Calibri', bold: true, size: 10, color: { argb: EXCEL_THEME.headerFont } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXCEL_THEME.headerFill } };
  row.alignment = { vertical: 'middle', wrapText: true };
  for (let c = 1; c <= colCount; c++) {
    row.getCell(c).border = THIN_BORDER as ExcelJS.Borders;
  }
}

/**
 * Standard title block (brand line, title, subtitle, control line).
 * Returns the row number where the data header should go.
 */
export function addTitleBlock(
  ws: ExcelJS.Worksheet,
  title: string,
  subtitle: string,
  controlNo: string,
  colCount = 6
): number {
  const lastCol = ws.getColumn(colCount).letter;
  ws.mergeCells(`A1:${lastCol}1`);
  ws.getCell('A1').value = 'SEDONA COURT TRAVELLERS INN & APARTMENTS';
  ws.getCell('A1').font = { name: 'Calibri', bold: true, size: EXCEL_THEME.titleSize };
  ws.mergeCells(`A2:${lastCol}2`);
  ws.getCell('A2').value = title;
  ws.getCell('A2').font = { name: 'Calibri', bold: true, size: 11 };
  ws.mergeCells(`A3:${lastCol}3`);
  ws.getCell('A3').value = subtitle;
  ws.getCell('A3').font = { name: 'Calibri', italic: true, size: EXCEL_THEME.subtitleSize, color: { argb: 'FF555555' } };
  ws.mergeCells(`A4:${lastCol}4`);
  ws.getCell('A4').value = `Control No: ${controlNo}`;
  ws.getCell('A4').font = { name: 'Calibri', size: 9, color: { argb: 'FF555555' } };
  return 6;
}

/** Peso formatting for a cell. */
export function asPeso(cell: ExcelJS.Cell): void {
  cell.numFmt = EXCEL_THEME.pesoFmt;
}

/** Integer formatting for a cell. */
export function asInt(cell: ExcelJS.Cell): void {
  cell.numFmt = EXCEL_THEME.intFmt;
}

/** Status pill fill: 'good' | 'warn' | 'bad'. */
export function statusFill(cell: ExcelJS.Cell, tone: 'good' | 'warn' | 'bad'): void {
  const fill = tone === 'good' ? EXCEL_THEME.goodFill : tone === 'warn' ? EXCEL_THEME.warnFill : EXCEL_THEME.badFill;
  const font = tone === 'good' ? EXCEL_THEME.goodFont : tone === 'warn' ? EXCEL_THEME.warnFont : EXCEL_THEME.badFont;
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
  cell.font = { name: 'Calibri', bold: true, color: { argb: font } };
}

/** Bold totals row with a double top border. */
export function styleTotalsRow(row: ExcelJS.Row, colCount: number): void {
  row.font = { name: 'Calibri', bold: true };
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.border = {
      ...THIN_BORDER,
      top: { style: 'double' },
    } as ExcelJS.Borders;
  }
}

/** Common print setup: landscape, fit-to-width, gridlines. */
export function setupPrint(ws: ExcelJS.Worksheet, landscape = true): void {
  ws.pageSetup = {
    ...ws.pageSetup,
    paperSize: 9, // A4
    orientation: landscape ? 'landscape' : 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
  } as ExcelJS.PageSetup;
}

/** Trigger a browser download of an ExcelJS workbook. */
export async function downloadWorkbook(wb: ExcelJS.Workbook, filename: string): Promise<void> {
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}
