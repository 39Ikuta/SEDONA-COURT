/**
 * server/utils/money.ts
 * Safe money calculation utilities using integer centavos arithmetic.
 * Eliminates floating-point errors in financial calculations.
 */

/**
 * Convert pesos to centavos (integer).
 * Always rounds to nearest centavo.
 */
export function pesosToCentavos(pesos: number): number {
  return Math.round(pesos * 100);
}

/**
 * Convert centavos to pesos (float for display only).
 */
export function centavosToPesos(centavos: number): number {
  return centavos / 100;
}

/**
 * Validate centavos value is safe integer within reasonable bounds.
 * Max: ₱9,999,999.99 (999,999,999 centavos)
 */
export function validateCentavos(centavos: number, fieldName: string = 'amount'): void {
  if (!Number.isSafeInteger(centavos)) {
    throw new Error(`${fieldName} is not a safe integer: ${centavos}`);
  }
  if (centavos < 0) {
    throw new Error(`${fieldName} cannot be negative: ${centavos}`);
  }
  if (centavos > 999999999) { // ₱9,999,999.99
    throw new Error(`${fieldName} exceeds maximum allowed (₱9,999,999.99): ${centavos} centavos`);
  }
}

/**
 * Safe addition of centavos with overflow protection.
 * Throws on negative values, non-integers, or overflow.
 */
export function safeCentavosAdd(...values: number[]): number {
  let sum = 0;
  for (const val of values) {
    validateCentavos(val, 'operand');
    sum += val;
    validateCentavos(sum, 'sum');
  }
  return sum;
}

/**
 * Validate that split payment centavos sum to total centavos.
 */
export function validateSplitPaymentCentavos(cashCents: number, gcashCents: number, totalCents: number): void {
  if (!Number.isInteger(cashCents)) {
    throw new Error('cashAmountCents must be an integer');
  }
  if (!Number.isInteger(gcashCents)) {
    throw new Error('gcashAmountCents must be an integer');
  }
  if (!Number.isInteger(totalCents)) {
    throw new Error('totalCents must be an integer');
  }

  validateCentavos(cashCents, 'cashAmountCents');
  validateCentavos(gcashCents, 'gcashAmountCents');
  validateCentavos(totalCents, 'totalCents');

  if (cashCents + gcashCents !== totalCents) {
    throw new Error(
      `MIXED payment mismatch: ${cashCents} + ${gcashCents} = ${cashCents + gcashCents} ≠ ${totalCents} centavos. ` +
      `Difference: ${Math.abs((cashCents + gcashCents) - totalCents)} centavos`
    );
  }
}

/**
 * Maximum reasonable bill amount: ₱50,000
 */
const MAX_REASONABLE_BILL_CENTAVOS = 5000000; // ₱50,000

/**
 * Validate bill total is within reasonable limits.
 * Requires manager override for bills exceeding ₱50,000.
 */
export function validateReasonableBill(
  totalCentavos: number,
  operatorRole: string,
  managerOverride: boolean = false
): void {
  if (totalCentavos > MAX_REASONABLE_BILL_CENTAVOS) {
    if (!managerOverride || !['admin', 'owner'].includes(operatorRole)) {
      throw new Error(
        `Bill total exceeds ₱50,000 (calculated: ₱${centavosToPesos(totalCentavos).toFixed(2)}). ` +
        `Manager approval required for high-value transactions.`
      );
    }
  }
}
