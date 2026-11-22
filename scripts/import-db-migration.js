import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { importSqliteToPostgres, runImporterCli } from './import-sqlite-to-postgres.js';

// Compatibility entry point. All imports now target PostgreSQL and require the
// explicit --source and --target-env flags documented by the primary command.
export { importSqliteToPostgres as importDatabaseMigration };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runImporterCli();
