/**
 * server/services/weekly-report-aggregator.ts
 * Automatically aggregates receipt and room data into weekly shift entries.
 * Called when receipts are created or at end-of-shift.
 *
 * Flow:
 * 1. On receipt creation → Update/create shift entry for that day
 * 2. On shift handoff → Finalize shift totals
 * 3. On week end → Generate final weekly summary
 */

import { pool } from '../db/pool';
import {
  startOfWeek,
  endOfWeek,
  format,
  getWeek,
  getYear,
  getDay,
  getISODay,
  parseISO
} from 'date-fns';

interface Receipt {
  receipt_no: string;
  date_time: string;
  room_number: string;
  guest_name: string;
  items: Array<{ description: string; subtext: string; amount: number }>;
  subtotal: number;
  service_charge: number;
  total: number;
  payment_method: 'CASH' | 'GCASH' | 'MIXED';
  cash_amount?: number;
  gcash_amount?: number;
  cashier_id: string;
}

interface Room {
  number: string;
  state: 'available' | 'occupied' | 'cleaning' | 'overdue' | 'maintenance';
  extra_beds: number;
  towel_sets: number;
}

const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export class WeeklyReportAggregator {
  /**
   * Parse revenue from a receipt based on item descriptions
   */
  private parseRevenueFromReceipt(receipt: Receipt): {
    roomBill: number;
    kitchenBill: number;
    drinksBill: number;
    miscellPurchases: number;
    extras: number;
  } {
    let roomBill = 0;
    let kitchenBill = 0;
    let drinksBill = 0;
    let miscellPurchases = 0;
    let extras = 0;

    receipt.items.forEach((item) => {
      const description = item.description.toLowerCase();

      if (description.includes('room') || description.includes('stay') || description.includes('accommodation') || description.includes('rent')) {
        roomBill += item.amount;
      } else if (description.includes('kitchen') || description.includes('meal') || description.includes('food')) {
        kitchenBill += item.amount;
      } else if (description.includes('drink') || description.includes('beverage')) {
        drinksBill += item.amount;
      } else if (
        description.includes('extra bed') ||
        description.includes('towel') ||
        description.includes('pillow') ||
        description.includes('amenity')
      ) {
        extras += item.amount;
      } else {
        miscellPurchases += item.amount;
      }
    });

    return { roomBill, kitchenBill, drinksBill, miscellPurchases, extras };
  }

  /**
   * Safe date parser that handles ISO strings, SQL dates (with space), and localized formats
   */
  private parseDateSafe(input: any): Date {
    if (!input) return new Date();
    if (input instanceof Date && !isNaN(input.getTime())) return input;
    const str = String(input).trim();
    if (!str || str === 'N/A' || str === 'null' || str === 'undefined') return new Date();

    const d = new Date(str);
    if (!isNaN(d.getTime())) return d;

    if (str.includes(' ')) {
      const d2 = new Date(str.replace(' ', 'T'));
      if (!isNaN(d2.getTime())) return d2;
    }

    try {
      const dIso = parseISO(str);
      if (!isNaN(dIso.getTime())) return dIso;
    } catch (_) {}

    return new Date();
  }

  /**
   * Determine shift type from datetime
   * DAY: 6 AM - 6 PM
   * NIGHT: 6 PM - 6 AM
   */
  private getShiftType(dateTime: string): 'DAY' | 'NIGHT' {
    const date = this.parseDateSafe(dateTime);
    const hour = date.getHours();
    return hour >= 6 && hour < 18 ? 'DAY' : 'NIGHT';
  }

  /**
   * Called when a receipt is created - update shift entry
   */
  async onReceiptCreated(receipt: Receipt): Promise<void> {
    try {
      const receiptDate = this.parseDateSafe(receipt.date_time);
      const dateStr = format(receiptDate, 'yyyy-MM-dd');
      const shiftType = this.getShiftType(receipt.date_time);
      const dayOfWeek = DAY_NAMES[getISODay(receiptDate) % 7];
      const week = getWeek(receiptDate);
      const year = getYear(receiptDate);

      const revenue = this.parseRevenueFromReceipt(receipt);

      // Check if shift entry exists
      const existing = await pool.query(
        `SELECT id FROM weekly_shift_entries
         WHERE date = $1 AND shift_type = $2`,
        [dateStr, shiftType]
      );

      if (existing.rows.length > 0) {
        // Update existing entry - add revenue from this receipt
        await pool.query(
          `UPDATE weekly_shift_entries
           SET room_bill = room_bill + $1,
               kitchen_bill = kitchen_bill + $2,
               drinks_bill = drinks_bill + $3,
               miscell_purchases = miscell_purchases + $4,
               extras = extras + $5,
               payment_received = payment_received + $6,
               updated_at = NOW()
           WHERE date = $7 AND shift_type = $8`,
          [
            revenue.roomBill,
            revenue.kitchenBill,
            revenue.drinksBill,
            revenue.miscellPurchases,
            revenue.extras,
            receipt.total,
            dateStr,
            shiftType
          ]
        );
      } else {
        // Create new shift entry
        await pool.query(
          `INSERT INTO weekly_shift_entries (
            date, day_of_week, shift_type, cashier_name,
            room_bill, kitchen_bill, drinks_bill, miscell_purchases,
            extras, payment_received, week_number, year, total_checkins
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
            ON DUPLICATE KEY UPDATE
              room_bill = room_bill + VALUES(room_bill),
              kitchen_bill = kitchen_bill + VALUES(kitchen_bill),
              drinks_bill = drinks_bill + VALUES(drinks_bill),
              miscell_purchases = miscell_purchases + VALUES(miscell_purchases),
              extras = extras + VALUES(extras),
              payment_received = payment_received + VALUES(payment_received),
              total_checkins = total_checkins + 1,
              updated_at = NOW()`,
          [
            dateStr,
            dayOfWeek,
            shiftType,
            receipt.cashier_id || 'UNASSIGNED',
            revenue.roomBill,
            revenue.kitchenBill,
            revenue.drinksBill,
            revenue.miscellPurchases,
            revenue.extras,
            receipt.total,
            week,
            year,
          ]
        );
      }

      // Track GCash entry if applicable
      if (receipt.payment_method === 'GCASH' || receipt.payment_method === 'MIXED') {
        const gcashAmount = receipt.payment_method === 'GCASH' ? receipt.total : receipt.gcash_amount || 0;

        if (gcashAmount > 0) {
          await pool.query(
            `INSERT INTO gcash_entries (
              date, shift_type, reference_number, amount,
              guest_name, room_number, receipt_no, cashier_id,
              week_number, year
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              dateStr,
              shiftType,
              `GC-${receipt.receipt_no.replace(/[^0-9]/g, '').slice(-8)}`,
              gcashAmount,
              receipt.guest_name,
              receipt.room_number,
              receipt.receipt_no,
              receipt.cashier_id,
              week,
              year,
            ]
          );
        }
      }

      console.log(`✅ Weekly entry updated for ${dateStr} ${shiftType}`);
    } catch (err) {
      console.error('Error in onReceiptCreated:', err);
      throw err;
    }
  }

  /**
   * Called when processing checkouts - increment checkout count
   */
  async onCheckout(date: string, shiftType: 'DAY' | 'NIGHT'): Promise<void> {
    try {
      await pool.query(
        `UPDATE weekly_shift_entries
         SET checkout_count = checkout_count + 1, updated_at = NOW()
         WHERE date = $1 AND shift_type = $2`,
        [date, shiftType]
      );

      console.log(`✅ Checkout count incremented for ${date} ${shiftType}`);
    } catch (err) {
      console.error('Error in onCheckout:', err);
    }
  }

  /**
   * Called during shift handoff - increment transfer count
   */
  async onRoomTransfer(date: string, shiftType: 'DAY' | 'NIGHT'): Promise<void> {
    try {
      await pool.query(
        `UPDATE weekly_shift_entries
         SET transfer_count = transfer_count + 1, updated_at = NOW()
         WHERE date = $1 AND shift_type = $2`,
        [date, shiftType]
      );

      console.log(`✅ Transfer count incremented for ${date} ${shiftType}`);
    } catch (err) {
      console.error('Error in onRoomTransfer:', err);
    }
  }

  /**
   * Called at end of day - finalize daily totals
   */
  async finalizeDailyShifts(date: string): Promise<void> {
    try {
      // Get all receipts for the day
      const receipts = await pool.query(
        `SELECT * FROM receipts
         WHERE DATE(date_time) = $1`,
        [date]
      );

      // Aggregate by shift
      const dayReceipts = receipts.rows.filter((r) => {
        const hour = new Date(r.date_time).getHours();
        return hour >= 6 && hour < 18;
      });

      const nightReceipts = receipts.rows.filter((r) => {
        const hour = new Date(r.date_time).getHours();
        return hour < 6 || hour >= 18;
      });

      // Update shift entries with receipt count
      if (dayReceipts.length > 0) {
        await pool.query(
          `UPDATE weekly_shift_entries
           SET total_checkins = (
             SELECT COUNT(*) FROM receipts
             WHERE DATE(date_time) = $1 AND EXTRACT(HOUR FROM date_time) >= 6
             AND EXTRACT(HOUR FROM date_time) < 18
           )
           WHERE date = $1 AND shift_type = 'DAY'`,
          [date]
        );
      }

      if (nightReceipts.length > 0) {
        await pool.query(
          `UPDATE weekly_shift_entries
           SET total_checkins = (
             SELECT COUNT(*) FROM receipts
             WHERE DATE(date_time) = $1 AND (
               EXTRACT(HOUR FROM date_time) < 6 OR
               EXTRACT(HOUR FROM date_time) >= 18
             )
           )
           WHERE date = $1 AND shift_type = 'NIGHT'`,
          [date]
        );
      }

      console.log(`✅ Daily shifts finalized for ${date}`);
    } catch (err) {
      console.error('Error in finalizeDailyShifts:', err);
      throw err;
    }
  }

  /**
   * Called on Sunday night - create/finalize weekly summary
   */
  async finalizeWeekly(weekStart: string, operatorUsername: string): Promise<void> {
    try {
      const start = parseISO(weekStart);
      const end = endOfWeek(start, { weekStartsOn: 1 });
      const startStr = format(start, 'yyyy-MM-dd');
      const endStr = format(end, 'yyyy-MM-dd');

      await pool.query(
        `UPDATE weekly_expenses 
         SET finalized_at = datetime('now', 'localtime'), finalized_by = $1
         WHERE week_start = $2`,
        [operatorUsername, startStr]
      );

      // Log it
      console.log(`✅ Weekly summary finalized for ${startStr} by ${operatorUsername}`);
    } catch (err) {
      console.error('Error in finalizeWeekly:', err);
      throw err;
    }
  }

  /**
   * Get all shift entries for a week
   */
  async getWeeklyShifts(weekStart: string): Promise<any[]> {
    try {
      const start = parseISO(weekStart);
      const end = endOfWeek(start, { weekStartsOn: 1 });
      const startStr = format(start, 'yyyy-MM-dd');
      const endStr = format(end, 'yyyy-MM-dd');

      const result = await pool.query(
        `SELECT * FROM weekly_shift_entries
         WHERE date >= $1 AND date <= $2
         ORDER BY date, shift_type`,
        [startStr, endStr]
      );

      return result.rows;
    } catch (err) {
      console.error('Error in getWeeklyShifts:', err);
      throw err;
    }
  }

  /**
   * Get week expenses or create if doesn't exist
   */
  async getWeeklyExpenses(weekStart: string): Promise<any> {
    try {
      const start = parseISO(weekStart);
      const end = endOfWeek(start, { weekStartsOn: 1 });
      const startStr = format(start, 'yyyy-MM-dd');
      const endStr = format(end, 'yyyy-MM-dd');

      let result = await pool.query(
        `SELECT * FROM weekly_expenses WHERE week_start = ?`,
        [startStr]
      );

      if (result.rows.length === 0) {
        // Create default entry
        await pool.query(
          `INSERT IGNORE INTO weekly_expenses (week_start, week_end)
           VALUES (?, ?)`,
          [startStr, endStr]
        );

        result = await pool.query(
          `SELECT * FROM weekly_expenses WHERE week_start = ?`,
          [startStr]
        );
      }

      return result.rows[0];
    } catch (err) {
      console.error('Error in getWeeklyExpenses:', err);
      throw err;
    }
  }

  /**
   * Update weekly expense entry
   */
  async updateWeeklyExpenses(weekStart: string, expenses: any): Promise<any> {
    try {
      const start = parseISO(weekStart);
      const end = endOfWeek(start, { weekStartsOn: 1 });
      const startStr = format(start, 'yyyy-MM-dd');
      const endStr = format(end, 'yyyy-MM-dd');

      // Calculate totals
      const col1Total =
        (expenses.kitchen_expenses || 0) +
        (expenses.wilkins_pure || 0) +
        (expenses.ate_lanie_beddings || 0) +
        (expenses.krico_gas_laundry || 0) +
        (expenses.tissue_flexi_cling || 0) +
        (expenses.miscellaneous || 0) +
        (expenses.kovi || 0) +
        (expenses.cm_surc_rh || 0) +
        (expenses.lempo || 0) +
        (expenses.marbont || 0) +
        (expenses.aquapura || 0) +
        (expenses.andeng_store || 0) +
        (expenses.george_cable || 0) +
        (expenses.rh_meat || 0) +
        (expenses.coke_zero || 0) +
        (expenses.short_pau || 0) +
        (expenses.venyen_zonrox || 0);

      const col2Total = (expenses.vale_pau_cam_id || 0) + (expenses.admin_gretch_sa || 0);

      const customExpenses = expenses.custom_expenses || [];
      const customCol1Total = customExpenses
        .filter((e: any) => e.category === 'col1')
        .reduce((sum: number, e: any) => sum + (e.amount || 0), 0);
      const customCol2Total = customExpenses
        .filter((e: any) => e.category === 'col2')
        .reduce((sum: number, e: any) => sum + (e.amount || 0), 0);

      await pool.query(
        `INSERT INTO weekly_expenses (
          week_start, week_end,
          kitchen_expenses, wilkins_pure, ate_lanie_beddings, krico_gas_laundry,
          tissue_flexi_cling, miscellaneous, kovi, cm_surc_rh, lempo, marbont,
          aquapura, andeng_store, george_cable, rh_meat, coke_zero, short_pau,
          venyen_zonrox, vale_pau_cam_id, admin_gretch_sa, custom_expenses,
          total_expenses_col1, total_expenses_col2, total_expenses
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          kitchen_expenses = VALUES(kitchen_expenses),
          wilkins_pure = VALUES(wilkins_pure),
          ate_lanie_beddings = VALUES(ate_lanie_beddings),
          krico_gas_laundry = VALUES(krico_gas_laundry),
          tissue_flexi_cling = VALUES(tissue_flexi_cling),
          miscellaneous = VALUES(miscellaneous),
          kovi = VALUES(kovi),
          cm_surc_rh = VALUES(cm_surc_rh),
          lempo = VALUES(lempo),
          marbont = VALUES(marbont),
          aquapura = VALUES(aquapura),
          andeng_store = VALUES(andeng_store),
          george_cable = VALUES(george_cable),
          rh_meat = VALUES(rh_meat),
          coke_zero = VALUES(coke_zero),
          short_pau = VALUES(short_pau),
          venyen_zonrox = VALUES(venyen_zonrox),
          vale_pau_cam_id = VALUES(vale_pau_cam_id),
          admin_gretch_sa = VALUES(admin_gretch_sa),
          custom_expenses = VALUES(custom_expenses),
          total_expenses_col1 = VALUES(total_expenses_col1),
          total_expenses_col2 = VALUES(total_expenses_col2),
          total_expenses = VALUES(total_expenses),
          updated_at = NOW()`,
        [
          startStr,
          endStr,
          expenses.kitchen_expenses || 0,
          expenses.wilkins_pure || 0,
          expenses.ate_lanie_beddings || 0,
          expenses.krico_gas_laundry || 0,
          expenses.tissue_flexi_cling || 0,
          expenses.miscellaneous || 0,
          expenses.kovi || 0,
          expenses.cm_surc_rh || 0,
          expenses.lempo || 0,
          expenses.marbont || 0,
          expenses.aquapura || 0,
          expenses.andeng_store || 0,
          expenses.george_cable || 0,
          expenses.rh_meat || 0,
          expenses.coke_zero || 0,
          expenses.short_pau || 0,
          expenses.venyen_zonrox || 0,
          expenses.vale_pau_cam_id || 0,
          expenses.admin_gretch_sa || 0,
          JSON.stringify(customExpenses),
          col1Total + customCol1Total,
          col2Total + customCol2Total,
          col1Total + col2Total + customCol1Total + customCol2Total,
        ]
      );

      const fetchResult = await pool.query('SELECT * FROM weekly_expenses WHERE week_start = ?', [startStr]);
      console.log(`✅ Weekly expenses updated for ${startStr}`);
      return fetchResult.rows[0];
    } catch (err) {
      console.error('Error in updateWeeklyExpenses:', err);
      throw err;
    }
  }

  /**
   * Get GCash entries for week
   */
  async getWeeklyGCash(weekStart: string): Promise<any[]> {
    try {
      const start = parseISO(weekStart);
      const end = endOfWeek(start, { weekStartsOn: 1 });
      const startStr = format(start, 'yyyy-MM-dd');
      const endStr = format(end, 'yyyy-MM-dd');

      const result = await pool.query(
        `SELECT * FROM gcash_entries
         WHERE date >= $1 AND date <= $2
         ORDER BY date, shift_type`,
        [startStr, endStr]
      );

      return result.rows;
    } catch (err) {
      console.error('Error in getWeeklyGCash:', err);
      throw err;
    }
  }

  /**
   * Get cash denomination for week
   */
  async getWeeklyCashDenomination(weekStart: string): Promise<any> {
    try {
      const start = parseISO(weekStart);
      const startStr = format(start, 'yyyy-MM-dd');

      const result = await pool.query(
        `SELECT * FROM cash_denomination_report
         WHERE week_start = $1
         ORDER BY report_date DESC
         LIMIT 1`,
        [startStr]
      );

      return result.rows[0] || null;
    } catch (err) {
      console.error('Error in getWeeklyCashDenomination:', err);
      throw err;
    }
  }

  /**
   * Save cash denomination report
   */
  async saveCashDenomination(weekStart: string, data: any): Promise<any> {
    try {
      const start = parseISO(weekStart);
      const startStr = format(start, 'yyyy-MM-dd');
      const reportDate = format(new Date(), 'yyyy-MM-dd');

      const total1000 = (data.bills_1000_count || 0) * 1000;
      const total500 = (data.bills_500_count || 0) * 500;
      const total200 = (data.bills_200_count || 0) * 200;
      const total100 = (data.bills_100_count || 0) * 100;
      const total50 = (data.bills_50_count || 0) * 50;
      const coinsTotal = data.coins_total || 0;

      const grandTotal = total1000 + total500 + total200 + total100 + total50 + coinsTotal;

      await pool.query(
        `INSERT INTO cash_denomination_report (
          week_start, report_date,
          bills_1000_count, bills_500_count, bills_200_count, bills_100_count, bills_50_count,
          coins_total, total_1000, total_500, total_200, total_100, total_50,
          grand_total, received_by, counted_by
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          bills_1000_count = VALUES(bills_1000_count),
          bills_500_count = VALUES(bills_500_count),
          bills_200_count = VALUES(bills_200_count),
          bills_100_count = VALUES(bills_100_count),
          bills_50_count = VALUES(bills_50_count),
          coins_total = VALUES(coins_total),
          total_1000 = VALUES(total_1000),
          total_500 = VALUES(total_500),
          total_200 = VALUES(total_200),
          total_100 = VALUES(total_100),
          total_50 = VALUES(total_50),
          grand_total = VALUES(grand_total),
          received_by = VALUES(received_by),
          counted_by = VALUES(counted_by),
          updated_at = NOW()`,
        [
          startStr,
          reportDate,
          data.bills_1000_count || 0,
          data.bills_500_count || 0,
          data.bills_200_count || 0,
          data.bills_100_count || 0,
          data.bills_50_count || 0,
          coinsTotal,
          total1000,
          total500,
          total200,
          total100,
          total50,
          grandTotal,
          data.received_by || '',
          data.counted_by || '',
        ]
      );

      const fetchResult = await pool.query('SELECT * FROM cash_denomination_report WHERE report_date = ?', [reportDate]);
      console.log(`✅ Cash denomination saved for ${startStr}`);
      return fetchResult.rows[0];
    } catch (err) {
      console.error('Error in saveCashDenomination:', err);
      throw err;
    }
  }
}

// Export singleton
export const weeklyReportAggregator = new WeeklyReportAggregator();
