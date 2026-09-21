import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { all, one, run } from '../../db.js';
import { COLORS, EPHEMERAL, UserError, ts } from '../../util.js';
import { DAY, tierIndex } from './constants.js';
import { refreshQueue } from './queue.js';
import { createTicket } from './tickets.js';
import {
  assertCanTest,
  avatarUrl,
  displayName,
  getConfig,
  getRank,
  highEnabled,
  isHighTester,
  requireVerified,
  sendLog,
} from './util.js';

// High tests: players at the cap (HT3 by default) ask for a test for the tiers above it.
// Requests appear in the high-test channel, where a high tester accepts (opening a high-test
// ticket) or denies them.

const DENY_COOLDOWN = DAY;

/**
 * Reaching the cap in a regular test earns a high test right away, so the regular cooldown
 * doesn't block the request. After a high test, the normal cooldown applies.
 */
function cooldownWaived(guildId, userId, gamemode) {
  const last = one('SELECT high FROM tests WHERE guild_id = ? AND user_id = ? AND gamemode = ? ORDER BY created_at DESC LIMIT 1', guildId, userId, gamemode);
  return Boolean(last && !last.high);
}

const pendingFor = (guildId, userId, gamemode) =>
  one("SELECT * FROM high_requests WHERE guild_id = ? AND user_id = ? AND gamemode = ? AND status = 'pending'", guildId, userId, gamemode);

function requireHighSetup(cfg) {
  if (!highEnabled(cfg)) throw new UserError('This server has not set up high testing. An admin can run `/setup config high_test_channel:`.');
}

function requireHighTester(interaction, cfg) {
  if (!isHighTester(interaction.member, cfg)) throw new UserError('Only high testers can do that.');
}

async function highChannel(guild, cfg) {
  const channel = await guild.channels.fetch(cfg.high_channel_id).catch(() => null);
  if (!channel?.isTextBased()) throw new UserError('The high test channel is missing. Ask an admin to set it again with `/setup config`.');
  return channel;
}

function requestView(request, player, rank, state) {
  const embed = new EmbedBuilder()
    .setColor(state ? (state.accepted ? COLORS.success : COLORS.grey) : COLORS.gold)
    .setTitle(`High test request · ${request.gamemode}`)
    .setThumbnail(avatarUrl(player))
    .addFields(
      { name: 'Player', value: `<@${request.user_id}>`, inline: true },
      { name: 'Username', value: displayName(player), inline: true },
      { name: 'Region', value: player.region, inline: true },
      { name: 'Current tier', value: rank?.tier ?? 'Unranked', inline: true },
      { name: 'Peak tier', value: rank?.peak_tier ?? '—', inline: true },
      { name: 'Requested', value: ts(request.created_at), inline: true },
    );
  if (state) embed.setFooter({ text: state.text.slice(0, 2048) });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`high:accept:${request.id}`).setLabel('Accept').setStyle(ButtonStyle.Success).setDisabled(Boolean(state)),
    new ButtonBuilder().setCustomId(`high:deny:${request.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger).setDisabled(Boolean(state)),
  );
  return { embeds: [embed], components: [row] };
}

/** Player asks for a high test. Returns the reply payload (the caller has deferred). */
export async function requestHighTest(interaction, gamemode) {
  const { guild, guildId, user } = interaction;
  const cfg = getConfig(guildId);
  requireHighSetup(cfg);
  const player = requireVerified(guildId, user.id);
  assertCanTest(guildId, user.id, gamemode, cfg, { ignoreCooldown: cooldownWaived(guildId, user.id, gamemode) });

  const rank = getRank(guildId, user.id, gamemode);
  if (!rank || tierIndex(rank.tier) > tierIndex(cfg.high_cap)) {
    throw new UserError(`High tests are for players at **${cfg.high_cap}** or above in ${gamemode}. You're **${rank?.tier ?? 'Unranked'}**.`);
  }
  if (pendingFor(guildId, user.id, gamemode)) throw new UserError(`You already have a ${gamemode} high test request waiting.`);
  const denied = one(
    "SELECT handled_at FROM high_requests WHERE guild_id = ? AND user_id = ? AND gamemode = ? AND status = 'denied' ORDER BY handled_at DESC LIMIT 1",
    guildId, user.id, gamemode,
  );
  if (denied && denied.handled_at + DENY_COOLDOWN > Date.now()) {
    throw new UserError(`Your last ${gamemode} high test request was denied. You can ask again ${ts(denied.handled_at + DENY_COOLDOWN)}.`);
  }

  const channel = await highChannel(guild, cfg);
  const { lastInsertRowid: id } = run(
    'INSERT INTO high_requests (guild_id, user_id, gamemode, created_at) VALUES (?, ?, ?, ?)',
    guildId, user.id, gamemode, Date.now(),
  );
  const request = one('SELECT * FROM high_requests WHERE id = ?', id);
  try {
    const message = await channel.send({
      content: cfg.high_tester_role_id ? `<@&${cfg.high_tester_role_id}>` : undefined,
      ...requestView(request, player, rank),
      allowedMentions: { roles: cfg.high_tester_role_id ? [cfg.high_tester_role_id] : [] },
    });
    run('UPDATE high_requests SET message_id = ? WHERE id = ?', message.id, id);
  } catch {
    run('DELETE FROM high_requests WHERE id = ?', id);
    throw new UserError('I could not post in the high test channel. Ask an admin to check my permissions there.');
  }
  return { content: `✅ Your **${gamemode}** high test request was sent. A high tester will open a ticket with you if they accept it.` };
}

