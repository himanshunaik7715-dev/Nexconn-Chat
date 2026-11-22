import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIsolatedDatabase } from './postgres-test-database.js';
import { openSqliteFixture } from './sqlite-fixtures.js';
import { importSqliteToPostgres } from '../scripts/import-sqlite-to-postgres.js';

function addAccount(db, id, username, email, hash, nexconnId, createdAt) {
  db.prepare(`INSERT INTO users (id, username, email, display_name, avatar_url, password_hash, nexconn_user_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, username, email, `${username} Display`, 'https://images.example.test/avatar.png', hash, nexconnId, createdAt);
}

test('SQLite snapshot import preserves account/favorite values and excludes sessions', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'nexconn-pg-import-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const sourcePath = join(directory, 'authoritative-copy.sqlite');
  const source = openSqliteFixture(sourcePath);
  addAccount(source, 'source-user', 'Alice_One', 'Alice@Example.test', '$2b$12$preserved-hash-fixture', 'nx-alice', '2026-01-02T03:04:05.678Z');
  source.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run('old-session', 'source-user', Date.now() + 60_000, 12_345);
  source.prepare('INSERT INTO favorites (user_id, channel_type, channel_id, created_at) VALUES (?, ?, ?, ?)')
    .run('source-user', 'direct', 'nx-bob', '2026-02-03T04:05:06.007Z');
  source.close();

  const { database } = await createIsolatedDatabase();
  t.after(() => database.close());
  const result = await importSqliteToPostgres({ sourcePath, database });
  assert.deepEqual(result, { users: 1, favorites: 1, sessions: 0, integrity: 'ok' });
  assert.deepEqual((await database.query('SELECT * FROM users')).rows[0], {
    id: 'source-user', username: 'Alice_One', email: 'Alice@Example.test', display_name: 'Alice_One Display',
    avatar_url: 'https://images.example.test/avatar.png', password_hash: '$2b$12$preserved-hash-fixture', nexconn_user_id: 'nx-alice', created_at: '2026-01-02T03:04:05.678Z',
  });
  assert.equal((await database.query('SELECT count(*)::int AS count FROM sessions')).rows[0].count, 0);
  assert.equal((await database.query('SELECT count(*)::int AS count FROM favorites')).rows[0].count, 1);

  const sourceCheck = new Database(sourcePath, { readonly: true, fileMustExist: true });
  assert.equal(sourceCheck.prepare('SELECT count(*) AS count FROM sessions').get().count, 1);
  assert.equal(sourceCheck.pragma('integrity_check', { simple: true }), 'ok');
  sourceCheck.close();

  await assert.rejects(importSqliteToPostgres({ sourcePath, database }), /target is not empty/);
  assert.equal((await database.query('SELECT count(*)::int AS count FROM users')).rows[0].count, 1);
});

test('SQLite import rolls back PostgreSQL writes when an insert fails', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'nexconn-pg-import-rollback-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const sourcePath = join(directory, 'source.sqlite');
  const source = openSqliteFixture(sourcePath);
  addAccount(source, 'source-user', 'Alice', 'alice@example.test', '$2b$12$hash', 'nx-alice', '2026-01-01');
  source.prepare('INSERT INTO favorites (user_id, channel_type, channel_id, created_at) VALUES (?, ?, ?, ?)')
    .run('source-user', 'direct', 'nx-bob', '2026-01-02');
  source.close();

  const { database } = await createIsolatedDatabase();
  t.after(() => database.close());
  const failingDatabase = {
    query: (...args) => database.query(...args),
    transaction: (callback) => database.transaction((tx) => callback({
      query: (sql, values) => {
        if (sql.includes('INSERT INTO favorites')) throw new Error('injected importer failure');
        return tx.query(sql, values);
      },
    })),
  };
  await assert.rejects(importSqliteToPostgres({ sourcePath, database: failingDatabase }), /injected importer failure/);
  assert.equal((await database.query('SELECT count(*)::int AS count FROM users')).rows[0].count, 0);
  assert.equal((await database.query('SELECT count(*)::int AS count FROM favorites')).rows[0].count, 0);
});

test('SQLite source with case-insensitive collisions is rejected before import', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'nexconn-pg-import-collision-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const sourcePath = join(directory, 'collision.sqlite');
  const source = new Database(sourcePath);
  source.exec(`CREATE TABLE users (
    id TEXT PRIMARY KEY, username TEXT NOT NULL, email TEXT NOT NULL, display_name TEXT NOT NULL DEFAULT '',
    avatar_url TEXT NOT NULL DEFAULT '', password_hash TEXT NOT NULL, nexconn_user_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
  )`);
  source.prepare(`INSERT INTO users (id, username, email, password_hash, nexconn_user_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run('u1', 'Alice', 'alice@example.test', 'hash1', 'nx-1', '2026-01-01');
  source.prepare(`INSERT INTO users (id, username, email, password_hash, nexconn_user_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run('u2', 'alice', 'alice2@example.test', 'hash2', 'nx-2', '2026-01-02');
  source.close();
  const { database } = await createIsolatedDatabase();
  t.after(() => database.close());
  await assert.rejects(importSqliteToPostgres({ sourcePath, database }), /case-insensitive uniqueness/);
});
