/**
 * src/api/reportExports.ts
 * Client for the SEPARATE database-authoritative exports
 * (GET /api/report-exports/*). The existing browser-generated workbooks in
 * utils/excelGenerator.ts are intentionally left untouched.
 */

async function downloadBlob(res: Response, filename: string): Promise<void> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error || `Export failed (${res.status})`);
  }
  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

function authHeaders(): Record<string, string> {
  const token = sessionStorage.getItem('scti_token') || '';
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Download the printable cashier shift forms workbook (Cashier Transaction
 * Form + Shift Transfer Form) for a date + shift, generated live by the server.
 * Cashier role and above.
 *
 * Pass sheets='transfer' for a transfer-form-only file (the handoff slip).
 */
export async function downloadShiftForms(
  date: string,
  shift: 'DAY' | 'NIGHT',
  sheets: 'both' | 'transfer' = 'both'
): Promise<void> {
  const qs = new URLSearchParams({ date, shift });
  if (sheets === 'transfer') qs.set('sheets', 'transfer');
  const res = await fetch(`/api/report-exports/shift-forms?${qs.toString()}`, {
    headers: authHeaders(),
  });
  await downloadBlob(
    res,
    sheets === 'transfer'
      ? `Sedona_Shift_Transfer_Form_${date}_${shift}.xlsx`
      : `Sedona_Cashier_Shift_Forms_${date}_${shift}.xlsx`
  );
}

/**
 * Download the database-authoritative executive workbook for a week
 * (Monday weekStart, YYYY-MM-DD). Admin/owner only.
 */
export async function downloadDbAuthoritativeWorkbook(weekStart: string): Promise<void> {
  const res = await fetch(
    `/api/report-exports/executive-workbook?weekStart=${encodeURIComponent(weekStart)}`,
    { headers: authHeaders() }
  );
  await downloadBlob(res, `Sedona_Court_DB_Authoritative_Audit_${weekStart}.xlsx`);
}

/**
 * Download the database-authoritative transactions ledger for a date range.
 */
export async function downloadDbLedger(params: {
  from: string;
  to: string;
  paymentMethod?: string;
  cashier?: string;
}): Promise<void> {
  const qs = new URLSearchParams({
    from: params.from,
    to: params.to,
    ...(params.paymentMethod ? { paymentMethod: params.paymentMethod } : {}),
    ...(params.cashier ? { cashier: params.cashier } : {}),
  }).toString();
  const res = await fetch(`/api/report-exports/transactions-ledger?${qs}`, {
    headers: authHeaders(),
  });
  await downloadBlob(res, `Sedona_Court_DB_Ledger_${params.from}_to_${params.to}.xlsx`);
}
