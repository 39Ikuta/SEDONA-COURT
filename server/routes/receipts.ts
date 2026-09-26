/**
 * server/routes/receipts.ts
 * GET  /api/receipts     — list all receipts (optionally filter by ?cashier=&date=)
 * POST /api/receipts     — create a new receipt on checkout (server-computed, idempotent, transactional)
 */

import { Router, Request, Response } from 'express';
import { pool, withTransaction } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { socketManager } from '../websocket/socket-manager';
import { weeklyReportAggregator } from '../services/weekly-report-aggregator';
import { calculateStayRate, DEFAULT_TIER_RATES, formatStayDuration, calculateExcessHours } from '../utils/pricing';
import { getDiscountAmount, normalizeDiscountType } from '../utils/discount-rates';
import { asyncHandler } from '../utils/async-handler';
import { inventoryService } from '../services/inventory-service';

const router = Router();

function rowToReceipt(row: any) {
  let items = [];
  if (row.items) {
    try {
      items = typeof row.items === 'string' ? JSON.parse(row.items) : row.items;
    } catch (parseErr) {
      console.warn(`rowToReceipt: Failed to parse items JSON for receipt ${row.receipt_no}:`, parseErr);
      items = [];
    }
  }

  // Derive rateSelected and stayDuration from items or metadata
  const rentItem = items.find((it: any) => it.description?.toLowerCase().includes('rent') || it.subtext?.toLowerCase().includes('stay') || it.subtext?.toLowerCase().includes('base'));
  let rateSelected = row.rate_selected;
  let stayDuration = row.stay_duration;
  if (!rateSelected && rentItem?.subtext) {
    if (rentItem.subtext.toLowerCase().includes('3h') || rentItem.subtext.toLowerCase().includes('3 hour')) rateSelected = '3h';
    else if (rentItem.subtext.toLowerCase().includes('6h') || rentItem.subtext.toLowerCase().includes('6 hour')) rateSelected = '6h';
    else if (rentItem.subtext.toLowerCase().includes('12h') || rentItem.subtext.toLowerCase().includes('12 hour')) rateSelected = '12h';
    else if (rentItem.subtext.toLowerCase().includes('promo')) rateSelected = 'promo';
    else if (rentItem.subtext.toLowerCase().includes('24h') || rentItem.subtext.toLowerCase().includes('24 hour')) rateSelected = '24h';
  }
  if (!stayDuration && rateSelected) {
    stayDuration = formatStayDuration(rateSelected);
  }

  // Derive discount info: prefer persisted DB columns, fall back to item-parsing for legacy receipts
  let discount: number | undefined;
  let discountType: string | undefined;
  let discountIdRef: string | undefined;

  if (row.discount_amount && Number(row.discount_amount) > 0) {
    // Use persisted discount fields from DB
    discount = Number(row.discount_amount);
    discountType = row.discount_type || undefined;
    discountIdRef = row.discount_id_ref || undefined;
  } else {
    // Fallback: derive from items for receipts created before discount column migration
    const discountItem = items.find((it: any) => it.amount < 0 || it.description?.toLowerCase().includes('discount'));
    if (discountItem) {
      discount = Math.abs(Number(discountItem.amount) || 0);
      if (discountItem.description?.toLowerCase().includes('card') || discountItem.description?.includes('(DC)')) {
        discountType = 'DC';
      } else {
        discountType = 'SENIOR';
      }
      const match = discountItem.subtext?.match(/\[(?:ID|Card #|Ref):\s*([^\]]+)\]/i);
      if (match) {
        discountIdRef = match[1].trim();
      }
    }
  }

  return {
    receiptNo: row.receipt_no,
    dateTime: row.date_time instanceof Date ? row.date_time.toISOString() : String(row.date_time),
    guestName: row.guest_name,
    roomNumber: String(row.room_number || ''),
    roomType: row.room_type,
    paymentMethod: row.payment_method,
    gcashRef: row.gcash_ref,
    cashAmount: row.cash_amount ? parseFloat(row.cash_amount) : undefined,
    gcashAmount: row.gcash_amount ? parseFloat(row.gcash_amount) : undefined,
    checkIn: row.check_in instanceof Date ? row.check_in.toISOString() : (row.check_in ? String(row.check_in) : undefined),
    checkOut: row.check_out instanceof Date ? row.check_out.toISOString() : (row.check_out ? String(row.check_out) : undefined),
    items: items,
    subtotal: parseFloat(row.subtotal || 0),
    serviceCharge: parseFloat(row.service_charge || 0),
    total: parseFloat(row.total || 0),
    discount: discount,
    discountType: discountType,
    discountIdRef: discountIdRef,
    cashierId: row.cashier_id,
    rateSelected: rateSelected,
    stayDuration: stayDuration,
  };
}

// GET /api/receipts
router.get('/', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  try {
    const { cashier, date } = req.query;
    let query = 'SELECT * FROM receipts WHERE 1=1';
    const params: any[] = [];

    if (cashier) {
      params.push(cashier);
      query += ` AND LOWER(cashier_id) = LOWER(?)`;
    }
    if (date) {
      params.push(date);
      query += ` AND DATE(date_time) = ?`;
    }
    query += ' ORDER BY date_time DESC';

    const result = await pool.query(query, params);
    res.json(result.rows.map(rowToReceipt));
  } catch (err) {
    console.error('GET /receipts error:', err);
    res.status(500).json({ error: 'Failed to fetch receipts' });
  }
}));

function safeParseDate(input: any): Date | null {
  if (!input) return null;
  if (input instanceof Date) return isNaN(input.getTime()) ? null : input;

  const str = String(input).trim();
  if (!str || str === 'N/A' || str === 'null' || str === 'undefined') return null;

  const d = new Date(str);
  if (!isNaN(d.getTime())) return d;

  if (str.includes(' ')) {
    const d2 = new Date(str.replace(' ', 'T'));
    if (!isNaN(d2.getTime())) return d2;
  }

  return null;
}

/**
 * Stores a full ISO-8601 string (e.g. "2026-09-22T14:05:00.000Z") so that
 * the UTC offset is preserved end-to-end. SQLite/MySQL accept ISO strings
 * as TEXT and our rowToReceipt parses them back via `new Date(str).toISOString()`.
 * Previously this used `.slice(0,19)` which stripped the timezone, causing an
 * 8-hour shift whenever the server was in UTC+8.
 */
function formatSqlDateTime(date: Date | null | undefined, fallbackToNow: boolean = false): string | null {
  const d = date || (fallbackToNow ? new Date() : null);
  if (!d || isNaN(d.getTime())) {
    return fallbackToNow ? new Date().toISOString() : null;
  }
  return d.toISOString();
}

// POST /api/receipts — Checkout & Receipt creation handler
router.post('/', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const r = req.body;
  const operator = (req as any).operator;
  const idempotencyKey = (req.headers['x-idempotency-key'] as string) || r.idempotencyKey || r.receiptNo;

  try {
    // Priority 2c & 3a: Wrap all writes in an atomic database transaction
    // C-05 fix: idempotency check is now INSIDE the transaction to prevent TOCTOU race
    const receiptData = await withTransaction(async (conn) => {
      // Idempotency check — must be inside transaction to prevent race
      if (idempotencyKey) {
        const existing = await conn.query('SELECT * FROM receipts WHERE receipt_no = ?', [idempotencyKey]);
        if (existing.rows.length > 0) {
          return { alreadyExists: true, receipt: rowToReceipt(existing.rows[0]) };
        }
      }

      const receiptNo = r.receiptNo || idempotencyKey || `SCTI-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
      const parsedDateTime = safeParseDate(r.dateTime) || new Date();
      const dateTime = formatSqlDateTime(parsedDateTime, true)!;

      let roomNumber = r.roomNumber ? String(r.roomNumber).trim() : null;
      let roomType = r.roomType || 'Standard Room';
      let guestName = r.guestName || 'Walk-in Guest';
      let checkIn = formatSqlDateTime(safeParseDate(r.checkIn), false);
      let checkOut = formatSqlDateTime(safeParseDate(r.checkOut), true)!;
      let paymentMethod = r.paymentMethod || 'CASH';
      let gcashRef = r.gcashRef ? String(r.gcashRef).trim() : null;

      let subtotal = 0;
      let total = 0;
      let items = r.items || [];
      let foodCharges = 0;

      const isSeniorRequested = Boolean(
        r.isSeniorPwdDiscount ||
        (r.discountType && normalizeDiscountType(r.discountType) === 'SENIOR')
      );
      const isDiscountCardRequested = Boolean(
        r.isDiscountCard ||
        (r.discountType && normalizeDiscountType(r.discountType) === 'DC')
      );

      // Constraint 5 & Decision Point 3: Mutual exclusivity
      if (isSeniorRequested && isDiscountCardRequested) {
        throw Object.assign(
          new Error('Only one discount type (Senior/PWD or Discount Card) may be applied per transaction.'),
          { statusCode: 400 }
        );
      }

      let discountType: 'SENIOR' | 'DC' | null = null;
      if (isSeniorRequested) discountType = 'SENIOR';
      else if (isDiscountCardRequested) discountType = 'DC';

      let discountIdRef = (r.seniorPwdId || r.discountCardId || r.discountIdRef || '').trim() || (discountType ? 'VERIFIED' : '');

      if (paymentMethod === 'GCASH' || (paymentMethod === 'MIXED' && Number(r.gcashAmount) > 0)) {
        if (!gcashRef) {
          throw Object.assign(new Error('GCash transaction reference is required for GCash payments.'), { statusCode: 400 });
        }
      }

      let roomRow: any = null;
      let finalRateSelected = r.rateSelected || '24h';
      let finalStayDuration = r.stayDuration || formatStayDuration(finalRateSelected);
      let discountCentavos = 0;
      let roomTier = 'Standard';

      if (roomNumber) {
        const roomResult = await conn.query('SELECT * FROM rooms WHERE number = ?', [roomNumber]);
        if (roomResult.rows.length > 0) {
          roomRow = roomResult.rows[0];

          // H-05: Validate room is actually occupied before checkout
          if (roomRow.state !== 'occupied' && roomRow.state !== 'overdue') {
            throw Object.assign(
              new Error(`Room ${roomNumber} is not currently occupied (state: ${roomRow.state}). Cannot checkout.`),
              { statusCode: 400 }
            );
          }

          // Fallback to room's persisted discount if not explicitly passed in payload
          if (!discountType && roomRow.discount_type && roomRow.discount_type !== 'NONE') {
            discountType = normalizeDiscountType(roomRow.discount_type);
          }
          if ((!discountIdRef || discountIdRef === 'VERIFIED') && roomRow.discount_id_ref) {
            discountIdRef = roomRow.discount_id_ref.trim();
          }

          roomType = roomRow.room_type || roomType;
          guestName = roomRow.guest_name || guestName;
          if (r.checkIn) {
            const parsed = safeParseDate(r.checkIn);
            if (parsed) checkIn = formatSqlDateTime(parsed, false);
          } else if (roomRow.check_in_time) {
            const parsed = safeParseDate(roomRow.check_in_time);
            if (parsed) {
              checkIn = formatSqlDateTime(parsed, false);
            }
          }

          const servicesResult = await conn.query('SELECT * FROM billable_services WHERE is_deleted = FALSE');
          const services = servicesResult.rows;

          finalRateSelected = r.rateSelected || roomRow.rate_selected || '24h';
          const customHours = Number(r.customHours || roomRow.custom_hours || 1);
          finalStayDuration = formatStayDuration(finalRateSelected, customHours);
          roomTier = roomRow.tier || 'Standard';
          const tier = roomTier;

          let baseRate = 0;
          if (finalRateSelected === 'custom') {
            baseRate = customHours * 130;
          } else {
            const rateService = services.find(
              (s: any) => s.type === 'room_rate' && s.category === tier && s.rate_type === finalRateSelected
            );
            baseRate = rateService
              ? calculateStayRate(rateService, r.checkIn || roomRow.check_in_time)
              : (DEFAULT_TIER_RATES[tier]?.[finalRateSelected] ?? 1500);
          }

          const extraBedService = services.find((s: any) => s.id === 'extra-bed');
          const towelService = services.find((s: any) => s.id === 'towel');
          const extraPersonService = services.find((s: any) => s.id === 'extra-person');
          const excessHourService = services.find((s: any) => s.id === 'late-checkout-extension');
          const extraBedPrice = extraBedService ? Number(extraBedService.price) : 250;
          const towelPrice = towelService ? Number(towelService.price) : 100;
          const extraPersonPrice = extraPersonService ? Number(extraPersonService.price) : 150;
          const excessHourPrice = excessHourService ? Number(excessHourService.price) : 130;

          const extraBeds = Number(roomRow.extra_beds || 0);
          const towelSets = Number(roomRow.towel_sets || 0);
          const numGuests = Number(roomRow.num_guests || 1);
          const extraGuests = Math.max(0, numGuests - 2);

          const bedsCharge = extraBeds * extraBedPrice;
          const towelsCharge = towelSets * towelPrice;
          const extraPersonCharge = extraGuests * extraPersonPrice;

          // Compute excess hours surcharge past the 15-minute grace period
          let excessHours = 0;
          let excessHoursCharge = 0;
          if (roomRow.check_out_time && finalRateSelected !== 'custom') {
            const actualOutDate = r.checkOut ? new Date(r.checkOut) : new Date();
            excessHours = calculateExcessHours(roomRow.check_out_time, actualOutDate, 15);
            excessHoursCharge = excessHours * excessHourPrice;
          }

          let chargedFoodList: Array<{ item: { name: string; price: number }; quantity: number }> = [];
          if (roomRow.charged_food) {
            if (typeof roomRow.charged_food === 'string') {
              try {
                chargedFoodList = JSON.parse(roomRow.charged_food);
              } catch (e) {
                console.warn(`[receipts] corrupt charged_food for room ${roomNumber}, ignoring: ${e}`);
                chargedFoodList = [];
              }
            } else {
              chargedFoodList = roomRow.charged_food;
            }
          }
          foodCharges = chargedFoodList.reduce(
            (sum, order) => sum + Number(order.item?.price || 0) * Number(order.quantity || 1),
            0
          );

          // Authoritatively resolve discount amount from table in integer centavos (Constraint 1, 2, 3)
          discountCentavos = 0;
          if (discountType) {
            const resolvedCentavos = getDiscountAmount(discountType, tier, finalRateSelected);
            if (resolvedCentavos === null) {
              // Fallback to percentage calculation if unmapped
              discountCentavos = Math.round(baseRate * 100 * (discountType === 'SENIOR' ? 0.20 : 0.10));
            } else {
              discountCentavos = resolvedCentavos;
            }
          }

          // Compute bill using integer centavos arithmetic
          const baseRateCentavos = Math.round(baseRate * 100);
          const bedsChargeCentavos = Math.round(bedsCharge * 100);
          const towelsChargeCentavos = Math.round(towelsCharge * 100);
          const extraPersonChargeCentavos = Math.round(extraPersonCharge * 100);
          const excessHoursChargeCentavos = Math.round(excessHoursCharge * 100);
          const foodChargesCentavos = Math.round(foodCharges * 100);

          const subtotalCentavos = baseRateCentavos + bedsChargeCentavos + towelsChargeCentavos + extraPersonChargeCentavos + excessHoursChargeCentavos + foodChargesCentavos;
          const totalCentavos = Math.max(0, subtotalCentavos - discountCentavos);

          subtotal = subtotalCentavos / 100;
          total = totalCentavos / 100;
          const discountAmountPesos = discountCentavos / 100;

          const rateSubtext = finalRateSelected === 'custom'
            ? `${customHours} Hours × ₱130/hr`
            : `${finalStayDuration} Base Rate`;

          items = [
            { description: `${roomType} Rent${finalRateSelected === 'custom' ? ' (Custom Stay)' : ''}`, subtext: rateSubtext, amount: baseRate },
          ];
          if (discountAmountPesos > 0 && discountType) {
            const desc = discountType === 'DC' ? 'Discount Card (DC)' : 'Senior / PWD Discount';
            const hasCustomRef = discountIdRef && discountIdRef.trim() && discountIdRef.trim() !== 'VERIFIED';
            const sub = discountType === 'DC'
              ? (hasCustomRef ? `Fixed Card Discount [Card #: ${discountIdRef.trim()}]` : 'Fixed Card Discount')
              : (hasCustomRef ? `Fixed Statutory Discount [ID: ${discountIdRef.trim()}]` : 'Fixed Statutory Discount');
            items.push({
              description: desc,
              subtext: sub,
              amount: -discountAmountPesos,
            });
          }
          if (bedsCharge > 0) {
            items.push({
              description: 'Extra Bed Add-on',
              subtext: `${extraBeds} Bed(s) x ₱${extraBedPrice}`,
              amount: bedsCharge,
            });
          }
          if (towelsCharge > 0) {
            items.push({
              description: 'Extra Towels Add-on',
              subtext: `${towelSets} Set(s) x ₱${towelPrice}`,
              amount: towelsCharge,
            });
          }
          if (extraPersonCharge > 0) {
            items.push({
              description: 'Extra Person Surcharge',
              subtext: `${extraGuests} Extra Guest(s) (beyond 2) x ₱${extraPersonPrice}`,
              amount: extraPersonCharge,
            });
          }
          if (excessHoursCharge > 0) {
            items.push({
              description: 'Excess Stay / Late Checkout Surcharge',
              subtext: `${excessHours} Overstay Hour(s) × ₱${excessHourPrice}/hr (past 15m grace)`,
              amount: excessHoursCharge,
            });
          }
          chargedFoodList.forEach((f) => {
            items.push({
              description: f.item?.name || 'Food Order',
              subtext: `${f.quantity} Qty x ₱${f.item?.price}`,
              amount: Number(f.item?.price || 0) * Number(f.quantity || 1),
            });
          });
        }
      }

      if (!roomRow) {
        // Direct POS receipt or walk-in sale — recompute securely
        let computedSubtotal = 0;
        if (items && items.length > 0) {
          const serviceRows = await conn.query('SELECT id, price FROM billable_services');
          const priceMap = new Map<string, number>();
          for (const row of serviceRows.rows) {
            priceMap.set(row.id, Number(row.price) || 0);
          }

          for (const it of items) {
            const itemId = String(it.item_id || it.id || '').trim();
            if (!itemId || !priceMap.has(itemId)) {
              throw Object.assign(new Error(`Invalid or missing service ID for POS item: ${itemId || 'unknown'}`), { statusCode: 400 });
            }
            const qty = Math.max(1, Math.round(Number(it.quantity) || 1));
            const actualPrice = priceMap.get(itemId)!;
            it.amount = actualPrice * qty;
            computedSubtotal += it.amount;
          }
        }
        subtotal = computedSubtotal;
        total = subtotal;

        // Bug 3 fix: deduct stock for each POS item sold directly at counter
        if (items && items.length > 0) {
          const posOperator = operator?.username || 'Frontdesk';
          for (const it of items) {
            if (!it.item_id && !it.id) continue; // skip items without an inventory id
            const itemId = String(it.item_id || it.id || '').trim();
            if (!itemId) continue;
            const qty = Math.max(1, Math.round(Number(it.quantity) || 1));
            try {
              await inventoryService.atomicDecrementStock(
                [{ item_id: itemId, quantity: qty, name: it.description || it.name || itemId }],
                `POS-${receiptNo}`,
                posOperator,
                conn
              );
            } catch (invErr: any) {
              // Non-blocking: log but don't abort the POS sale
              console.warn(`[receipts] POS inventory deduct skipped for ${itemId}:`, invErr?.message);
            }
          }
        }
      }

      // Determine cash / gcash split based on server-computed total (Constraint 6)
      let cashAmount: number | null = null;
      let gcashAmount: number | null = null;
      if (paymentMethod === 'CASH') {
        cashAmount = total;
        gcashAmount = null;
      } else if (paymentMethod === 'GCASH') {
        gcashAmount = total;
        cashAmount = null;
      } else if (paymentMethod === 'MIXED') {
        if (r.cashAmount !== undefined && r.gcashAmount !== undefined) {
          cashAmount = Number(r.cashAmount);
          gcashAmount = Number(r.gcashAmount);
          // M-08: Validate MIXED payment amounts sum to total using integer centavos
          const cashCentavos = Math.round(cashAmount * 100);
          const gcashCentavos = Math.round(gcashAmount * 100);
          const targetTotalCentavos = Math.round(total * 100);
          if (cashCentavos + gcashCentavos !== targetTotalCentavos) {
            throw Object.assign(
              new Error(`MIXED payment amounts (₱${cashAmount} + ₱${gcashAmount} = ₱${((cashCentavos + gcashCentavos) / 100).toFixed(2)}) do not equal total ₱${total.toFixed(2)}.`),
              { statusCode: 400 }
            );
          }
        } else {
          cashAmount = total;
          gcashAmount = 0;
        }
      }

      // Server-derived authenticated operator identity (Constraint 7)
      const authenticatedOperator = operator?.username || operator?.name || 'Frontdesk';
      const cashierId = authenticatedOperator;
      const itemsStr = JSON.stringify(items);

      // 1. Insert receipt (includes persisted discount and rate/duration fields)
      await conn.query(
        `INSERT INTO receipts (
          receipt_no, date_time, guest_name, room_number, room_type,
          payment_method, gcash_ref, cash_amount, gcash_amount,
          check_in, check_out, items, subtotal, service_charge, total, cashier_id,
          discount_type, discount_amount, discount_id_ref,
          rate_selected, stay_duration
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          receiptNo, dateTime, guestName, roomNumber, roomType,
          paymentMethod, gcashRef, cashAmount, gcashAmount,
          checkIn, checkOut,
          itemsStr,
          subtotal, 0, total, cashierId,
          discountType || null, discountCentavos / 100, (discountIdRef && discountIdRef !== 'VERIFIED' ? discountIdRef.trim() : null),
          finalRateSelected || null, finalStayDuration || null,
        ]
      );

      // 2. If room checkout, transition room state to 'cleaning'
      if (roomNumber) {
        await conn.query(
          `UPDATE rooms SET
            state = 'cleaning', label = 'Housekeep', guest_name = '', guest_id = '',
            num_guests = 0, rate_selected = '24h', extra_beds = 0, towel_sets = 0,
            check_in_time = NULL, check_out_time = NULL, is_overdue = 0, charged_food = '[]',
            discount_type = 'NONE', discount_id_ref = '',
            updated_at = NOW()
           WHERE number = ?`,
          [roomNumber]
        );

        // 3. Write audit log (Constraint 7: server-derived operator)
        const logId = `log-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
        await conn.query(
          `INSERT INTO audit_logs (id, timestamp, operator, action, details)
           VALUES (?, NOW(), ?, 'CHECKOUT', ?)`,
          [
            logId,
            authenticatedOperator,
            `Guest ${guestName} checked out of Room ${roomNumber}. Total: ₱${total.toLocaleString()}${discountType ? ` (${discountType} Discount: ₱${(discountCentavos / 100).toFixed(2)}, Ref: ${discountIdRef})` : ''}`,
          ]
        );

        // Dedicated audit log entry for discount application (Constraint 7)
        if (discountCentavos > 0 && discountType) {
          const discountLogId = `log-disc-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
          await conn.query(
            `INSERT INTO audit_logs (id, timestamp, operator, action, details)
             VALUES (?, NOW(), ?, 'DISCOUNT_APPLIED', ?)`,
            [
              discountLogId,
              authenticatedOperator,
              `Applied ${discountType} discount of ₱${(discountCentavos / 100).toFixed(2)} on Room ${roomNumber} (${roomTier} / ${finalStayDuration}) [Ref: ${discountIdRef}]. Checkout total: ₱${total.toFixed(2)}`,
            ]
          );
        }

        // 4. Update POS revenue if food was charged
        if (foodCharges > 0) {
          const today = new Date().toISOString().split('T')[0];
          await conn.query(
            `INSERT INTO pos_revenue (date, kitchen, drinks, miscell)
             VALUES (?, ?, 0, 0)
             ON DUPLICATE KEY UPDATE
               kitchen = kitchen + VALUES(kitchen),
               updated_at = NOW()`,
            [today, foodCharges]
          );
        }
      }

      // Fetch created receipt within transaction
      const created = await conn.query('SELECT * FROM receipts WHERE receipt_no = ?', [receiptNo]);
      return { alreadyExists: false, receipt: rowToReceipt(created.rows[0]), roomNumber, foodCharges };
    });

    // Handle idempotent return
    if (receiptData.alreadyExists) {
      return res.status(200).json(receiptData.receipt);
    }

    const receipt = receiptData.receipt;

    // Auto-populate weekly report entry (outside transaction — non-critical)
    try {
      await weeklyReportAggregator.onReceiptCreated({
        receipt_no: receipt.receiptNo,
        date_time: receipt.dateTime,
        room_number: receipt.roomNumber,
        guest_name: receipt.guestName,
        items: receipt.items || [],
        subtotal: receipt.subtotal,
        service_charge: receipt.serviceCharge || 0,
        total: receipt.total,
        payment_method: receipt.paymentMethod,
        cash_amount: receipt.cashAmount,
        gcash_amount: receipt.gcashAmount,
        cashier_id: receipt.cashierId,
      });
    } catch (aggErr) {
      console.warn('⚠️ Weekly report aggregation failed:', aggErr);
    }

    // Broadcast receipt creation
    socketManager.broadcastReceiptCreated({
      receiptNo: receipt.receiptNo,
      roomNumber: receipt.roomNumber,
      total: receipt.total,
      cashier: receipt.cashierId,
      timestamp: new Date().toISOString(),
    });

    // Broadcast room status change
    if (receiptData.roomNumber) {
      socketManager.broadcastRoomUpdate({
        roomNumber: receiptData.roomNumber,
        state: 'cleaning',
        guestName: '',
        timestamp: new Date().toISOString(),
      });
    }

    return res.status(201).json(receipt);
  } catch (err: any) {
    console.error('POST /receipts error:', err);
    const status = err.statusCode && Number.isInteger(err.statusCode) ? err.statusCode : 500;
    return res.status(status).json({ error: err.message || 'Failed to create receipt' });
  }
}));

export default router;

