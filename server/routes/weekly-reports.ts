/**
 * server/routes/weekly-reports.ts
 * API endpoints for weekly reporting system
 *
 * GET  /api/weekly-reports/:weekStart         - Get all data for a week
 * GET  /api/weekly-reports/:weekStart/shifts  - Get shift entries only
 * GET  /api/weekly-reports/:weekStart/expenses - Get expenses only
 * GET  /api/weekly-reports/:weekStart/gcash   - Get GCash entries only
 * POST /api/weekly-reports/:weekStart/expenses - Update expenses
 * POST /api/weekly-reports/:weekStart/cash-denom - Save cash denomination
 * POST /api/weekly-reports/:weekStart/finalize - Finalize weekly report
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { weeklyReportAggregator } from '../services/weekly-report-aggregator';
import { format, parseISO, startOfWeek, endOfWeek } from 'date-fns';
import {
  validateCashDenomination,
  validateExpenses,
  validateWeekStartDate,
  formatValidationErrors,
} from '../utils/validation';
import { asyncHandler } from '../utils/async-handler';

const router = Router();

/**
 * GET /api/weekly-reports/:weekStart
 * Returns complete weekly data: shifts, expenses, gcash, cash denomination
 */
router.get('/:weekStart', asyncHandler(async (req: Request, res: Response) => {
  try {
    const { weekStart } = req.params;

    // Validate date format
    const dateValidation = validateWeekStartDate(weekStart);
    if (!dateValidation.valid) {
      return res.status(400).json({
        error: 'Invalid date',
        details: formatValidationErrors(dateValidation.errors),
      });
    }

    try {
      parseISO(weekStart);
    } catch {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    // Get all data for the week
    const [rawShifts, rawExpenses, rawGCash, cashDenom] = await Promise.all([
      weeklyReportAggregator.getWeeklyShifts(weekStart).catch(() => []),
      weeklyReportAggregator.getWeeklyExpenses(weekStart).catch(() => ({})),
      weeklyReportAggregator.getWeeklyGCash(weekStart).catch(() => []),
      weeklyReportAggregator.getWeeklyCashDenomination(weekStart).catch(() => null),
    ]);

    const shifts = Array.isArray(rawShifts) ? rawShifts : [];
    const expenses = rawExpenses || {};
    const gcashEntries = Array.isArray(rawGCash) ? rawGCash : [];

    // Calculate totals
    const totalRevenue = shifts.reduce((sum, s) => sum + parseFloat(s.payment_received || 0), 0);
    const totalGCash = gcashEntries.reduce((sum, g) => sum + parseFloat(g.amount || 0), 0);
    const totalExpenses = parseFloat(expenses.total_expenses || 0);
    const netProfit = totalRevenue - totalExpenses;

    const start = parseISO(weekStart);
    const end = endOfWeek(start, { weekStartsOn: 1 });

    let customExpenses: any[] = [];
    if (expenses.custom_expenses) {
      try {
        customExpenses = typeof expenses.custom_expenses === 'string'
          ? JSON.parse(expenses.custom_expenses)
          : expenses.custom_expenses;
      } catch {
        console.warn('weekly-reports: Failed to parse custom_expenses JSON');
        customExpenses = [];
      }
    }

    res.json({
      period: {
        weekStart: format(start, 'yyyy-MM-dd'),
        weekEnd: format(end, 'yyyy-MM-dd'),
        weekLabel: `${format(start, 'MMM dd')} - ${format(end, 'MMM dd, yyyy')}`,
      },
      shifts: shifts.map((s) => ({
        date: s.date,
        dayOfWeek: s.day_of_week,
        shiftType: s.shift_type,
        cashier: s.cashier_name,
        totalCheckins: Number(s.total_checkins || 0),
        checkoutCount: Number(s.checkout_count || 0),
        transferCount: Number(s.transfer_count || 0),
        roomBill: parseFloat(s.room_bill || 0),
        kitchenBill: parseFloat(s.kitchen_bill || 0),
        drinksBill: parseFloat(s.drinks_bill || 0),
        miscellPurchases: parseFloat(s.miscell_purchases || 0),
        extras: parseFloat(s.extras || 0),
        discount: parseFloat(s.discount || 0),
        paymentReceived: parseFloat(s.payment_received || 0),
      })),
      expenses: {
        col1: {
          kitchenExpenses: parseFloat(expenses.kitchen_expenses || 0),
          wilkinsPure: parseFloat(expenses.wilkins_pure || 0),
          ateLanieBeddings: parseFloat(expenses.ate_lanie_beddings || 0),
          kricoGasLaundry: parseFloat(expenses.krico_gas_laundry || 0),
          tissueFlexiCling: parseFloat(expenses.tissue_flexi_cling || 0),
          miscellaneous: parseFloat(expenses.miscellaneous || 0),
          kovi: parseFloat(expenses.kovi || 0),
          cmSurcRh: parseFloat(expenses.cm_surc_rh || 0),
          lempo: parseFloat(expenses.lempo || 0),
          marbont: parseFloat(expenses.marbont || 0),
          aquapura: parseFloat(expenses.aquapura || 0),
          andengStore: parseFloat(expenses.andeng_store || 0),
          georgeCable: parseFloat(expenses.george_cable || 0),
          rhMeat: parseFloat(expenses.rh_meat || 0),
          cokeZero: parseFloat(expenses.coke_zero || 0),
          shortPau: parseFloat(expenses.short_pau || 0),
          venyenZonrox: parseFloat(expenses.venyen_zonrox || 0),
          subtotal: parseFloat(expenses.total_expenses_col1 || 0),
        },
        col2: {
          valePauCamId: parseFloat(expenses.vale_pau_cam_id || 0),
          adminGretchSa: parseFloat(expenses.admin_gretch_sa || 0),
          subtotal: parseFloat(expenses.total_expenses_col2 || 0),
        },
        customExpenses: customExpenses,
        total: parseFloat(expenses.total_expenses || 0),
      },
      gcash: {
        entries: gcashEntries.map((g) => ({
          id: g.id,
          date: g.date,
          shiftType: g.shift_type,
          referenceNumber: g.reference_number,
          amount: parseFloat(g.amount || 0),
          guestName: g.guest_name,
          roomNumber: g.room_number,
          receiptNo: g.receipt_no,
        })),
        total: totalGCash,
      },
      cashDenomination: cashDenom
        ? {
            bills1000Count: Number(cashDenom.bills_1000_count || 0),
            bills500Count: Number(cashDenom.bills_500_count || 0),
            bills200Count: Number(cashDenom.bills_200_count || 0),
            bills100Count: Number(cashDenom.bills_100_count || 0),
            bills50Count: Number(cashDenom.bills_50_count || 0),
            coinsTotal: parseFloat(cashDenom.coins_total || 0),
            total1000: parseFloat(cashDenom.total_1000 || 0),
            total500: parseFloat(cashDenom.total_500 || 0),
            total200: parseFloat(cashDenom.total_200 || 0),
            total100: parseFloat(cashDenom.total_100 || 0),
            total50: parseFloat(cashDenom.total_50 || 0),
            grandTotal: parseFloat(cashDenom.grand_total || 0),
            receivedBy: cashDenom.received_by,
            countedBy: cashDenom.counted_by,
          }
        : null,
      summary: {
        totalRevenue,
        totalGCash,
        totalExpenses,
        netProfit,
      },
    });
  } catch (err) {
    console.error('GET /weekly-reports/:weekStart error:', err);
    res.status(500).json({ error: 'Failed to fetch weekly report' });
  }
}));

/**
 * GET /api/weekly-reports/:weekStart/shifts
 * Get shift entries only (for direct table display)
 */
router.get('/:weekStart/shifts', asyncHandler(async (req: Request, res: Response) => {
  try {
    const { weekStart } = req.params;

    const rawShifts = await weeklyReportAggregator.getWeeklyShifts(weekStart);
    const shifts = Array.isArray(rawShifts) ? rawShifts : [];

    res.json({
      weekStart,
      count: shifts.length,
      shifts: shifts.map((s) => ({
        id: s.id,
        date: s.date,
        dayOfWeek: s.day_of_week,
        shiftType: s.shift_type,
        cashier: s.cashier_name,
        totalCheckins: Number(s.total_checkins || 0),
        checkoutCount: Number(s.checkout_count || 0),
        transferCount: Number(s.transfer_count || 0),
        roomBill: parseFloat(s.room_bill || 0),
        kitchenBill: parseFloat(s.kitchen_bill || 0),
        drinksBill: parseFloat(s.drinks_bill || 0),
        miscellPurchases: parseFloat(s.miscell_purchases || 0),
        extras: parseFloat(s.extras || 0),
        discount: parseFloat(s.discount || 0),
        paymentReceived: parseFloat(s.payment_received || 0),
      })),
    });
  } catch (err) {
    console.error('GET /weekly-reports/:weekStart/shifts error:', err);
    res.status(500).json({ error: 'Failed to fetch shift entries' });
  }
}));

/**
 * GET /api/weekly-reports/:weekStart/expenses
 * Get expenses only
 */
router.get('/:weekStart/expenses', asyncHandler(async (req: Request, res: Response) => {
  try {
    const { weekStart } = req.params;

    const rawExpenses = await weeklyReportAggregator.getWeeklyExpenses(weekStart);
    const expenses = rawExpenses || {};

    let customExpenses: any[] = [];
    if (expenses.custom_expenses) {
      try {
        customExpenses = typeof expenses.custom_expenses === 'string'
          ? JSON.parse(expenses.custom_expenses)
          : expenses.custom_expenses;
      } catch {
        console.warn('weekly-reports expenses: Failed to parse custom_expenses JSON');
        customExpenses = [];
      }
    }

    res.json({
      weekStart,
      col1: {
        kitchen: parseFloat(expenses.kitchen_expenses || 0),
        wilkinsPure: parseFloat(expenses.wilkins_pure || 0),
        ateLanieBeddings: parseFloat(expenses.ate_lanie_beddings || 0),
        kricoGasLaundry: parseFloat(expenses.krico_gas_laundry || 0),
        tissueFlexiCling: parseFloat(expenses.tissue_flexi_cling || 0),
        miscellaneous: parseFloat(expenses.miscellaneous || 0),
        kovi: parseFloat(expenses.kovi || 0),
        cmSurcRh: parseFloat(expenses.cm_surc_rh || 0),
        lempo: parseFloat(expenses.lempo || 0),
        marbont: parseFloat(expenses.marbont || 0),
        aquapura: parseFloat(expenses.aquapura || 0),
        andengStore: parseFloat(expenses.andeng_store || 0),
        georgeCable: parseFloat(expenses.george_cable || 0),
        rhMeat: parseFloat(expenses.rh_meat || 0),
        cokeZero: parseFloat(expenses.coke_zero || 0),
        shortPau: parseFloat(expenses.short_pau || 0),
        venyenZonrox: parseFloat(expenses.venyen_zonrox || 0),
        subtotal: parseFloat(expenses.total_expenses_col1 || 0),
      },
      col2: {
        valePauCamId: parseFloat(expenses.vale_pau_cam_id || 0),
        adminGretchSa: parseFloat(expenses.admin_gretch_sa || 0),
        subtotal: parseFloat(expenses.total_expenses_col2 || 0),
      },
      customExpenses: customExpenses,
      total: parseFloat(expenses.total_expenses || 0),
    });
  } catch (err) {
    console.error('GET /weekly-reports/:weekStart/expenses error:', err);
    res.status(500).json({ error: 'Failed to fetch expenses' });
  }
}));

/**
 * GET /api/weekly-reports/:weekStart/gcash
 * Get GCash entries
 */
router.get('/:weekStart/gcash', asyncHandler(async (req: Request, res: Response) => {
  try {
    const { weekStart } = req.params;

    const rawEntries = await weeklyReportAggregator.getWeeklyGCash(weekStart);
    const entries = Array.isArray(rawEntries) ? rawEntries : [];
    const total = entries.reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);

    res.json({
      weekStart,
      count: entries.length,
      total,
      entries: entries.map((e) => ({
        id: e.id,
        date: e.date,
        shiftType: e.shift_type,
        referenceNumber: e.reference_number,
        amount: parseFloat(e.amount || 0),
        guestName: e.guest_name,
        roomNumber: e.room_number,
        receiptNo: e.receipt_no,
      })),
    });
  } catch (err) {
    console.error('GET /weekly-reports/:weekStart/gcash error:', err);
    res.status(500).json({ error: 'Failed to fetch GCash entries' });
  }
}));

