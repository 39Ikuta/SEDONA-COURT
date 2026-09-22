/**
 * server/tests/report-exports.test.ts
 * Test suite for the SEPARATE database-authoritative exports
 * (GET /api/report-exports/*). The existing browser-generated workbooks
 * are intentionally untouched by this suite.
 *
 * 1. Auth gating: 401 unauthenticated, 403 cashier/kitchen/customer_display,
 *    200 admin/owner.
 * 2. Executive workbook: valid .xlsx with all 10 DB sheets, control number,
 *    and cross-footing totals.
 * 3. Input validation: non-Monday / malformed weekStart rejected with 400.
 * 4. Transactions ledger: filters work, totals cross-foot.
 */

process.env.NODE_ENV = 'test';
process.env.TZ = 'Asia/Manila';

import http from 'http';
import ExcelJS from 'exceljs';
// Import pool first: it loads .env.local (JWT_SECRET) as a side effect
// before ../utils/jwt is evaluated.
import { pool } from '../db/pool';
import { signJwt } from '../utils/jwt';

void pool;

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function assertTest(name: string, condition: boolean, errorDetail?: string) {
  results.push({ name, passed: condition, error: errorDetail });
  const icon = condition ? '✅' : '❌';
  console.log(`${icon} ${name}${!condition && errorDetail ? ` — FAILED: ${errorDetail}` : ''}`);
}

