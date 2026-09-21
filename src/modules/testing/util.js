import { createHash } from 'node:crypto';
import { DAY, REGIONS, TIERS, USERNAME_RE, tierIndex } from './constants.js';
import { all, one, run } from '../../db.js';
import { UserError, isAdmin, ts } from '../../util.js';

export function getConfig(guildId) {
  run('INSERT OR IGNORE INTO guild_config (guild_id) VALUES (?)', guildId);
  return one('SELECT * FROM guild_config WHERE guild_id = ?', guildId);
}

export const gamemodes = (guildId) =>
  all('SELECT name FROM gamemodes WHERE guild_id = ? ORDER BY name COLLATE NOCASE', guildId).map((r) => r.name);

export function resolveGamemode(guildId, input) {
  const gm = gamemodes(guildId).find((g) => g.toLowerCase() === input?.toLowerCase());
  if (!gm) throw new UserError(`Unknown gamemode \`${input}\`. An admin can add it with \`/setup gamemode add\`.`);
  return gm;
}

export const isTester = (member, cfg) =>
  isAdmin(member) || Boolean(cfg.tester_role_id && member.roles.cache.has(cfg.tester_role_id));

/** High testing is on once a server sets a high-test channel. Until then regular tests have no cap. */
export const highEnabled = (cfg) => Boolean(cfg.high_channel_id);

export const isHighTester = (member, cfg) =>
  isAdmin(member) || Boolean(cfg.high_tester_role_id && member.roles.cache.has(cfg.high_tester_role_id));

/** Tiers a ticket's result may give: everything in a high test, up to the cap in a regular one. */
export const allowedTiers = (cfg, ticket) =>
  ticket.high || !highEnabled(cfg) ? TIERS : TIERS.filter((t) => tierIndex(t) >= tierIndex(cfg.high_cap));

export function requireTester(interaction) {
  const cfg = getConfig(interaction.guildId);
  if (!isTester(interaction.member, cfg)) throw new UserError('Only testers can do that.');
  return cfg;
}

export const getPlayer = (guildId, userId) =>
  one('SELECT * FROM players WHERE guild_id = ? AND user_id = ?', guildId, userId);

export function requireVerified(guildId, userId) {
  const player = getPlayer(guildId, userId);
  if (!player) throw new UserError('Verify your Minecraft account first with the **Verify Account** button.');
  if (!player.region) throw new UserError('Finish verifying by picking a region (press **Verify Account** again).');
  if (player.cracked && getConfig(guildId).account_mode === 'premium') {
    throw new UserError('This server no longer accepts cracked accounts. Press **Verify Account** to link a premium account.');
  }
  return player;
}

export const getRank = (guildId, userId, gamemode) =>
  one('SELECT * FROM ranks WHERE guild_id = ? AND user_id = ? AND gamemode = ?', guildId, userId, gamemode);

/** Returns the timestamp the cooldown ends at, or null if the player can test. */
export function cooldownEnds(guildId, userId, gamemode, cfg) {
  const last = getRank(guildId, userId, gamemode)?.last_tested_at;
  if (!last) return null;
  const end = last + cfg.cooldown_days * DAY;
  return end > Date.now() ? end : null;
}

export function activeRestriction(guildId, userId) {
  const r = one('SELECT * FROM restrictions WHERE guild_id = ? AND user_id = ?', guildId, userId);
  if (r?.until && r.until <= Date.now()) {
    run('DELETE FROM restrictions WHERE guild_id = ? AND user_id = ?', guildId, userId);
    return null;
  }
  return r ?? null;
}

/** Throws if the player is restricted, on cooldown, or already in a ticket. */
export function assertCanTest(guildId, userId, gamemode, cfg, { ignoreCooldown = false } = {}) {
  const r = activeRestriction(guildId, userId);
  if (r) {
    const until = r.until ? ` until ${ts(r.until, 'f')}` : '';
    throw new UserError(`You are restricted from testing${until}.${r.reason ? ` Reason: ${r.reason}` : ''}`);
  }
  const cd = !ignoreCooldown && cooldownEnds(guildId, userId, gamemode, cfg);
  if (cd) throw new UserError(`You were tested in **${gamemode}** recently. You can test again ${ts(cd)}.`);
  if (openTicketFor(guildId, userId)) throw new UserError('You already have an open test ticket.');
}

