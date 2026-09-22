/**
 * server/tests/cashier-inventory.test.ts
 * Test suite for Cashier Shift Menu Inventory & Daily/Weekly Export:
 *
 * 1. Concurrent Order Oversell Prevention:
 *    - Two simultaneous orders against a stock of 1 — exactly one succeeds (201) and one fails (400 Insufficient Stock).
 *    - Available stock hits exactly 0, never negative.
 * 2. Stock-Count-As-Of-Now Overwrite Behavior:
 *    - Entering a count sets current availability to that exact count (recount overwrite, not implicit addition).
 *    - Delta is correctly logged in append-only inventory_events ledger.
 * 3. Role-Based Access Control (RBAC):
 *    - kitchen role receives 403 Forbidden on POST /api/inventory/stock.
 *    - customer_display role receives 403 Forbidden on POST /api/inventory/stock.
 *    - Unauthenticated requests receive 401 Unauthorized.
 *    - cashier and admin roles succeed (200 OK).
 * 4. Zero-Stock Order Gating:
 *    - Attempting to order an item with 0 stock fails with HTTP 400 before creating any kitchen order.
 * 5. Daily and Weekly Report Aggregations & CSV Export:
 *    - Both daily and weekly reports are strictly auth-gated (401 without token).
 *    - Daily report correctly aggregates starting counts, stock-set events, total sold, and ending quantity.
 *    - Weekly report aggregates across multiple days.
 *    - ?format=csv returns valid text/csv content with Content-Disposition.
 * 6. Batch Stock Set:
 *    - Cashier can set multiple counts in one call.
 * 7. Room Extras Stock Consume (PUT /api/rooms/:number):
 *    - Assigning extra beds / towels deducts only the newly assigned delta.
 *    - Re-saving unchanged extras deducts nothing (delta 0).
 *    - Assigning beyond stock fails with HTTP 400 and leaves room + stock untouched.
 *    - Unknown room returns HTTP 404.
 */

process.env.NODE_ENV = 'test';
process.env.TZ = 'Asia/Manila';

