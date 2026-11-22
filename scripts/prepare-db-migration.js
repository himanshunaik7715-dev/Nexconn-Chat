import 'dotenv/config';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Create a consistent migration copy, keep account/favorite rows, and expire all app sessions. */
export async function prepareDatabaseMigration({ sourcePath, targetPath }) {
  const source = resolve(sourcePath);
  const target = resolve(targetPath);
  if (source === target) throw new Error('Source and destination database paths must differ.');
  if (existsSync(target)) throw new Error('Migration destination already exists; choose a new path.');
  mkdirSync(dirname(target), { recursive: true });

  const sourceDb = new Database(source, { readonly: true, fileMustExist: true });
  try {
    await sourceDb.backup(target);
  } finally {
    sourceDb.close();
  }

  const migrationDb = new Database(target);
  try {
    const tableNames = new Set(migrationDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
    if (!tableNames.has('users')) throw new Error('Source database is missing the users table.');
    migrationDb.transaction(() => {
      if (tableNames.has('sessions')) migrationDb.prepare('DELETE FROM sessions').run();
    })();
    const integrity = migrationDb.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') throw new Error('SQLite integrity check failed for the migration copy.');
    if (migrationDb.pragma('foreign_key_check').length) throw new Error('SQLite foreign-key check failed for the migration copy.');
    const users = migrationDb.prepare('SELECT count(*) AS count FROM users').get().count;
    const favorites = tableNames.has('favorites') ? migrationDb.prepare('SELECT count(*) AS count FROM favorites').get().count : 0;
    const sessions = tableNames.has('sessions') ? migrationDb.prepare('SELECT count(*) AS count FROM sessions').get().count : 0;
    return { source, target, users, favorites, sessions, integrity };
  } finally {
    migrationDb.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const options = {};
    for (let index = 0; index < args.length; index += 1) {
      const flag = args[index];
      if (!['--source', '--snapshot'].includes(flag) || !args[index + 1] || options[flag]) {
        throw new Error('Usage: npm run db:prepare-migration -- --source <verified-production-copy.sqlite> --snapshot <private-output.sqlite>');
      }
      options[flag] = args[++index];
    }
    const sourcePath = options['--source'];
    const targetPath = options['--snapshot'];
    if (!sourcePath || !targetPath) throw new Error('Usage: npm run db:prepare-migration -- --source <verified-production-copy.sqlite> --snapshot <private-output.sqlite>');
    const result = await prepareDatabaseMigration({ sourcePath, targetPath });
    process.stdout.write(`Prepared a private migration copy. users=${result.users}, favorites=${result.favorites}, sessions=${result.sessions}, integrity=${result.integrity}\n`);
    process.stdout.write(`Keep ${result.target} out of Git. Transfer it only through a private, authenticated channel.\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Could not prepare the database migration.'}\n`);
    process.exitCode = 1;
  }
}
