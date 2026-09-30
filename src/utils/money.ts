/**
 * src/utils/money.ts
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
 * Add multiple peso amounts safely using centavos.
 */
export function addPesos(...amounts: number[]): number {
  const totalCentavos = amounts.reduce((sum, amount) => {
    return sum + pesosToCentavos(amount);
  }, 0);
  return centavosToPesos(totalCentavos);
}

/**
 * Subtract peso amounts safely using centavos.
 */
export function subtractPesos(minuend: number, subtrahend: number): number {
  const centavos = pesosToCentavos(minuend) - pesosToCentavos(subtrahend);
  return centavosToPesos(centavos);
}

/**
 * Calculate change due (always non-negative).
 */
export function calculateChange(tendered: number, due: number): number {
  const changeCentavos = Math.max(0, pesosToCentavos(tendered) - pesosToCentavos(due));
  return centavosToPesos(changeCentavos);
}

/**
 * Check if two peso amounts are equal within centavo precision.
 */
export function pesosEqual(a: number, b: number): boolean {
  return pesosToCentavos(a) === pesosToCentavos(b);
}

/**
 * Validate that split payment amounts sum to total.
 * Returns true if valid, false if mismatch.
 */
export function validateSplitPayment(cashAmount: number, gcashAmount: number, total: number): boolean {
  const cashCentavos = pesosToCentavos(cashAmount);
  const gcashCentavos = pesosToCentavos(gcashAmount);
  const totalCentavos = pesosToCentavos(total);
  return cashCentavos + gcashCentavos === totalCentavos;
}

/**
 * Format pesos for display with exactly 2 decimal places.
 */
export function formatPesos(amount: number): string {
  return `₱${amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
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
    throw new Error(`${fieldName} exceeds maximum allowed: ${centavos} centavos`);
  }
}

/**
 * Safe addition of centavos with overflow protection.
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
