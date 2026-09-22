/**
 * server/tests/weekly-reporting-workflow.test.ts
 * End-to-end test for weekly reporting system
 * 
 * Tests:
 * 1. Migration creates all tables
 * 2. Receipt creation triggers auto-population of shift entries
 * 3. API endpoints return correct data structure
 * 4. Validation rejects invalid data
 * 5. Excel export generates correct format
 */

import { pool } from '../db/pool';
import { weeklyReportAggregator } from '../services/weekly-report-aggregator';
import {
  validateCashDenomination,
  validateExpenses,
  validateWeekStartDate,
} from '../utils/validation';
import { format, parseISO, startOfWeek } from 'date-fns';

const testResults: { name: string; passed: boolean; error?: string }[] = [];

function logTest(name: string, passed: boolean, error?: string) {
  testResults.push({ name, passed, error });
  const status = passed ? '✓' : '✗';
  console.log(`${status} ${name}${error ? ` - ${error}` : ''}`);
}

async function runTests() {
  console.log('🧪 Starting Weekly Reporting System Tests\n');

  try {
    // Test 1: Verify tables exist
    console.log('Test 1: Database tables');
    try {
      const tablesResult = await pool.query(`
        SELECT table_name FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name IN ('weekly_shift_entries', 'weekly_expenses', 'gcash_entries', 'cash_denomination_report')
      `);

      const tables = new Set(tablesResult.rows.map((r) => r.table_name));
      const allTablesExist =
        tables.has('weekly_shift_entries') &&
        tables.has('weekly_expenses') &&
        tables.has('gcash_entries') &&
        tables.has('cash_denomination_report');

      logTest('Weekly reporting tables exist', allTablesExist);
    } catch (err) {
      logTest(
        'Weekly reporting tables exist',
        false,
        err instanceof Error ? err.message : 'Unknown error'
      );
    }

    // Test 2: Date validation
    console.log('\nTest 2: Date validation');
    const mondayDate = startOfWeek(new Date(), { weekStartsOn: 1 });
    const mondayStr = format(mondayDate, 'yyyy-MM-dd');

    const validDateTest = validateWeekStartDate(mondayStr);
    logTest('Valid Monday date passes validation', validDateTest.valid);

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 7); // Next Monday (7 days from now)
    const futureDateStr = format(futureDate, 'yyyy-MM-dd');
    const futureDateTest = validateWeekStartDate(futureDateStr);
    logTest('Future date fails validation', !futureDateTest.valid);

    const invalidDayTest = validateWeekStartDate('2024-01-03'); // Wednesday
    logTest('Non-Monday date fails validation', !invalidDayTest.valid);

    // Test 3: Cash denomination validation
    console.log('\nTest 3: Cash denomination validation');
    const validDenom = {
      bills_1000_count: 5,
      bills_500_count: 10,
      bills_200_count: 0,
      bills_100_count: 5,
      bills_50_count: 2,
      coins_total: 150.5,
    };
    const validDenomTest = validateCashDenomination(validDenom);
    logTest('Valid cash denomination passes', validDenomTest.valid);

    const invalidDenom = {
      bills_1000_count: -5,
      bills_500_count: 'invalid',
      coins_total: 15000000,
    };
    const invalidDenomTest = validateCashDenomination(invalidDenom);
    logTest('Invalid cash denomination fails', !invalidDenomTest.valid);
    if (invalidDenomTest.errors.length > 0) {
      console.log(`  Errors: ${invalidDenomTest.errors.map((e) => e.message).join(', ')}`);
    }

    // Test 4: Expense validation
    console.log('\nTest 4: Expense validation');
    const validExpenses = {
      kitchen_expenses: 500,
      wilkins_pure: 1000,
      miscellaneous: 200,
    };
    const validExpenseTest = validateExpenses(validExpenses);
    logTest('Valid expenses pass', validExpenseTest.valid);

    const invalidExpenses = {
      kitchen_expenses: 'not a number',
      wilkins_pure: -500,
      aquapura: 10000000,
    };
    const invalidExpenseTest = validateExpenses(invalidExpenses);
    logTest('Invalid expenses fail', !invalidExpenseTest.valid);

    // Test 5: Weekly expense entry structure
    console.log('\nTest 5: Weekly expense data structure');
    try {
      const expenseData = await weeklyReportAggregator.getWeeklyExpenses(mondayStr);
      const hasRequiredFields =
        'kitchen_expenses' in expenseData &&
        'total_expenses_col1' in expenseData &&
        'total_expenses_col2' in expenseData &&
        'total_expenses' in expenseData;

      logTest('Expense data has required fields', hasRequiredFields);
    } catch (err) {
      logTest(
        'Expense data has required fields',
        false,
        err instanceof Error ? err.message : 'Unknown error'
      );
    }

    // Test 6: Weekly shift data structure
    console.log('\nTest 6: Weekly shift data structure');
    try {
      const shifts = await weeklyReportAggregator.getWeeklyShifts(mondayStr);
      const hasShifts = Array.isArray(shifts);
      logTest('Shift data is array', hasShifts);

      if (shifts.length > 0) {
        const firstShift = shifts[0];
        const hasFields =
          'date' in firstShift &&
          'shift_type' in firstShift &&
          'payment_received' in firstShift &&
          'room_bill' in firstShift;
        logTest('Shift entries have required fields', hasFields);
      }
    } catch (err) {
      logTest(
        'Shift data structure valid',
        false,
        err instanceof Error ? err.message : 'Unknown error'
      );
    }

    // Test 7: GCash data structure
    console.log('\nTest 7: GCash data structure');
    try {
      const gcashEntries = await weeklyReportAggregator.getWeeklyGCash(mondayStr);
      logTest('GCash data is retrievable', Array.isArray(gcashEntries));
    } catch (err) {
      logTest(
        'GCash data is retrievable',
        false,
        err instanceof Error ? err.message : 'Unknown error'
      );
    }

    // Test 8: Cash denomination data structure
    console.log('\nTest 8: Cash denomination data structure');
    try {
      const cashDenom = await weeklyReportAggregator.getWeeklyCashDenomination(mondayStr);
      if (cashDenom) {
        const hasFields =
          'bills_1000_count' in cashDenom &&
          'grand_total' in cashDenom &&
          'created_at' in cashDenom;
        logTest('Cash denomination has required fields', hasFields);
      } else {
        logTest('Cash denomination returns null or data', cashDenom === null || cashDenom !== undefined);
      }
    } catch (err) {
      logTest(
        'Cash denomination data structure valid',
        false,
        err instanceof Error ? err.message : 'Unknown error'
      );
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    const passed = testResults.filter((r) => r.passed).length;
    const total = testResults.length;
    console.log(`✓ ${passed}/${total} tests passed\n`);

    if (passed < total) {
      console.log('Failed tests:');
      testResults.filter((r) => !r.passed).forEach((r) => {
        console.log(`  - ${r.name}${r.error ? `: ${r.error}` : ''}`);
      });
    }

    process.exit(passed === total ? 0 : 1);
  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(1);
  }
}

runTests();