export function cancelHighTest(interaction, gamemode) {
  const request = pendingFor(interaction.guildId, interaction.user.id, gamemode);
  if (!request) throw new UserError(`You have no ${gamemode} high test request waiting.`);
  run("UPDATE high_requests SET status = 'cancelled', handled_at = ? WHERE id = ?", Date.now(), request.id);
  void editRequestMessage(interaction.guild, request, { accepted: false, text: 'Cancelled by the player' });
  return { content: `Cancelled your ${gamemode} high test request.` };
}

export function listPending(interaction) {
  const cfg = getConfig(interaction.guildId);
  requireHighSetup(cfg);
  requireHighTester(interaction, cfg);
  const rows = all("SELECT * FROM high_requests WHERE guild_id = ? AND status = 'pending' ORDER BY created_at LIMIT 25", interaction.guildId);
  const link = (r) => (r.message_id ? `https://discord.com/channels/${r.guild_id}/${cfg.high_channel_id}/${r.message_id}` : null);
  const lines = rows.map((r, i) => `**${i + 1}.** <@${r.user_id}> · ${r.gamemode} · ${ts(r.created_at)}${link(r) ? ` · [open](${link(r)})` : ''}`);
  return {
    embeds: [new EmbedBuilder().setColor(COLORS.gold).setTitle('Pending high test requests').setDescription(lines.join('\n') || 'None right now.')],
    allowedMentions: { parse: [] },
  };
}

async function editRequestMessage(guild, request, state) {
  const cfg = getConfig(guild.id);
  const player = one('SELECT * FROM players WHERE guild_id = ? AND user_id = ?', guild.id, request.user_id);
  if (!request.message_id || !player || !cfg.high_channel_id) return;
  const channel = await guild.channels.fetch(cfg.high_channel_id).catch(() => null);
  const message = await channel?.messages.fetch(request.message_id).catch(() => null);
  await message?.edit({ content: null, ...requestView(request, player, getRank(guild.id, request.user_id, request.gamemode), state) }).catch(() => {});
}

