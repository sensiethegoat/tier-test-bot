import { db } from '../../db.js';

// One public site per server, reachable at /<slug> once an admin publishes it.
db.exec(`
CREATE TABLE IF NOT EXISTS web_config (
  guild_id   TEXT PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,
  guild_name TEXT NOT NULL,
  icon_url   TEXT,
  published  INTEGER NOT NULL DEFAULT 0
);
`);
