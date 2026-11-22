import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareDatabaseMigration } from '../scripts/prepare-db-migration.js';
import { openSqliteFixture } from './sqlite-fixtures.js';

test('database migration export preserves accounts/favorites and clears old sessions', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'nexconn-db-migration-'));
  const sourcePath = join(directory, 'source.sqlite');
  const targetPath = join(directory, 'migration.sqlite');
  const source = openSqliteFixture(sourcePath);
  source.prepare(`INSERT INTO users (id, username, email, display_name, avatar_url, password_hash, nexconn_user_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run('user-1', 'sample_user', 'sample@example.test', 'Sample User', '', 'hash-only-test-fixture', 'nex-user-1', new Date().toISOString());
  source.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run('session-1', 'user-1', Date.now() + 60_000, Date.now());
  source.prepare('INSERT INTO favorites (user_id, channel_type, channel_id, created_at) VALUES (?, ?, ?, ?)').run('user-1', 'direct', 'nex-user-2', new Date().toISOString());

  try {
    const result = await prepareDatabaseMigration({ sourcePath, targetPath });
    assert.equal(result.users, 1);
    assert.equal(result.favorites, 1);
    assert.equal(result.sessions, 0);
    assert.equal(result.integrity, 'ok');
    assert.equal(source.prepare('SELECT count(*) AS count FROM sessions').get().count, 1);
  } finally {
    source.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
