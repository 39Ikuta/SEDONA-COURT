/**
 * Run database migration to create guest_balance_cache table
 * Usage: node run-migration.js
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'server', 'data', 'sedona_pms.db');
const migrationPath = path.join(__dirname, 'server', 'migrations', '001_add_guest_balance_cache.sql');

console.log('🔄 Running database migration...');
console.log('Database:', dbPath);
console.log('Migration:', migrationPath);

try {
  // Open database
  const db = new Database(dbPath);

  // Read migration SQL
  const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

  // Split by semicolon and execute each statement
  const statements = migrationSQL
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  console.log(`\n📝 Executing ${statements.length} SQL statements...`);

  db.prepare('BEGIN TRANSACTION').run();

  try {
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      console.log(`\n[${i + 1}/${statements.length}] Executing...`);
      console.log(stmt.substring(0, 100) + (stmt.length > 100 ? '...' : ''));

      db.prepare(stmt + ';').run();
    }

    db.prepare('COMMIT').run();
    console.log('\n✅ Migration completed successfully!');

    // Verify table was created
    const tableCheck = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='guest_balance_cache'
    `).get();

    if (tableCheck) {
      console.log('✅ Table "guest_balance_cache" created successfully');

      // Check row count
      const count = db.prepare('SELECT COUNT(*) as count FROM guest_balance_cache').get();
      console.log(`📊 Initial rows populated: ${count.count}`);
    } else {
      console.log('⚠️  Warning: Table creation could not be verified');
    }

  } catch (err) {
    db.prepare('ROLLBACK').run();
    throw err;
  }

  db.close();
  console.log('\n🎉 Database migration complete!');
  process.exit(0);

} catch (error) {
  console.error('\n❌ Migration failed:', error.message);
  console.error(error.stack);
  process.exit(1);
}
