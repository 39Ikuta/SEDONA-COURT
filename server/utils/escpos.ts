/**
 * server/utils/escpos.ts
 *
 * Native ESC/POS thermal command builder for Sedona Court PMS.
 * Generates binary command buffers for thermal receipt printers (58mm and 80mm roll widths).
 *
 * Implements:
 * - Native double-width and double-height bold (DOUBLE_BOTH_ON + BOLD_ON)
 * - Exact bottom section ordering (Subtotal -> Discount -> TOTAL AMOUNT DUE -> Settlement -> Tendered -> CHANGE)
 * - Safe character limits fitting both 58mm (32 chars / 16 double-chars) and 80mm rolls without truncation
 */

export const ESC_POS = {
  INIT: Buffer.from([0x1b, 0x40]), // ESC @ Initialize
  ALIGN_LEFT: Buffer.from([0x1b, 0x61, 0x00]), // ESC a 0
  ALIGN_CENTER: Buffer.from([0x1b, 0x61, 0x01]), // ESC a 1
  ALIGN_RIGHT: Buffer.from([0x1b, 0x61, 0x02]), // ESC a 2
  BOLD_ON: Buffer.from([0x1b, 0x45, 0x01]), // ESC E 1
  BOLD_OFF: Buffer.from([0x1b, 0x45, 0x00]), // ESC E 0
  DOUBLE_HEIGHT_ON: Buffer.from([0x1d, 0x21, 0x01]), // GS ! 1
  DOUBLE_WIDTH_ON: Buffer.from([0x1d, 0x21, 0x10]), // GS ! 16
  DOUBLE_BOTH_ON: Buffer.from([0x1d, 0x21, 0x11]), // GS ! 17 (or ESC ! 0x30)
  NORMAL_TEXT: Buffer.from([0x1d, 0x21, 0x00]), // GS ! 0
  CUT_FULL: Buffer.from([0x1d, 0x56, 0x00]), // GS V 0
  CUT_PARTIAL: Buffer.from([0x1d, 0x56, 0x01]), // GS V 1
  FEED_AND_CUT: Buffer.from([0x1d, 0x56, 0x41, 0x03]), // GS V 65 3
  DRAWER_PIN2: Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]), // ESC p 0 25 250 (Pin 2 kick)
  DRAWER_PIN5: Buffer.from([0x1b, 0x70, 0x01, 0x19, 0xfa]), // ESC p 1 25 250 (Pin 5 kick)
};

export interface ReceiptRawPrintOptions {
  host?: string;
  port?: number;
  rollWidth?: '58mm' | '80mm';
  receiptNo: string;
  dateTime: string;
  guestName: string;
  roomNumber: string;
  roomType: string;
  cashierId: string;
  checkIn: string;
  checkOut: string;
  stayDuration?: string;
  timeConsumed?: string;
  items: Array<{ description: string; subtext?: string; amount: number }>;
  subtotal: number;
  discount?: number;
  discountType?: string;
  discountCardMasked?: string;
  total: number;
  paymentMethod: string;
  amountTendered: number;
  changeAmount: number;
  cashAmount?: number;
  gcashAmount?: number;
  gcashRef?: string;
  depositBalance?: number;
  depositApplied?: number;
  depositLine?: string;
  reprintCount?: number;
  isVoid?: boolean;
  voidReason?: string;
  isPrePrint?: boolean;
  label?: string;
}

export function formatManilaForPrint(val?: string): string {
  if (!val || val === 'N/A') return 'N/A';
  const d = new Date(val.includes(' ') && !val.includes('T') ? val.replace(' ', 'T') : val);
  if (isNaN(d.getTime())) return String(val);
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d);
}

function foldToWidth(text: string, width: number): string[] {
  const clean = String(text ?? '');
  if (clean.length <= width) return [clean];
  const lines: string[] = [];
  let rest = clean;
  while (rest.length > width) {
    lines.push(rest.slice(0, width));
    rest = rest.slice(width);
  }
  if (rest) lines.push(rest);
  return lines;
}

