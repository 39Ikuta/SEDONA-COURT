/**
 * server/routes/analytics.ts
 * Advanced Analytics & Accounting Summary API endpoints for Sedona Court PMS.
 *
 * GET /api/analytics/financial-summary  - Comprehensive P&L, RevPAR, ADR, Occupancy, Tender Splits, and Discounts
 * GET /api/analytics/channel-breakdown  - Departmental revenue splits (Rooms, Kitchen, Drinks, Extras, Miscell)
 * GET /api/analytics/daily-trends      - Daily revenue & occupancy timeline for charts
 */

import { Router, Request, Response } from 'express';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { startOfWeek, endOfWeek, parseISO, format, differenceInDays } from 'date-fns';
import { asyncHandler } from '../utils/async-handler';

const router = Router();
router.use(requireAuth);

const TOTAL_HOTEL_ROOMS = 32;

/**
 * GET /api/analytics/financial-summary
 * Query params:
 * - startDate (optional, YYYY-MM-DD)
 * - endDate (optional, YYYY-MM-DD)
 * - weekStart (optional, YYYY-MM-DD)
 */
router.get('/financial-summary', asyncHandler(async (req: Request, res: Response) => {
  try {
    let { startDate, endDate, weekStart } = req.query as {
      startDate?: string;
      endDate?: string;
      weekStart?: string;
    };

    if (weekStart && !startDate) {
      const parsedStart = parseISO(weekStart);
      const parsedEnd = endOfWeek(parsedStart, { weekStartsOn: 1 });
      startDate = format(parsedStart, 'yyyy-MM-dd');
      endDate = format(parsedEnd, 'yyyy-MM-dd');
    } else if (!startDate || !endDate) {
      const parsedStart = startOfWeek(new Date(), { weekStartsOn: 1 });
      const parsedEnd = endOfWeek(parsedStart, { weekStartsOn: 1 });
      startDate = format(parsedStart, 'yyyy-MM-dd');
      endDate = format(parsedEnd, 'yyyy-MM-dd');
    }

    // 1. Query receipts within the date range
    const receiptsResult = await pool.query(
      `SELECT * FROM receipts 
       WHERE DATE(date_time) >= ? AND DATE(date_time) <= ?
       ORDER BY date_time ASC`,
      [startDate, endDate]
    );
    const receipts = receiptsResult.rows;

    // 2. Query expenses within the date range
    const expensesResult = await pool.query(
      `SELECT * FROM weekly_expenses 
       WHERE week_start >= ? AND week_start <= ?`,
      [startDate, endDate]
    );
    const expensesRows = expensesResult.rows;

    // 3. Query shift entries within the date range
    const shiftsResult = await pool.query(
      `SELECT * FROM weekly_shift_entries 
       WHERE date >= ? AND date <= ?
       ORDER BY date ASC, shift_type ASC`,
      [startDate, endDate]
    );
    const shifts = shiftsResult.rows;

    // 4. Query live rooms for real-time occupancy
    const roomsResult = await pool.query('SELECT * FROM rooms');
    const rooms = roomsResult.rows;
    const currentOccupied = rooms.filter(r => r.state === 'occupied' || r.state === 'overdue').length;
    const liveOccupancyRate = TOTAL_HOTEL_ROOMS > 0 ? (currentOccupied / TOTAL_HOTEL_ROOMS) * 100 : 0;

    // --- Financial Calculations ---
    let totalRevenueFromReceipts = 0;
    let totalCashReceived = 0;
    let totalGCashReceived = 0;
    let totalSeniorPwdDiscounts = 0;
    let seniorPwdDiscountCount = 0;

    let roomRevenue = 0;
    let kitchenRevenue = 0;
    let drinksRevenue = 0;
    let extrasRevenue = 0;
    let miscellRevenue = 0;

    let totalCheckinsCount = 0;

    receipts.forEach((r: any) => {
      const total = parseFloat(r.total || 0);
      totalRevenueFromReceipts += total;

      // Tender breakdown
      if (r.payment_method === 'CASH') {
        totalCashReceived += total;
      } else if (r.payment_method === 'GCASH') {
        totalGCashReceived += total;
      } else if (r.payment_method === 'MIXED') {
        totalCashReceived += parseFloat(r.cash_amount || 0);
        totalGCashReceived += parseFloat(r.gcash_amount || 0);
      }

      // Parse items
      let items: any[] = [];
      try {
        items = typeof r.items === 'string' ? JSON.parse(r.items) : (r.items || []);
      } catch (_) {
        items = [];
      }

      items.forEach((it: any) => {
        const desc = (it.description || '').toLowerCase();
        const amt = parseFloat(it.amount || 0);

        if (desc.includes('discount') || desc.includes('pwd') || desc.includes('senior')) {
          totalSeniorPwdDiscounts += Math.abs(amt);
          seniorPwdDiscountCount++;
        } else if (desc.includes('room') || desc.includes('stay') || desc.includes('rent')) {
          roomRevenue += amt;
          totalCheckinsCount++;
        } else if (desc.includes('kitchen') || desc.includes('food') || desc.includes('silog') || desc.includes('meal') || desc.includes('sandwich')) {
          kitchenRevenue += amt;
        } else if (desc.includes('drink') || desc.includes('coffee') || desc.includes('water') || desc.includes('beer') || desc.includes('shake') || desc.includes('soda')) {
          drinksRevenue += amt;
        } else if (desc.includes('extra bed') || desc.includes('towel') || desc.includes('pillow') || desc.includes('extra person')) {
          extrasRevenue += amt;
        } else {
          miscellRevenue += amt;
        }
      });
    });

    // If shift entries exist, integrate shift-level revenue
    let shiftsTotalRevenue = 0;
    let shiftsRoomRevenue = 0;
    let shiftsKitchenRevenue = 0;
    let shiftsDrinksRevenue = 0;
    let shiftsExtrasRevenue = 0;
    let shiftsMiscRevenue = 0;
    let shiftsTotalCheckins = 0;

    shifts.forEach((s: any) => {
      shiftsTotalRevenue += parseFloat(s.payment_received || 0);
      shiftsRoomRevenue += parseFloat(s.room_bill || 0);
      shiftsKitchenRevenue += parseFloat(s.kitchen_bill || 0);
      shiftsDrinksRevenue += parseFloat(s.drinks_bill || 0);
      shiftsExtrasRevenue += parseFloat(s.extras || 0);
      shiftsMiscRevenue += parseFloat(s.miscell_purchases || 0);
      shiftsTotalCheckins += Number(s.total_checkins || 0);
    });

    // Determine final gross figures
    const finalGrossRevenue = shiftsTotalRevenue > 0 ? shiftsTotalRevenue : totalRevenueFromReceipts;
    const finalRoomRevenue = shiftsRoomRevenue > 0 ? shiftsRoomRevenue : roomRevenue;
    const finalKitchenRevenue = shiftsKitchenRevenue > 0 ? shiftsKitchenRevenue : kitchenRevenue;
    const finalDrinksRevenue = shiftsDrinksRevenue > 0 ? shiftsDrinksRevenue : drinksRevenue;
    const finalExtrasRevenue = shiftsExtrasRevenue > 0 ? shiftsExtrasRevenue : extrasRevenue;
    const finalMiscRevenue = shiftsMiscRevenue > 0 ? shiftsMiscRevenue : miscellRevenue;
    const finalCheckinCount = shiftsTotalCheckins > 0 ? shiftsTotalCheckins : (totalCheckinsCount || currentOccupied);

    // Sum expenses
    let totalExpenses = 0;
    let col1Expenses = 0;
    let col2Expenses = 0;

    expensesRows.forEach((exp: any) => {
      totalExpenses += parseFloat(exp.total_expenses || 0);
      col1Expenses += parseFloat(exp.total_expenses_col1 || 0);
      col2Expenses += parseFloat(exp.total_expenses_col2 || 0);
    });

    const netOperatingProfit = finalGrossRevenue - totalExpenses;
    const netProfitMargin = finalGrossRevenue > 0 ? (netOperatingProfit / finalGrossRevenue) * 100 : 0;

    // Hospitality Metrics (ADR & RevPAR)
    const daysInPeriod = Math.max(1, differenceInDays(parseISO(endDate), parseISO(startDate)) + 1);
    const availableRoomNights = TOTAL_HOTEL_ROOMS * daysInPeriod;
    const adr = finalCheckinCount > 0 ? finalRoomRevenue / finalCheckinCount : 0;
    const revPar = availableRoomNights > 0 ? finalRoomRevenue / availableRoomNights : 0;

    res.json({
      period: {
        startDate,
        endDate,
        days: daysInPeriod,
        label: `${format(parseISO(startDate), 'MMM dd')} - ${format(parseISO(endDate), 'MMM dd, yyyy')}`,
      },
      kpi: {
        grossRevenue: parseFloat(finalGrossRevenue.toFixed(2)),
        totalExpenses: parseFloat(totalExpenses.toFixed(2)),
        netOperatingProfit: parseFloat(netOperatingProfit.toFixed(2)),
        netProfitMarginPercent: parseFloat(netProfitMargin.toFixed(1)),
        occupancyRatePercent: parseFloat(liveOccupancyRate.toFixed(1)),
        currentOccupiedRooms: currentOccupied,
        totalAvailableRooms: TOTAL_HOTEL_ROOMS,
        totalCheckins: finalCheckinCount,
        adr: parseFloat(adr.toFixed(2)),
        revPar: parseFloat(revPar.toFixed(2)),
      },
      tenders: {
        cash: parseFloat(totalCashReceived.toFixed(2)),
        gcash: parseFloat(totalGCashReceived.toFixed(2)),
        cashPercent: finalGrossRevenue > 0 ? parseFloat(((totalCashReceived / finalGrossRevenue) * 100).toFixed(1)) : 0,
        gcashPercent: finalGrossRevenue > 0 ? parseFloat(((totalGCashReceived / finalGrossRevenue) * 100).toFixed(1)) : 0,
        receiptsCount: receipts.length,
      },
      channels: {
        room: parseFloat(finalRoomRevenue.toFixed(2)),
        kitchen: parseFloat(finalKitchenRevenue.toFixed(2)),
        drinks: parseFloat(finalDrinksRevenue.toFixed(2)),
        extras: parseFloat(finalExtrasRevenue.toFixed(2)),
        miscell: parseFloat(finalMiscRevenue.toFixed(2)),
      },
      discounts: {
        seniorPwdTotal: parseFloat(totalSeniorPwdDiscounts.toFixed(2)),
        count: seniorPwdDiscountCount,
      },
      expensesBreakdown: {
        col1Subtotal: parseFloat(col1Expenses.toFixed(2)),
        col2Subtotal: parseFloat(col2Expenses.toFixed(2)),
        total: parseFloat(totalExpenses.toFixed(2)),
      },
    });
  } catch (err) {
    console.error('GET /api/analytics/financial-summary error:', err);
    res.status(500).json({ error: 'Failed to generate financial summary' });
  }
}));

export default router;
