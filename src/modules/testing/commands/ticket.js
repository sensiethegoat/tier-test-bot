import { EmbedBuilder, InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { bestTier } from '../constants.js';
import { db, run } from '../../../db.js';
import { closeTicket, requireTicket } from '../tickets.js';
import { applyTierRole, avatarUrl, displayName, getConfig, getPlayer, getRank, tierOption } from '../util.js';
import { COLORS, EPHEMERAL, UserError } from '../../../util.js';

const result = new SlashCommandBuilder()
  .setName('result')
  .setDescription('Submit the result of this test and close the ticket')
  .setContexts(InteractionContextType.Guild)
  .addStringOption((o) => tierOption(o))
  .addStringOption((o) => o.setName('notes').setDescription('Optional notes for the log').setMaxLength(500));

async function executeResult(interaction) {
  const ticket = requireTicket(interaction);
  const { guild, guildId, options, user } = interaction;
  const tier = options.getString('tier', true);
  const notes = options.getString('notes');
  await interaction.deferReply();

  const cfg = getConfig(guildId);
  const player = getPlayer(guildId, ticket.user_id);
  if (!player) throw new UserError('The player unlinked their account; close this ticket with `/close`.');
  const prev = getRank(guildId, ticket.user_id, ticket.gamemode);
  const now = Date.now();

  db.transaction(() => {
    run(
      `INSERT INTO ranks (guild_id, user_id, gamemode, tier, peak_tier, last_tested_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (guild_id, user_id, gamemode) DO UPDATE SET
         tier = excluded.tier, peak_tier = excluded.peak_tier, last_tested_at = excluded.last_tested_at`,
      guildId, ticket.user_id, ticket.gamemode, tier, bestTier(prev?.peak_tier, tier), now,
    );
    run(
      `INSERT INTO tests (guild_id, user_id, tester_id, gamemode, region, ign, prev_tier, new_tier, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      guildId, ticket.user_id, user.id, ticket.gamemode, ticket.region, player.ign, prev?.tier ?? null, tier, notes, now,
    );
  })();

  const member = await guild.members.fetch(ticket.user_id).catch(() => null);
  if (member) await applyTierRole(member, ticket.gamemode, tier);

  const embed = new EmbedBuilder()
    .setColor(COLORS.gold)
    .setTitle(`${player.ign}'s Test Results 🏆`)
    .setThumbnail(avatarUrl(player))
    .addFields(
      { name: 'Tester', value: `<@${user.id}>` },
      { name: 'Region', value: ticket.region },
      { name: 'Username', value: displayName(player) },
      { name: 'Previous Rank', value: prev?.tier ?? 'Unranked' },
      { name: 'Rank Earned', value: tier },
    )
    .setFooter({ text: ticket.gamemode })
    .setTimestamp();

  const results = cfg.results_channel_id && (await guild.channels.fetch(cfg.results_channel_id).catch(() => null));
  await results
    ?.send({ content: `<@${ticket.user_id}>`, embeds: [embed], allowedMentions: { users: [ticket.user_id] } })
    .catch(() => {});

  await interaction.editReply({ content: 'Result saved. This ticket closes in 10 seconds.', embeds: [embed] });
  await closeTicket(interaction.channel, ticket, user.id, `Result: ${tier}${notes ? ` — ${notes}` : ''}`);
}

const close = new SlashCommandBuilder()
  .setName('close')
  .setDescription('Close this ticket without a result')
  .setContexts(InteractionContextType.Guild)
  .addStringOption((o) => o.setName('reason').setDescription('Why the test did not happen').setMaxLength(300));

async function executeClose(interaction) {
  const ticket = requireTicket(interaction);
  const reason = interaction.options.getString('reason');
  await interaction.reply('Closing this ticket in 10 seconds. No result was recorded and no cooldown applies.');
  await closeTicket(interaction.channel, ticket, interaction.user.id, reason);
}

const ticket = new SlashCommandBuilder()
  .setName('ticket')
  .setDescription('Manage the current test ticket')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) =>
    s
      .setName('add')
      .setDescription('Let someone view and talk in this ticket')
      .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('spectate')
      .setDescription('Let someone view this ticket without talking')
      .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('remove')
      .setDescription('Remove someone from this ticket')
      .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('rename')
      .setDescription('Rename this ticket (Discord allows 2 renames per 10 minutes)')
      .addStringOption((o) => o.setName('name').setDescription('New channel name').setRequired(true).setMaxLength(90)),
  );

async function executeTicket(interaction) {
  const t = requireTicket(interaction);
  const { channel, options } = interaction;
  const sub = options.getSubcommand();

  if (sub === 'rename') {
    await interaction.deferReply(EPHEMERAL);
    await channel.setName(options.getString('name', true));
    return interaction.editReply(`Renamed to ${channel}.`);
  }

  const target = options.getUser('user', true);
  if (sub === 'remove') {
    if (target.id === t.user_id || target.id === t.tester_id) throw new UserError('You cannot remove the player or tester.');
    await channel.permissionOverwrites.delete(target.id);
    return interaction.reply(`Removed ${target}.`);
  }

  const talk = sub === 'add';
  await channel.permissionOverwrites.edit(target.id, {
    ViewChannel: true,
    ReadMessageHistory: true,
    SendMessages: talk,
    AddReactions: talk,
  });
  return interaction.reply(talk ? `Added ${target}.` : `${target} is now spectating.`);
}

export default [
  { data: result, execute: executeResult },
  { data: close, execute: executeClose },
  { data: ticket, execute: executeTicket },
];
