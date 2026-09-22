/**
 * server/db/migration-runner.ts
 * MySQL database migration system for managing schema changes.
 * 
 * Usage:
 *   npm run migrate          - Run pending migrations
 *   npm run migrate:create   - Create a new migration file
 *   npm run migrate:status   - Check migration status
 */

import { pool } from './pool';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MIGRATIONS_DIR = join(__dirname, 'migrations');
const MIGRATION_TABLE = 'schema_migrations';

interface Migration {
  filename: string;
  sql: string;
  timestamp: number;
}

/**
 * Ensure the schema_migrations table exists
 */
async function ensureMigrationTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
      id INT AUTO_INCREMENT PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

/**
 * Get list of already executed migrations
 */
async function getExecutedMigrations(): Promise<Set<string>> {
  const result = await pool.query(
    `SELECT filename FROM ${MIGRATION_TABLE} ORDER BY filename ASC`
  );
  return new Set(result.rows.map((row: any) => row.filename));
}

/**
 * Get all migration files from the migrations directory
 */
async function getAllMigrationFiles(): Promise<Migration[]> {
  try {
    const files = await readdir(MIGRATIONS_DIR);
    const sqlFiles = files.filter(f => f.endsWith('.sql') && !f.startsWith('.'));
    
    const migrations: Migration[] = [];
    for (const filename of sqlFiles) {
      const filepath = join(MIGRATIONS_DIR, filename);
      const sql = await readFile(filepath, 'utf-8');
      
      // Extract timestamp from filename (format: YYYYMMDD_HHMMSS_description.sql)
      const match = filename.match(/^(\d{8}_\d{6})_/);
      const timestamp = match ? parseInt(match[1].replace('_', '')) : 0;
      
      migrations.push({ filename, sql, timestamp });
    }
    
    // Sort by timestamp
    return migrations.sort((a, b) => a.timestamp - b.timestamp);
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      console.warn(`⚠️  Migrations directory not found: ${MIGRATIONS_DIR}`);
      return [];
    }
    throw err;
  }
}

/**
 * Run a single migration
 */
async function executeMigration(migration: Migration): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('START TRANSACTION');
    
    console.log(`📝 Executing migration: ${migration.filename}`);
    
    // Split SQL by semicolons for multiple statements if any
    const statements = migration.sql
      .split(/;\s*$/m)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    for (const stmt of statements) {
      await client.query(stmt);
    }
    
    await client.query(
      `INSERT INTO ${MIGRATION_TABLE} (filename) VALUES (?)`,
      [migration.filename]
    );
    
    await client.query('COMMIT');
    console.log(`✅ Migration completed: ${migration.filename}`);
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ignore rollback error
    }
    console.error(`❌ Migration failed: ${migration.filename}`);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Run all pending migrations
 */
export async function runMigrations(): Promise<void> {
  console.log('\n🚀 Starting MySQL database migrations...\n');
  
  try {
    await ensureMigrationTable();
    
    const executedMigrations = await getExecutedMigrations();
    const allMigrations = await getAllMigrationFiles();
    
    const pendingMigrations = allMigrations.filter(
      m => !executedMigrations.has(m.filename)
    );
    
    if (pendingMigrations.length === 0) {
      console.log('✅ No pending migrations. Database is up to date.\n');
      return;
    }
    
    console.log(`Found ${pendingMigrations.length} pending migration(s):\n`);
    pendingMigrations.forEach(m => console.log(`   - ${m.filename}`));
    console.log();
    
    for (const migration of pendingMigrations) {
      await executeMigration(migration);
    }
    
    console.log(`\n✅ Successfully executed ${pendingMigrations.length} migration(s).\n`);
  } catch (err) {
    console.error('\n❌ Migration failed:', err);
    throw err;
  }
}

/**
 * Show migration status
 */
export async function showMigrationStatus(): Promise<void> {
  console.log('\n📊 Migration Status\n');
  
  try {
    await ensureMigrationTable();
    
    const executedMigrations = await getExecutedMigrations();
    const allMigrations = await getAllMigrationFiles();
    
    if (allMigrations.length === 0) {
      console.log('No migration files found.\n');
      return;
    }
    
    console.log('Migration Files:');
    console.log('─'.repeat(80));
    
    allMigrations.forEach(m => {
      const status = executedMigrations.has(m.filename) ? '✅ Executed' : '⏳ Pending';
      console.log(`${status}  ${m.filename}`);
    });
    
    console.log('─'.repeat(80));
    console.log(`Total: ${allMigrations.length} | Executed: ${executedMigrations.size} | Pending: ${allMigrations.length - executedMigrations.size}\n`);
  } catch (err) {
    console.error('\n❌ Failed to show migration status:', err);
    throw err;
  }
}

/**
 * Create a new migration file template
 */
export async function createMigration(description: string): Promise<void> {
  const fs = await import('fs/promises');
  
  // Generate timestamp
  const now = new Date();
  const timestamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '_',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');
  
  // Create filename
  const sanitizedDesc = description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const filename = `${timestamp}_${sanitizedDesc}.sql`;
  const filepath = join(MIGRATIONS_DIR, filename);
  
  // Template
  const template = `-- Migration: ${description}
-- Created: ${now.toISOString()}
-- 
-- Add your MySQL migration SQL below:

-- Example: Create a new table
-- CREATE TABLE example (
--   id INT AUTO_INCREMENT PRIMARY KEY,
--   name VARCHAR(100) NOT NULL,
--   created_at DATETIME DEFAULT CURRENT_TIMESTAMP
-- ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Example: Add a column
-- ALTER TABLE users ADD COLUMN email VARCHAR(255);

-- Example: Create an index
-- CREATE INDEX idx_users_email ON users(email);
`;
  
  try {
    await fs.writeFile(filepath, template, 'utf-8');
    console.log(`\n✅ Created migration file: ${filename}`);
    console.log(`   Path: ${filepath}\n`);
    console.log('Edit the file to add your migration SQL, then run: npm run migrate\n');
  } catch (err) {
    console.error('\n❌ Failed to create migration file:', err);
    throw err;
  }
}

// CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2];
  
  (async () => {
    try {
      switch (command) {
        case 'up':
        case 'run':
          await runMigrations();
          break;
        
        case 'status':
          await showMigrationStatus();
          break;
        
        case 'create':
          const description = process.argv[3];
          if (!description) {
            console.error('\n❌ Please provide a migration description.');
            console.error('Usage: npm run migrate:create "add user preferences table"\n');
            process.exit(1);
          }
          await createMigration(description);
          break;
        
        default:
          console.log('\n📦 Database Migration Tool (MySQL)\n');
          console.log('Commands:');
          console.log('  npm run migrate              - Run pending migrations');
          console.log('  npm run migrate:status       - Show migration status');
          console.log('  npm run migrate:create "..." - Create new migration file\n');
          process.exit(1);
      }
    } catch (err) {
      console.error(err);
      process.exit(1);
    } finally {
      await pool.end();
    }
  })();
}
