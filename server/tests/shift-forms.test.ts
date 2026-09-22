/**
 * server/tests/shift-forms.test.ts
 * Test suite for the printable cashier shift forms export
 * (GET /api/report-exports/shift-forms) — a separate exportable that
 * mirrors the paper Cashier Transaction Form + Shift Transfer Form.
 *
 * 1. Auth gating: 401 unauthenticated; 403 kitchen/customer_display;
 *    200 cashier/admin/owner.
 * 2. Input validation: malformed date / shift rejected with 400.
 * 3. Workbook shape: both paper-faithful sheets, 30 pre-numbered rows,
 *    TOTAL row with live SUM formulas, footer blocks.
 * 4. Data echo: a seeded receipt for the shift appears with mapped fields;
 *    ambiguous cells (Coupon/Declared/Excess) stay blank.
 * 5. Cap rule: >30 receipts truncates with warning header.
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

async function runTests() {
  console.log('\n🧾 STARTING CASHIER SHIFT FORMS EXPORT TEST SUITE\n');

  const { app } = await import('../index');

  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => resolve());
  });
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  // Snapshot rooms 4 and 5 (used as scratch) so the suite restores them.
  const snap4 = (await pool.query('SELECT * FROM rooms WHERE number = ?', ['4'])).rows[0];
  const snap5 = (await pool.query('SELECT * FROM rooms WHERE number = ?', ['5'])).rows[0];

  try {
    const adminToken = signJwt({ id: 1, username: 'admin', name: 'System Administrator', role: 'admin' }, 3600);
    const ownerToken = signJwt({ id: 9, username: 'owner', name: 'Sedona Owner', role: 'owner' }, 3600);
    const cashierToken = signJwt({ id: 2, username: 'ann', name: 'Ann (Cashier 1)', role: 'cashier' }, 3600);
    const kitchenToken = signJwt({ id: 5, username: 'kitchen1', name: 'SCTI Kitchen Staff', role: 'kitchen' }, 3600);
    const kioskToken = signJwt({ id: 9999, username: 'kiosk', name: 'Lobby Display Kiosk', role: 'customer_display' }, 3600);

    async function requestRaw(path: string, token?: string, method = 'GET', body?: any) {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      const buf = Buffer.from(await res.arrayBuffer());
      let json: any = null;
      try {
        json = JSON.parse(buf.toString('utf8'));
      } catch {
        // binary xlsx
      }
      return { status: res.status, headers: res.headers, buf, json };
    }

    const today = new Date().toISOString().slice(0, 10);
    const formsPath = `/api/report-exports/shift-forms?date=${today}&shift=DAY`;

    // =========================================================================
    // SECTION 1: AUTH GATING + VALIDATION
    // =========================================================================
    console.log('--- 1. Auth Gating + Validation ---');

    const unauth = await requestRaw(formsPath);
    assertTest('1.1: Unauthenticated request returns 401', unauth.status === 401, `got ${unauth.status}`);

    const kitchenRes = await requestRaw(formsPath, kitchenToken);
    assertTest('1.2: kitchen receives 403', kitchenRes.status === 403, `got ${kitchenRes.status}`);

    const kioskRes = await requestRaw(formsPath, kioskToken);
    assertTest('1.3: customer_display receives 403', kioskRes.status === 403, `got ${kioskRes.status}`);

    const cashierRes = await requestRaw(formsPath, cashierToken);
    assertTest('1.4: cashier receives 200', cashierRes.status === 200, `got ${cashierRes.status}`);

    const ownerRes = await requestRaw(formsPath, ownerToken);
    assertTest('1.5: owner receives 200', ownerRes.status === 200, `got ${ownerRes.status}`);

    const badDate = await requestRaw('/api/report-exports/shift-forms?date=soon&shift=DAY', adminToken);
    assertTest('1.6: Malformed date returns 400', badDate.status === 400, `got ${badDate.status}`);

    const badShift = await requestRaw(`/api/report-exports/shift-forms?date=${today}&shift=DAWN`, adminToken);
    assertTest('1.7: Invalid shift returns 400', badShift.status === 400, `got ${badShift.status}`);

    // =========================================================================
    // SECTION 2: WORKBOOK SHAPE
    // =========================================================================
    console.log('\n--- 2. Workbook Shape ---');

    const adminRes = await requestRaw(formsPath, adminToken);
    assertTest('2.1: admin receives 200', adminRes.status === 200, `got ${adminRes.status}`);
    assertTest(
      '2.2: Content-Type is spreadsheetml + DB filename',
      (adminRes.headers.get('content-type') || '').includes('spreadsheetml') &&
        (adminRes.headers.get('content-disposition') || '').includes('Sedona_Cashier_Shift_Forms_'),
      `${adminRes.headers.get('content-type')} / ${adminRes.headers.get('content-disposition')}`
    );

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(adminRes.buf as any);
    const names = wb.worksheets.map((ws) => ws.name);
    assertTest(
      '2.3: Both paper-faithful sheets present',
      names.includes('CASHIER TRANSACTION FORM') && names.includes('SHIFT TRANSFER FORM'),
      names.join(', ')
    );

    const ws1 = wb.getWorksheet('CASHIER TRANSACTION FORM');
    const title1 = String(ws1?.getCell('A1').value || '');
    assertTest('2.4: Sheet 1 title preserved', title1 === 'CASHIER TRANSACTION FORM', title1);
    // 30 pre-numbered rows (4..33)
    let numbered = 0;
    for (let r = 4; r <= 33; r++) {
      if (Number(ws1?.getCell(`A${r}`).value) === r - 3) numbered++;
    }
    assertTest('2.5: 30 pre-numbered entry rows', numbered === 30, `got ${numbered}`);
    // TOTAL row carries live SUM formulas over the entry block
    const totalFormula = String((ws1?.getCell('J34').value as any)?.formula || '');
    assertTest('2.6: TOTAL row uses live SUM formulas', totalFormula === 'SUM(J4:J33)', totalFormula);
    // Footer blocks exist
    assertTest(
      '2.7: Footer blocks (DATE/SHIFT/CASHIER/EXPENSES/REMARKS/TOTAL) present',
      ws1?.getCell('A36').value === 'DATE:' &&
        ws1?.getCell('A37').value === 'SHIFT:' &&
        ws1?.getCell('A38').value === 'CASHIER:' &&
        String(ws1?.getCell('J36').value || '').includes('EXPENSES') &&
        ws1?.getCell('P36').value === 'TOTAL:',
      'footer labels missing'
    );
    const ws2 = wb.getWorksheet('SHIFT TRANSFER FORM');
    assertTest(
      '2.8: Transfer sheet has TRANSFERRED header + FROM/TO CA footer',
      String(ws2?.getCell('J2').value || '') === 'TRANSFERRED' &&
        ws2?.getCell('A38').value === 'FROM CA:' &&
        ws2?.getCell('A39').value === 'TO CA:',
      'transfer blocks missing'
    );

    // =========================================================================
    // SECTION 3: DATA ECHO (seeded receipt)
    // =========================================================================
    console.log('\n--- 3. Data Echo ---');

    // Occupy room 4 with extras + known timestamps inside today's DAY window.
    const staffRooms = await requestRaw('/api/rooms', cashierToken);
    const staffJson: any = staffRooms.json;
    const staffRoom4 = (Array.isArray(staffJson) ? staffJson : []).find((x: any) => x.number === '4');
    const occupyRes = await requestRaw('/api/rooms/4', cashierToken, 'PUT', {
      ...staffRoom4,
      state: 'occupied',
      label: 'Form Test',
      guestName: 'Form Test Guest',
      checkInTime: `${today}T02:00:00.000Z`,
      checkOutTime: `${today}T10:00:00.000Z`,
    });
    assertTest('3.1: Setup occupy succeeds (status 200)', occupyRes.status === 200, `got ${occupyRes.status}`);

    // Direct receipt insert inside the DAY window (06:00–18:00 local wall clock).
    const receiptNo = `SCTI-FORM-${Date.now()}`;
    await pool.query(
      `INSERT INTO receipts (receipt_no, date_time, guest_name, room_number, room_type,
        payment_method, gcash_ref, cash_amount, gcash_amount, check_in, check_out,
        items, subtotal, service_charge, total, cashier_id, discount_type, discount_amount, discount_id_ref)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        receiptNo, `${today} 10:30:00`, 'Form Test Guest', '4', 'Standard Room',
        'CASH', null, 1500, null, `${today}T02:00:00.000Z`, `${today}T10:00:00.000Z`,
        JSON.stringify([
          { description: 'Standard Room Rent', subtext: '24 Hours Base Rate', amount: 1500 },
        ]),
        1500, 0, 1500, 'ann', null, 0, null,
      ]
    );

    const echoRes = await requestRaw(formsPath, cashierToken);
    const echoWb = new ExcelJS.Workbook();
    await echoWb.xlsx.load(echoRes.buf as any);
    const echoWs = echoWb.getWorksheet('CASHIER TRANSACTION FORM');
    let foundRow = 0;
    echoWs?.eachRow((row, rowNumber) => {
      if (rowNumber >= 4 && rowNumber <= 33 && String(row.getCell(2).value || '') === receiptNo) {
        foundRow = rowNumber;
      }
    });
    assertTest('3.2: Seeded receipt appears in the entry block', foundRow > 0, `receipt ${receiptNo} not found`);
    if (foundRow > 0) {
      const row = echoWs!.getRow(foundRow);
      assertTest('3.3: Room + rent mapped', String(row.getCell(3).value) === '4' && Number(row.getCell(10).value) === 1500, `C=${row.getCell(3).value} J=${row.getCell(10).value}`);
      assertTest('3.4: Payment total mapped', Number(row.getCell(18).value) === 1500, `R=${row.getCell(18).value}`);
      assertTest(
        '3.5: Ambiguous cells stay blank (Coupon/Declared/Excess)',
        (row.getCell(4).value || '') === '' && (row.getCell(7).value || '') === '' && (row.getCell(9).value || '') === '',
        `D=${row.getCell(4).value} G=${row.getCell(7).value} I=${row.getCell(9).value}`
      );
      assertTest(
        '3.6: Footer cashier echoes requesting operator',
        String(echoWs!.getCell('B38').value || '').toLowerCase() === 'ann',
        `B38=${echoWs!.getCell('B38').value}`
      );
    }

    // Cleanup seeded receipt + restore room 4.
    await pool.query('DELETE FROM receipts WHERE receipt_no = ?', [receiptNo]);
    await pool.query(
      `UPDATE rooms SET state = ?, label = ?, guest_name = ?, guest_id = ?, num_guests = ?,
        rate_selected = ?, custom_hours = ?, extra_beds = ?, towel_sets = ?,
        check_in_time = ?, check_out_time = ?, is_overdue = ?, charged_food = ?
       WHERE number = '4'`,
      [
        snap4.state, snap4.label, snap4.guest_name, snap4.guest_id, snap4.num_guests,
        snap4.rate_selected, snap4.custom_hours, snap4.extra_beds, snap4.towel_sets,
        snap4.check_in_time, snap4.check_out_time, snap4.is_overdue, snap4.charged_food,
      ]
    );

    // =========================================================================
    // SECTION 4: 30-ROW CAP
    // =========================================================================
    console.log('\n--- 4. Thirty-Row Cap ---');

    // Seed 31 receipts for room 5 inside the window.
    const stamp = Date.now();
    for (let i = 0; i < 31; i++) {
      await pool.query(
        `INSERT INTO receipts (receipt_no, date_time, guest_name, room_number, room_type,
          payment_method, cash_amount, check_in, check_out, items, subtotal, total, cashier_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `SCTI-CAP-${stamp}-${i}`, `${today} 11:${String(i % 60).padStart(2, '0')}:00`,
          'Cap Test', '5', 'Standard Room', 'CASH', 100,
          `${today}T01:00:00.000Z`, `${today}T02:00:00.000Z`,
          JSON.stringify([{ description: 'Standard Room Rent', subtext: 'x', amount: 100 }]),
          100, 100, 'ann',
        ]
      );
    }
    const capRes = await requestRaw(formsPath, cashierToken);
    const truncCount = Number(capRes.headers.get('x-export-truncated-count') || '0');
    assertTest(
      '4.1: Truncation surfaced via warning header (≥1 beyond cap)',
      truncCount >= 1,
      `header=${capRes.headers.get('x-export-truncated-count')}`
    );
    const capWb = new ExcelJS.Workbook();
    await capWb.xlsx.load(capRes.buf as any);
    const capWs = capWb.getWorksheet('CASHIER TRANSACTION FORM');
    let filledRows = 0;
    capWs?.eachRow((row, rowNumber) => {
      if (rowNumber >= 4 && rowNumber <= 33 && String(row.getCell(2).value || '').trim() !== '') filledRows++;
    });
    assertTest('4.2: Entry block holds exactly 30 rows (strict cap)', filledRows === 30, `got ${filledRows}`);

    // Cleanup seeded cap receipts + restore room 5
    await pool.query('DELETE FROM receipts WHERE receipt_no LIKE ?', [`SCTI-CAP-${stamp}-%`]);
    await pool.query(
      `UPDATE rooms SET state = ?, label = ?, guest_name = ?, guest_id = ?, num_guests = ?,
        rate_selected = ?, custom_hours = ?, extra_beds = ?, towel_sets = ?,
        check_in_time = ?, check_out_time = ?, is_overdue = ?, charged_food = ?
       WHERE number = '5'`,
      [
        snap5.state, snap5.label, snap5.guest_name, snap5.guest_id, snap5.num_guests,
        snap5.rate_selected, snap5.custom_hours, snap5.extra_beds, snap5.towel_sets,
        snap5.check_in_time, snap5.check_out_time, snap5.is_overdue, snap5.charged_food,
      ]
    );

    // =========================================================================
    // SECTION 5: TRANSFER-ONLY MODE (the handoff slip on its own)
    // =========================================================================
    console.log('\n--- 5. Transfer-Only Mode ---');

    const transferRes = await requestRaw(
      `/api/report-exports/shift-forms?date=${today}&shift=DAY&sheets=transfer`,
      cashierToken
    );
    assertTest('5.1: cashier receives 200 on transfer-only export', transferRes.status === 200, `got ${transferRes.status}`);
    assertTest(
      '5.2: Transfer-only filename used',
      (transferRes.headers.get('content-disposition') || '').includes('Sedona_Shift_Transfer_Form_'),
      transferRes.headers.get('content-disposition')
    );
    const transferWb = new ExcelJS.Workbook();
    await transferWb.xlsx.load(transferRes.buf as any);
    const transferNames = transferWb.worksheets.map((ws) => ws.name);
    assertTest(
      '5.3: Only the SHIFT TRANSFER FORM sheet is present',
      transferNames.length === 1 && transferNames[0] === 'SHIFT TRANSFER FORM',
      transferNames.join(', ')
    );
    const transferWs = transferWb.getWorksheet('SHIFT TRANSFER FORM');
    assertTest(
      '5.4: Transfer sheet keeps header + footer blocks',
      String(transferWs?.getCell('J2').value || '') === 'TRANSFERRED' &&
        transferWs?.getCell('A38').value === 'FROM CA:' &&
        transferWs?.getCell('A39').value === 'TO CA:',
      'transfer blocks missing'
    );

    const kioskTransfer = await requestRaw(
      `/api/report-exports/shift-forms?date=${today}&shift=DAY&sheets=transfer`,
      kioskToken
    );
    assertTest('5.5: customer_display still receives 403 on transfer-only', kioskTransfer.status === 403, `got ${kioskTransfer.status}`);
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
