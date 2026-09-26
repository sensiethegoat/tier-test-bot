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

// Past seasons: a snapshot of every tier when the season ended.
db.exec(`
CREATE TABLE IF NOT EXISTS seasons (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL,
  name       TEXT NOT NULL,
  started_at INTEGER,
  ended_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS season_ranks (
  season_id INTEGER NOT NULL,
  guild_id  TEXT NOT NULL,
  user_id   TEXT NOT NULL,
  ign       TEXT,
  gamemode  TEXT NOT NULL,
  tier      TEXT NOT NULL,
  peak_tier TEXT NOT NULL,
  PRIMARY KEY (season_id, user_id, gamemode)
);
CREATE INDEX IF NOT EXISTS season_ranks_guild ON season_ranks (guild_id, season_id);
`);

// High test requests wait in the high-test channel until a high tester accepts or denies them.
db.exec(`
CREATE TABLE IF NOT EXISTS high_requests (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  gamemode   TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending',
  message_id TEXT,
  handled_by TEXT,
  reason     TEXT,
  created_at INTEGER NOT NULL,
  handled_at INTEGER
);
CREATE INDEX IF NOT EXISTS high_requests_user ON high_requests (guild_id, user_id, gamemode, status);
`);

// Columns added after the first release; CREATE TABLE IF NOT EXISTS won't add them to old databases.
const hasColumn = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
if (!hasColumn('guild_config', 'account_mode')) {
  db.exec("ALTER TABLE guild_config ADD COLUMN account_mode TEXT NOT NULL DEFAULT 'premium'");
}
if (!hasColumn('tests', 'score')) db.exec('ALTER TABLE tests ADD COLUMN score TEXT');
if (!hasColumn('guild_config', 'nick_sync')) db.exec('ALTER TABLE guild_config ADD COLUMN nick_sync INTEGER NOT NULL DEFAULT 0');
if (!hasColumn('guild_config', 'high_tester_role_id')) {
  db.exec('ALTER TABLE guild_config ADD COLUMN high_tester_role_id TEXT');
  db.exec('ALTER TABLE guild_config ADD COLUMN high_channel_id TEXT');
  db.exec("ALTER TABLE guild_config ADD COLUMN high_cap TEXT NOT NULL DEFAULT 'HT3'");
}
if (!hasColumn('tickets', 'high')) db.exec('ALTER TABLE tickets ADD COLUMN high INTEGER NOT NULL DEFAULT 0');
if (!hasColumn('tests', 'high')) db.exec('ALTER TABLE tests ADD COLUMN high INTEGER NOT NULL DEFAULT 0');
if (!hasColumn('guild_config', 'tier_set')) db.exec('ALTER TABLE guild_config ADD COLUMN tier_set INTEGER NOT NULL DEFAULT 10');
if (!hasColumn('players', 'retired')) {
  db.exec('ALTER TABLE players ADD COLUMN retired INTEGER NOT NULL DEFAULT 0');
  db.exec('ALTER TABLE players ADD COLUMN retired_at INTEGER');
}
if (!hasColumn('gamemodes', 'icon')) db.exec('ALTER TABLE gamemodes ADD COLUMN icon TEXT');
if (!hasColumn('tests', 'season_id')) db.exec('ALTER TABLE tests ADD COLUMN season_id INTEGER');

// The Oceania region used to be called AU; MCPVP-style lists call it OC.
const done = db.prepare("SELECT 1 FROM bot_meta WHERE key = 'region_au_to_oc'").get();
if (!done) {
  const tables = ['players', 'queues', 'queue_entries', 'waitlist', 'tickets', 'tests'];
  db.transaction(() => {
    for (const table of tables) db.prepare(`UPDATE ${table} SET region = 'OC' WHERE region = 'AU'`).run();
    db.prepare("INSERT INTO bot_meta (key, value) VALUES ('region_au_to_oc', '1')").run();
  })();
}

if (!hasColumn('players', 'cracked')) db.exec('ALTER TABLE players ADD COLUMN cracked INTEGER NOT NULL DEFAULT 0');
