import { all, one } from '../../db.js';
import { overallTier, pointsFor, tierIndex, titleFor } from '../testing/constants.js';

// Everything the website shows. Only public fields leave this file: never Discord IDs or staff notes.

const VISIBLE = `w.published = 1 AND COALESCE(
  (SELECT enabled FROM guild_modules m WHERE m.guild_id = w.guild_id AND m.module = 'web'), 1) = 1`;

export const siteBySlug = (slug) => one(`SELECT * FROM web_config w WHERE w.slug = ? AND ${VISIBLE}`, slug);
export const siteByGuild = (guildId) => one(`SELECT * FROM web_config w WHERE w.guild_id = ? AND ${VISIBLE}`, guildId);
export const publishedSites = () => all(`SELECT slug, guild_name, icon_url FROM web_config w WHERE ${VISIBLE} ORDER BY guild_name COLLATE NOCASE`);

export const gamemodesOf = (guildId) => all('SELECT name, icon FROM gamemodes WHERE guild_id = ? ORDER BY name COLLATE NOCASE', guildId);

/** A server's testing settings (tier scale). Falls back to the defaults if it has none yet. */
export const settingsOf = (guildId) => one('SELECT * FROM guild_config WHERE guild_id = ?', guildId) ?? { tier_set: 10 };

const head = (p) => (p.cracked ? 'MHF_Steve' : p.uuid);

/** Where a player sits in a gamemode's ranking, ignoring retired players. */
function positionIn(guildId, gamemode, userId) {
  const rows = all(
    `SELECT r.user_id, r.tier, r.last_tested_at FROM ranks r JOIN players p ON p.guild_id = r.guild_id AND p.user_id = r.user_id
     WHERE r.guild_id = ? AND r.gamemode = ? AND p.retired = 0`,
    guildId, gamemode,
  ).sort((a, b) => tierIndex(a.tier) - tierIndex(b.tier) || (a.last_tested_at ?? 0) - (b.last_tested_at ?? 0));
  const index = rows.findIndex((r) => r.user_id === userId);
  return index === -1 ? null : index + 1;
}

export function leaderboard(guildId, gamemode, region, { includeRetired = false } = {}) {
  const cfg = settingsOf(guildId);
  let rows = all(
    `SELECT r.user_id, r.gamemode, r.tier, r.peak_tier, r.last_tested_at, p.ign, p.uuid, p.region, p.cracked, p.retired
     FROM ranks r JOIN players p ON p.guild_id = r.guild_id AND p.user_id = r.user_id
     WHERE r.guild_id = ?`,
    guildId,
  );
  if (region) rows = rows.filter((r) => r.region === region);
  if (!includeRetired) rows = rows.filter((r) => !r.retired);
  const base = (r) => ({ ign: r.ign, head: head(r), region: r.region, cracked: Boolean(r.cracked), retired: Boolean(r.retired) });

  if (gamemode) {
    return rows
      .filter((r) => r.gamemode === gamemode)
      .sort((a, b) => tierIndex(a.tier) - tierIndex(b.tier) || (a.last_tested_at ?? 0) - (b.last_tested_at ?? 0))
      .slice(0, 100)
      .map((r, i) => ({ rank: i + 1, ...base(r), tier: r.tier, peak: r.peak_tier }));
  }

  const players = new Map();
  for (const r of rows) {
    const p = players.get(r.user_id) ?? { ...base(r), points: 0, tiers: {} };
    p.points += pointsFor(cfg, r.peak_tier);
    p.tiers[r.gamemode] = r.tier;
    players.set(r.user_id, p);
  }
  return [...players.values()]
    .sort((a, b) => b.points - a.points || a.ign.localeCompare(b.ign))
    .slice(0, 100)
    .map((p, i) => ({ rank: i + 1, ...p, overall: overallTier(cfg, p.points), title: titleFor(p.points) }));
}

export const seasonsOf = (guildId) =>
  all('SELECT id, name, started_at, ended_at FROM seasons WHERE guild_id = ? ORDER BY id DESC', guildId).map((s) => ({
    id: s.id,
    name: s.name,
    startedAt: s.started_at ? new Date(s.started_at).toISOString() : null,
    endedAt: new Date(s.ended_at).toISOString(),
  }));