export function buildReceiptEscPosBuffer(
  options: ReceiptRawPrintOptions,
  rollWidth: '58mm' | '80mm' = '80mm'
): Buffer {
  const is58mm = rollWidth === '58mm';
  const lineWidth = is58mm ? 32 : 42;
  const divider = '-'.repeat(lineWidth) + '\n';
  const doubleDivider = '='.repeat(lineWidth) + '\n';

  const padRow = (left: any = '', right: any = ''): string => {
    const l = String(left ?? '');
    let r = String(right ?? '');
    if (r.length > lineWidth) r = r.slice(0, lineWidth);
    const lLines = foldToWidth(l, lineWidth);
    const firstL = lLines[0] ?? '';
    const totalSpaces = Math.max(1, lineWidth - firstL.length - r.length);
    let out = `${firstL}${' '.repeat(totalSpaces)}${r}\n`;
    for (let i = 1; i < lLines.length; i++) out += `${lLines[i]}\n`;
    return out;
  };

  const chunks: Buffer[] = [
    ESC_POS.INIT,
    ESC_POS.ALIGN_CENTER,
  ];

  // Pre-print, Void, or Reprint banner
  if (options.isPrePrint) {
    chunks.push(ESC_POS.BOLD_ON);
    chunks.push(Buffer.from(`*** ${options.label || 'PRE-PRINT / NOT OFFICIAL RECEIPT'} ***\n`, 'utf-8'));
    chunks.push(ESC_POS.BOLD_OFF);
  }
  if (options.isVoid) {
    chunks.push(ESC_POS.BOLD_ON);
    chunks.push(Buffer.from('*** VOIDED RECEIPT ***\n', 'utf-8'));
    if (options.voidReason) {
      chunks.push(Buffer.from(`REASON: ${options.voidReason}\n`, 'utf-8'));
    }
    chunks.push(ESC_POS.BOLD_OFF);
  }
  if (options.reprintCount && options.reprintCount > 0) {
    chunks.push(ESC_POS.BOLD_ON);
    chunks.push(Buffer.from(`[OFFICIAL REPRINT #${options.reprintCount}]\n`, 'utf-8'));
    chunks.push(ESC_POS.BOLD_OFF);
  }

  // Header Brand
  chunks.push(ESC_POS.BOLD_ON);
  chunks.push(ESC_POS.DOUBLE_HEIGHT_ON);
  chunks.push(Buffer.from('SEDONA COURT\n', 'utf-8'));
  chunks.push(ESC_POS.NORMAL_TEXT);
  chunks.push(Buffer.from('Doña Remedios Trinidad Hwy\nSan Rafael, 3008 Bulacan\nTEL: +63 (0939) 905-2816\n', 'utf-8'));
  chunks.push(Buffer.from(divider, 'utf-8'));

  // Metadata Panel
  const receiptDateTime = formatManilaForPrint(options.dateTime || new Date().toISOString());
  const cashierIdentifier = options.cashierId || 'FrontDesk';
  const inTime = formatManilaForPrint(options.checkIn || (options as any).checkInDate || '');
  const outTime = formatManilaForPrint(options.checkOut || (options as any).checkOutDate || '');
  const receiptItems = options.items || [];

  chunks.push(ESC_POS.ALIGN_LEFT);
  chunks.push(Buffer.from(padRow('RECEIPT NO:', options.receiptNo), 'utf-8'));
  chunks.push(Buffer.from(padRow('DATE/TIME:', receiptDateTime), 'utf-8'));
  chunks.push(Buffer.from(padRow('CASHIER:', cashierIdentifier), 'utf-8'));
  chunks.push(Buffer.from(padRow('ROOM NUMBER:', `ROOM ${options.roomNumber}`), 'utf-8'));
  chunks.push(Buffer.from(padRow('GUEST:', options.guestName), 'utf-8'));
  if (options.stayDuration) {
    chunks.push(Buffer.from(padRow('DECLARED STAY:', options.stayDuration), 'utf-8'));
  }
  chunks.push(Buffer.from(divider, 'utf-8'));

  // In / Out / Time Consumed Block (Task 3)
  chunks.push(Buffer.from(padRow('IN:', inTime), 'utf-8'));
  chunks.push(Buffer.from(padRow('OUT:', outTime), 'utf-8'));
  if (options.timeConsumed) {
    chunks.push(ESC_POS.BOLD_ON);
    chunks.push(Buffer.from(padRow('TIME CONSUMED:', options.timeConsumed), 'utf-8'));
    chunks.push(ESC_POS.BOLD_OFF);
  }
  chunks.push(Buffer.from(divider, 'utf-8'));

  // Items
  chunks.push(ESC_POS.BOLD_ON);
  chunks.push(Buffer.from(padRow('CHARGE DESCRIPTION', 'AMOUNT'), 'utf-8'));
  chunks.push(ESC_POS.BOLD_OFF);
  receiptItems.forEach((it) => {
    const amtStr = `${it.amount < 0 ? '-' : ''}PHP ${Math.abs(it.amount).toFixed(2)}`;
    chunks.push(Buffer.from(padRow(it.description, amtStr), 'utf-8'));
    if (it.subtext) {
      chunks.push(Buffer.from(`  > ${it.subtext}\n`, 'utf-8'));
    }
  });
  chunks.push(Buffer.from(divider, 'utf-8'));

  // Bottom Section strictly ordered per Task 4:
  // 1. Subtotal
  chunks.push(Buffer.from(padRow('SUBTOTAL:', `PHP ${options.subtotal.toFixed(2)}`), 'utf-8'));

  // 2. Discount with masked card
  if (options.discount && options.discount > 0) {
    const discLabel = `DISCOUNT (${options.discountType || 'APPLIED'}):`;
    chunks.push(Buffer.from(padRow(discLabel, `-PHP ${options.discount.toFixed(2)}`), 'utf-8'));
    if (options.discountCardMasked) {
      chunks.push(Buffer.from(padRow('CARD # (MASKED):', options.discountCardMasked), 'utf-8'));
    }
  }

  // 2b. Deposit Applied (if any)
  if (options.depositApplied && options.depositApplied > 0) {
    chunks.push(Buffer.from(padRow('DEPOSIT APPLIED:', `-PHP ${options.depositApplied.toFixed(2)}`), 'utf-8'));
  }

  // 3. TOTAL AMOUNT DUE in double-width/double-height bold (ESC/POS)
  chunks.push(Buffer.from(doubleDivider, 'utf-8'));
  chunks.push(ESC_POS.BOLD_ON);
  chunks.push(Buffer.from('TOTAL AMOUNT DUE:\n', 'utf-8'));
  chunks.push(ESC_POS.DOUBLE_BOTH_ON);
  chunks.push(ESC_POS.ALIGN_RIGHT);
  chunks.push(Buffer.from(`PHP ${options.total.toFixed(2)}\n`, 'utf-8'));
  chunks.push(ESC_POS.NORMAL_TEXT);
  chunks.push(ESC_POS.ALIGN_LEFT);
  chunks.push(Buffer.from(doubleDivider, 'utf-8'));

  // 4. Settlement Method
  chunks.push(Buffer.from(padRow('SETTLEMENT METHOD:', options.paymentMethod || 'CASH'), 'utf-8'));
  if (options.paymentMethod === 'MIXED') {
    if (options.cashAmount != null) chunks.push(Buffer.from(padRow('  - Cash Paid:', `PHP ${options.cashAmount.toFixed(2)}`), 'utf-8'));
    if (options.gcashAmount != null) chunks.push(Buffer.from(padRow('  - GCash Paid:', `PHP ${options.gcashAmount.toFixed(2)}`), 'utf-8'));
  }
  if (options.gcashRef) {
    chunks.push(Buffer.from(padRow('GCASH REF NO:', options.gcashRef), 'utf-8'));
  }

  // 5. Amount Tendered
  chunks.push(Buffer.from(padRow('AMOUNT TENDERED:', `PHP ${options.amountTendered.toFixed(2)}`), 'utf-8'));

  // 6. CHANGE (Large or Bold)
  chunks.push(ESC_POS.BOLD_ON);
  chunks.push(Buffer.from(padRow('CHANGE:', `PHP ${options.changeAmount.toFixed(2)}`), 'utf-8'));
  chunks.push(ESC_POS.BOLD_OFF);

  // 6b. Deposit line (not sales)
  if (options.depositLine) {
    chunks.push(Buffer.from(padRow('DEPOSIT (not sales):', options.depositLine), 'utf-8'));
  }

  // 7. Deposit balance if any
  if (options.depositBalance != null && options.depositBalance > 0) {
    chunks.push(Buffer.from(padRow('DEPOSIT BALANCE:', `PHP ${options.depositBalance.toFixed(2)}`), 'utf-8'));
  }

  // Footer & Cut
  chunks.push(Buffer.from(divider, 'utf-8'));
  chunks.push(ESC_POS.ALIGN_CENTER);
  chunks.push(Buffer.from('Thank you for staying at Sedona Court!\n\n\n\n', 'utf-8'));
  chunks.push(ESC_POS.FEED_AND_CUT);

  return Buffer.concat(chunks);
}

