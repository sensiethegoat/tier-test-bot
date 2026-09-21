import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Shared SQLite connection. Modules create their own tables in their schema.js; every table
// is keyed by guild_id, so each server's data is isolated.
const file = process.env.DATABASE_PATH ?? 'data/bot.db';
mkdirSync(dirname(file), { recursive: true });

export const db = new Database(file);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS guild_modules (
  guild_id TEXT NOT NULL,
  module   TEXT NOT NULL,
  enabled  INTEGER NOT NULL,
  PRIMARY KEY (guild_id, module)
);
CREATE TABLE IF NOT EXISTS bug_reports (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id       TEXT NOT NULL,
  user_id        TEXT NOT NULL,
  title          TEXT NOT NULL,
  description    TEXT NOT NULL,
  steps          TEXT,
  attachment_url TEXT,
  status         TEXT NOT NULL DEFAULT 'open',
  created_at     INTEGER NOT NULL,
  resolved_at    INTEGER
);
`);

const cache = new Map();
function prep(sql) {
  let stmt = cache.get(sql);
  if (!stmt) cache.set(sql, (stmt = db.prepare(sql)));
  return stmt;
}

export const one = (sql, ...params) => prep(sql).get(...params);
export const all = (sql, ...params) => prep(sql).all(...params);
export const run = (sql, ...params) => prep(sql).run(...params);
