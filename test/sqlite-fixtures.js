import Database from 'better-sqlite3';

export function openSqliteFixture(databasePath) {
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL COLLATE NOCASE UNIQUE,
      email TEXT NOT NULL COLLATE NOCASE UNIQUE,
      display_name TEXT NOT NULL DEFAULT '',
      avatar_url TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      nexconn_user_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      revoked_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX sessions_user_id_idx ON sessions(user_id);
    CREATE TABLE favorites (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      channel_type TEXT NOT NULL CHECK (channel_type IN ('direct', 'group')),
      channel_id TEXT NOT NULL CHECK (length(channel_id) BETWEEN 1 AND 128),
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, channel_type, channel_id)
    );
  `);
  return db;
}