export interface DepositSlipPrintOptions {
  depositNumber: string;
  dateTime: string;
  roomNumber: string;
  guestName: string;
  cashierId: string;
  amount: number;
  paymentMethod: string;
  notes?: string;
  reprintCount?: number;
}

export function buildDepositSlipEscPosBuffer(
  options: DepositSlipPrintOptions,
  rollWidth: '58mm' | '80mm' = '80mm'
): Buffer {
  const is58mm = rollWidth === '58mm';
  const lineWidth = is58mm ? 32 : 42;
  const divider = '-'.repeat(lineWidth) + '\n';
  const doubleDivider = '='.repeat(lineWidth) + '\n';

  const padRow = (left: any = '', right: any = ''): string => {
    const l = String(left ?? '');
    let r = String(right ?? '');
    if (r.length > lineWidth) r = r.slice(0, lineWidth);
    const lLines = foldToWidth(l, lineWidth);
    const firstL = lLines[0] ?? '';
    const totalSpaces = Math.max(1, lineWidth - firstL.length - r.length);
    let out = `${firstL}${' '.repeat(totalSpaces)}${r}\n`;
    for (let i = 1; i < lLines.length; i++) out += `${lLines[i]}\n`;
    return out;
  };

  const chunks: Buffer[] = [
    ESC_POS.INIT,
    ESC_POS.ALIGN_CENTER,
  ];

  if (options.reprintCount && options.reprintCount > 0) {
    chunks.push(ESC_POS.BOLD_ON);
    chunks.push(Buffer.from(`[OFFICIAL REPRINT #${options.reprintCount}]\n`, 'utf-8'));
    chunks.push(ESC_POS.BOLD_OFF);
  }

  chunks.push(ESC_POS.BOLD_ON);
  chunks.push(ESC_POS.DOUBLE_HEIGHT_ON);
  chunks.push(Buffer.from('SEDONA COURT\n', 'utf-8'));
  chunks.push(ESC_POS.NORMAL_TEXT);
  chunks.push(Buffer.from('SECURITY DEPOSIT ACKNOWLEDGMENT\n', 'utf-8'));
  chunks.push(Buffer.from('Doña Remedios Trinidad Hwy, San Rafael\n', 'utf-8'));
  chunks.push(Buffer.from(doubleDivider, 'utf-8'));

  chunks.push(ESC_POS.ALIGN_LEFT);
  chunks.push(Buffer.from(padRow('DEPOSIT SLIP NO:', options.depositNumber), 'utf-8'));
  chunks.push(Buffer.from(padRow('DATE/TIME:', options.dateTime || new Date().toISOString()), 'utf-8'));
  chunks.push(Buffer.from(padRow('COLLECTED BY:', options.cashierId || 'FrontDesk'), 'utf-8'));
  chunks.push(Buffer.from(padRow('ROOM NUMBER:', `ROOM ${options.roomNumber}`), 'utf-8'));
  chunks.push(Buffer.from(padRow('GUEST:', options.guestName || 'Valued Guest'), 'utf-8'));
  chunks.push(Buffer.from(padRow('METHOD:', options.paymentMethod || 'CASH'), 'utf-8'));
  if (options.notes) {
    chunks.push(Buffer.from(padRow('PURPOSE:', options.notes), 'utf-8'));
  }
  chunks.push(Buffer.from(divider, 'utf-8'));

  // Deposit Amount in Double Size
  chunks.push(ESC_POS.BOLD_ON);
  chunks.push(Buffer.from('DEPOSIT AMOUNT HELD:\n', 'utf-8'));
  chunks.push(ESC_POS.DOUBLE_BOTH_ON);
  chunks.push(ESC_POS.ALIGN_RIGHT);
  chunks.push(Buffer.from(`PHP ${options.amount.toFixed(2)}\n`, 'utf-8'));
  chunks.push(ESC_POS.NORMAL_TEXT);
  chunks.push(ESC_POS.ALIGN_LEFT);
  chunks.push(Buffer.from(doubleDivider, 'utf-8'));

  chunks.push(ESC_POS.ALIGN_CENTER);
  chunks.push(Buffer.from('* REFUNDABLE UPON CLEARANCE *\n', 'utf-8'));
  chunks.push(Buffer.from('Please present this slip at checkout to redeem.\n\n', 'utf-8'));

  chunks.push(ESC_POS.ALIGN_LEFT);
  chunks.push(Buffer.from('Guest Signature: _______________________\n\n\n\n', 'utf-8'));
  chunks.push(ESC_POS.FEED_AND_CUT);

  return Buffer.concat(chunks);
}

