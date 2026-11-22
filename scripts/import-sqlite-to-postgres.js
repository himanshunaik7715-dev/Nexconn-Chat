import Database from 'better-sqlite3';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { openDatabase } from '../server/database.js';

const expectedTables = new Set(['users', 'sessions', 'favorites']);

function readSnapshot(snapshotPath) {
  const source = new Database(snapshotPath, { readonly: true, fileMustExist: true });
  try {
    if (source.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('SQLite source failed integrity_check.');
    if (source.pragma('foreign_key_check').length) throw new Error('SQLite source contains foreign-key violations.');
    const tables = new Set(source.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map(({ name }) => name));
    for (const table of tables) if (!expectedTables.has(table)) throw new Error(`SQLite source contains an unrecognized application table: ${table}.`);
    if (!tables.has('users')) throw new Error('SQLite source is missing the users table.');

    const userColumns = new Set(source.prepare('PRAGMA table_info(users)').all().map(({ name }) => name));
    const requiredUserColumns = ['id', 'username', 'email', 'password_hash', 'nexconn_user_id', 'created_at'];
    if (requiredUserColumns.some((column) => !userColumns.has(column))) throw new Error('SQLite source users table does not match the supported schema.');
    const users = source.prepare(`SELECT id, username, email,
      ${userColumns.has('display_name') ? 'display_name' : 'username AS display_name'},
      ${userColumns.has('avatar_url') ? 'avatar_url' : "'' AS avatar_url"},
      password_hash, nexconn_user_id, created_at FROM users ORDER BY id`).all();
    const usernames = new Set();
    const emails = new Set();
    for (const user of users) {
      const username = user.username.toLowerCase();
      const email = user.email.toLowerCase();
      if (usernames.has(username) || emails.has(email)) throw new Error('SQLite source has account names that conflict under PostgreSQL case-insensitive uniqueness.');
      usernames.add(username);
      emails.add(email);
    }

    let favorites = [];
    if (tables.has('favorites')) {
      const columns = new Set(source.prepare('PRAGMA table_info(favorites)').all().map(({ name }) => name));
      if (!['user_id', 'channel_type', 'channel_id', 'created_at'].every((column) => columns.has(column))) throw new Error('SQLite source favorites table does not match the supported schema.');
      favorites = source.prepare('SELECT user_id, channel_type, channel_id, created_at FROM favorites ORDER BY user_id, channel_type, channel_id').all();
    }
    const orphaned = favorites.some((favorite) => !users.some((user) => user.id === favorite.user_id));
    if (orphaned) throw new Error('SQLite source contains favorites without an owning user.');
    return { users, favorites };
  } finally {
    source.close();
  }
}

async function assertEmptyTarget(database) {
  const result = await database.query(`SELECT
    (SELECT count(*)::int FROM users) AS users,
    (SELECT count(*)::int FROM sessions) AS sessions,
    (SELECT count(*)::int FROM favorites) AS favorites`);
  const counts = result.rows[0];
  if (counts.users || counts.sessions || counts.favorites) throw new Error('PostgreSQL target is not empty; import was not started.');
}

async function verifyRows(database, expected) {
  const users = (await database.query(`SELECT id, username, email, display_name, avatar_url, password_hash, nexconn_user_id, created_at
    FROM users ORDER BY id`)).rows;
  const favorites = (await database.query(`SELECT user_id, channel_type, channel_id, created_at
    FROM favorites ORDER BY user_id, channel_type, channel_id`)).rows;
  if (!isDeepStrictEqual(users, expected.users) || !isDeepStrictEqual(favorites, expected.favorites)) {
    throw new Error('PostgreSQL row values do not exactly match the verified SQLite snapshot.');
  }
  const duplicateUsers = await database.query('SELECT lower(username) FROM users GROUP BY lower(username) HAVING count(*) > 1');
  const duplicateEmails = await database.query('SELECT lower(email) FROM users GROUP BY lower(email) HAVING count(*) > 1');
  const orphans = await database.query('SELECT f.user_id FROM favorites f LEFT JOIN users u ON u.id = f.user_id WHERE u.id IS NULL');
  if (duplicateUsers.rowCount || duplicateEmails.rowCount || orphans.rowCount) throw new Error('PostgreSQL uniqueness or foreign-key verification failed.');
  return { users: users.length, favorites: favorites.length, sessions: 0 };
}

/** Import a read-only, consistent SQLite snapshot in one PostgreSQL transaction. */
export async function importSqliteToPostgres({ sourcePath, database }) {
  if (!sourcePath || !database) throw new Error('An explicit SQLite source path and PostgreSQL database handle are required.');
  const source = resolve(sourcePath);
  const tempDirectory = await mkdtemp(join(tmpdir(), 'nexconn-sqlite-snapshot-'));
  const snapshot = join(tempDirectory, 'snapshot.sqlite');
  try {
    const liveSource = new Database(source, { readonly: true, fileMustExist: true });
    try { await liveSource.backup(snapshot); }
    finally { liveSource.close(); }

    const expected = readSnapshot(snapshot);
    await assertEmptyTarget(database);
    await database.transaction(async (tx) => {
      for (const user of expected.users) {
        await tx.query(`INSERT INTO users (id, username, email, display_name, avatar_url, password_hash, nexconn_user_id, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [user.id, user.username, user.email, user.display_name, user.avatar_url, user.password_hash, user.nexconn_user_id, user.created_at]);
      }
      for (const favorite of expected.favorites) {
        await tx.query(`INSERT INTO favorites (user_id, channel_type, channel_id, created_at)
          VALUES ($1, $2, $3, $4)`, [favorite.user_id, favorite.channel_type, favorite.channel_id, favorite.created_at]);
      }
      const counts = await tx.query(`SELECT
        (SELECT count(*)::int FROM users) AS users,
        (SELECT count(*)::int FROM favorites) AS favorites,
        (SELECT count(*)::int FROM sessions) AS sessions`);
      if (counts.rows[0].users !== expected.users.length || counts.rows[0].favorites !== expected.favorites.length || counts.rows[0].sessions !== 0) {
        throw new Error('Imported PostgreSQL row counts do not match the source snapshot.');
      }
      await verifyRows({ query: (text, values) => tx.query(text, values) }, expected);
    });
    return { ...(await verifyRows(database, expected)), integrity: 'ok' };
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

export function parseImporterArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (!['--source', '--target-env'].includes(flag) || !args[index + 1] || options[flag]) {
      throw new Error('Usage: node scripts/import-sqlite-to-postgres.js --source <verified-snapshot.sqlite> --target-env <DATABASE_URL_VARIABLE>');
    }
    options[flag] = args[++index];
  }
  if (!options['--source'] || !options['--target-env'] || !/^[A-Z][A-Z0-9_]*$/.test(options['--target-env'])) {
    throw new Error('Usage: node scripts/import-sqlite-to-postgres.js --source <verified-snapshot.sqlite> --target-env <DATABASE_URL_VARIABLE>');
  }
  return { sourcePath: options['--source'], targetEnvName: options['--target-env'] };
}

export async function runImporterCli(args = process.argv.slice(2), environment = process.env) {
  let database;
  try {
    const { sourcePath, targetEnvName } = parseImporterArguments(args);
    const targetUrl = environment[targetEnvName];
    if (!targetUrl) throw new Error(`The explicitly selected ${targetEnvName} environment variable is not set.`);
    database = await openDatabase(targetUrl);
    const result = await importSqliteToPostgres({ sourcePath, database });
    process.stdout.write(`SQLite import verified. users=${result.users}, favorites=${result.favorites}, sessions=${result.sessions}, integrity=${result.integrity}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'SQLite import failed.'}\n`);
    process.exitCode = 1;
  } finally {
    await database?.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runImporterCli();