export const openTicketFor = (guildId, userId) =>
  one('SELECT * FROM tickets WHERE guild_id = ? AND user_id = ? AND closed_at IS NULL', guildId, userId);

// Cracked players get the default skin: their name may belong to someone else's premium skin.
export const avatarUrl = (player) =>
  player.cracked ? 'https://mc-heads.net/avatar/MHF_Steve/128' : `https://mc-heads.net/avatar/${player.uuid}/128`;

export const displayName = (player) => (player.cracked ? `${player.ign} (cracked)` : player.ign);

/** The UUID an offline-mode server gives a name: a v3 UUID of "OfflinePlayer:<name>", like Mojang's, without dashes. */
export function offlineUuid(name) {
  const hash = createHash('md5').update(`OfflinePlayer:${name}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x30;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  return hash.toString('hex');
}

/** Looks up a Java account. Returns { uuid, ign } or null if it doesn't exist. */
export async function lookupMinecraft(name) {
  if (!USERNAME_RE.test(name)) return null;
  const urls = [
    `https://api.mojang.com/users/profiles/minecraft/${name}`,
    `https://api.minecraftservices.com/minecraft/profile/lookup/name/${name}`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.status === 200) {
        const body = await res.json();
        return { uuid: body.id, ign: body.name };
      }
      if (res.status === 204 || res.status === 404) return null;
    } catch {
      // try the next endpoint
    }
  }
  throw new UserError('Could not reach the Minecraft API right now. Try again in a minute.');
}

export async function sendLog(guild, cfg, embed) {
  if (!cfg.log_channel_id) return;
  const channel = await guild.channels.fetch(cfg.log_channel_id).catch(() => null);
  await channel?.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
}

/** Gives the member the role for their current tier and removes the other tier roles of that gamemode. */
export async function applyTierRole(member, gamemode, tier) {
  const roles = all('SELECT tier, role_id FROM tier_roles WHERE guild_id = ? AND gamemode = ?', member.guild.id, gamemode);
  const remove = roles.filter((r) => r.tier !== tier && member.roles.cache.has(r.role_id)).map((r) => r.role_id);
  const add = roles.find((r) => r.tier === tier)?.role_id;
  if (remove.length) await member.roles.remove(remove).catch(() => {});
  if (add) await member.roles.add(add).catch(() => {});
}

/** With nickname sync on, renames the member to "[best current tier] IGN". */
export async function syncNickname(member) {
  const cfg = getConfig(member.guild.id);
  const player = getPlayer(member.guild.id, member.id);
  if (!cfg.nick_sync || !player || !member.manageable) return;
  const best = all('SELECT tier FROM ranks WHERE guild_id = ? AND user_id = ?', member.guild.id, member.id)
    .map((r) => r.tier)
    .sort((a, b) => tierIndex(a) - tierIndex(b))[0];
  const nick = (best ? `[${best}] ${player.ign}` : player.ign).slice(0, 32);
  if (member.nickname !== nick) await member.setNickname(nick, 'Tier nickname sync').catch(() => {});
}

// Shared slash-command option builders.
export const gamemodeOption = (o, required = true) =>
  o.setName('gamemode').setDescription('Gamemode').setRequired(required).setAutocomplete(true);

export const regionOption = (o, required = true) =>
  o
    .setName('region')
    .setDescription('Region')
    .setRequired(required)
    .addChoices(...Object.entries(REGIONS).map(([value, name]) => ({ name: `${value} · ${name}`, value })));

export const tierOption = (o, extra = []) =>
  o
    .setName('tier')
    .setDescription('Tier')
    .setRequired(true)
    .addChoices(...[...TIERS, ...extra].map((t) => ({ name: t, value: t })));
