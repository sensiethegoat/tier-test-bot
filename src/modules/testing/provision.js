import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { all, run } from '../../db.js';
import { UserError } from '../../util.js';
import { REGIONS, tiersOf } from './constants.js';
import { panelView } from './panel.js';
import { refreshQueue } from './queue.js';
import { getConfig } from './util.js';

const REASON = 'Tier testing /autosetup';
const TIER_COLORS = {
  HT1: 0xff3b30, MT1: 0xff5a4d, LT1: 0xff6b6b,
  HT2: 0xff9500, MT2: 0xffa733, LT2: 0xffb84d,
  HT3: 0xffcc00, MT3: 0xffd633, LT3: 0xffe066,
  HT4: 0x34c759, MT4: 0x57d07a, LT4: 0x7bd88f,
  HT5: 0x0a84ff, MT5: 0x3d9dff, LT5: 0x64b5f6,
};

/** Creates any missing "<gamemode> <tier>" roles. Returns the roles it created. */
export async function ensureTierRoles(guild, gamemode) {
  const existing = new Map(
    all('SELECT tier, role_id FROM tier_roles WHERE guild_id = ? AND gamemode = ?', guild.id, gamemode).map((r) => [r.tier, r.role_id]),
  );
  const created = [];
  // Create worst → best so the top tier ends up highest in the role list.
  for (const tier of [...tiersOf(getConfig(guild.id))].reverse()) {
    if (existing.has(tier) && guild.roles.cache.has(existing.get(tier))) continue;
    const role = await guild.roles
      .create({ name: `${gamemode} ${tier}`, colors: { primaryColor: TIER_COLORS[tier] }, reason: REASON })
      .catch(() => null);
    if (!role) throw new UserError('I could not create roles. Give me **Manage Roles**.');
    run('INSERT OR REPLACE INTO tier_roles VALUES (?, ?, ?, ?)', guild.id, gamemode, tier, role.id);
    created.push(role);
  }
  return created;
}

const valid = (guild, id, type) => {
  const channel = id && guild.channels.cache.get(id);
  return channel && (type === undefined || channel.type === type) ? channel : null;
};

async function findOrCreateRole(guild, id, name) {
  const found = (id && guild.roles.cache.get(id)) || guild.roles.cache.find((r) => r.name === name);
  return found ?? guild.roles.create({ name, reason: REASON });
}

async function findOrCreateChannel(guild, { id, name, type = ChannelType.GuildText, parent, overwrites }) {
  const found =
    valid(guild, id, type) ||
    guild.channels.cache.find((c) => c.type === type && c.name === name && (parent === undefined || c.parentId === (parent?.id ?? null)));
  if (found) return found;
  return guild.channels.create({ name, type, parent: parent?.id, permissionOverwrites: overwrites, reason: REASON });
}

/**
 * Builds (or completes) the whole testing layout for one gamemode. Safe to run again: it
 * reuses what exists and only creates what's missing, so running it for a second gamemode
 * adds that gamemode's queues, roles and panel next to the first.
 */
export async function autosetup(guild, gamemode, regions) {
  const me = guild.members.me;
  if (!me.permissions.has([PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles])) {
    throw new UserError('I need **Manage Channels** and **Manage Roles** to set up the server.');
  }
  run('INSERT OR IGNORE INTO gamemodes (guild_id, name) VALUES (?, ?)', guild.id, gamemode);
  const cfg = getConfig(guild.id);
  const everyone = guild.roles.everyone.id;
  const view = PermissionFlagsBits.ViewChannel;
  const send = PermissionFlagsBits.SendMessages;
  const botAllow = { id: me.id, allow: [view, send, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory] };
  const readOnly = [{ id: everyone, allow: [view], deny: [send] }, botAllow];

  const tester = await findOrCreateRole(guild, cfg.tester_role_id, 'Tester');
  const staffOnly = [{ id: everyone, deny: [view] }, { id: tester.id, allow: [view] }, botAllow];

  const category = await findOrCreateChannel(guild, { name: '🏆 Tier Testing', type: ChannelType.GuildCategory });
  const tickets = await findOrCreateChannel(guild, {
    id: cfg.ticket_category_id,
    name: '⚔️ Test Tickets',
    type: ChannelType.GuildCategory,
    overwrites: [{ id: everyone, deny: [view] }, botAllow],
  });
  const request = await findOrCreateChannel(guild, { name: 'request-test', parent: category, overwrites: readOnly });
  const results = await findOrCreateChannel(guild, { id: cfg.results_channel_id, name: 'results', parent: category, overwrites: readOnly });
  const logs = await findOrCreateChannel(guild, { id: cfg.log_channel_id, name: 'test-logs', parent: category, overwrites: staffOnly });

  const highTester = await findOrCreateRole(guild, cfg.high_tester_role_id, 'High Tester');
  const high = await findOrCreateChannel(guild, {
    id: cfg.high_channel_id,
    name: 'high-tests',
    parent: category,
    overwrites: [{ id: everyone, deny: [view] }, { id: highTester.id, allow: [view] }, botAllow],
  });

  run(
    `UPDATE guild_config SET tester_role_id = ?, ticket_category_id = ?, results_channel_id = ?, log_channel_id = ?,
       high_tester_role_id = ?, high_channel_id = ? WHERE guild_id = ?`,
    tester.id, tickets.id, results.id, logs.id, highTester.id, high.id, guild.id,
  );

  const queues = [];
  for (const region of regions) {
    const channel = await findOrCreateChannel(guild, { name: `${region.toLowerCase()}-queue`, parent: category, overwrites: readOnly });
    const waitlist = await findOrCreateRole(guild, null, `${region} Waitlist`);
    run(
      `INSERT INTO queues (guild_id, gamemode, region, channel_id, waitlist_role_id) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (guild_id, gamemode, region) DO UPDATE SET channel_id = excluded.channel_id,
         waitlist_role_id = excluded.waitlist_role_id,
         message_id = CASE WHEN queues.channel_id = excluded.channel_id THEN queues.message_id ELSE NULL END`,
      guild.id, gamemode, region, channel.id, waitlist.id,
    );
    await refreshQueue(guild.client, guild.id, gamemode, region);
    queues.push({ region, channel, waitlist });
  }

  const tierRoles = await ensureTierRoles(guild, gamemode);

  // One panel per gamemode: skip posting if this gamemode's panel is already there.
  const recent = await request.messages.fetch({ limit: 50 }).catch(() => new Map());
  const hasPanel = [...recent.values()].some(
    (m) => m.author?.id === me.id && m.components?.some((row) => row.components?.some((c) => c.customId === `panel:waitlist:${gamemode}`)),
  );
  if (!hasPanel) await request.send(panelView(gamemode, getConfig(guild.id)));

  return { category, tickets, request, results, logs, high, tester, highTester, queues, tierRoles, postedPanel: !hasPanel };
}

export const ALL_REGIONS = Object.keys(REGIONS);
export const DEFAULT_REGIONS = ['NA', 'EU', 'AS', 'OC'];
