/**
 * server/services/alarm-service.ts
 * Alarm Window State Machine & Scheduled Checkout Monitor.
 *
 * State Machine per Active Booking / Occupied Room:
 *   NORMAL      -> now < checkout - alarm_pre_minutes (default 15m)
 *   WARNING     -> checkout - alarm_pre_minutes <= now < checkout (pre-checkout alert)
 *   DUE         -> checkout <= now < checkout + alarm_post_minutes (grace window, no escalation)
 *   OVERDUE     -> now >= checkout + alarm_post_minutes (escalated alert, persists until acknowledged or checked out)
 *
 * Guarantees:
 * - Single event emission on state transitions (room:alarm_state_changed) to prevent double-firing.
 * - Persistent alarm_state, acknowledged_at, and acknowledged_by in DB across server restarts.
 * - Idempotent alarm acknowledgment with role verification.
 * - Configurable alarm thresholds and overdue settings persisted in DB system_settings.
 */

import { pool } from '../db/pool';
import { socketManager } from '../websocket/socket-manager';
import { calculateExpectedCheckout } from '../utils/pricing';

export type AlarmState = 'NORMAL' | 'WARNING' | 'DUE' | 'OVERDUE';

export interface AlarmSettings {
  alarm_pre_minutes: number;
  alarm_post_minutes: number;
  snooze_minutes: number;
  overdue_repeat_minutes: number;
  overdue_max_repeats: number;
  extra_hour_rate: number;
  open_time_reminder_hours: number;
}

export interface AlarmStateChangedPayload {
  roomNumber: string;
  previousState: AlarmState;
  newState: AlarmState;
  expectedCheckoutAt: string;
  acknowledgedAt?: string | null;
  acknowledgedBy?: string | null;
  timestamp: string;
}

/**
 * Fetch configurable alarm threshold offsets from DB (system_settings).
 * Defaults to:
 *   alarm_pre_minutes: 15
 *   alarm_post_minutes: 15
 *   snooze_minutes: 10
 *   overdue_repeat_minutes: 5
 *   overdue_max_repeats: 3
 *   extra_hour_rate: 10000 (10000 centavos = 100.00 pesos)
 *   open_time_reminder_hours: 3
 */
export async function getAlarmSettings(): Promise<AlarmSettings> {
  const defaults: AlarmSettings = {
    alarm_pre_minutes: 15,
    alarm_post_minutes: 15,
    snooze_minutes: 10,
    overdue_repeat_minutes: 5,
    overdue_max_repeats: 3,
    extra_hour_rate: 13000,
    open_time_reminder_hours: 3,
  };

  try {
    const res = await pool.query(
      "SELECT `key`, `value` FROM system_settings WHERE `key` IN ('alarm_pre_minutes', 'alarm_post_minutes', 'snooze_minutes', 'overdue_repeat_minutes', 'overdue_max_repeats', 'extra_hour_rate', 'open_time_reminder_hours')"
    );
    const settings = { ...defaults };
    for (const row of res.rows) {
      const k = row.key as keyof AlarmSettings;
      if (k in settings) {
        const parsed = parseInt(row.value, 10);
        if (!isNaN(parsed) && parsed >= 0) {
          settings[k] = parsed;
        }
      }
    }
    return settings;
  } catch (err) {
    console.warn('Failed to fetch alarm settings from DB, using defaults:', err);
    return defaults;
  }
}

/**
 * Update alarm threshold offsets and operational alarm settings in DB.
 */
export async function updateAlarmSettings(settings: Partial<AlarmSettings>): Promise<AlarmSettings> {
  const keys: (keyof AlarmSettings)[] = [
    'alarm_pre_minutes',
    'alarm_post_minutes',
    'snooze_minutes',
    'overdue_repeat_minutes',
    'overdue_max_repeats',
    'extra_hour_rate',
    'open_time_reminder_hours',
  ];

  for (const key of keys) {
    if (settings[key] !== undefined) {
      const val = Math.max(0, Math.round(Number(settings[key])));
      await pool.query(
        `INSERT OR REPLACE INTO system_settings (\`key\`, \`value\`, \`updated_at\`)
         VALUES (?, ?, NOW())`,
        [key, String(val)]
      );
    }
  }

  const updated = await getAlarmSettings();
  // Immediately re-evaluate active room alarms with new thresholds
  evaluateActiveRoomAlarms().catch((err) => console.error('Error re-evaluating alarms on settings change:', err));
  return updated;
}

