/**
 * server/utils/env-validator.ts
 * Validates that all required environment variables are set before server starts.
 * Throws descriptive errors if any required variables are missing.
 */

interface EnvConfig {
  DATABASE_URL: string;
  API_PORT: string;
  GEMINI_API_KEY?: string;
  APP_URL?: string;
  NODE_ENV?: string;
}

const REQUIRED_VARS = [
  'DATABASE_URL',
  'JWT_SECRET',
] as const;

const OPTIONAL_VARS = [
  'API_PORT',
  'GEMINI_API_KEY',
  'APP_URL',
  'NODE_ENV',
] as const;

export function validateEnvironment(): EnvConfig {
  const missing: string[] = [];
  const warnings: string[] = [];

  // Check required variables
  for (const varName of REQUIRED_VARS) {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  }

  // Check optional but recommended variables
  for (const varName of OPTIONAL_VARS) {
    if (!process.env[varName]) {
      warnings.push(varName);
    }
  }

  // Handle missing required variables
  if (missing.length > 0) {
    console.error('\n❌ Missing required environment variables:\n');
    missing.forEach((varName) => {
      console.error(`   - ${varName}`);
    });
    console.error('\n📝 Please create a .env.local file from .env.example:');
    console.error('   cp .env.example .env.local\n');
    throw new Error('Environment validation failed. Check console output above.');
  }

  // Display warnings for optional variables
  if (warnings.length > 0) {
    console.warn('\n⚠️  Optional environment variables not set:');
    warnings.forEach((varName) => {
      console.warn(`   - ${varName}`);
    });
    console.warn('   These may be required for certain features.\n');
  }

  // Validate DATABASE_URL format
  const dbUrl = process.env.DATABASE_URL || 'sqlite://server/data/sedona_pms.db';
  if (
    !dbUrl.startsWith('sqlite://') &&
    !dbUrl.startsWith('file:') &&
    !dbUrl.startsWith('mysql://') &&
    !dbUrl.startsWith('postgresql://') &&
    !dbUrl.startsWith('postgres://')
  ) {
    throw new Error('DATABASE_URL must be a valid SQLite, MySQL, or PostgreSQL connection string (sqlite://..., mysql://..., or postgresql://...)');
  }

  // Set defaults for optional variables
  const config: EnvConfig = {
    DATABASE_URL: dbUrl,
    API_PORT: process.env.API_PORT || '4000',
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    APP_URL: process.env.APP_URL,
    NODE_ENV: process.env.NODE_ENV || 'development',
  };

  console.log('✅ Environment validation passed.');
  return config;
}

/**
 * Get a validated environment variable.
 * Throws if the variable is not set.
 */
export function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Required environment variable ${key} is not set`);
  }
  return value;
}

/**
 * Get an optional environment variable with a default value.
 */
export function getOptionalEnv(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}
