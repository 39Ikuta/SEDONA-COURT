/**
 * server/utils/validation.ts
 * Validation utilities for weekly reporting system
 */

export interface ValidationError {
  field: string;
  message: string;
  value?: any;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Validate cash denomination data
 */
export function validateCashDenomination(data: any): ValidationResult {
  const errors: ValidationError[] = [];

  if (data.bills_1000_count !== undefined) {
    if (!Number.isInteger(data.bills_1000_count)) {
      errors.push({ field: 'bills_1000_count', message: 'Must be an integer', value: data.bills_1000_count });
    } else if (data.bills_1000_count < 0) {
      errors.push({ field: 'bills_1000_count', message: 'Cannot be negative', value: data.bills_1000_count });
    } else if (data.bills_1000_count > 10000) {
      errors.push({ field: 'bills_1000_count', message: 'Unreasonably high value', value: data.bills_1000_count });
    }
  }

  if (data.bills_500_count !== undefined) {
    if (!Number.isInteger(data.bills_500_count)) {
      errors.push({ field: 'bills_500_count', message: 'Must be an integer', value: data.bills_500_count });
    } else if (data.bills_500_count < 0) {
      errors.push({ field: 'bills_500_count', message: 'Cannot be negative', value: data.bills_500_count });
    } else if (data.bills_500_count > 10000) {
      errors.push({ field: 'bills_500_count', message: 'Unreasonably high value', value: data.bills_500_count });
    }
  }

  if (data.bills_200_count !== undefined) {
    if (!Number.isInteger(data.bills_200_count)) {
      errors.push({ field: 'bills_200_count', message: 'Must be an integer', value: data.bills_200_count });
    } else if (data.bills_200_count < 0) {
      errors.push({ field: 'bills_200_count', message: 'Cannot be negative', value: data.bills_200_count });
    } else if (data.bills_200_count > 10000) {
      errors.push({ field: 'bills_200_count', message: 'Unreasonably high value', value: data.bills_200_count });
    }
  }

  if (data.bills_100_count !== undefined) {
    if (!Number.isInteger(data.bills_100_count)) {
      errors.push({ field: 'bills_100_count', message: 'Must be an integer', value: data.bills_100_count });
    } else if (data.bills_100_count < 0) {
      errors.push({ field: 'bills_100_count', message: 'Cannot be negative', value: data.bills_100_count });
    } else if (data.bills_100_count > 10000) {
      errors.push({ field: 'bills_100_count', message: 'Unreasonably high value', value: data.bills_100_count });
    }
  }

  if (data.bills_50_count !== undefined) {
    if (!Number.isInteger(data.bills_50_count)) {
      errors.push({ field: 'bills_50_count', message: 'Must be an integer', value: data.bills_50_count });
    } else if (data.bills_50_count < 0) {
      errors.push({ field: 'bills_50_count', message: 'Cannot be negative', value: data.bills_50_count });
    } else if (data.bills_50_count > 10000) {
      errors.push({ field: 'bills_50_count', message: 'Unreasonably high value', value: data.bills_50_count });
    }
  }

  if (data.coins_total !== undefined) {
    if (typeof data.coins_total !== 'number') {
      errors.push({ field: 'coins_total', message: 'Must be a number', value: data.coins_total });
    } else if (data.coins_total < 0) {
      errors.push({ field: 'coins_total', message: 'Cannot be negative', value: data.coins_total });
    } else if (data.coins_total > 100000) {
      errors.push({ field: 'coins_total', message: 'Unreasonably high value', value: data.coins_total });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate expense data
 */
export function validateExpenses(data: any): ValidationResult {
  const errors: ValidationError[] = [];

  const numericFields = [
    'kitchen_expenses',
    'wilkins_pure',
    'ate_lanie_beddings',
    'krico_gas_laundry',
    'tissue_flexi_cling',
    'miscellaneous',
    'kovi',
    'cm_surc_rh',
    'lempo',
    'marbont',
    'aquapura',
    'andeng_store',
    'george_cable',
    'rh_meat',
    'coke_zero',
    'short_pau',
    'venyen_zonrox',
    'vale_pau_cam_id',
    'admin_gretch_sa',
  ];

  numericFields.forEach((field) => {
    if (data[field] !== undefined) {
      const value = data[field];
      if (typeof value !== 'number' && typeof value !== 'string') {
        errors.push({ field, message: 'Must be a number', value });
      } else if (typeof value === 'string') {
        const parsed = parseFloat(value);
        if (isNaN(parsed)) {
          errors.push({ field, message: 'Must be a valid number', value });
        } else if (parsed < 0) {
          errors.push({ field, message: 'Cannot be negative', value });
        } else if (parsed > 1000000) {
          errors.push({ field, message: 'Unreasonably high value', value });
        }
      } else if (value < 0) {
        errors.push({ field, message: 'Cannot be negative', value });
      } else if (value > 1000000) {
        errors.push({ field, message: 'Unreasonably high value', value });
      }
    }
  });

  // Validate custom expenses if provided
  if (data.custom_expenses) {
    if (!Array.isArray(data.custom_expenses)) {
      errors.push({ field: 'custom_expenses', message: 'Must be an array', value: data.custom_expenses });
    } else {
      data.custom_expenses.forEach((expense: any, idx: number) => {
        if (typeof expense.amount !== 'number' || expense.amount < 0 || expense.amount > 1000000) {
          errors.push({
            field: `custom_expenses[${idx}].amount`,
            message: 'Invalid amount',
            value: expense.amount,
          });
        }
        if (typeof expense.name !== 'string' || expense.name.trim().length === 0) {
          errors.push({
            field: `custom_expenses[${idx}].name`,
            message: 'Name is required',
            value: expense.name,
          });
        }
        if (!['col1', 'col2'].includes(expense.category)) {
          errors.push({
            field: `custom_expenses[${idx}].category`,
            message: 'Must be col1 or col2',
            value: expense.category,
          });
        }
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate week start date
 */
export function validateWeekStartDate(dateStr: string): ValidationResult {
  const errors: ValidationError[] = [];

  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      errors.push({ field: 'weekStart', message: 'Invalid date format', value: dateStr });
      return { valid: false, errors };
    }

    // Check if it's a Monday (start of week)
    if (date.getDay() !== 1) {
      errors.push({
        field: 'weekStart',
        message: 'Date must be a Monday (start of week)',
        value: dateStr,
      });
    }

    // Check if date is not in the future (allow today)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (date > today) {
      errors.push({
        field: 'weekStart',
        message: 'Date cannot be in the future',
        value: dateStr,
      });
    }

    // Check if date is not too far in the past (>2 years)
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    if (date < twoYearsAgo) {
      errors.push({
        field: 'weekStart',
        message: 'Date is too far in the past',
        value: dateStr,
      });
    }
  } catch (err) {
    errors.push({ field: 'weekStart', message: 'Invalid date', value: dateStr });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate shift entry
 */
export function validateShiftEntry(data: any): ValidationResult {
  const errors: ValidationError[] = [];

  const numericFields = [
    'totalCheckins',
    'checkoutCount',
    'transferCount',
    'roomBill',
    'kitchenBill',
    'drinksBill',
    'miscellPurchases',
    'extras',
    'discount',
    'paymentReceived',
  ];

  numericFields.forEach((field) => {
    if (data[field] !== undefined) {
      const value = data[field];
      if (typeof value !== 'number') {
        errors.push({ field, message: 'Must be a number', value });
      } else if (value < 0) {
        errors.push({ field, message: 'Cannot be negative', value });
      } else if (value > 10000000) {
        errors.push({ field, message: 'Unreasonably high value', value });
      }
    }
  });

  if (data.shiftType && !['DAY', 'NIGHT'].includes(data.shiftType)) {
    errors.push({ field: 'shiftType', message: 'Must be DAY or NIGHT', value: data.shiftType });
  }

  if (data.cashier && (typeof data.cashier !== 'string' || data.cashier.trim().length === 0)) {
    errors.push({ field: 'cashier', message: 'Cashier name is required', value: data.cashier });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate receipt for weekly aggregation
 */
export function validateReceiptForAggregation(receipt: any): ValidationResult {
  const errors: ValidationError[] = [];

  if (!receipt.receiptNo || typeof receipt.receiptNo !== 'string') {
    errors.push({ field: 'receiptNo', message: 'Receipt number is required', value: receipt.receiptNo });
  }

  if (!receipt.dateTime || typeof receipt.dateTime !== 'string') {
    errors.push({ field: 'dateTime', message: 'Date/time is required', value: receipt.dateTime });
  }

  if (!receipt.cashierId || typeof receipt.cashierId !== 'string') {
    errors.push({ field: 'cashierId', message: 'Cashier ID is required', value: receipt.cashierId });
  }

  if (typeof receipt.total !== 'number' || receipt.total < 0) {
    errors.push({ field: 'total', message: 'Total must be a positive number', value: receipt.total });
  }

  if (!['CASH', 'GCASH', 'MIXED'].includes(receipt.paymentMethod)) {
    errors.push({
      field: 'paymentMethod',
      message: 'Invalid payment method',
      value: receipt.paymentMethod,
    });
  }

  if (!Array.isArray(receipt.items)) {
    errors.push({ field: 'items', message: 'Items must be an array', value: receipt.items });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Format validation errors for response
 */
export function formatValidationErrors(errors: ValidationError[]): string {
  return errors.map((err) => `${err.field}: ${err.message}`).join('; ');
}
