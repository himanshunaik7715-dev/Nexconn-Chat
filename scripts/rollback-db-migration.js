import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/**
 * The former helper only rolled back an SQLite-to-SQLite import. Runtime data
 * now belongs to PostgreSQL, so using SQLite file rollback would be unsafe.
 * Restore a verified Neon backup/branch and redeploy PostgreSQL-compatible code.
 */
export function rollbackDatabaseMigration() {
  throw new Error('SQLite file rollback is retired. Restore a verified PostgreSQL backup/branch instead.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stderr.write('SQLite file rollback is retired. Restore a verified PostgreSQL backup/branch; the source SQLite archive is not modified.\n');
  process.exitCode = 1;
}
