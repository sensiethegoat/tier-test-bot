import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { all, db, one, run } from '../../db.js';
import { createTicket } from './tickets.js';
import { assertCanTest, getConfig, requireTester, requireVerified } from './util.js';
import { COLORS, UserError } from '../../util.js';

export const getQueue = (guildId, gamemode, region) =>
  one('SELECT * FROM queues WHERE guild_id = ? AND gamemode = ? AND region = ?', guildId, gamemode, region);

export const queueEntries = (guildId, gamemode, region) =>
  all(
    'SELECT user_id, joined_at FROM queue_entries WHERE guild_id = ? AND gamemode = ? AND region = ? ORDER BY joined_at, rowid',
    guildId, gamemode, region,
  );

const queueTesters = (guildId, gamemode, region) =>
  all('SELECT tester_id FROM queue_testers WHERE guild_id = ? AND gamemode = ? AND region = ?', guildId, gamemode, region);

function render(q, cfg) {
  const embed = new EmbedBuilder().setTitle(`${q.gamemode} Testing Queue · ${q.region}`).setTimestamp();

  if (q.open) {
    const testers = queueTesters(q.guild_id, q.gamemode, q.region);
    const entries = queueEntries(q.guild_id, q.gamemode, q.region);
    embed.setColor(COLORS.success).setDescription(
      [
        `**Tester${testers.length === 1 ? '' : 's'} available:**`,
        testers.map((t, i) => `${i + 1}. <@${t.tester_id}>`).join('\n') || '—',
        '',
        `**Queue** (${entries.length}/${cfg.max_queue}):`,
        entries.map((e, i) => `${i + 1}. <@${e.user_id}>`).join('\n') || '*Empty*',
      ].join('\n'),
    );
  } else {
    embed
      .setColor(COLORS.grey)
      .setDescription(
        'No testers are available for this queue right now.\n\n' +
          'Enter the waitlist from the request-test panel and you will be pinged here when a tester opens the queue.',
      );
  }

  const id = `${q.gamemode}:${q.region}`;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`queue:join:${id}`).setLabel('Join Queue').setStyle(ButtonStyle.Success).setDisabled(!q.open),
    new ButtonBuilder().setCustomId(`queue:leave:${id}`).setLabel('Leave Queue').setStyle(ButtonStyle.Danger).setDisabled(!q.open),
    new ButtonBuilder().setCustomId(`queue:next:${id}`).setLabel('Next Player').setEmoji('⏭️').setStyle(ButtonStyle.Secondary).setDisabled(!q.open),
  );
  return { embeds: [embed], components: [row], allowedMentions: { parse: [] } };
}

async function doRefresh(client, guildId, gamemode, region) {
  const q = getQueue(guildId, gamemode, region);
  if (!q) return;
  const channel = await client.channels.fetch(q.channel_id).catch(() => null);
  if (!channel?.isTextBased()) return;

  const view = render(q, getConfig(guildId));
  if (q.message_id) {
    const msg = await channel.messages.fetch(q.message_id).catch(() => null);
    if (msg) return void (await msg.edit(view));
  }
  const msg = await channel.send(view);
  run('UPDATE queues SET message_id = ? WHERE guild_id = ? AND gamemode = ? AND region = ?', msg.id, guildId, gamemode, region);
}

// Refreshes are chained per queue so two quick clicks can't post two queue messages.
const chains = new Map();
export function refreshQueue(client, guildId, gamemode, region) {
  const key = `${guildId}:${gamemode}:${region}`;
  const next = (chains.get(key) ?? Promise.resolve())
    .then(() => doRefresh(client, guildId, gamemode, region))
    .catch((err) => console.error(`Failed to refresh queue ${key}:`, err.message));
  chains.set(key, next);
  next.finally(() => chains.get(key) === next && chains.delete(key));
  return next;
}

export async function openQueue(interaction, gamemode, region) {
  requireTester(interaction);
  const q = getQueue(interaction.guildId, gamemode, region);
  if (!q) throw new UserError(`There is no ${gamemode} ${region} queue. An admin can create one with \`/setup queue\`.`);

  run('INSERT OR IGNORE INTO queue_testers VALUES (?, ?, ?, ?)', interaction.guildId, gamemode, region, interaction.user.id);
  run('UPDATE queues SET open = 1 WHERE guild_id = ? AND gamemode = ? AND region = ?', interaction.guildId, gamemode, region);
  await refreshQueue(interaction.client, interaction.guildId, gamemode, region);

  if (!q.open) {
    const channel = await interaction.guild.channels.fetch(q.channel_id).catch(() => null);
    const ping = q.waitlist_role_id ? `<@&${q.waitlist_role_id}> ` : '';
    await channel
      ?.send({
        content: `${ping}The **${gamemode}** queue for **${region}** is now open! Press **Join Queue** above.`,
        allowedMentions: { roles: q.waitlist_role_id ? [q.waitlist_role_id] : [] },
      })
      .catch(() => {});
  }
  return q;
}

export async function closeQueue(client, guildId, gamemode, region) {
  db.transaction(() => {
    run('DELETE FROM queue_testers WHERE guild_id = ? AND gamemode = ? AND region = ?', guildId, gamemode, region);
    run('DELETE FROM queue_entries WHERE guild_id = ? AND gamemode = ? AND region = ?', guildId, gamemode, region);
    run('UPDATE queues SET open = 0 WHERE guild_id = ? AND gamemode = ? AND region = ?', guildId, gamemode, region);
  })();
  await refreshQueue(client, guildId, gamemode, region);
}