/**
 * POST /api/weekly-reports/:weekStart/expenses
 * Update expenses for the week
 */
router.post('/:weekStart/expenses', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  try {
    const { weekStart } = req.params;
    const expenses = req.body;

    // Validate week start date
    const dateValidation = validateWeekStartDate(weekStart);
    if (!dateValidation.valid) {
      return res.status(400).json({
        error: 'Invalid date',
        details: formatValidationErrors(dateValidation.errors),
      });
    }

    // Validate expense data
    const expenseValidation = validateExpenses(expenses);
    if (!expenseValidation.valid) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationErrors(expenseValidation.errors),
      });
    }

    const updated = await weeklyReportAggregator.updateWeeklyExpenses(weekStart, expenses);

    res.json({
      success: true,
      message: 'Expenses updated',
      data: {
        col1Total: parseFloat(updated.total_expenses_col1 || 0),
        col2Total: parseFloat(updated.total_expenses_col2 || 0),
        total: parseFloat(updated.total_expenses || 0),
      },
    });
  } catch (err) {
    console.error('POST /weekly-reports/:weekStart/expenses error:', err);
    res.status(500).json({ error: 'Failed to update expenses' });
  }
}));

/**
 * POST /api/weekly-reports/:weekStart/cash-denom
 * Save cash denomination report
 */
