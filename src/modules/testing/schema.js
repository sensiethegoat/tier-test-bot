import { db } from '../../db.js';

// Tier testing tables.
db.exec(`
CREATE TABLE IF NOT EXISTS guild_config (
  guild_id           TEXT PRIMARY KEY,
  tester_role_id     TEXT,
  ticket_category_id TEXT,
  results_channel_id TEXT,
  log_channel_id     TEXT,
  cooldown_days      INTEGER NOT NULL DEFAULT 30,
  max_queue          INTEGER NOT NULL DEFAULT 20,
  account_mode       TEXT NOT NULL DEFAULT 'premium'
);

CREATE TABLE IF NOT EXISTS gamemodes (
  guild_id TEXT NOT NULL,
  name     TEXT NOT NULL,
  PRIMARY KEY (guild_id, name)
);

CREATE TABLE IF NOT EXISTS players (
  guild_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  ign         TEXT NOT NULL,
  uuid        TEXT NOT NULL,
  region      TEXT,
  server      TEXT,
  verified_at INTEGER NOT NULL,
  cracked     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS players_uuid ON players (guild_id, uuid);

CREATE TABLE IF NOT EXISTS ranks (
  guild_id       TEXT NOT NULL,
  user_id        TEXT NOT NULL,
  gamemode       TEXT NOT NULL,
  tier           TEXT NOT NULL,
  peak_tier      TEXT NOT NULL,
  last_tested_at INTEGER,
  PRIMARY KEY (guild_id, user_id, gamemode)
);

CREATE TABLE IF NOT EXISTS tests (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  tester_id  TEXT NOT NULL,
  gamemode   TEXT NOT NULL,
  region     TEXT NOT NULL,
  ign        TEXT NOT NULL,
  prev_tier  TEXT,
  new_tier   TEXT NOT NULL,
  notes      TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tests_tester ON tests (guild_id, tester_id, created_at);

CREATE TABLE IF NOT EXISTS queues (
  guild_id         TEXT NOT NULL,
  gamemode         TEXT NOT NULL,
  region           TEXT NOT NULL,
  channel_id       TEXT NOT NULL,
  waitlist_role_id TEXT,
  message_id       TEXT,
  open             INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, gamemode, region)
);

CREATE TABLE IF NOT EXISTS queue_testers (
  guild_id  TEXT NOT NULL,
  gamemode  TEXT NOT NULL,
  region    TEXT NOT NULL,
  tester_id TEXT NOT NULL,
  PRIMARY KEY (guild_id, gamemode, region, tester_id)
);

-- One queue spot per player per gamemode.
CREATE TABLE IF NOT EXISTS queue_entries (
  guild_id  TEXT NOT NULL,
  gamemode  TEXT NOT NULL,
  region    TEXT NOT NULL,
  user_id   TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, gamemode, user_id)
);

CREATE TABLE IF NOT EXISTS waitlist (
  guild_id  TEXT NOT NULL,
  gamemode  TEXT NOT NULL,
  user_id   TEXT NOT NULL,
  region    TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, gamemode, user_id)
);

CREATE TABLE IF NOT EXISTS tickets (
  channel_id TEXT PRIMARY KEY,
  guild_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  tester_id  TEXT NOT NULL,
  gamemode   TEXT NOT NULL,
  region     TEXT NOT NULL,
  opened_at  INTEGER NOT NULL,
  closed_at  INTEGER,
  deleted    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS tickets_user ON tickets (guild_id, user_id, closed_at);

CREATE TABLE IF NOT EXISTS tier_roles (
  guild_id TEXT NOT NULL,
  gamemode TEXT NOT NULL,
  tier     TEXT NOT NULL,
  role_id  TEXT NOT NULL,
  PRIMARY KEY (guild_id, gamemode, tier)
);


CREATE TABLE IF NOT EXISTS restrictions (
  guild_id TEXT NOT NULL,
  user_id  TEXT NOT NULL,
  until    INTEGER,
  reason   TEXT,
  PRIMARY KEY (guild_id, user_id)
);
`);

// Columns added after the first release; CREATE TABLE IF NOT EXISTS won't add them to old databases.
const hasColumn = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
if (!hasColumn('guild_config', 'account_mode')) {
  db.exec("ALTER TABLE guild_config ADD COLUMN account_mode TEXT NOT NULL DEFAULT 'premium'");
}
if (!hasColumn('players', 'cracked')) db.exec('ALTER TABLE players ADD COLUMN cracked INTEGER NOT NULL DEFAULT 0');