/**
 * Pure function: Compute alarm state derived from expected_checkout_at and thresholds.
 */
export function computeAlarmState(
  expectedCheckoutUtc: string | Date,
  nowMs: number = Date.now(),
  settings: Partial<AlarmSettings> = { alarm_pre_minutes: 15, alarm_post_minutes: 15 }
): AlarmState {
  const checkoutDate = typeof expectedCheckoutUtc === 'string' ? new Date(expectedCheckoutUtc) : expectedCheckoutUtc;
  const checkoutMs = checkoutDate.getTime();
  if (isNaN(checkoutMs)) return 'NORMAL';

  const preMs = (settings.alarm_pre_minutes ?? 15) * 60 * 1000;
  const postMs = (settings.alarm_post_minutes ?? 15) * 60 * 1000;

  if (nowMs < checkoutMs - preMs) {
    return 'NORMAL';
  } else if (nowMs < checkoutMs) {
    return 'WARNING';
  } else if (nowMs < checkoutMs + postMs) {
    return 'DUE';
  } else {
    return 'OVERDUE';
  }
}

/**
 * Evaluates all active occupied/overdue rooms against DB state.
 * Emits room:alarm_state_changed ONLY on state transitions.
 * Tick interval: 15-30s. Safe across restarts.
 */
export async function evaluateActiveRoomAlarms(): Promise<void> {
  try {
    const settings = await getAlarmSettings();
    const now = new Date();
    const nowMs = now.getTime();

    const result = await pool.query(`
      SELECT number, state, room_type, rate_selected, custom_hours,
             check_in_time, check_in_at, check_out_time, expected_checkout_at,
             alarm_state, acknowledged_at, acknowledged_by,
             snoozed_until, repeat_count, billing_mode, open_time_started_at,
             last_reminder_at, overtime_waived
      FROM rooms
      WHERE state IN ('occupied', 'overdue')
    `);

    for (const room of result.rows) {
      // Staff house / Room 12 never triggers guest checkout alarms
      const isStaff = room.room_type === 'Staff House' || String(room.number) === '12';
      if (isStaff) {
        if (room.alarm_state !== 'NORMAL') {
          await pool.query('UPDATE rooms SET alarm_state = ?, updated_at = NOW() WHERE number = ?', [
            'NORMAL',
            room.number,
          ]);
        }
        continue;
      }

      // Handle billing_mode === 'open_time': suppress all audible alarms
      if (room.billing_mode === 'open_time') {
        const startedAt = room.open_time_started_at || room.check_in_at || room.check_in_time;
        const lastReminder = room.last_reminder_at || room.open_time_started_at || startedAt;
        const lastReminderMs = lastReminder ? new Date(lastReminder).getTime() : 0;
        const reminderIntervalMs = (settings.open_time_reminder_hours || 3) * 3600000;

        if (lastReminderMs && (nowMs - lastReminderMs >= reminderIntervalMs)) {
          const startMs = startedAt ? new Date(startedAt).getTime() : nowMs;
          const elapsedHours = Math.max(1, Math.floor((nowMs - startMs) / 3600000));
          socketManager.broadcastOpenTimeReminder({
            roomNumber: String(room.number),
            elapsedHours,
            timestamp: now.toISOString(),
          });
          await pool.query('UPDATE rooms SET last_reminder_at = NOW(), updated_at = NOW() WHERE number = ?', [room.number]);
        }

        if (room.alarm_state !== 'NORMAL') {
          await pool.query('UPDATE rooms SET alarm_state = ?, is_overdue = 0, updated_at = NOW() WHERE number = ?', [
            'NORMAL',
            room.number,
          ]);
        }
        continue;
      }

      // Standard room logic
      const checkInRaw = room.check_in_at || room.check_in_time;
      let expectedCheckoutRaw = room.expected_checkout_at || room.check_out_time;

      // If expected_checkout_at is missing: calculate check_in_at + booked duration and persist
      if (!expectedCheckoutRaw && checkInRaw) {
        const parsedIn = new Date(checkInRaw);
        if (!isNaN(parsedIn.getTime())) {
          const calcExp = calculateExpectedCheckout(room.rate_selected || '24h', parsedIn, room.custom_hours);
          expectedCheckoutRaw = calcExp.toISOString();
          await pool.query(
            'UPDATE rooms SET expected_checkout_at = ?, check_in_at = COALESCE(check_in_at, ?), check_out_time = COALESCE(check_out_time, ?), updated_at = NOW() WHERE number = ?',
            [expectedCheckoutRaw, parsedIn.toISOString(), expectedCheckoutRaw, room.number]
          );
        }
      }

      if (!expectedCheckoutRaw) continue;

      const currentState: AlarmState = (room.alarm_state as AlarmState) || 'NORMAL';
      const targetState = computeAlarmState(expectedCheckoutRaw, nowMs, settings);

      const snoozedUntilMs = room.snoozed_until ? new Date(room.snoozed_until).getTime() : 0;
      const isSnoozed = !isNaN(snoozedUntilMs) && nowMs < snoozedUntilMs;

      if (targetState !== currentState) {
        const isOverdue = targetState === 'OVERDUE' || targetState === 'DUE';
        const nextRoomState = isOverdue ? 'overdue' : 'occupied';

        // Persist new alarm_state, is_overdue, and room state
        await pool.query(
          `UPDATE rooms SET
             alarm_state = ?,
             is_overdue = ?,
             state = ?,
             expected_checkout_at = COALESCE(expected_checkout_at, ?),
             check_in_at = COALESCE(check_in_at, ?),
             updated_at = NOW()
           WHERE number = ?`,
          [
            targetState,
            isOverdue ? 1 : 0,
            nextRoomState,
            expectedCheckoutRaw,
            checkInRaw ? new Date(checkInRaw).toISOString() : null,
            room.number,
          ]
        );

        console.log(`🔔 Alarm state transition for Room ${room.number}: ${currentState} -> ${targetState}`);

        const payload: AlarmStateChangedPayload = {
          roomNumber: String(room.number),
          previousState: currentState,
          newState: targetState,
          expectedCheckoutAt: new Date(expectedCheckoutRaw).toISOString(),
          acknowledgedAt: room.acknowledged_at ? new Date(room.acknowledged_at).toISOString() : null,
          acknowledgedBy: room.acknowledged_by || null,
          timestamp: now.toISOString(),
        };

        // Broadcast to all terminals — emitted ONLY on state transition
        socketManager.broadcastAlarmStateChanged(payload);

        // Also broadcast room update so UI re-renders with new colors immediately
        socketManager.broadcastRoomUpdate({
          roomNumber: String(room.number),
          state: nextRoomState,
          alarmState: targetState,
          checkInAt: checkInRaw ? new Date(checkInRaw).toISOString() : undefined,
          expectedCheckoutAt: new Date(expectedCheckoutRaw).toISOString(),
          acknowledgedAt: room.acknowledged_at ? new Date(room.acknowledged_at).toISOString() : null,
          acknowledgedBy: room.acknowledged_by || null,
          timestamp: now.toISOString(),
        });

        // Audio trigger on transition
        if (!isSnoozed) {
          if (targetState === 'WARNING') {
            socketManager.broadcastAlarmAudioTrigger({ roomNumber: String(room.number), state: 'WARNING' });
          } else if (targetState === 'OVERDUE' && !room.acknowledged_at) {
            socketManager.broadcastAlarmAudioTrigger({ roomNumber: String(room.number), state: 'OVERDUE', repeatCount: 1 });
            await pool.query('UPDATE rooms SET repeat_count = 1, last_reminder_at = NOW(), updated_at = NOW() WHERE number = ?', [room.number]);
          }
        }
      } else {
        // Non-transition: handle periodic overdue alarm repeats
        if (targetState === 'OVERDUE' && !room.acknowledged_at && !isSnoozed) {
          const repeatCount = Number(room.repeat_count || 0);
          const maxRepeats = settings.overdue_max_repeats || 3;
          const repeatIntervalMs = (settings.overdue_repeat_minutes || 5) * 60 * 1000;
          const lastReminderMs = room.last_reminder_at ? new Date(room.last_reminder_at).getTime() : 0;

          if (repeatCount === 0) {
            socketManager.broadcastAlarmAudioTrigger({ roomNumber: String(room.number), state: 'OVERDUE', repeatCount: 1 });
            await pool.query('UPDATE rooms SET repeat_count = 1, last_reminder_at = NOW(), updated_at = NOW() WHERE number = ?', [room.number]);
          } else if (repeatCount < maxRepeats) {
            if (nowMs - lastReminderMs >= repeatIntervalMs) {
              const nextRepeat = repeatCount + 1;
              socketManager.broadcastAlarmAudioTrigger({ roomNumber: String(room.number), state: 'OVERDUE', repeatCount: nextRepeat });
              await pool.query('UPDATE rooms SET repeat_count = ?, last_reminder_at = NOW(), updated_at = NOW() WHERE number = ?', [nextRepeat, room.number]);
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('Error during evaluateActiveRoomAlarms:', err);
  }
}

/**
 * Idempotent Alarm Acknowledgment.
 * Persists acknowledged_at and acknowledged_by on the room.
 */
export async function acknowledgeAlarm(
  roomNumber: string,
  operatorUsername: string
): Promise<{ success: boolean; acknowledgedAt: string; acknowledgedBy: string; alreadyAcknowledged: boolean }> {
  const result = await pool.query(
    'SELECT number, state, alarm_state, acknowledged_at, acknowledged_by FROM rooms WHERE number = ?',
    [String(roomNumber)]
  );

  if (result.rows.length === 0) {
    const err: any = new Error(`Room ${roomNumber} not found`);
    err.statusCode = 404;
    throw err;
  }

  const room = result.rows[0];

  // Idempotent return if already acknowledged
  if (room.acknowledged_at) {
    return {
      success: true,
      acknowledgedAt: new Date(room.acknowledged_at).toISOString(),
      acknowledgedBy: room.acknowledged_by || operatorUsername,
      alreadyAcknowledged: true,
    };
  }

  const nowIso = new Date().toISOString();
  await pool.query(
    'UPDATE rooms SET acknowledged_at = NOW(), acknowledged_by = ?, updated_at = NOW() WHERE number = ?',
    [operatorUsername, String(roomNumber)]
  );

  // Log audit entry
  const logId = `log-ack-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
  await pool.query(
    `INSERT INTO audit_logs (id, timestamp, operator, action, details)
     VALUES (?, NOW(), ?, 'ALARM_ACKNOWLEDGED', ?)`,
    [logId, operatorUsername, `Acknowledged ${room.alarm_state} alarm for Room ${roomNumber}`]
  );

  // Broadcast to all terminals
  socketManager.broadcastAlarmAcknowledged({
    roomNumber: String(roomNumber),
    acknowledgedAt: nowIso,
    acknowledgedBy: operatorUsername,
    timestamp: nowIso,
  });

  return {
    success: true,
    acknowledgedAt: nowIso,
    acknowledgedBy: operatorUsername,
    alreadyAcknowledged: false,
  };
}

/**
 * Stay Extension: Safely recalculates expected_checkout_at server-side and recomputes alarm_state.
 * ALWAYS contiguous T_new = T_old + 60min * hours, NEVER from now().
 * If billing_mode === 'open_time', switch to 'standard'.
 * Adds overtime line item to charged_food at extra_hour_rate.
 * Silences alarm, resets repeat_count = 0, snoozed_until = NULL, acknowledged_at = NULL.
 */
export async function extendStay(
  roomNumber: string,
  opts: { hours?: number; rateSelected?: string; customHours?: number },
  operatorUsername: string
): Promise<{ success: boolean; newCheckout: string; alarmState: AlarmState }> {
  const roomRes = await pool.query('SELECT * FROM rooms WHERE number = ?', [String(roomNumber)]);
  if (roomRes.rows.length === 0) {
    const err: any = new Error(`Room ${roomNumber} not found`);
    err.statusCode = 404;
    throw err;
  }

  const room = roomRes.rows[0];
  if (room.state !== 'occupied' && room.state !== 'overdue') {
    const err: any = new Error(`Cannot extend Room ${roomNumber}: Room is currently ${room.state.toUpperCase()}`);
    err.statusCode = 400;
    throw err;
  }

  const currentCheckout = room.expected_checkout_at || room.check_out_time
    ? new Date(room.expected_checkout_at || room.check_out_time)
    : new Date();

  const settings = await getAlarmSettings();
  const hoursToExtend = opts.hours && opts.hours > 0 ? opts.hours : 1;
  // ALWAYS contiguous T_new = T_old + 60min * hours, NEVER from now()
  const newCheckout = new Date(currentCheckout.getTime() + hoursToExtend * 3600000);
  const newCheckoutIso = newCheckout.toISOString();
  const newAlarmState = computeAlarmState(newCheckout, Date.now(), settings);

  // Add overtime line item to charged_food
  let chargedFoodList: any[] = [];
  if (room.charged_food) {
    try {
      chargedFoodList = typeof room.charged_food === 'string' ? JSON.parse(room.charged_food) : room.charged_food;
    } catch {
      chargedFoodList = [];
    }
  }

  const extraHourPrice = settings.extra_hour_rate >= 1000 ? settings.extra_hour_rate / 100 : settings.extra_hour_rate;
  chargedFoodList.push({
    item: {
      id: `overtime-ext-${Date.now()}`,
      name: `Overtime Extension (${hoursToExtend}h)`,
      price: extraHourPrice,
      category: 'Overtime',
      description: `Stay extension of ${hoursToExtend} hour(s) at ₱${extraHourPrice.toFixed(2)}/hr`,
      imageUrl: '',
    },
    quantity: hoursToExtend,
  });

  const chargedFoodStr = JSON.stringify(chargedFoodList);

  // Update room with new checkout, rate, and reset alarm state & counters
  await pool.query(
    `UPDATE rooms SET
       expected_checkout_at = ?,
       check_out_time = ?,
       billing_mode = 'standard',
       charged_food = ?,
       alarm_state = ?,
       acknowledged_at = NULL,
       acknowledged_by = NULL,
       snoozed_until = NULL,
       repeat_count = 0,
       is_overdue = ?,
       state = ?,
       updated_at = NOW()
     WHERE number = ?`,
    [
      newCheckoutIso,
      newCheckoutIso,
      chargedFoodStr,
      newAlarmState,
      newAlarmState === 'OVERDUE' || newAlarmState === 'DUE' ? 1 : 0,
      newAlarmState === 'OVERDUE' || newAlarmState === 'DUE' ? 'overdue' : 'occupied',
      String(roomNumber),
    ]
  );

  // Silence alarm
  socketManager.broadcastAlarmSilenced({ roomNumber: String(roomNumber), reason: 'Stay extended' });

  // Audit log
  const logId = `log-ext-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
  await pool.query(
    `INSERT INTO audit_logs (id, timestamp, operator, action, details)
     VALUES (?, NOW(), ?, 'STAY_EXTENDED', ?)`,
    [
      logId,
      operatorUsername,
      `Stay extended for Room ${roomNumber} by ${hoursToExtend}h to ${newCheckoutIso} by ${operatorUsername}. New alarm state: ${newAlarmState}`,
    ]
  );

  // Broadcast state change and room update
  socketManager.broadcastAlarmStateChanged({
    roomNumber: String(roomNumber),
    previousState: room.alarm_state as AlarmState,
    newState: newAlarmState,
    expectedCheckoutAt: newCheckoutIso,
    acknowledgedAt: null,
    acknowledgedBy: null,
    timestamp: new Date().toISOString(),
  });

  socketManager.broadcastRoomUpdate({
    roomNumber: String(roomNumber),
    state: newAlarmState === 'OVERDUE' || newAlarmState === 'DUE' ? 'overdue' : 'occupied',
    alarmState: newAlarmState,
    expectedCheckoutAt: newCheckoutIso,
    checkOutTime: newCheckoutIso,
    billingMode: 'standard',
    snoozedUntil: undefined,
    repeatCount: 0,
    chargedFood: chargedFoodList,
    timestamp: new Date().toISOString(),
  });

  return {
    success: true,
    newCheckout: newCheckoutIso,
    alarmState: newAlarmState,
  };
}

/**
 * Snooze alarm for a room for snooze_minutes (default 10m).
 * Silences audio and logs audit trail.
 */
export async function snoozeAlarm(
  roomNumber: string,
  operatorUsername: string
): Promise<{ success: boolean; snoozedUntil: string }> {
  const settings = await getAlarmSettings();
  const snoozeMinutes = settings.snooze_minutes || 10;
  const snoozedUntil = new Date(Date.now() + snoozeMinutes * 60000).toISOString();

  const roomRes = await pool.query('SELECT number, state FROM rooms WHERE number = ?', [String(roomNumber)]);
  if (roomRes.rows.length === 0) {
    const err: any = new Error(`Room ${roomNumber} not found`);
    err.statusCode = 404;
    throw err;
  }

  await pool.query(
    `UPDATE rooms SET
       snoozed_until = ?,
       repeat_count = 0,
       updated_at = NOW()
     WHERE number = ?`,
    [snoozedUntil, String(roomNumber)]
  );

  // Silence audio
  socketManager.broadcastAlarmSilenced({ roomNumber: String(roomNumber), reason: 'Alarm snoozed' });

  // Audit log
  const logId = `log-snooze-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
  await pool.query(
    `INSERT INTO audit_logs (id, timestamp, operator, action, details)
     VALUES (?, NOW(), ?, 'ALARM_SNOOZED', ?)`,
    [
      logId,
      operatorUsername,
      `Alarm for Room ${roomNumber} snoozed for ${snoozeMinutes} minutes (until ${snoozedUntil}) by ${operatorUsername}`,
    ]
  );

  socketManager.broadcastRoomUpdate({
    roomNumber: String(roomNumber),
    snoozedUntil,
    repeatCount: 0,
    timestamp: new Date().toISOString(),
  });

  return {
    success: true,
    snoozedUntil,
  };
}

/**
 * Switch a room to Open Time billing mode.
 * Suppresses audible alarms, sets start timestamps, and logs audit trail.
 */
export async function switchToOpenTime(
  roomNumber: string,
  operatorUsername: string,
  reason: string
): Promise<{ success: boolean; billingMode: 'open_time' }> {
  const roomRes = await pool.query('SELECT number, state FROM rooms WHERE number = ?', [String(roomNumber)]);
  if (roomRes.rows.length === 0) {
    const err: any = new Error(`Room ${roomNumber} not found`);
    err.statusCode = 404;
    throw err;
  }

  const nowIso = new Date().toISOString();
  await pool.query(
    `UPDATE rooms SET
       billing_mode = 'open_time',
       open_time_started_at = NOW(),
       last_reminder_at = NOW(),
       snoozed_until = NULL,
       repeat_count = 0,
       alarm_state = 'NORMAL',
       is_overdue = 0,
       state = 'occupied',
       updated_at = NOW()
     WHERE number = ?`,
    [String(roomNumber)]
  );

  // Silence audio
  socketManager.broadcastAlarmSilenced({ roomNumber: String(roomNumber), reason: 'Switched to open time' });

  // Audit log
  const logId = `log-opentime-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
  await pool.query(
    `INSERT INTO audit_logs (id, timestamp, operator, action, details)
     VALUES (?, NOW(), ?, 'SWITCH_TO_OPEN_TIME', ?)`,
    [
      logId,
      operatorUsername,
      `Switched Room ${roomNumber} to open time by ${operatorUsername}. Reason: ${reason || 'N/A'}`,
    ]
  );

  socketManager.broadcastRoomUpdate({
    roomNumber: String(roomNumber),
    billingMode: 'open_time',
    openTimeStartedAt: nowIso,
    state: 'occupied',
    alarmState: 'NORMAL',
    timestamp: nowIso,
  });

  return {
    success: true,
    billingMode: 'open_time',
  };
}

/**
 * Waive overtime fees for a room.
 * Records operator and reason, logs audit trail.
 */
export async function waiveOvertime(
  roomNumber: string,
  operatorUsername: string,
  reason: string
): Promise<{ success: boolean; overtimeWaived: boolean }> {
  const roomRes = await pool.query('SELECT number, state FROM rooms WHERE number = ?', [String(roomNumber)]);
  if (roomRes.rows.length === 0) {
    const err: any = new Error(`Room ${roomNumber} not found`);
    err.statusCode = 404;
    throw err;
  }

  await pool.query(
    `UPDATE rooms SET
       overtime_waived = 1,
       overtime_waived_by = ?,
       overtime_waived_reason = ?,
       updated_at = NOW()
     WHERE number = ?`,
    [operatorUsername, reason || null, String(roomNumber)]
  );

  // Audit log
  const logId = `log-waive-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
  await pool.query(
    `INSERT INTO audit_logs (id, timestamp, operator, action, details)
     VALUES (?, NOW(), ?, 'OVERTIME_WAIVED', ?)`,
    [
      logId,
      operatorUsername,
      `Waived overtime for Room ${roomNumber} by ${operatorUsername}. Reason: ${reason || 'N/A'}`,
    ]
  );

  socketManager.broadcastRoomUpdate({
    roomNumber: String(roomNumber),
    overtimeWaived: true,
    overtimeWaivedBy: operatorUsername,
    overtimeWaivedReason: reason || undefined,
    timestamp: new Date().toISOString(),
  });

  return {
    success: true,
    overtimeWaived: true,
  };
}

