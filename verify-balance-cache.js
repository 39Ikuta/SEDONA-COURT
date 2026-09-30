/**
 * Verify and populate guest_balance_cache from existing transactions
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'server', 'data', 'sedona_pms.db');

console.log('🔍 Checking deposit transactions and balance cache...');

try {
  const db = new Database(dbPath);

  // Check if there are any deposit transactions
  const txCount = db.prepare('SELECT COUNT(*) as count FROM deposit_transactions').get();
  console.log(`\n📊 Deposit transactions found: ${txCount.count}`);

  if (txCount.count > 0) {
    // Get unique guest identifiers
    const guests = db.prepare(`
      SELECT DISTINCT guest_identifier
      FROM deposit_transactions
      WHERE guest_identifier IS NOT NULL AND guest_identifier != ''
    `).all();

    console.log(`👥 Unique guests with deposits: ${guests.length}`);

    if (guests.length > 0) {
      console.log('\n🔄 Populating balance cache...');

      const insertStmt = db.prepare(`
        INSERT OR REPLACE INTO guest_balance_cache (
          guest_identifier,
          balance_centavos,
          total_in_centavos,
          total_out_centavos,
          last_updated,
          lock_version
        )
        SELECT
          guest_identifier,
          COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount_centavos ELSE -amount_centavos END), 0) AS balance_centavos,
          COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount_centavos ELSE 0 END), 0) AS total_in_centavos,
          COALESCE(SUM(CASE WHEN direction = 'OUT' THEN amount_centavos ELSE 0 END), 0) AS total_out_centavos,
          datetime('now', 'localtime') AS last_updated,
          0 AS lock_version
        FROM deposit_transactions
        WHERE guest_identifier = ?
        GROUP BY LOWER(guest_identifier)
      `);

      let populated = 0;
      for (const guest of guests) {
        insertStmt.run(guest.guest_identifier);
        populated++;
      }

      console.log(`✅ Populated ${populated} guest balances`);

      // Verify
      const cacheCount = db.prepare('SELECT COUNT(*) as count FROM guest_balance_cache').get();
      console.log(`\n📊 Balance cache rows: ${cacheCount.count}`);

      // Show some examples
      const samples = db.prepare(`
        SELECT guest_identifier, balance_centavos, total_in_centavos, total_out_centavos
        FROM guest_balance_cache
        LIMIT 5
      `).all();

      if (samples.length > 0) {
        console.log('\n📋 Sample balances:');
        samples.forEach(s => {
          console.log(`  ${s.guest_identifier}: Balance ₱${(s.balance_centavos / 100).toFixed(2)} (IN: ₱${(s.total_in_centavos / 100).toFixed(2)}, OUT: ₱${(s.total_out_centavos / 100).toFixed(2)})`);
        });
      }
    } else {
      console.log('✅ No guest deposits to populate');
    }
  } else {
    console.log('✅ No deposit transactions yet (fresh database)');
  }

  db.close();
  console.log('\n🎉 Verification complete!');

} catch (error) {
  console.error('\n❌ Error:', error.message);
  console.error(error.stack);
  process.exit(1);
}