export const seasonOf = (guildId, id) => one('SELECT * FROM seasons WHERE guild_id = ? AND id = ?', guildId, id);

/** Final standings of a finished season, in the same shape as the live leaderboard. */
export function seasonLeaderboard(guildId, seasonId, gamemode) {
  const cfg = settingsOf(guildId);
  const rows = all(
    `SELECT s.user_id, s.gamemode, s.tier, s.peak_tier, s.ign, p.uuid, p.region, p.cracked
     FROM season_ranks s LEFT JOIN players p ON p.guild_id = s.guild_id AND p.user_id = s.user_id
     WHERE s.guild_id = ? AND s.season_id = ?`,
    guildId, seasonId,
  );
  const base = (r) => ({ ign: r.ign ?? 'Unknown', head: r.uuid && !r.cracked ? r.uuid : 'MHF_Steve', region: r.region ?? '—', cracked: Boolean(r.cracked) });

  if (gamemode) {
    return rows
      .filter((r) => r.gamemode === gamemode)
      .sort((a, b) => tierIndex(a.tier) - tierIndex(b.tier) || String(a.ign).localeCompare(String(b.ign)))
      .slice(0, 100)
      .map((r, i) => ({ rank: i + 1, ...base(r), tier: r.tier, peak: r.peak_tier }));
  }
  const players = new Map();
  for (const r of rows) {
    const p = players.get(r.user_id) ?? { ...base(r), points: 0, tiers: {} };
    p.points += pointsFor(cfg, r.peak_tier);
    p.tiers[r.gamemode] = r.tier;
    players.set(r.user_id, p);
  }
  return [...players.values()]
    .sort((a, b) => b.points - a.points || a.ign.localeCompare(b.ign))
    .slice(0, 100)
    .map((p, i) => ({ rank: i + 1, ...p, overall: overallTier(cfg, p.points), title: titleFor(p.points) }));
}

export function player(guildId, ign) {
  const p = one('SELECT * FROM players WHERE guild_id = ? AND lower(ign) = lower(?)', guildId, ign);
  if (!p) return null;
  const cfg = settingsOf(guildId);
  const ranks = all('SELECT gamemode, tier, peak_tier FROM ranks WHERE guild_id = ? AND user_id = ?', guildId, p.user_id);
  const points = ranks.reduce((sum, r) => sum + pointsFor(cfg, r.peak_tier), 0);
  const history = all(
    `SELECT id, gamemode, region, prev_tier, new_tier, score, high, created_at FROM tests
     WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 50`,
    guildId, p.user_id,
  );
  return {
    ign: p.ign,
    head: head(p),
    region: p.region,
    cracked: Boolean(p.cracked),
    retired: Boolean(p.retired),
    points,
    overall: overallTier(cfg, points),
    title: titleFor(points),
    tiers: Object.fromEntries(
      ranks.map((r) => [r.gamemode, { tier: r.tier, peak: r.peak_tier, position: p.retired ? null : positionIn(guildId, r.gamemode, p.user_id) }]),
    ),
    history: history.map(publicResult),
  };
}

const RESULT_SQL = `SELECT t.id, t.ign, t.gamemode, t.region, t.prev_tier, t.new_tier, t.score, t.high, t.created_at, p.uuid, p.cracked
  FROM tests t LEFT JOIN players p ON p.guild_id = t.guild_id AND p.user_id = t.user_id`;

const publicResult = (r) => ({
  id: r.id,
  ...(r.ign !== undefined && { ign: r.ign, head: r.uuid ? head(r) : 'MHF_Steve' }),
  gamemode: r.gamemode,
  region: r.region,
  previousTier: r.prev_tier ?? 'Unranked',
  tier: r.new_tier,
  score: r.score,
  highTest: Boolean(r.high),
  testedAt: new Date(r.created_at).toISOString(),
});

export const results = (guildId, limit = 50) =>
  all(`${RESULT_SQL} WHERE t.guild_id = ? ORDER BY t.created_at DESC LIMIT ?`, guildId, limit).map(publicResult);

export function result(guildId, id) {
  const r = one(`${RESULT_SQL} WHERE t.guild_id = ? AND t.id = ?`, guildId, id);
  return r ? publicResult(r) : null;
}
