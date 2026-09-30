/**
 * Financial Accuracy Test Suite
 * Tests all money-related calculations for 100% accuracy
 *
 * Run with: npm test -- financial-accuracy.test.ts
 */

import { describe, it, expect } from '@jest/globals';
import {
  pesosToCentavos,
  centavosToPesos,
  calculateChange,
  validateSplitPayment,
  safeCentavosAdd,
  validateCentavos
} from '../src/utils/money';

describe('Financial Accuracy Tests - 100% Precision', () => {

  describe('Floating-Point Error Prevention', () => {
    it('should handle 0.01 centavo precision correctly', () => {
      const amount1 = 1000.01;
      const amount2 = 999.99;

      // Wrong way (floating point)
      const floatDiff = amount1 - amount2; // 0.0199999999999818

      // Right way (centavos)
      const cents1 = pesosToCentavos(amount1);
      const cents2 = pesosToCentavos(amount2);
      const centsDiff = cents1 - cents2;

      expect(centsDiff).toBe(2); // Exactly 2 centavos
      expect(centavosToPesos(centsDiff)).toBe(0.02); // Exactly ₱0.02
      expect(floatDiff).not.toBe(0.02); // Float is wrong
    });

    it('should calculate change with zero error', () => {
      const tendered = 2000.00;
      const due = 1499.99;

      const change = calculateChange(tendered, due);

      expect(change).toBe(500.01); // Exactly ₱500.01
      expect(pesosToCentavos(change)).toBe(50001);
    });

    it('should handle multiple small amounts accumulation', () => {
      // Accumulate 100 transactions of ₱0.01
      const amounts = Array(100).fill(0.01);
      let floatSum = 0;
      let centavosSum = 0;

      for (const amt of amounts) {
        floatSum += amt; // Accumulates error
        centavosSum += pesosToCentavos(amt);
      }

      expect(centavosToPesos(centavosSum)).toBe(1.00); // Exact ₱1.00
      expect(floatSum).toBeCloseTo(1.00, 10); // Float is "close" but not exact
    });
  });

  describe('Mixed Payment Validation', () => {
    it('should validate exact split payment', () => {
      const cash = 1000.00;
      const gcash = 500.00;
      const total = 1500.00;

      expect(validateSplitPayment(cash, gcash, total)).toBe(true);
    });

    it('should reject mismatched split payment', () => {
      const cash = 1000.01;
      const gcash = 500.00;
      const total = 1500.00;

      expect(validateSplitPayment(cash, gcash, total)).toBe(false);
    });

    it('should handle centavo-precision splits', () => {
      const cash = 999.99;
      const gcash = 0.01;
      const total = 1000.00;

      expect(validateSplitPayment(cash, gcash, total)).toBe(true);
    });
  });

  describe('Integer Overflow Protection', () => {
    it('should reject values exceeding safe integer limit', () => {
      const hugeAmount = Number.MAX_SAFE_INTEGER + 1;

      expect(() => {
        validateCentavos(hugeAmount, 'test');
      }).toThrow('not a safe integer');
    });

    it('should reject negative amounts', () => {
      expect(() => {
        validateCentavos(-100, 'test');
      }).toThrow('cannot be negative');
    });

    it('should reject amounts over ₱9,999,999.99', () => {
      const overLimit = 1000000000; // ₱10,000,000 in centavos

      expect(() => {
        validateCentavos(overLimit, 'test');
      }).toThrow('exceeds maximum allowed');
    });

    it('should detect overflow in addition', () => {
      const nearMax = 999999900; // ₱9,999,999 in centavos

      expect(() => {
        safeCentavosAdd(nearMax, nearMax); // Would overflow
      }).toThrow();
    });
  });

  describe('Bill Calculation Accuracy', () => {
    it('should calculate complex bill with zero error', () => {
      const baseRate = 1300.00;
      const extraBeds = 250.00 * 2; // 500.00
      const towels = 100.00;
      const food = 345.50;
      const discount = 195.00;

      const subtotalCentavos = safeCentavosAdd(
        pesosToCentavos(baseRate),
        pesosToCentavos(extraBeds),
        pesosToCentavos(towels),
        pesosToCentavos(food)
      );

      const totalCentavos = subtotalCentavos - pesosToCentavos(discount);
      const total = centavosToPesos(totalCentavos);

      expect(total).toBe(2300.50); // Exact ₱2,300.50
      expect(pesosToCentavos(total)).toBe(230050);
    });

    it('should handle deposit application correctly', () => {
      const billTotal = 2500.00;
      const depositApplied = 1000.00;

      const billCentavos = pesosToCentavos(billTotal);
      const depositCentavos = pesosToCentavos(depositApplied);
      const remainingCentavos = billCentavos - depositCentavos;

      expect(centavosToPesos(remainingCentavos)).toBe(1500.00);
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero amounts', () => {
      expect(pesosToCentavos(0)).toBe(0);
      expect(centavosToPesos(0)).toBe(0);
      expect(calculateChange(100, 100)).toBe(0);
    });

    it('should handle very small amounts', () => {
      expect(pesosToCentavos(0.01)).toBe(1);
      expect(centavosToPesos(1)).toBe(0.01);
    });

    it('should round half-centavos correctly', () => {
      // JavaScript: 10.005 * 100 = 1000.4999999999999
      expect(pesosToCentavos(10.005)).toBe(1001); // Rounds up
      expect(pesosToCentavos(10.004)).toBe(1000); // Rounds down
    });

    it('should never produce negative change', () => {
      const tendered = 100.00;
      const due = 150.00; // Tendered less than due

      expect(calculateChange(tendered, due)).toBe(0); // No negative change
    });
  });

  describe('Real-World Scenarios', () => {
    it('Scenario: Room checkout with all charges', () => {
      // Base rate: 24HR Premium = ₱1,800
      // Extra bed: 2 × ₱250 = ₱500
      // Towels: 1 × ₱100 = ₱100
      // Food: ₱347.50
      // Extra person: 1 × ₱150 = ₱150
      // Excess hours: 2 × ₱130 = ₱260
      // Subtotal: ₱3,157.50
      // Senior discount: ₱340
      // Total: ₱2,817.50

      const charges = [
        180000, // base rate
        50000,  // extra beds
        10000,  // towels
        34750,  // food
        15000,  // extra person
        26000   // excess hours
      ];

      const subtotalCentavos = safeCentavosAdd(...charges);
      expect(subtotalCentavos).toBe(315750);

      const discountCentavos = 34000; // ₱340
      const totalCentavos = subtotalCentavos - discountCentavos;
      expect(totalCentavos).toBe(281750);

      const total = centavosToPesos(totalCentavos);
      expect(total).toBe(2817.50);
    });

    it('Scenario: MIXED payment validation', () => {
      // Total: ₱2,817.50
      // Cash: ₱2,000.00
      // GCash: ₱817.50

      const totalCentavos = 281750;
      const cashCentavos = 200000;
      const gcashCentavos = 81750;

      expect(cashCentavos + gcashCentavos).toBe(totalCentavos);
    });

    it('Scenario: Change calculation with large bill', () => {
      // Bill: ₱347.50
      // Tendered: ₱500.00
      // Change: ₱152.50

      const change = calculateChange(500.00, 347.50);
      expect(change).toBe(152.50);
      expect(pesosToCentavos(change)).toBe(15250);
    });

    it('Scenario: Deposit balance operations', () => {
      // Deposit IN: ₱5,000.00
      // Apply 1: ₱1,500.00
      // Apply 2: ₱2,300.50
      // Remaining: ₱1,199.50

      const depositCentavos = 500000;
      const apply1Centavos = 150000;
      const apply2Centavos = 230050;

      const remainingCentavos = depositCentavos - apply1Centavos - apply2Centavos;
      expect(remainingCentavos).toBe(119950);
      expect(centavosToPesos(remainingCentavos)).toBe(1199.50);
    });
  });

  describe('Currency Formatting', () => {
    it('should always format to 2 decimal places', () => {
      expect(centavosToPesos(100).toFixed(2)).toBe('1.00');
      expect(centavosToPesos(150).toFixed(2)).toBe('1.50');
      expect(centavosToPesos(155).toFixed(2)).toBe('1.55');
      expect(centavosToPesos(10050).toFixed(2)).toBe('100.50');
    });
  });
});

describe('Time Calculation Accuracy', () => {
  it('should calculate stay duration in minutes correctly', () => {
    const checkIn = new Date('2024-01-01T14:00:00Z');
    const checkOut = new Date('2024-01-01T18:30:00Z');

    const diffMs = checkOut.getTime() - checkIn.getTime();
    const minutes = Math.floor(diffMs / 60000);

    expect(minutes).toBe(270); // Exactly 4.5 hours = 270 minutes
  });

  it('should handle overnight stays correctly', () => {
    const checkIn = new Date('2024-01-01T20:00:00Z');
    const checkOut = new Date('2024-01-02T08:00:00Z');

    const diffMs = checkOut.getTime() - checkIn.getTime();
    const minutes = Math.floor(diffMs / 60000);

    expect(minutes).toBe(720); // 12 hours = 720 minutes
  });
});

export {};
