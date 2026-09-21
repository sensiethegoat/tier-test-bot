import { ChannelType, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { TICKET_DELETE_DELAY } from './constants.js';
import { all, one, run } from '../../db.js';
import { avatarUrl, displayName, getConfig, getPlayer, getRank, sendLog } from './util.js';
import { COLORS, UserError, isAdmin } from '../../util.js';

const MEMBER_PERMS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.EmbedLinks,
];

export const getTicket = (channelId) => one('SELECT * FROM tickets WHERE channel_id = ?', channelId);

export async function createTicket(guild, cfg, { member, testerId, gamemode, region }) {
  const player = getPlayer(guild.id, member.id);
  const rank = getRank(guild.id, member.id, gamemode);

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: guild.client.user.id, allow: MEMBER_PERMS },
    { id: member.id, allow: MEMBER_PERMS },
    { id: testerId, allow: MEMBER_PERMS },
  ];
  if (cfg.tester_role_id) overwrites.push({ id: cfg.tester_role_id, allow: MEMBER_PERMS });

  const name = `test-${player.ign}`.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const parent = cfg.ticket_category_id && guild.channels.cache.has(cfg.ticket_category_id) ? cfg.ticket_category_id : null;

  let channel;
  try {
    channel = await guild.channels.create({ name, type: ChannelType.GuildText, parent, permissionOverwrites: overwrites });
  } catch (err) {
    console.error(`Ticket creation failed in ${guild.id}:`, err.message);
    throw new UserError('I could not create the ticket channel. Make sure I have **Manage Channels** and **Manage Roles**.');
  }

  run(
    'INSERT INTO tickets (channel_id, guild_id, user_id, tester_id, gamemode, region, opened_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    channel.id, guild.id, member.id, testerId, gamemode, region, Date.now(),
  );

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle(`${gamemode} Tier Test · ${player.ign}`)
    .setThumbnail(avatarUrl(player))
    .setDescription(
      'Agree on a server and start when you are both ready.\n' +
        'Testers: finish with `/result`, or `/close` if the test did not happen.',
    )
    .addFields(
      { name: 'Player', value: `<@${member.id}>`, inline: true },
      { name: 'Tester', value: `<@${testerId}>`, inline: true },
      { name: 'Region', value: region, inline: true },
      { name: 'Username', value: player.ign, inline: true },
      { name: 'Account', value: player.cracked ? 'Cracked (test on an offline-mode server)' : 'Premium', inline: true },
      { name: 'Current Tier', value: rank?.tier ?? 'Unranked', inline: true },
      { name: 'Peak Tier', value: rank?.peak_tier ?? '—', inline: true },
      { name: 'Preferred Server', value: player.server || 'Not specified' },
    );

  await channel.send({
    content: `<@${member.id}> <@${testerId}>`,
    embeds: [embed],
    allowedMentions: { users: [member.id, testerId] },
  });

  await sendLog(
    guild,
    cfg,
    new EmbedBuilder()
      .setColor(COLORS.primary)
      .setTitle('Ticket opened')
      .setDescription(`${channel} · <@${member.id}> (${displayName(player)}) with <@${testerId}> · ${gamemode} ${region}`)
      .setTimestamp(),
  );
  return channel;
}

/** The open ticket in this channel, which the caller must be the tester of (or an admin). */
export function requireTicket(interaction) {
  const ticket = getTicket(interaction.channelId);
  if (!ticket || ticket.closed_at) throw new UserError('This is not an open test ticket.');
  if (ticket.tester_id !== interaction.user.id && !isAdmin(interaction.member)) {
    throw new UserError('Only the assigned tester or an admin can do that.');
  }
  return ticket;
}

export async function closeTicket(channel, ticket, closedBy, reason) {
  run('UPDATE tickets SET closed_at = ? WHERE channel_id = ?', Date.now(), ticket.channel_id);

  await sendLog(
    channel.guild,
    getConfig(channel.guild.id),
    new EmbedBuilder()
      .setColor(COLORS.danger)
      .setTitle('Ticket closed')
      .setDescription(`#${channel.name} · <@${ticket.user_id}> · ${ticket.gamemode} ${ticket.region}\nClosed by <@${closedBy}>`)
      .addFields({ name: 'Reason', value: reason || 'No reason given' })
      .setTimestamp(),
  );

  setTimeout(() => deleteTicketChannel(channel), TICKET_DELETE_DELAY);
}

async function deleteTicketChannel(channel) {
  await channel.delete().catch(() => {});
  run('UPDATE tickets SET deleted = 1 WHERE channel_id = ?', channel.id);
}

/** Deletes channels of tickets that were closed right before a restart. */
export async function sweepClosedTickets(client) {
  const stale = all('SELECT channel_id, guild_id FROM tickets WHERE closed_at IS NOT NULL AND deleted = 0');
  for (const t of stale) {
    if (!client.guilds.cache.has(t.guild_id)) continue; // another shard's guild
    const channel = await client.channels.fetch(t.channel_id).catch(() => null);
    if (channel) await deleteTicketChannel(channel);
    else run('UPDATE tickets SET deleted = 1 WHERE channel_id = ?', t.channel_id);
  }
}