router.post('/:weekStart/cash-denom', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  try {
    const { weekStart } = req.params;
    const { bills_1000_count, bills_500_count, bills_200_count, bills_100_count, bills_50_count, coins_total, received_by, counted_by } = req.body;

    // Validate week start date
    const dateValidation = validateWeekStartDate(weekStart);
    if (!dateValidation.valid) {
      return res.status(400).json({
        error: 'Invalid date',
        details: formatValidationErrors(dateValidation.errors),
      });
    }

    // Validate cash denomination data
    const denomValidation = validateCashDenomination({
      bills_1000_count,
      bills_500_count,
      bills_200_count,
      bills_100_count,
      bills_50_count,
      coins_total,
    });

    if (!denomValidation.valid) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationErrors(denomValidation.errors),
      });
    }

    const saved = await weeklyReportAggregator.saveCashDenomination(weekStart, {
      bills_1000_count,
      bills_500_count,
      bills_200_count,
      bills_100_count,
      bills_50_count,
      coins_total,
      received_by,
      counted_by,
    });

    res.json({
      success: true,
      message: 'Cash denomination saved',
      data: {
        total1000: parseFloat(saved.total_1000 || 0),
        total500: parseFloat(saved.total_500 || 0),
        total200: parseFloat(saved.total_200 || 0),
        total100: parseFloat(saved.total_100 || 0),
        total50: parseFloat(saved.total_50 || 0),
        coinsTotal: parseFloat(saved.coins_total || 0),
        grandTotal: parseFloat(saved.grand_total || 0),
      },
    });
  } catch (err) {
    console.error('POST /weekly-reports/:weekStart/cash-denom error:', err);
    res.status(500).json({ error: 'Failed to save cash denomination' });
  }
}));

