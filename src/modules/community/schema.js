import { db } from '../../db.js';

// Community tables (support tickets). Announcements need no storage.
db.exec(`
CREATE TABLE IF NOT EXISTS support_config (
  guild_id       TEXT PRIMARY KEY,
  staff_role_id  TEXT,
  category_id    TEXT,
  log_channel_id TEXT,
  max_open       INTEGER NOT NULL DEFAULT 1,
  next_number    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS support_tickets (
  channel_id TEXT PRIMARY KEY,
  guild_id   TEXT NOT NULL,
  number     INTEGER NOT NULL,
  user_id    TEXT NOT NULL,
  subject    TEXT NOT NULL,
  claimed_by TEXT,
  opened_at  INTEGER NOT NULL,
  closed_at  INTEGER,
  deleted    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS support_tickets_user ON support_tickets (guild_id, user_id, closed_at);
`);
