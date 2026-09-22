/**
 * server/tests/kitchen-queue-timer.test.ts
 * Comprehensive test suite verifying that the kitchen queue timer is exactly 30 minutes:
 * 1. Fresh order has 30 minutes remaining (1800s countdown, timer_duration_minutes = 30).
 * 2. 10-minute old order has 20 minutes remaining and 'normal' urgency.
 * 3. 25-minute old order has 5 minutes remaining and 'warning' urgency.
 * 4. 28-minute old order has 2 minutes remaining and 'critical' urgency.
 * 5. Orders older than 30 minutes auto-expire and are removed from the active queue.
 * 6. GET /api/kitchen/queue and GET /api/kitchen/tv/display return correct 30-minute timer data.
 */

process.env.NODE_ENV = 'test';
process.env.TZ = 'Asia/Manila';

import http from 'http';
import { pool, sqliteDb } from '../db/pool';
import { signJwt } from '../utils/jwt';
import { kitchenOrderService } from '../services/kitchen-orders';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function assertTest(name: string, condition: boolean, details?: string) {
  results.push({ name, passed: condition, error: details });
  const icon = condition ? '✅' : '❌';
  console.log(`${icon} ${name}${!condition && details ? ` — FAILED: ${details}` : ''}`);
}

async function runKitchenTimerTests() {
  console.log('\n⏱️  STARTING KITCHEN QUEUE 30-MINUTE TIMER TEST SUITE\n');

  // Start dedicated HTTP test server on ephemeral port
  const { app } = await import('../index');
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const kitchenToken = signJwt({
    id: 10,
    username: 'kitchen_test',
    name: 'Kitchen Staff',
    role: 'kitchen',
  });

  try {
    // Clean up kitchen orders from test rooms (Room 101, 102, 103, 104, 105)
    const testRooms = ['101', '102', '103', '104', '105'];
    for (const r of testRooms) {
      sqliteDb.prepare('DELETE FROM kitchen_orders WHERE room_number = ?').run(r);
    }
    sqliteDb.prepare("UPDATE menu_item_inventory SET current_quantity = 50 WHERE item_id = 'bf-tapsilog'").run();

    // --- 1. Create a Fresh Order (T-0) ---
    console.log('--- 1. Fresh Order (0 mins old -> 30 mins remaining) ---');
    await kitchenOrderService.createOrder({
      room_number: '101',
      guest_name: 'Fresh Guest',
      cashier_name: 'Cashier Test',
      items: [{ item_id: 'bf-tapsilog', name: 'Tapsilog', quantity: 1 }],
      total_amount: 160,
    });

    const queue1 = await kitchenOrderService.getRoomQueue();
    const group101 = queue1.find(q => q.room_number === '101');

    assertTest('1.1: Fresh order exists in room queue', Boolean(group101));
    assertTest(
      '1.2: Timer duration is exactly 30 minutes',
      group101?.timer_duration_minutes === 30,
      `Got ${group101?.timer_duration_minutes}`
    );
    assertTest(
      '1.3: Fresh order seconds remaining is ~1800s (29-30 mins)',
      Boolean(group101 && group101.seconds_remaining && group101.seconds_remaining >= 1790 && group101.seconds_remaining <= 1800),
      `Got ${group101?.seconds_remaining}s`
    );
    assertTest('1.4: Fresh order minutes remaining is 30', group101?.minutes_remaining === 30, `Got ${group101?.minutes_remaining}`);
    assertTest('1.5: Fresh order urgency is "normal"', group101?.urgency === 'normal', `Got ${group101?.urgency}`);

    // --- 2. Order Placed 10 Minutes Ago (T-10m) ---
    console.log('\n--- 2. Order Placed 10 Minutes Ago (10 mins old -> 20 mins remaining) ---');
    const order10mAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    sqliteDb.prepare(`
      INSERT INTO kitchen_orders (
        order_number, room_number, guest_name, cashier_name,
        items, total_items, total_amount, status, priority,
        ordered_at, created_at, updated_at
      ) VALUES ('K-10M', '102', '10m Guest', 'Cashier Test', '[]', 1, 150, 'new', 'normal', ?, ?, ?)
    `).run(order10mAgo, order10mAgo, order10mAgo);

    const queue2 = await kitchenOrderService.getRoomQueue();
    const group102 = queue2.find(q => q.room_number === '102');

    assertTest('2.1: 10m-old order exists in queue', Boolean(group102));
    assertTest('2.2: 10m-old order minutes elapsed is 10', group102?.minutes_elapsed === 10, `Got ${group102?.minutes_elapsed}`);
    assertTest(
      '2.3: 10m-old order seconds remaining is ~1200s (19-20 mins)',
      Boolean(group102 && group102.seconds_remaining && group102.seconds_remaining >= 1190 && group102.seconds_remaining <= 1210),
      `Got ${group102?.seconds_remaining}s`
    );
    assertTest('2.4: 10m-old order minutes remaining is 20', group102?.minutes_remaining === 20, `Got ${group102?.minutes_remaining}`);
    assertTest('2.5: 10m-old order urgency is "normal"', group102?.urgency === 'normal', `Got ${group102?.urgency}`);

    // --- 3. Order Placed 25 Minutes Ago (T-25m -> Warning Urgency) ---
    console.log('\n--- 3. Order Placed 25 Minutes Ago (25 mins old -> 5 mins remaining, Warning) ---');
    const order25mAgo = new Date(Date.now() - 25 * 60 * 1000).toISOString();
    sqliteDb.prepare(`
      INSERT INTO kitchen_orders (
        order_number, room_number, guest_name, cashier_name,
        items, total_items, total_amount, status, priority,
        ordered_at, created_at, updated_at
      ) VALUES ('K-25M', '103', '25m Guest', 'Cashier Test', '[]', 1, 150, 'new', 'normal', ?, ?, ?)
    `).run(order25mAgo, order25mAgo, order25mAgo);

    const queue3 = await kitchenOrderService.getRoomQueue();
    const group103 = queue3.find(q => q.room_number === '103');

    assertTest('3.1: 25m-old order exists in queue', Boolean(group103));
    assertTest(
      '3.2: 25m-old order seconds remaining is ~300s (4-5 mins)',
      Boolean(group103 && group103.seconds_remaining && group103.seconds_remaining >= 290 && group103.seconds_remaining <= 310),
      `Got ${group103?.seconds_remaining}s`
    );
    assertTest('3.3: 25m-old order urgency transitions to "warning"', group103?.urgency === 'warning', `Got ${group103?.urgency}`);

    // --- 4. Order Placed 28 Minutes Ago (T-28m -> Critical Urgency) ---
    console.log('\n--- 4. Order Placed 28 Minutes Ago (28 mins old -> 2 mins remaining, Critical) ---');
    const order28mAgo = new Date(Date.now() - 28 * 60 * 1000).toISOString();
    sqliteDb.prepare(`
      INSERT INTO kitchen_orders (
        order_number, room_number, guest_name, cashier_name,
        items, total_items, total_amount, status, priority,
        ordered_at, created_at, updated_at
      ) VALUES ('K-28M', '104', '28m Guest', 'Cashier Test', '[]', 1, 150, 'new', 'normal', ?, ?, ?)
    `).run(order28mAgo, order28mAgo, order28mAgo);

    const queue4 = await kitchenOrderService.getRoomQueue();
    const group104 = queue4.find(q => q.room_number === '104');

    assertTest('4.1: 28m-old order exists in queue', Boolean(group104));
    assertTest(
      '4.2: 28m-old order seconds remaining is ~120s (1-2 mins)',
      Boolean(group104 && group104.seconds_remaining && group104.seconds_remaining >= 110 && group104.seconds_remaining <= 130),
      `Got ${group104?.seconds_remaining}s`
    );
    assertTest('4.3: 28m-old order urgency transitions to "critical"', group104?.urgency === 'critical', `Got ${group104?.urgency}`);

    // --- 5. Order Placed 31 Minutes Ago (T-31m -> Auto-Expiry Beyond 30 Mins) ---
    console.log('\n--- 5. Order Placed 31 Minutes Ago (> 30 Mins Auto-Expiry) ---');
    const order31mAgo = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    sqliteDb.prepare(`
      INSERT INTO kitchen_orders (
        order_number, room_number, guest_name, cashier_name,
        items, total_items, total_amount, status, priority,
        ordered_at, created_at, updated_at
      ) VALUES ('K-31M', '105', '31m Guest', 'Cashier Test', '[]', 1, 150, 'new', 'normal', ?, ?, ?)
    `).run(order31mAgo, order31mAgo, order31mAgo);

    const queue5 = await kitchenOrderService.getRoomQueue();
    const group105 = queue5.find(q => q.room_number === '105');

    assertTest('5.1: 31m-old order is omitted from active room queue', group105 === undefined);

    const expiredRow = sqliteDb.prepare('SELECT status, kitchen_notes FROM kitchen_orders WHERE order_number = ?').get('K-31M') as any;
    assertTest('5.2: 31m-old order status is updated to "cancelled"', expiredRow?.status === 'cancelled', `Got ${expiredRow?.status}`);
    assertTest(
      '5.3: 31m-old order notes mention 30 minutes queue timer',
      expiredRow?.kitchen_notes?.includes('30 minutes'),
      `Got ${expiredRow?.kitchen_notes}`
    );

    // --- 6. API Endpoint Integration Check ---
    console.log('\n--- 6. REST API Endpoint Timer Data Verification ---');
    const tvRes = await fetch(`${baseUrl}/api/kitchen/tv/display`, {
      headers: { Authorization: `Bearer ${kitchenToken}` },
    });
    const tvData = (await tvRes.json()) as any;
    assertTest('6.1: GET /api/kitchen/tv/display responds with 200', tvRes.status === 200);
    assertTest('6.2: TV display queue contains active rooms', Array.isArray(tvData.queue) && tvData.queue.length >= 4);

    const tvRoom101 = tvData.queue.find((q: any) => q.room_number === '101');
    assertTest('6.3: TV display Room 101 timer duration is 30 mins', tvRoom101?.timer_duration_minutes === 30);
    assertTest('6.4: TV display Room 101 minutes remaining is 30', tvRoom101?.minutes_remaining === 30);

    // Clean up test orders
    for (const r of testRooms) {
      sqliteDb.prepare('DELETE FROM kitchen_orders WHERE room_number = ?').run(r);
    }
  } finally {
    server.close();
  }

  // Summary
  const passedCount = results.filter(r => r.passed).length;
  const totalCount = results.length;
  console.log('\n=================================================');
  console.log(`📊 KITCHEN TIMER RESULTS: ${passedCount}/${totalCount} PASSED ${passedCount === totalCount ? '🎉 ALL PASSED' : '❌ SOME FAILED'}`);
  console.log('=================================================\n');

  if (passedCount < totalCount) {
    process.exit(1);
  }
}

runKitchenTimerTests().catch((err) => {
  console.error('Fatal error in kitchen timer test:', err);
  process.exit(1);
});