/**
 * POST /api/weekly-reports/:weekStart/finalize
 * Finalize the weekly report (lock for the week)
 */
router.post('/:weekStart/finalize', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  try {
    const { weekStart } = req.params;
    const operator = (req as any).operator;

    // Only admin or owner can finalize
    if (operator.role !== 'admin' && operator.role !== 'owner') {
      return res.status(403).json({ error: 'Only admin or owner can finalize reports' });
    }

    // Run finalization
    await weeklyReportAggregator.finalizeWeekly(weekStart);

    // Get final data
    const [shifts, expenses, gcashEntries] = await Promise.all([
      weeklyReportAggregator.getWeeklyShifts(weekStart),
      weeklyReportAggregator.getWeeklyExpenses(weekStart),
      weeklyReportAggregator.getWeeklyGCash(weekStart),
    ]);

    const totalRevenue = shifts.reduce((sum, s) => sum + parseFloat(s.payment_received || 0), 0);
    const totalGCash = gcashEntries.reduce((sum, g) => sum + parseFloat(g.amount || 0), 0);
    const totalExpenses = parseFloat(expenses.total_expenses || 0);

    res.json({
      success: true,
      message: 'Weekly report finalized',
      summary: {
        weekStart,
        shiftsCount: shifts.length,
        totalRevenue: parseFloat(totalRevenue.toFixed(2)),
        totalGCash: parseFloat(totalGCash.toFixed(2)),
        totalExpenses: parseFloat(totalExpenses.toFixed(2)),
        netProfit: parseFloat((totalRevenue - totalExpenses).toFixed(2)),
        finalizedBy: operator.username,
        finalizedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('POST /weekly-reports/:weekStart/finalize error:', err);
    res.status(500).json({ error: 'Failed to finalize weekly report' });
  }
}));

export default router;