/** Removes a tester from a queue; closes the queue when nobody is left testing. */
export async function testerLeave(client, guildId, gamemode, region, testerId) {
  run('DELETE FROM queue_testers WHERE guild_id = ? AND gamemode = ? AND region = ? AND tester_id = ?', guildId, gamemode, region, testerId);
  const left = one('SELECT COUNT(*) AS n FROM queue_testers WHERE guild_id = ? AND gamemode = ? AND region = ?', guildId, gamemode, region).n;
  if (left === 0) await closeQueue(client, guildId, gamemode, region);
  else await refreshQueue(client, guildId, gamemode, region);
  return left;
}

export async function joinQueue(interaction, gamemode, region) {
  const { guildId, user } = interaction;
  const cfg = getConfig(guildId);
  const q = getQueue(guildId, gamemode, region);
  if (!q?.open) throw new UserError('This queue is closed.');

  const player = requireVerified(guildId, user.id);
  if (player.region !== region) {
    throw new UserError(`This queue is for **${region}**, but your region is **${player.region}**.`);
  }
  if (!one('SELECT 1 FROM waitlist WHERE guild_id = ? AND gamemode = ? AND user_id = ?', guildId, gamemode, user.id)) {
    throw new UserError(`Enter the **${gamemode}** waitlist first (request-test panel).`);
  }
  assertCanTest(guildId, user.id, gamemode, cfg);

  const entries = queueEntries(guildId, gamemode, region);
  const pos = entries.findIndex((e) => e.user_id === user.id);
  if (pos !== -1) throw new UserError(`You are already in the queue at **#${pos + 1}**.`);
  if (entries.length >= cfg.max_queue) throw new UserError('The queue is full. Try again when a spot opens up.');

  run('INSERT INTO queue_entries VALUES (?, ?, ?, ?, ?)', guildId, gamemode, region, user.id, Date.now());
  await refreshQueue(interaction.client, guildId, gamemode, region);
  return entries.length + 1;
}

export async function leaveQueue(interaction, gamemode, region) {
  const res = run(
    'DELETE FROM queue_entries WHERE guild_id = ? AND gamemode = ? AND region = ? AND user_id = ?',
    interaction.guildId, gamemode, region, interaction.user.id,
  );
  if (!res.changes) throw new UserError('You are not in this queue.');
  await refreshQueue(interaction.client, interaction.guildId, gamemode, region);
}

/** Pops the first player in the queue and opens a test ticket for them with the calling tester. */
export async function nextPlayer(interaction, gamemode, region) {
  const cfg = requireTester(interaction);
  const { guild, guildId, user } = interaction;
  const q = getQueue(guildId, gamemode, region);
  if (!q?.open) throw new UserError('That queue is not open.');
  run('INSERT OR IGNORE INTO queue_testers VALUES (?, ?, ?, ?)', guildId, gamemode, region, user.id);

  // Removing the entry synchronously before any await means two testers can't pop the same player.
  let entry, member;
  while ((entry = queueEntries(guildId, gamemode, region)[0])) {
    run('DELETE FROM queue_entries WHERE guild_id = ? AND gamemode = ? AND user_id = ?', guildId, gamemode, entry.user_id);
    member = await guild.members.fetch(entry.user_id).catch(() => null);
    if (member) break;
  }
  if (!entry) {
    await refreshQueue(interaction.client, guildId, gamemode, region);
    throw new UserError('The queue is empty.');
  }

  let channel;
  try {
    channel = await createTicket(guild, cfg, { member, testerId: user.id, gamemode, region });
  } catch (err) {
    run('INSERT OR IGNORE INTO queue_entries VALUES (?, ?, ?, ?, ?)', guildId, gamemode, region, entry.user_id, entry.joined_at);
    throw err;
  }

  run('DELETE FROM waitlist WHERE guild_id = ? AND gamemode = ? AND user_id = ?', guildId, gamemode, member.id);
  if (q.waitlist_role_id) await member.roles.remove(q.waitlist_role_id).catch(() => {});
  await refreshQueue(interaction.client, guildId, gamemode, region);
  return channel;
}

/** Takes a user out of every waitlist and queue in the guild (used for restrictions and unlinking). */
export async function removeEverywhere(client, guildId, userId) {
  const queued = all('SELECT gamemode, region FROM queue_entries WHERE guild_id = ? AND user_id = ?', guildId, userId);
  const roles = all(
    `SELECT q.waitlist_role_id AS id FROM waitlist w JOIN queues q USING (guild_id, gamemode, region)
     WHERE w.guild_id = ? AND w.user_id = ? AND q.waitlist_role_id IS NOT NULL`,
    guildId, userId,
  ).map((r) => r.id);
  run('DELETE FROM queue_entries WHERE guild_id = ? AND user_id = ?', guildId, userId);
  run('DELETE FROM waitlist WHERE guild_id = ? AND user_id = ?', guildId, userId);

  if (roles.length) {
    const guild = client.guilds.cache.get(guildId);
    const member = await guild?.members.fetch(userId).catch(() => null);
    await member?.roles.remove(roles).catch(() => {});
  }
  await Promise.all(queued.map((q) => refreshQueue(client, guildId, q.gamemode, q.region)));
}
