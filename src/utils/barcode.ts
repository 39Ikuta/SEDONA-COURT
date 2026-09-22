/**
 * src/utils/barcode.ts
 * Generates high-contrast, scanner-optimized Code 128 barcode SVG patterns
 * and date/time formatters for thermal receipt printers & thermal barcode scanners.
 */

// Code 128B pattern table (107 patterns, each pattern is 11 bits: 1=bar, 0=space)
// Represents characters ASCII 32 to 127
const CODE128_PATTERNS: string[] = [
  '11011001100', '11001101100', '11001100110', '10010011000', '10010001100', // 0-4
  '10001001100', '10011001000', '10011000100', '10001100100', '11001001000', // 5-9
  '11001000100', '11000100100', '10110011100', '10011011100', '10011001110', // 10-14
  '10111001100', '10011101100', '10011100110', '11001110010', '11001011100', // 15-19
  '11001001110', '11011100100', '11001110100', '11101101110', '11101001100', // 20-24
  '11100101100', '11100100110', '11101100100', '11100110100', '11100110010', // 25-29
  '11011011000', '11011000110', '11000110110', '10100011000', '10001011000', // 30-34
  '10001000110', '10110001000', '10001101000', '10001100010', '11010001000', // 35-39
  '11000101000', '11000100010', '10110111000', '10110001110', '10001101110', // 40-44
  '10111011000', '10111000110', '10001110110', '11101110110', '11010001110', // 45-49
  '11000101110', '11011101000', '11011100010', '11011101110', '11101011000', // 50-54
  '11101000110', '11100010110', '11101101000', '11101100010', '11100011010', // 55-59
  '11101111010', '11001000010', '11110001010', '10100110000', '10100001100', // 60-64
  '10010110000', '10010000110', '10000101100', '10000100110', '10110010000', // 65-69
  '10110000100', '10011010000', '10011000010', '10000110100', '10000110010', // 70-74
  '11000010010', '11001010000', '11110111010', '11000010100', '10001111010', // 75-79
  '10100111100', '10010111100', '10010011110', '10111100100', '10011110100', // 80-84
  '10011110010', '11110100100', '11110010100', '11110010010', '11011011110', // 85-89
  '11011110110', '11110110110', '10101111000', '10100011110', '10001011110', // 90-94
  '10111101000', '10111100010', '11110101000', '11110100010', '10111011110', // 95-99
  '10111101110', '11101011110', '11110101110', '11010000100', '11010010000', // 100-104 (Start A, B, C)
  '11010011100', '11000111010'                                                   // 105 (Start B), Stop pattern
];

const START_CODE_B = 104;
const STOP_PATTERN = '1100011101011';

/**
 * Encodes an ASCII string into binary bar pattern (1=bar, 0=space) using Code 128 Subtype B
 */
export function encodeCode128B(text: string): string {
  const safeText = text.replace(/[^\x20-\x7E]/g, '');
  if (!safeText) return '';

  const values: number[] = [START_CODE_B];
  let checksum = START_CODE_B;

  for (let i = 0; i < safeText.length; i++) {
    const code = safeText.charCodeAt(i) - 32;
    values.push(code);
    checksum += code * (i + 1);
  }

  const checkValue = checksum % 103;
  values.push(checkValue);

  let bitString = '';
  for (const v of values) {
    bitString += CODE128_PATTERNS[v] || '';
  }
  bitString += STOP_PATTERN;

  return bitString;
}

/**
 * Formats a Date/ISO string to exact requested format: `09/12/2026, 02:05 PM`
 */
export function formatGatePassDateTime(dateVal?: string | Date | null): string {
  if (!dateVal || dateVal === 'N/A') {
    return new Date().toLocaleString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  }

  let d: Date;
  if (dateVal instanceof Date) {
    d = dateVal;
  } else {
    const raw = String(dateVal);
    const normalized = raw.includes(' ') && !raw.includes('T') ? raw.replace(' ', 'T') : raw;
    d = new Date(normalized);
  }

  if (isNaN(d.getTime())) {
    return String(dateVal);
  }

  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const year = d.getFullYear();

  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12; // 0 becomes 12
  const hoursStr = String(hours).padStart(2, '0');

  return `${month}/${day}/${year}, ${hoursStr}:${minutes} ${ampm}`;
}
