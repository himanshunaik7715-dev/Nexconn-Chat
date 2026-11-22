import test from 'node:test';
import assert from 'node:assert/strict';
import { createIsolatedDatabase } from '../test/postgres-test-database.js';
import { initializeDatabase, openDatabase } from './database.js';

test('PostgreSQL URL is required and non-PostgreSQL targets are rejected', async () => {
  await assert.rejects(openDatabase(''), /DATABASE_URL must be configured/);
  await assert.rejects(openDatabase('https://example.test/db'), /must identify a PostgreSQL database/);
});

test('PostgreSQL migrations create users, sessions and favorites with constraints', async (t) => {
  const { database } = await createIsolatedDatabase();
  t.after(() => database.close());

  const tables = (await database.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")).rows.map(({ table_name }) => table_name);
  assert.ok(tables.includes('users'));
  assert.ok(tables.includes('sessions'));
  assert.ok(tables.includes('favorites'));
  await initializeDatabase(database.pool);
  assert.equal((await database.query('SELECT count(*)::int AS count FROM schema_migrations')).rows[0].count, 1);

  await database.query(`INSERT INTO users
    (id, username, email, password_hash, nexconn_user_id, created_at)
    VALUES ($1, $2, $3, $4, $5, $6)`, ['user-1', 'Sample_User', 'sample@example.test', 'bcrypt-hash', 'nx-user-1', '2026-01-01T00:00:00.000Z']);
  await assert.rejects(database.query(`INSERT INTO users
    (id, username, email, password_hash, nexconn_user_id, created_at)
    VALUES ($1, $2, $3, $4, $5, $6)`, ['user-2', 'sample_user', 'other@example.test', 'hash', 'nx-user-2', '2026-01-02']), (error) => error.code === '23505');
  await assert.rejects(database.query(`INSERT INTO users
    (id, username, email, password_hash, nexconn_user_id, created_at)
    VALUES ($1, $2, $3, $4, $5, $6)`, ['user-3', 'another', 'SAMPLE@EXAMPLE.TEST', 'hash', 'nx-user-3', '2026-01-03']), (error) => error.code === '23505');
  await assert.rejects(database.query('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES ($1, $2, $3, $4)', ['s1', 'missing-user', 1, 1]));
  await assert.rejects(database.query('INSERT INTO favorites (user_id, channel_type, channel_id, created_at) VALUES ($1, $2, $3, $4)', ['user-1', 'open', 'x', 'now']));
  await assert.rejects(database.query('INSERT INTO favorites (user_id, channel_type, channel_id, created_at) VALUES ($1, $2, $3, $4)', ['user-1', 'direct', '', 'now']));

  await database.query('INSERT INTO favorites (user_id, channel_type, channel_id, created_at) VALUES ($1, $2, $3, $4)', ['user-1', 'direct', 'nx-user-2', '2026-01-03']);
  await database.query('DELETE FROM users WHERE id = $1', ['user-1']);
  assert.equal((await database.query('SELECT count(*)::int AS count FROM favorites')).rows[0].count, 0);
});

test('PostgreSQL transactions roll back all writes on failure', async (t) => {
  const { database } = await createIsolatedDatabase();
  t.after(() => database.close());
  await assert.rejects(database.transaction(async (tx) => {
    await tx.query(`INSERT INTO users (id, username, email, password_hash, nexconn_user_id, created_at)
      VALUES ('user-1', 'alice', 'alice@example.test', 'hash', 'nx-alice', '2026-01-01')`);
    throw new Error('rollback fixture');
  }), /rollback fixture/);
  assert.equal((await database.query('SELECT count(*)::int AS count FROM users')).rows[0].count, 0);
});
