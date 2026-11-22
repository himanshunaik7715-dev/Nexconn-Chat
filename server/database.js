import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const { Pool } = pg;
const migrationDirectory = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
const migrations = [{ version: 1, file: '001-initial-schema.sql' }];

export class DatabaseUnavailableError extends Error {
  constructor(cause) {
    super('The account database is temporarily unavailable.', { cause });
    this.name = 'DatabaseUnavailableError';
    this.code = 'DATABASE_UNAVAILABLE';
  }
}

export function isDatabaseUnavailable(error) {
  return error instanceof DatabaseUnavailableError || [
    '08000', '08001', '08003', '08004', '08006', '08007', '08P01', '53300', '57P01', '57P02', '57P03',
    'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND',
  ].includes(error?.code);
}

async function runMigrations(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migration_lock (
      id INTEGER PRIMARY KEY CHECK (id = 1)
    )`);
    await client.query('INSERT INTO schema_migration_lock (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
    await client.query('SELECT id FROM schema_migration_lock WHERE id = 1 FOR UPDATE');

    for (const migration of migrations) {
      const applied = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [migration.version]);
      if (applied.rowCount) continue;
      const sql = await readFile(join(migrationDirectory, migration.file), 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [migration.version]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Create the asynchronous PostgreSQL store and apply versioned schema migrations. */
export async function openDatabase(databaseUrl, { PoolFactory, initialize = true } = {}) {
  if (typeof databaseUrl !== 'string' || !databaseUrl.trim()) {
    throw new Error('DATABASE_URL must be configured for the PostgreSQL database.');
  }
  let parsed;
  try { parsed = new URL(databaseUrl); }
  catch { throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || !parsed.pathname || parsed.pathname === '/') {
    throw new Error('DATABASE_URL must identify a PostgreSQL database.');
  }

  const poolOptions = {
    connectionString: databaseUrl,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
  };
  const pool = PoolFactory ? PoolFactory(poolOptions) : new Pool(poolOptions);
  pool.on?.('error', () => {
    // Do not log driver errors: they may contain host or connection details.
  });

  try {
    await pool.query('SELECT 1');
    if (initialize) await runMigrations(pool);
  } catch (error) {
    await pool.end().catch(() => {});
    if (isDatabaseUnavailable(error)) throw new DatabaseUnavailableError(error);
    throw error;
  }

  return {
    query: (text, values = []) => pool.query(text, values),
    transaction: async (callback) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await callback({ query: (text, values = []) => client.query(text, values) });
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
    pool,
  };
}

/** Apply pending migrations to a pool owned by an isolated test or import process. */
export async function initializeDatabase(pool) {
  await runMigrations(pool);
}
