/**
 * server/tests/kitchen-printer.test.ts
 * Test suite verifying thermal kitchen ticket printing behavior:
 *
 * 1. Non-blocking order creation under printer failure (201 returned immediately).
 * 2. Background retry worker transitions to 'failed' with visible error.
 * 3. Idempotency guard prevents duplicate prints on replayed creation calls.
 * 4. RBAC on reprint endpoint (401 unauth, 403 customer_display, 200 staff).
 * 5. Successful print simulation against local mock TCP server (verifying ESC/POS bytes).
 * 6. In-flight print double-click serialization guard.
 */

process.env.NODE_ENV = 'test';
process.env.TZ = 'Asia/Manila';

import http from 'http';
import net from 'net';
import { pool } from '../db/pool';
import { signJwt } from '../utils/jwt';
import { setPrinterConfig, kitchenPrinterService, formatTicketBytes } from '../services/kitchen-printer';

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
  console.log('\n🖨️ STARTING KITCHEN THERMAL PRINTER TEST SUITE\n');

  const { app } = await import('../index');
  const server = http.createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, () => resolve());
  });

  const port = (server.address() as any).port;

  async function request(urlPath: string, options: { method?: string; token?: string; body?: any } = {}) {
    const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const text = await res.text();
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, data };
  }

  // Generate tokens
  const cashierToken = signJwt({ id: 2, username: 'ann', role: 'cashier', name: 'Ann Cashier' });
  const kitchenToken = signJwt({ id: 10, username: 'kitchen1', role: 'kitchen', name: 'SCTI Kitchen Staff' });
  const adminToken = signJwt({ id: 1, username: 'admin', role: 'admin', name: 'System Admin' });
  const customerDisplayToken = signJwt({ id: 9999, username: 'kiosk', role: 'customer_display', name: 'Lobby Display Kiosk' });

  try {
    // -------------------------------------------------------------
    // SECTION 1: NON-BLOCKING ORDER CREATION UNDER PRINTER FAILURE
    // -------------------------------------------------------------
    console.log('--- 1. Non-Blocking Order Creation Under Printer Failure ---');

    // Configure printer to unreachable loopback port with fast timeout
    setPrinterConfig({
      ip: '127.0.0.1',
      port: 59990, // Unused port where nothing is listening
      enabled: true,
      timeoutMs: 300,
      maxRetries: 2,
    });

    const startTime = Date.now();
    const createOrderRes = await request('/api/kitchen/orders', {
      method: 'POST',
      token: cashierToken,
      body: {
        room_number: '101',
        guest_name: 'Test Printing Guest',
        cashier_name: 'ann',
        items: [
          { item_id: 'menu_tapsilog', name: 'Tapsilog Special', quantity: 2, special_instructions: 'Egg well done' },
          { item_id: 'menu_iced_tea', name: 'House Iced Tea', quantity: 1 },
        ],
        total_amount: 350.00,
        priority: 'normal',
      },
    });
    const durationMs = Date.now() - startTime;

    assertTest(
      '1.1: Order creation responds immediately (< 500ms) without waiting for printer',
      durationMs < 500,
      `Duration was ${durationMs}ms`
    );

    assertTest(
      '1.2: Order creation returns HTTP 201 Created and persists order',
      createOrderRes.status === 201 && !!createOrderRes.data?.order_number,
      `Status: ${createOrderRes.status}`
    );

    const createdOrderId = createOrderRes.data?.id;

    // Verify order exists in DB with print_status = 'pending' (no automatic print)
    const dbOrderRes = await pool.query('SELECT * FROM kitchen_orders WHERE id = ?', [createdOrderId]);
    assertTest(
      '1.3: Order is committed to SQLite with print_status = "pending" (no auto-print)',
      dbOrderRes.rows.length === 1 && dbOrderRes.rows[0].print_status === 'pending',
      `Status: ${dbOrderRes.rows[0]?.print_status}`
    );

    // -------------------------------------------------------------
    // SECTION 2: MANUAL CASHIER PRINT TRIGGER & BACKGROUND RETRY
    // -------------------------------------------------------------
    console.log('\n--- 2. Manual Cashier Print Trigger & Visible Failure State ---');

    // Cashier explicitly clicks button to print kitchen ticket
    const cashierPrintRes = await request(`/api/kitchen/orders/${createdOrderId}/print`, {
      method: 'POST',
      token: cashierToken,
    });
    assertTest(
      '2.0: Cashier manually triggers kitchen print button (status 200)',
      cashierPrintRes.status === 200 && cashierPrintRes.data?.success === true,
      `Status: ${cashierPrintRes.status}, Body: ${JSON.stringify(cashierPrintRes.data)}`
    );

    // Wait for the background worker to finish retries (2 retries * (timeout + backoff) ≈ 1000ms)
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const updatedDbOrder = await pool.query('SELECT print_status, print_attempts, print_error FROM kitchen_orders WHERE id = ?', [createdOrderId]);
    const row = updatedDbOrder.rows[0];

    assertTest(
      '2.1: print_status transitions to "failed" after retries are exhausted',
      row?.print_status === 'failed',
      `Expected 'failed', got '${row?.print_status}'`
    );

    assertTest(
      '2.2: print_attempts recorded at max retries (2)',
      row?.print_attempts === 2,
      `Expected 2, got ${row?.print_attempts}`
    );

    assertTest(
      '2.3: print_error records failure details (connection refused / timeout)',
      typeof row?.print_error === 'string' && row.print_error.length > 0,
      `print_error: ${row?.print_error}`
    );

    // -------------------------------------------------------------
    // SECTION 3: IDEMPOTENCY GUARD (NO DUPLICATE PRINTS ON REPLAY)
    // -------------------------------------------------------------
    console.log('\n--- 3. Idempotency Guard (No Duplicate Prints on Replay) ---');

    // Attempting a second automatic print on an order that is no longer 'pending'
    const duplicatePrintRes = await kitchenPrinterService.printKitchenTicket(createOrderRes.data, false);

    assertTest(
      '3.1: Automatic print call on already processed order returns success: false',
      duplicatePrintRes.success === false,
      `Result: ${JSON.stringify(duplicatePrintRes)}`
    );

    // -------------------------------------------------------------
    // SECTION 4: RBAC ON REPRINT ENDPOINT
    // -------------------------------------------------------------
    console.log('\n--- 4. RBAC on POST /api/kitchen/orders/:id/reprint ---');

    const unauthReprint = await request(`/api/kitchen/orders/${createdOrderId}/reprint`, {
      method: 'POST',
    });
    assertTest(
      '4.1: Unauthenticated request receives 401 Unauthorized',
      unauthReprint.status === 401,
      `Status: ${unauthReprint.status}`
    );

    const customerDisplayReprint = await request(`/api/kitchen/orders/${createdOrderId}/reprint`, {
      method: 'POST',
      token: customerDisplayToken,
    });
    assertTest(
      '4.2: customer_display role receives 403 Forbidden',
      customerDisplayReprint.status === 403,
      `Status: ${customerDisplayReprint.status}`
    );

    const kitchenReprint = await request(`/api/kitchen/orders/${createdOrderId}/reprint`, {
      method: 'POST',
      token: kitchenToken,
    });
    assertTest(
      '4.3: kitchen staff token is authorized to reprint (status 200)',
      kitchenReprint.status === 200,
      `Status: ${kitchenReprint.status}`
    );

    const cashierReprint = await request(`/api/kitchen/orders/${createdOrderId}/reprint`, {
      method: 'POST',
      token: cashierToken,
    });
    assertTest(
      '4.4: cashier token is authorized to reprint (status 200)',
      cashierReprint.status === 200,
      `Status: ${cashierReprint.status}`
    );

    const adminReprint = await request(`/api/kitchen/orders/${createdOrderId}/reprint`, {
      method: 'POST',
      token: adminToken,
    });
    assertTest(
      '4.5: admin token is authorized to reprint (status 200)',
      adminReprint.status === 200,
      `Status: ${adminReprint.status}`
    );

    // -------------------------------------------------------------
    // SECTION 5: SUCCESSFUL THERMAL PRINT TO MOCK TCP SERVER
    // -------------------------------------------------------------
    console.log('\n--- 5. Successful Thermal Print to Mock TCP Server ---');

    // Wait for any prior section retries to settle completely
    await new Promise((resolve) => setTimeout(resolve, 1200));

    let receivedBytes: Buffer = Buffer.alloc(0);
    const mockTcpServer = net.createServer((socket) => {
      socket.on('data', (chunk) => {
        receivedBytes = Buffer.concat([receivedBytes, chunk]);
      });
      socket.on('end', () => {
        socket.end();
      });
    });

    const mockPort = await new Promise<number>((resolve) => {
      mockTcpServer.listen(0, '127.0.0.1', () => {
        resolve((mockTcpServer.address() as any).port);
      });
    });

    // Point printer to the active mock TCP server
    setPrinterConfig({
      ip: '127.0.0.1',
      port: mockPort,
      enabled: true,
      timeoutMs: 1000,
      maxRetries: 2,
    });

    // Create a fresh test order to print
    const successOrderRes = await request('/api/kitchen/orders', {
      method: 'POST',
      token: cashierToken,
      body: {
        room_number: '205',
        guest_name: 'Successful Print Guest',
        cashier_name: 'ann',
        items: [
          { item_id: 'menu_pancit', name: 'Pancit Canton Special', quantity: 1, special_instructions: 'Less oil' },
        ],
        total_amount: 220.00,
        priority: 'urgent',
      },
    });

    const successOrderId = successOrderRes.data?.id;

    // Cashier explicitly triggers "Print Ticket" button
    const triggerSuccessPrint = await request(`/api/kitchen/orders/${successOrderId}/print`, {
      method: 'POST',
      token: cashierToken,
    });
    assertTest(
      '5.0: Cashier manually triggers kitchen print button for order (status 200)',
      triggerSuccessPrint.status === 200 && triggerSuccessPrint.data?.success === true,
      `Status: ${triggerSuccessPrint.status}`
    );

    // Wait for the mock printer to receive bytes
    await new Promise((resolve) => setTimeout(resolve, 800));

    assertTest(
      '5.1: Mock TCP thermal printer received bytes',
      receivedBytes.length > 0,
      `Received ${receivedBytes.length} bytes`
    );

    const receivedText = receivedBytes.toString('utf8');
    assertTest(
      '5.2: Ticket content contains Room #, Order #, Item, and Instructions',
      receivedText.includes('ROOM 205') &&
      receivedText.includes(successOrderRes.data?.order_number) &&
      receivedText.includes('Pancit Canton Special') &&
      receivedText.includes('Less oil'),
      `Text received snippet: ${receivedText.slice(0, 150)}`
    );

    const successDbOrder = await pool.query('SELECT print_status, printed_at, print_error FROM kitchen_orders WHERE id = ?', [successOrderId]);
    const successRow = successDbOrder.rows[0];

    assertTest(
      '5.3: print_status transitions to "printed" and printed_at timestamp is populated',
      successRow?.print_status === 'printed' && !!successRow?.printed_at && successRow?.print_error === null,
      `print_status: ${successRow?.print_status}, printed_at: ${successRow?.printed_at}`
    );

    mockTcpServer.close();

    // -------------------------------------------------------------
    // SECTION 6: IN-FLIGHT PRINT DOUBLE-CLICK SERIALIZATION GUARD
    // -------------------------------------------------------------
    console.log('\n--- 6. In-Flight Print Double-Click Serialization Guard ---');

    // Create a slow mock TCP server that delays connection/read
    const slowTcpServer = net.createServer((socket) => {
      // Don't close immediately, hold socket open
      setTimeout(() => socket.end(), 1000);
    });

    const slowPort = await new Promise<number>((resolve) => {
      slowTcpServer.listen(0, '127.0.0.1', () => {
        resolve((slowTcpServer.address() as any).port);
      });
    });

    setPrinterConfig({
      ip: '127.0.0.1',
      port: slowPort,
      enabled: true,
      timeoutMs: 3000,
      maxRetries: 1,
    });

    // Trigger reprint 1
    const firstReprintPromise = kitchenPrinterService.printKitchenTicket(successOrderRes.data, true);
    // Immediately attempt trigger reprint 2 while 1 is in-flight ('printing')
    const secondReprintRes = await kitchenPrinterService.printKitchenTicket(successOrderRes.data, true);

    assertTest(
      '6.1: Rapid second reprint while in flight is safely guarded (success: false)',
      secondReprintRes.success === false,
      `Second reprint returned: ${JSON.stringify(secondReprintRes)}`
    );

    await firstReprintPromise;
    slowTcpServer.close();

  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      await pool.end();
    } catch (_) {}
  }

  // Summary
  console.log('\n=================================================');
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = total - passed;
  console.log(`📊 TEST RESULTS: ${passed}/${total} PASSED ${failed > 0 ? `(${failed} FAILED)` : '🎉 ALL PASSED'}`);
  console.log('=================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