function mondayOfThisWeek(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = (day + 6) % 7; // days since Monday
  d.setDate(d.getDate() - diff);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function runTests() {
  console.log('\n📊 STARTING DATABASE-AUTHORITATIVE REPORT EXPORTS TEST SUITE\n');

  const { app } = await import('../index');

  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => resolve());
  });
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const adminToken = signJwt({ id: 1, username: 'admin', name: 'System Administrator', role: 'admin' }, 3600);
    const ownerToken = signJwt({ id: 9, username: 'owner', name: 'Sedona Owner', role: 'owner' }, 3600);
    const cashierToken = signJwt({ id: 2, username: 'ann', name: 'Ann (Cashier 1)', role: 'cashier' }, 3600);
    const kitchenToken = signJwt({ id: 5, username: 'kitchen1', name: 'SCTI Kitchen Staff', role: 'kitchen' }, 3600);
    const kioskToken = signJwt({ id: 9999, username: 'kiosk', name: 'Lobby Display Kiosk', role: 'customer_display' }, 3600);

    async function requestRaw(path: string, token?: string) {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`${baseUrl}${path}`, { headers });
      const buf = Buffer.from(await res.arrayBuffer());
      let json: any = null;
      try {
        json = JSON.parse(buf.toString('utf8'));
      } catch {
        // binary xlsx — not JSON
      }
      return { status: res.status, headers: res.headers, buf, json };
    }

    const weekStart = mondayOfThisWeek();
    const wbPath = `/api/report-exports/executive-workbook?weekStart=${weekStart}`;

    // =========================================================================
    // SECTION 1: AUTH GATING
    // =========================================================================
    console.log('--- 1. Auth Gating ---');

    const unauth = await requestRaw(wbPath);
    assertTest('1.1: Unauthenticated workbook request returns 401', unauth.status === 401, `got ${unauth.status}`);

    for (const [label, token, expected] of [
      ['cashier', cashierToken, 403],
      ['kitchen', kitchenToken, 403],
      ['customer_display', kioskToken, 403],
    ] as Array<[string, string, number]>) {
      const r = await requestRaw(wbPath, token);
      assertTest(`1.2: ${label} receives 403 on executive workbook`, r.status === expected, `got ${r.status}`);
    }

    const ownerRes = await requestRaw(wbPath, ownerToken);
    assertTest('1.3: owner receives 200 on executive workbook', ownerRes.status === 200, `got ${ownerRes.status}`);

    const unauthLedger = await requestRaw('/api/report-exports/transactions-ledger?from=2026-01-01&to=2026-12-31');
    assertTest('1.4: Unauthenticated ledger request returns 401', unauthLedger.status === 401, `got ${unauthLedger.status}`);

    const cashierLedger = await requestRaw('/api/report-exports/transactions-ledger?from=2026-01-01&to=2026-12-31', cashierToken);
    assertTest('1.5: cashier receives 403 on ledger export', cashierLedger.status === 403, `got ${cashierLedger.status}`);

    // =========================================================================
    // SECTION 2: WORKBOOK CONTENT
    // =========================================================================
    console.log('\n--- 2. Executive Workbook Content ---');

    const adminRes = await requestRaw(wbPath, adminToken);
    assertTest('2.1: admin receives 200 on executive workbook', adminRes.status === 200, `got ${adminRes.status}`);
    assertTest(
      '2.2: Content-Type is spreadsheetml',
      (adminRes.headers.get('content-type') || '').includes('spreadsheetml'),
      adminRes.headers.get('content-type')
    );
    assertTest(
      '2.3: Content-Disposition is an attachment with DB filename',
      (adminRes.headers.get('content-disposition') || '').includes('DB_Authoritative'),
      adminRes.headers.get('content-disposition')
    );
    assertTest('2.4: Control number header present', !!adminRes.headers.get('x-export-control-no'));

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(adminRes.buf as any);
    const sheetNames = wb.worksheets.map((ws) => ws.name);
    const expectedSheets = [
      'DB Cover', 'DB Dashboard', 'DB Shift Log', 'DB Journal', 'DB Deposits',
      'DB Night Audit', 'DB Comps Voids', 'DB GCash Audit', 'DB Cash Safe',
      'DB Inventory', 'DB Audit Trail',
    ];
    const missing = expectedSheets.filter((s) => !sheetNames.includes(s));
    assertTest('2.5: All 11 DB sheets present', missing.length === 0, `missing: ${missing.join(', ')}`);

    // Cross-foot: DB Journal TOTALS row equals column sums.
    const journal = wb.getWorksheet('DB Journal');
    let totalSum = 0;
    let totalsRowValue: number | null = null;
    if (journal) {
      journal.eachRow((row) => {
        const first = String(row.getCell(1).value || '');
        const totalCell = Number(row.getCell(10).value || 0);
        if (first.startsWith('TOTALS')) {
          totalsRowValue = totalCell;
        } else if (/^(SCTI-|FCE-|STF-)/.test(first)) {
          totalSum = Math.round((totalSum + totalCell) * 100) / 100;
        }
      });
    }
    assertTest(
      '2.6: Journal TOTALS row cross-foots with receipt lines',
      totalsRowValue !== null && Math.abs((totalsRowValue as number) - totalSum) < 0.01,
      `totals=${totalsRowValue} sum=${totalSum}`
    );

    // Dashboard gross agrees with journal gross.
    const dashboard = wb.getWorksheet('DB Dashboard');
    let dashGross: number | null = null;
    if (dashboard) {
      dashboard.eachRow((row) => {
        if (String(row.getCell(1).value || '').startsWith('Gross Revenue')) {
          dashGross = Number(row.getCell(2).value || 0);
        }
      });
    }
    assertTest(
      '2.7: Dashboard gross agrees with journal gross',
      dashGross !== null && totalsRowValue !== null && Math.abs(dashGross - (totalsRowValue as number)) < 0.01,
      `dashboard=${dashGross} journal=${totalsRowValue}`
    );

    // =========================================================================
    // SECTION 3: INPUT VALIDATION
    // =========================================================================
    console.log('\n--- 3. Input Validation ---');

    const badWeek = await requestRaw('/api/report-exports/executive-workbook?weekStart=not-a-date', adminToken);
    assertTest('3.1: Malformed weekStart returns 400', badWeek.status === 400, `got ${badWeek.status}`);

    const nonMonday = await requestRaw('/api/report-exports/executive-workbook?weekStart=2026-09-16', adminToken);
    assertTest('3.2: Non-Monday weekStart returns 400', nonMonday.status === 400, `got ${nonMonday.status}`);

    const badLedger = await requestRaw('/api/report-exports/transactions-ledger?from=soon&to=later', adminToken);
    assertTest('3.3: Malformed ledger range returns 400', badLedger.status === 400, `got ${badLedger.status}`);

    // =========================================================================
    // SECTION 4: TRANSACTIONS LEDGER
    // =========================================================================
    console.log('\n--- 4. Transactions Ledger ---');

    const ledgerRes = await requestRaw('/api/report-exports/transactions-ledger?from=2020-01-01&to=2030-12-31', adminToken);
    assertTest('4.1: admin receives 200 on ledger export', ledgerRes.status === 200, `got ${ledgerRes.status}`);
    const ledgerWb = new ExcelJS.Workbook();
    await ledgerWb.xlsx.load(ledgerRes.buf as any);
    assertTest('4.2: Ledger contains DB Ledger sheet', !!ledgerWb.getWorksheet('DB Ledger'));

    const ledgerWs = ledgerWb.getWorksheet('DB Ledger');
    let lSum = 0;
    let lTotal: number | null = null;
    if (ledgerWs) {
      ledgerWs.eachRow((row) => {
        const first = String(row.getCell(1).value || '');
        const totalCell = Number(row.getCell(11).value || 0);
        if (first.startsWith('TOTALS')) lTotal = totalCell;
        else if (/^(SCTI-|FCE-|STF-)/.test(first)) lSum = Math.round((lSum + totalCell) * 100) / 100;
      });
    }
    assertTest(
      '4.3: Ledger TOTALS row cross-foots with receipt lines',
      lTotal !== null && Math.abs(lTotal - lSum) < 0.01,
      `totals=${lTotal} sum=${lSum}`
    );

    const cashOnly = await requestRaw('/api/report-exports/transactions-ledger?from=2020-01-01&to=2030-12-31&paymentMethod=CASH', adminToken);
    assertTest('4.4: paymentMethod filter accepted (status 200)', cashOnly.status === 200, `got ${cashOnly.status}`);
  } finally {
    server.close();
  }

  console.log('\n=================================================');
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`📊 TEST RESULTS: ${passed}/${results.length} PASSED ${failed === 0 ? '🎉 ALL PASSED' : '❌ FAILURES'}`);
  console.log('=================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
