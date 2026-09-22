/**
 * server/data/seed-accounts.ts
 * Server-only user accounts with access codes for DB seeding.
 * 
 * SECURITY: This file must NEVER be imported by frontend code.
 * Access codes are only needed for the bcrypt seeding process
 * and must not appear in the browser bundle.
 */

export interface SeedUserAccount {
  username: string;
  name: string;
  role: 'kitchen' | 'cashier' | 'admin' | 'owner' | 'customer_display';
  accessCode: string;
}

export const SEED_USER_ACCOUNTS: SeedUserAccount[] = [
  // 1 Kitchen account
  { username: 'kitchen1', name: 'SCTI Kitchen Staff', role: 'kitchen', accessCode: 'kitchen123' },
  // Cashier accounts (generic password: cashier123)
  { username: 'pau', name: 'Pau (Cashier)', role: 'cashier', accessCode: 'cashier123' },
  { username: 'raquel', name: 'Raquel (Cashier)', role: 'cashier', accessCode: 'cashier123' },
  { username: 'tuter', name: 'Tuter (Cashier)', role: 'cashier', accessCode: 'cashier123' },
  // Compatibility / test cashier
  { username: 'ann', name: 'Ann (Cashier)', role: 'cashier', accessCode: 'cashier123' },
  // 2 Admin accounts
  { username: 'admin1', name: 'Alex (Admin 1)', role: 'admin', accessCode: 'admin123' },
  { username: 'admin2', name: 'Chris (Admin 2)', role: 'admin', accessCode: 'admin456' },
  // compatibility admin
  { username: 'admin', name: 'Admin Terminal', role: 'admin', accessCode: 'admin' },
  // 1 Owner account
  { username: 'owner', name: 'Sedona Owner', role: 'owner', accessCode: 'owner123' },
  // 1 Customer Display / Lobby Kiosk account (strictly scoped, least-privilege)
  { username: 'kiosk', name: 'Lobby Display Kiosk', role: 'customer_display', accessCode: 'kiosk123' },
];