export interface DepositRefundSlipPrintOptions {
  depositNumber: string;
  dateTime: string;
  roomNumber: string;
  guestName: string;
  cashierId: string;
  originalAmount: number;
  refundAmount?: number;
  appliedAmount?: number;
  status: 'refunded' | 'applied' | 'forfeited';
  linkedReceiptNo?: string;
  notes?: string;
  reprintCount?: number;
}

export function buildDepositRefundSlipEscPosBuffer(
  options: DepositRefundSlipPrintOptions,
  rollWidth: '58mm' | '80mm' = '80mm'
): Buffer {
  const is58mm = rollWidth === '58mm';
  const lineWidth = is58mm ? 32 : 42;
  const divider = '-'.repeat(lineWidth) + '\n';
  const doubleDivider = '='.repeat(lineWidth) + '\n';

  const padRow = (left: any = '', right: any = ''): string => {
    const l = String(left ?? '');
    let r = String(right ?? '');
    if (r.length > lineWidth) r = r.slice(0, lineWidth);
    const lLines = foldToWidth(l, lineWidth);
    const firstL = lLines[0] ?? '';
    const totalSpaces = Math.max(1, lineWidth - firstL.length - r.length);
    let out = `${firstL}${' '.repeat(totalSpaces)}${r}\n`;
    for (let i = 1; i < lLines.length; i++) out += `${lLines[i]}\n`;
    return out;
  };

  const chunks: Buffer[] = [
    ESC_POS.INIT,
    ESC_POS.ALIGN_CENTER,
  ];

  if (options.reprintCount && options.reprintCount > 0) {
    chunks.push(ESC_POS.BOLD_ON);
    chunks.push(Buffer.from(`[OFFICIAL REPRINT #${options.reprintCount}]\n`, 'utf-8'));
    chunks.push(ESC_POS.BOLD_OFF);
  }

  const title = options.status === 'applied'
    ? 'DEPOSIT SETTLEMENT SLIP'
    : options.status === 'forfeited'
    ? 'DEPOSIT FORFEITURE SLIP'
    : 'DEPOSIT REFUND SLIP';

  chunks.push(ESC_POS.BOLD_ON);
  chunks.push(ESC_POS.DOUBLE_HEIGHT_ON);
  chunks.push(Buffer.from('SEDONA COURT\n', 'utf-8'));
  chunks.push(ESC_POS.NORMAL_TEXT);
  chunks.push(Buffer.from(`${title}\n`, 'utf-8'));
  chunks.push(Buffer.from(doubleDivider, 'utf-8'));

  chunks.push(ESC_POS.ALIGN_LEFT);
  chunks.push(Buffer.from(padRow('DEPOSIT SLIP NO:', options.depositNumber), 'utf-8'));
  chunks.push(Buffer.from(padRow('DATE/TIME:', options.dateTime || new Date().toISOString()), 'utf-8'));
  chunks.push(Buffer.from(padRow('SETTLED BY:', options.cashierId || 'FrontDesk'), 'utf-8'));
  chunks.push(Buffer.from(padRow('ROOM NUMBER:', `ROOM ${options.roomNumber}`), 'utf-8'));
  chunks.push(Buffer.from(padRow('GUEST:', options.guestName || 'Valued Guest'), 'utf-8'));
  chunks.push(Buffer.from(padRow('ORIGINAL DEPOSIT:', `PHP ${options.originalAmount.toFixed(2)}`), 'utf-8'));
  chunks.push(Buffer.from(padRow('STATUS:', options.status.toUpperCase()), 'utf-8'));

  if (options.linkedReceiptNo) {
    chunks.push(Buffer.from(padRow('LINKED RECEIPT:', options.linkedReceiptNo), 'utf-8'));
  }
  if (options.notes) {
    chunks.push(Buffer.from(padRow('REASON/NOTES:', options.notes), 'utf-8'));
  }
  chunks.push(Buffer.from(divider, 'utf-8'));

  const finalAmount = options.status === 'applied'
    ? (options.appliedAmount ?? options.originalAmount)
    : options.status === 'forfeited'
    ? 0
    : (options.refundAmount ?? options.originalAmount);

  const amountLabel = options.status === 'applied'
    ? 'AMOUNT APPLIED TO BILL:'
    : options.status === 'forfeited'
    ? 'AMOUNT FORFEITED:'
    : 'CASH REFUND RETURNED:';

  chunks.push(ESC_POS.BOLD_ON);
  chunks.push(Buffer.from(`${amountLabel}\n`, 'utf-8'));
  chunks.push(ESC_POS.DOUBLE_BOTH_ON);
  chunks.push(ESC_POS.ALIGN_RIGHT);
  chunks.push(Buffer.from(`PHP ${finalAmount.toFixed(2)}\n`, 'utf-8'));
  chunks.push(ESC_POS.NORMAL_TEXT);
  chunks.push(ESC_POS.ALIGN_LEFT);
  chunks.push(Buffer.from(doubleDivider, 'utf-8'));

  chunks.push(ESC_POS.ALIGN_CENTER);
  chunks.push(Buffer.from('Acknowledgment of Settlement\n\n', 'utf-8'));
  chunks.push(ESC_POS.ALIGN_LEFT);
  chunks.push(Buffer.from('Cashier Signature: _____________________\n\n', 'utf-8'));
  chunks.push(Buffer.from('Guest Signature:   _____________________\n\n\n\n', 'utf-8'));
  chunks.push(ESC_POS.FEED_AND_CUT);

  return Buffer.concat(chunks);
}