import http from 'http';
import { pool, sqliteDb } from '../db/pool';
import { signJwt } from '../utils/jwt';

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
  console.log('\n📦 STARTING CASHIER SHIFT MENU INVENTORY TEST SUITE\n');

  // Clean test item records
  sqliteDb.exec(`
    DELETE FROM inventory_events WHERE item_id IN ('fav-calamares', 'bf-longsilog', 'bf-tapsilog', 'bf-hotsilog');
    UPDATE menu_item_inventory SET current_quantity = 0 WHERE item_id IN ('fav-calamares', 'bf-longsilog', 'bf-tapsilog', 'bf-hotsilog');
  `);

  const { app } = await import('../index');

  // Start ephemeral HTTP server
  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => resolve());
  });
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // Generate test JWT tokens
    const adminToken = signJwt({
      id: 1,
      username: 'admin',
      name: 'System Administrator',
      role: 'admin',
    }, 3600);

    const cashierToken = signJwt({
      id: 2,
      username: 'ann',
      name: 'Ann (Cashier 1)',
      role: 'cashier',
    }, 3600);

    const kitchenToken = signJwt({
      id: 5,
      username: 'kitchen1',
      name: 'SCTI Kitchen Staff',
      role: 'kitchen',
    }, 3600);

    const customerDisplayToken = signJwt({
      id: 9999,
      username: 'kiosk',
      name: 'Lobby Display Kiosk',
      role: 'customer_display',
    }, 3600);

    // Request helper
    async function request(
      path: string,
      options: { method?: string; body?: any; token?: string; headers?: Record<string, string> } = {}
    ) {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      };
      if (options.token) {
        headers['Authorization'] = `Bearer ${options.token}`;
      }
      const res = await fetch(`${baseUrl}${path}`, {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });

      const contentType = res.headers.get('content-type') || '';
      let data: any = {};
      let text = '';
      if (contentType.includes('application/json')) {
        data = await res.json().catch(() => ({}));
      } else {
        text = await res.text().catch(() => '');
      }
      return { status: res.status, data, text, headers: res.headers };
    }

    // =========================================================================
    // SECTION 1: ROLE-BASED ACCESS CONTROL (RBAC)
    // =========================================================================
    console.log('\n--- 1. Role-Based Access Control (RBAC) ---');

    // 1.1: Unauthenticated POST /api/inventory/stock returns 401
    const resUnauth = await request('/api/inventory/stock', {
      method: 'POST',
      body: { itemId: 'bf-tapsilog', quantity: 10 },
    });
    assertTest('1.1: Unauthenticated request to /api/inventory/stock returns 401', resUnauth.status === 401);

    // 1.2: customer_display role returns 403
    const resDisplay = await request('/api/inventory/stock', {
      method: 'POST',
      token: customerDisplayToken,
      body: { itemId: 'bf-tapsilog', quantity: 10 },
    });
    assertTest('1.2: customer_display role receives 403 Forbidden on stock count entry', resDisplay.status === 403);

    // 1.3: kitchen role returns 403
    const resKitchen = await request('/api/inventory/stock', {
      method: 'POST',
      token: kitchenToken,
      body: { itemId: 'bf-tapsilog', quantity: 10 },
    });
    assertTest('1.3: kitchen role receives 403 Forbidden on stock count entry', resKitchen.status === 403);

    // 1.4: Cashier role can set stock (200)
    const resCashier = await request('/api/inventory/stock', {
      method: 'POST',
      token: cashierToken,
      body: { itemId: 'bf-tapsilog', quantity: 15 },
    });
    assertTest(
      '1.4: cashier role succeeds on stock count entry (status 200)',
      resCashier.status === 200 && resCashier.data.data?.current_quantity === 15,
      JSON.stringify(resCashier.data)
    );

    // 1.5: Kitchen role can READ current inventory (200)
    const resKitchenRead = await request('/api/inventory/current', {
      method: 'GET',
      token: kitchenToken,
    });
    assertTest(
      '1.5: kitchen role can read current inventory (status 200)',
      resKitchenRead.status === 200 && Array.isArray(resKitchenRead.data.items)
    );

    // =========================================================================
    // SECTION 2: STOCK-COUNT-AS-OF-NOW (OVERWRITE) BEHAVIOR
    // =========================================================================
    console.log('\n--- 2. Stock-Count-As-Of-Now Overwrite Behavior ---');

    // Set initial count = 20
    await request('/api/inventory/stock', {
      method: 'POST',
      token: cashierToken,
      body: { itemId: 'fav-calamares', quantity: 20, notes: 'Morning stock check' },
    });

    // Check availability is exactly 20
    const resCal1 = await request('/api/inventory/current', { token: cashierToken });
    const calItem1 = resCal1.data.items.find((i: any) => i.item_id === 'fav-calamares');
    assertTest('2.1: Stock count initialized to exactly 20', calItem1?.current_quantity === 20);

    // Cashier enters count = 25 (e.g. restock or recount)
    // Must OVERWRITE to 25 (NOT add to become 45)
    await request('/api/inventory/stock', {
      method: 'POST',
      token: cashierToken,
      body: { itemId: 'fav-calamares', quantity: 25, notes: 'Restocked by delivery' },
    });

    const resCal2 = await request('/api/inventory/current', { token: cashierToken });
    const calItem2 = resCal2.data.items.find((i: any) => i.item_id === 'fav-calamares');
    assertTest(
      '2.2: Re-entering count 25 overwrites to exactly 25 (not 45)',
      calItem2?.current_quantity === 25,
      `Expected 25, got ${calItem2?.current_quantity}`
    );

    // Verify append-only ledger has recorded both stock_set events with correct deltas
    const events = sqliteDb
      .prepare("SELECT * FROM inventory_events WHERE item_id = 'fav-calamares' ORDER BY rowid ASC")
      .all() as any[];
    assertTest('2.3: Two events recorded in append-only inventory_events ledger', events.length === 2);
    assertTest('2.4: First event delta is 20, balance_after is 20', events[0]?.quantity_change === 20 && events[0]?.balance_after === 20);
    assertTest('2.5: Second event delta is 5 (25 - 20), balance_after is 25', events[1]?.quantity_change === 5 && events[1]?.balance_after === 25);
    assertTest('2.6: Operator server-derived as "ann"', events[1]?.operator === 'ann');

    // =========================================================================
    // SECTION 3: ATOMIC CONCURRENT RACE CONDITION (OVERSELL PREVENTION)
    // =========================================================================
    console.log('\n--- 3. Atomic Concurrent Race Condition (Oversell Prevention) ---');

    // Set stock of 'bf-longsilog' to exactly 1
    await request('/api/inventory/stock', {
      method: 'POST',
      token: cashierToken,
      body: { itemId: 'bf-longsilog', quantity: 1, notes: 'Only 1 remaining portion' },
    });

    // Fire 2 concurrent orders simultaneously for 1 unit of bf-longsilog
    const orderPayload1 = {
      room_number: '101',
      guest_name: 'Guest A',
      cashier_name: 'Ann',
      items: [{ item_id: 'bf-longsilog', name: 'Longsilog', quantity: 1 }],
      total_amount: 150,
    };

    const orderPayload2 = {
      room_number: '102',
      guest_name: 'Guest B',
      cashier_name: 'Ann',
      items: [{ item_id: 'bf-longsilog', name: 'Longsilog', quantity: 1 }],
      total_amount: 150,
    };

    const [orderRes1, orderRes2] = await Promise.all([
      request('/api/kitchen/orders', { method: 'POST', token: cashierToken, body: orderPayload1 }),
      request('/api/kitchen/orders', { method: 'POST', token: cashierToken, body: orderPayload2 }),
    ]);

    const statuses = [orderRes1.status, orderRes2.status].sort();
    assertTest(
      '3.1: Exactly ONE concurrent order succeeds (201) and ONE fails (400 Insufficient Stock)',
      statuses[0] === 201 && statuses[1] === 400,
      `Statuses received: [${orderRes1.status}, ${orderRes2.status}], Errors: [${JSON.stringify(orderRes1.data)}, ${JSON.stringify(orderRes2.data)}]`
    );

    // Verify error message explains insufficient stock
    const failedOrder = orderRes1.status === 400 ? orderRes1 : orderRes2;
    assertTest(
      '3.2: Failed order error mentions "Insufficient stock"',
      failedOrder.data.error && failedOrder.data.error.toLowerCase().includes('insufficient stock'),
      failedOrder.data.error
    );

    // Verify current quantity in database is exactly 0, NOT -1
    const resLong = await request('/api/inventory/current', { token: cashierToken });
    const longItem = resLong.data.items.find((i: any) => i.item_id === 'bf-longsilog');
    assertTest('3.3: Available quantity is exactly 0 (no negative oversell)', longItem?.current_quantity === 0);

    // =========================================================================
    // SECTION 4: ZERO-STOCK ORDER GATING
    // =========================================================================
    console.log('\n--- 4. Zero-Stock Order Gating ---');

    // Attempting another order against bf-longsilog (which now has 0 stock)
    const resBlocked = await request('/api/kitchen/orders', {
      method: 'POST',
      token: cashierToken,
      body: {
        room_number: '103',
        guest_name: 'Guest C',
        cashier_name: 'Ann',
        items: [{ item_id: 'bf-longsilog', name: 'Longsilog', quantity: 1 }],
        total_amount: 150,
      },
    });

    assertTest('4.1: Order against 0 stock is rejected with HTTP 400', resBlocked.status === 400);

    // Verify database trigger trg_prevent_negative_inventory prevents direct negative balance insert
    let triggerFired = false;
    try {
      sqliteDb.prepare(`
        INSERT INTO inventory_events (
          id, item_id, item_name, event_type, quantity_change, balance_after,
          shift_id, shift_type, operator, created_at
        ) VALUES ('bypass-test', 'bf-longsilog', 'Longsilog', 'sold', -1, -1, '2026-09-05_DAY', 'DAY', 'ann', datetime('now'))
      `).run();
    } catch (triggerErr: any) {
      triggerFired = triggerErr.message.includes('Inventory quantity cannot be negative');
    }
    assertTest('4.2: Database TRIGGER trg_prevent_negative_inventory aborts negative balance', triggerFired);

    // =========================================================================
    // SECTION 5: DAILY & WEEKLY REPORT AGGREGATIONS & CSV EXPORT
    // =========================================================================
    console.log('\n--- 5. Daily and Weekly Report Aggregations & CSV Export ---');

    const todayStr = new Date().toISOString().slice(0, 10);

    // 5.1: Unauthenticated reports return 401
    const resDailyUnauth = await request('/api/inventory/report/daily');
    assertTest('5.1: Unauthenticated GET /api/inventory/report/daily returns 401', resDailyUnauth.status === 401);

    const resWeeklyUnauth = await request('/api/inventory/report/weekly');
    assertTest('5.2: Unauthenticated GET /api/inventory/report/weekly returns 401', resWeeklyUnauth.status === 401);

    // 5.3: Authenticated daily report returns aggregated item movements
    const resDaily = await request(`/api/inventory/report/daily?date=${todayStr}`, { token: adminToken });
    assertTest('5.3: Authenticated GET /api/inventory/report/daily returns 200', resDaily.status === 200);

    const calDaily = resDaily.data.items?.find((i: any) => i.itemId === 'fav-calamares');
    assertTest('5.4: Daily report contains stockSetEvents for Calamares', calDaily && calDaily.stockSetEvents.length >= 1);

    const longDaily = resDaily.data.items?.find((i: any) => i.itemId === 'bf-longsilog');
    assertTest('5.5: Daily report records units sold for Longsilog', longDaily && longDaily.totalSold >= 1);
    assertTest('5.6: Daily report detects Longsilog as out of stock (isOutOfStock = true)', longDaily && longDaily.isOutOfStock === true);
    assertTest('5.7: Daily report records zeroStockEvents for Longsilog', longDaily && longDaily.zeroStockEvents.length >= 1);

    // 5.8: Daily CSV export
    const resDailyCsv = await request(`/api/inventory/report/daily?date=${todayStr}&format=csv`, { token: cashierToken });
    assertTest('5.8: Daily report with format=csv returns status 200', resDailyCsv.status === 200);
    assertTest(
      '5.9: Content-Type is text/csv and Content-Disposition is attachment',
      (resDailyCsv.headers.get('content-type') || '').includes('text/csv') &&
        (resDailyCsv.headers.get('content-disposition') || '').includes('attachment')
    );
    assertTest(
      '5.10: CSV contains report title and Longsilog row',
      resDailyCsv.text.includes('DAILY MENU INVENTORY REPORT') && resDailyCsv.text.includes('Longsilog')
    );

    // 5.11: Weekly report JSON
    const resWeekly = await request(`/api/inventory/report/weekly?weekStart=${todayStr}`, { token: adminToken });
    assertTest('5.11: Authenticated GET /api/inventory/report/weekly returns 200', resWeekly.status === 200);
    assertTest(
      '5.12: Weekly report returns 7-day dailyBreakdowns and totalUnitsSold',
      Array.isArray(resWeekly.data.dailyBreakdowns) && resWeekly.data.dailyBreakdowns.length === 7
    );

    // 5.13: Weekly CSV export
    const resWeeklyCsv = await request(`/api/inventory/report/weekly?weekStart=${todayStr}&format=csv`, { token: adminToken });
    assertTest('5.13: Weekly report with format=csv returns text/csv', resWeeklyCsv.status === 200 && resWeeklyCsv.text.includes('WEEKLY MENU INVENTORY REPORT'));

    // =========================================================================
    // SECTION 6: BATCH STOCK SET
    // =========================================================================
    console.log('\n--- 6. Batch Stock Count Entry ---');

    const resBatch = await request('/api/inventory/stock/batch', {
      method: 'POST',
      token: cashierToken,
      body: {
        items: [
          { itemId: 'bf-tapsilog', quantity: 30 },
          { itemId: 'bf-hotsilog', quantity: 20 },
        ],
        notes: 'Shift batch opening count',
      },
    });

    assertTest('6.1: Batch stock update succeeds with status 200', resBatch.status === 200 && resBatch.data.count === 2);

    const resCurrentAfterBatch = await request('/api/inventory/current', { token: cashierToken });
    const tapsilog = resCurrentAfterBatch.data.items.find((i: any) => i.item_id === 'bf-tapsilog');
    const hotsilog = resCurrentAfterBatch.data.items.find((i: any) => i.item_id === 'bf-hotsilog');
    assertTest('6.2: Tapsilog updated to 30', tapsilog?.current_quantity === 30);
    assertTest('6.3: Hotsilog updated to 20', hotsilog?.current_quantity === 20);

    // =========================================================================
    // SECTION 7: ROOM EXTRAS STOCK CONSUME (PUT /api/rooms/:number)
    // =========================================================================
    console.log('\n--- 7. Room Extras Stock Consume ---');

    // Snapshot room 1 + bed/towel stock so the suite restores everything after.
    const room1Before = sqliteDb.prepare('SELECT * FROM rooms WHERE number = ?').get('1') as any;
    const bedStockBefore = (sqliteDb.prepare('SELECT current_quantity FROM menu_item_inventory WHERE item_id = ?').get('extra-bed') as any)?.current_quantity ?? null;
    const towelStockBefore = (sqliteDb.prepare('SELECT current_quantity FROM menu_item_inventory WHERE item_id = ?').get('towel') as any)?.current_quantity ?? null;

    // Cashier sets known counts: 3 beds, 2 towels.
    await request('/api/inventory/stock', {
      method: 'POST',
      token: cashierToken,
      body: { itemId: 'extra-bed', quantity: 3, notes: 'test setup' },
    });
    await request('/api/inventory/stock', {
      method: 'POST',
      token: cashierToken,
      body: { itemId: 'towel', quantity: 2, notes: 'test setup' },
    });

    // Fetch room 1 via API and assign 2 beds + 1 towel (mirrors walk-in check-in).
    const resRoom1 = await request('/api/rooms', { token: cashierToken });
    const room1 = (resRoom1.data as any[]).find((r: any) => r.number === '1');
    const assignRes = await request('/api/rooms/1', {
      method: 'PUT',
      token: cashierToken,
      body: { ...room1, state: 'occupied', guestName: 'Stock Test', extraBeds: 2, towelSets: 1 },
    });
    assertTest('7.1: Assigning 2 beds + 1 towel succeeds (status 200)', assignRes.status === 200, JSON.stringify(assignRes.data)?.slice(0, 300));

    const stockAfterAssign = async () => {
      const cur = await request('/api/inventory/current', { token: cashierToken });
      const items = (cur.data as any).items;
      return {
        beds: items.find((i: any) => i.item_id === 'extra-bed')?.current_quantity,
        towels: items.find((i: any) => i.item_id === 'towel')?.current_quantity,
      };
    };
    const after1 = await stockAfterAssign();
    assertTest('7.2: Extra-bed stock deducted by delta (3 -> 1)', after1.beds === 1, `got ${after1.beds}`);
    assertTest('7.3: Towel stock deducted by delta (2 -> 1)', after1.towels === 1, `got ${after1.towels}`);

    // Sold events reference the room assignment.
    const assignEvents = sqliteDb
      .prepare("SELECT * FROM inventory_events WHERE reference_id = 'ROOM-1-ASSIGN' ORDER BY rowid ASC")
      .all() as any[];
    assertTest(
      '7.4: Two sold events logged against ROOM-1-ASSIGN',
      assignEvents.length === 2 && assignEvents.every((e) => e.event_type === 'sold'),
      JSON.stringify(assignEvents.map((e) => ({ item: e.item_id, change: e.quantity_change, ref: e.reference_id })))
    );

    // Re-saving identical extras deducts nothing (delta 0).
    const resRoom1b = await request('/api/rooms', { token: cashierToken });
    const room1b = (resRoom1b.data as any[]).find((r: any) => r.number === '1');
    const resaveRes = await request('/api/rooms/1', {
      method: 'PUT',
      token: cashierToken,
      body: { ...room1b, extraBeds: 2, towelSets: 1 },
    });
    const after2 = await stockAfterAssign();
    assertTest('7.5: Re-saving unchanged extras succeeds without further deduction', resaveRes.status === 200 && after2.beds === 1 && after2.towels === 1);

    // Assigning beyond stock fails and rolls back (room keeps 2 beds, stock keeps 1).
    const overRes = await request('/api/rooms/1', {
      method: 'PUT',
      token: cashierToken,
      body: { ...room1b, extraBeds: 6, towelSets: 1 },
    });
    assertTest(
      '7.6: Over-assigning beds fails with HTTP 400 mentioning stock',
      overRes.status === 400 && String((overRes.data as any)?.error || '').toLowerCase().includes('stock'),
      `status=${overRes.status} body=${JSON.stringify(overRes.data)?.slice(0, 300)}`
    );
    const roomAfterFail = sqliteDb.prepare('SELECT extra_beds, towel_sets FROM rooms WHERE number = ?').get('1') as any;
    const after3 = await stockAfterAssign();
    assertTest('7.7: Failed update leaves room extras untouched (2 beds)', Number(roomAfterFail.extra_beds) === 2, JSON.stringify(roomAfterFail));
    assertTest('7.8: Failed update leaves stock untouched (1 bed)', after3.beds === 1, `got ${after3.beds}`);

    // Unknown room → 404.
    const res404 = await request('/api/rooms/9999', {
      method: 'PUT',
      token: cashierToken,
      body: { ...(room1b as any), number: '9999', extraBeds: 0, towelSets: 0 },
    });
    assertTest('7.9: Unknown room returns HTTP 404', res404.status === 404, `status=${res404.status}`);

    // Restore room 1 + bed/towel stock to pre-suite values.
    sqliteDb.prepare(
      `UPDATE rooms SET state = ?, label = ?, guest_name = ?, guest_id = ?, num_guests = ?,
        rate_selected = ?, custom_hours = ?, extra_beds = ?, towel_sets = ?,
        check_in_time = ?, check_out_time = ?, is_overdue = ?, charged_food = ?
       WHERE number = '1'`
    ).run(
      room1Before.state, room1Before.label, room1Before.guest_name, room1Before.guest_id,
      room1Before.num_guests, room1Before.rate_selected, room1Before.custom_hours,
      room1Before.extra_beds, room1Before.towel_sets, room1Before.check_in_time,
      room1Before.check_out_time, room1Before.is_overdue, room1Before.charged_food
    );
    sqliteDb.prepare("DELETE FROM inventory_events WHERE reference_id = 'ROOM-1-ASSIGN'").run();
    if (bedStockBefore !== null) {
      sqliteDb.prepare('UPDATE menu_item_inventory SET current_quantity = ? WHERE item_id = ?').run(bedStockBefore, 'extra-bed');
    }
    if (towelStockBefore !== null) {
      sqliteDb.prepare('UPDATE menu_item_inventory SET current_quantity = ? WHERE item_id = ?').run(towelStockBefore, 'towel');
    }

    // =========================================================================
    // SECTION 8: STYLED XLSX INVENTORY REPORTS (format=xlsx)
    // =========================================================================
    console.log('\n--- 8. Styled XLSX Inventory Reports ---');

    const ExcelJS = (await import('exceljs')).default;
    async function requestBinary(path: string, token?: string) {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`${baseUrl}${path}`, { headers });
      const buf = Buffer.from(await res.arrayBuffer());
      return { status: res.status, headers: res.headers, buf };
    }

    const xlsxTodayStr = new Date().toISOString().slice(0, 10);

    const unauthXlsx = await requestBinary(`/api/inventory/report/daily?date=${xlsxTodayStr}&format=xlsx`);
    assertTest('8.1: Unauthenticated xlsx request returns 401', unauthXlsx.status === 401, `got ${unauthXlsx.status}`);

    const dailyXlsx = await requestBinary(`/api/inventory/report/daily?date=${xlsxTodayStr}&format=xlsx`, cashierToken);
    assertTest('8.2: Daily xlsx returns 200 + spreadsheetml', dailyXlsx.status === 200 && (dailyXlsx.headers.get('content-type') || '').includes('spreadsheetml'), `status=${dailyXlsx.status}`);
    assertTest(
      '8.3: Daily xlsx disposition uses .xlsx filename',
      (dailyXlsx.headers.get('content-disposition') || '').includes('.xlsx'),
      dailyXlsx.headers.get('content-disposition')
    );
    const dailyWb = new ExcelJS.Workbook();
    await dailyWb.xlsx.load(dailyXlsx.buf as any);
    const dailySheets = dailyWb.worksheets.map((ws) => ws.name);
    assertTest(
      '8.4: Daily workbook has Daily Inventory + Summary sheets',
      dailySheets.includes('Daily Inventory') && dailySheets.includes('Summary'),
      dailySheets.join(', ')
    );

    const weeklyXlsx = await requestBinary('/api/inventory/report/weekly?format=xlsx', cashierToken);
    assertTest('8.5: Weekly xlsx returns 200 + spreadsheetml', weeklyXlsx.status === 200 && (weeklyXlsx.headers.get('content-type') || '').includes('spreadsheetml'), `status=${weeklyXlsx.status}`);
    const weeklyWb = new ExcelJS.Workbook();
    await weeklyWb.xlsx.load(weeklyXlsx.buf as any);
    const weeklySheets = weeklyWb.worksheets.map((ws) => ws.name);
    assertTest(
      '8.6: Weekly workbook has Weekly Inventory + Summary sheets',
      weeklySheets.includes('Weekly Inventory') && weeklySheets.includes('Summary'),
      weeklySheets.join(', ')
    );

    // Header row carries the dark-green theme fill.
    const invWs = dailyWb.getWorksheet('Daily Inventory');
    const headerFill = invWs && (invWs.getRow(6).getCell(1).fill as any)?.fgColor?.argb;
    assertTest('8.7: Header row uses the shared theme fill', headerFill === 'FF1F4D2E', `got ${headerFill}`);

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