/** Accept / Deny buttons on a request, and the deny reason form. */
export async function handleHighComponent(interaction, action, rawId) {
  const cfg = getConfig(interaction.guildId);
  requireHighTester(interaction, cfg);
  const request = one('SELECT * FROM high_requests WHERE id = ? AND guild_id = ?', Number(rawId), interaction.guildId);
  if (!request) throw new UserError('That request no longer exists.');
  if (request.status !== 'pending') throw new UserError(`That request was already ${request.status}.`);

  if (action === 'deny') {
    return interaction.showModal(
      new ModalBuilder()
        .setCustomId(`high:denied:${request.id}`)
        .setTitle('Deny high test request')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('reason').setLabel('Reason (sent to the player)').setStyle(TextInputStyle.Paragraph).setMaxLength(300).setRequired(false),
          ),
        ),
    );
  }

  if (action === 'denied') {
    const reason = interaction.fields.getTextInputValue('reason').trim() || null;
    const res = run(
      "UPDATE high_requests SET status = 'denied', handled_by = ?, reason = ?, handled_at = ? WHERE id = ? AND status = 'pending'",
      interaction.user.id, reason, Date.now(), request.id,
    );
    if (!res.changes) throw new UserError('Someone else handled that request first.');
    await interaction.deferReply(EPHEMERAL);
    await editRequestMessage(interaction.guild, request, {
      accepted: false,
      text: `Denied by ${interaction.user.username}${reason ? `: ${reason}` : ''}`,
    });
    const player = await interaction.client.users.fetch(request.user_id).catch(() => null);
    await player
      ?.send(`Your **${request.gamemode}** high test request in **${interaction.guild.name}** was denied.${reason ? `\nReason: ${reason}` : ''}`)
      .catch(() => {});
    return interaction.editReply('Request denied. The player can ask again in 24 hours.');
  }

  if (action === 'accept') {
    if (request.user_id === interaction.user.id) throw new UserError("You can't accept your own request.");
    await interaction.deferReply(EPHEMERAL);
    const member = await interaction.guild.members.fetch(request.user_id).catch(() => null);
    if (!member) {
      run("UPDATE high_requests SET status = 'cancelled', handled_at = ? WHERE id = ?", Date.now(), request.id);
      throw new UserError('That player left the server; the request was cancelled.');
    }
    const player = requireVerified(interaction.guildId, request.user_id);
    assertCanTest(interaction.guildId, request.user_id, request.gamemode, cfg, {
      ignoreCooldown: cooldownWaived(interaction.guildId, request.user_id, request.gamemode),
    });

    // Claim first so two high testers can't both accept it.
    const claimed = run(
      "UPDATE high_requests SET status = 'accepted', handled_by = ?, handled_at = ? WHERE id = ? AND status = 'pending'",
      interaction.user.id, Date.now(), request.id,
    );
    if (!claimed.changes) throw new UserError('Someone else handled that request first.');

    let channel;
    try {
      channel = await createTicket(interaction.guild, cfg, {
        member,
        testerId: interaction.user.id,
        gamemode: request.gamemode,
        region: player.region,
        high: true,
      });
    } catch (err) {
      run("UPDATE high_requests SET status = 'pending', handled_by = NULL, handled_at = NULL WHERE id = ?", request.id);
      throw err;
    }
    await editRequestMessage(interaction.guild, request, { accepted: true, text: `Accepted by ${interaction.user.username}` });
    // They're being tested now, so they leave this gamemode's regular queue.
    const queued = one('SELECT region FROM queue_entries WHERE guild_id = ? AND gamemode = ? AND user_id = ?', interaction.guildId, request.gamemode, request.user_id);
    run('DELETE FROM queue_entries WHERE guild_id = ? AND gamemode = ? AND user_id = ?', interaction.guildId, request.gamemode, request.user_id);
    if (queued) void refreshQueue(interaction.client, interaction.guildId, request.gamemode, queued.region);
    await sendLog(
      interaction.guild,
      cfg,
      new EmbedBuilder().setColor(COLORS.gold).setTitle('High test accepted').setDescription(`<@${request.user_id}> · ${request.gamemode} · by <@${interaction.user.id}> · ${channel}`),
    );
    return interaction.editReply(`Opened ${channel}.`);
  }

  throw new UserError('This button is no longer supported.');
}
