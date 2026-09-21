import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { REGIONS, USERNAME_RE } from './constants.js';
import { one, run } from '../../db.js';
import { getQueue, queueEntries, refreshQueue } from './queue.js';
import {
  assertCanTest,
  cooldownEnds,
  displayName,
  getConfig,
  getPlayer,
  lookupMinecraft,
  offlineUuid,
  openTicketFor,
  requireVerified,
} from './util.js';
import { COLORS, EPHEMERAL, UserError, ts } from '../../util.js';
import { highEnabled } from './util.js';

// Waitlist/status handlers run after the router has deferred, so they return the reply payload.

const ACCOUNT_TEXT = {
  premium: 'Java Minecraft username',
  cracked: 'cracked (offline-mode) username',
  both: 'premium or cracked Minecraft username',
};

/** The "request a test" message players interact with. One per gamemode. */
export function panelView(gamemode, cfg) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle(`📝 Request a ${gamemode} Tier Test`)
    .setDescription(
      [
        `**1. Verify Account** — link your ${ACCOUNT_TEXT[cfg.account_mode]} and pick your region.`,
        '**2. Enter Waitlist** — you get the waitlist role for your region.',
        '**3. Join Queue** — when a tester opens your region\'s queue you are pinged; press **Join Queue** there.',
        '',
        'When you reach the front, a tester opens a private ticket with you.',
        `You can be tested once every **${cfg.cooldown_days} days** per gamemode.`,
        ...(highEnabled(cfg)
          ? ['', `**At ${cfg.high_cap} or above?** Press **Request High Test** to be tested for the tiers above ${cfg.high_cap}.`]
          : []),
      ].join('\n'),
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel:verify').setLabel('Verify Account').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`panel:waitlist:${gamemode}`).setLabel('Enter Waitlist').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`panel:leave:${gamemode}`).setLabel('Leave Waitlist').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`panel:status:${gamemode}`).setLabel('My Status').setStyle(ButtonStyle.Secondary),
  );
  if (highEnabled(cfg)) {
    row.addComponents(
      new ButtonBuilder().setCustomId(`panel:high:${gamemode}`).setLabel('Request High Test').setEmoji('⭐').setStyle(ButtonStyle.Secondary),
    );
  }
  return { embeds: [embed], components: [row] };
}

function assertNotBusy(guildId, userId) {
  const busy =
    one('SELECT 1 FROM waitlist WHERE guild_id = ? AND user_id = ?', guildId, userId) ||
    one('SELECT 1 FROM queue_entries WHERE guild_id = ? AND user_id = ?', guildId, userId) ||
    openTicketFor(guildId, userId);
  if (busy) throw new UserError('Leave every waitlist and queue (and finish any open test) before changing your account or region.');
}

function assertTypeAllowed(cfg, type) {
  if (type !== 'premium' && type !== 'cracked') throw new UserError('Unknown account type.');
  if (cfg.account_mode === 'premium' && type === 'cracked') throw new UserError('This server only accepts premium accounts.');
  if (cfg.account_mode === 'cracked' && type === 'premium') throw new UserError('This server only accepts cracked accounts.');
}

/** Verify button: asks premium-or-cracked when the server allows both, otherwise opens the modal directly. */
export async function startVerify(interaction) {
  assertNotBusy(interaction.guildId, interaction.user.id);
  const mode = getConfig(interaction.guildId).account_mode;
  if (mode !== 'both') return showVerifyModal(interaction, mode);

  await interaction.reply({
    ...EPHEMERAL,
    content: 'Which kind of account will you test on?',
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('verify:type:premium').setLabel('Premium (bought Java)').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('verify:type:cracked').setLabel('Cracked (offline mode)').setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
}

export async function showVerifyModal(interaction, type) {
  assertNotBusy(interaction.guildId, interaction.user.id);
  assertTypeAllowed(getConfig(interaction.guildId), type);
  const existing = getPlayer(interaction.guildId, interaction.user.id);

  const ign = new TextInputBuilder()
    .setCustomId('ign')
    .setLabel(type === 'cracked' ? 'Cracked username (as used in-game)' : 'Minecraft username (Java Edition)')
    .setStyle(TextInputStyle.Short)
    .setMinLength(3)
    .setMaxLength(16)
    .setRequired(true);
  const server = new TextInputBuilder()
    .setCustomId('server')
    .setLabel(type === 'cracked' ? 'Offline-mode server to test on (optional)' : 'Preferred server to test on (optional)')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(60)
    .setRequired(false);
  if (existing?.ign && Boolean(existing.cracked) === (type === 'cracked')) ign.setValue(existing.ign);
  if (existing?.server) server.setValue(existing.server);

  await interaction.showModal(
    new ModalBuilder()
      .setCustomId(`verify:modal:${type}`)
      .setTitle(type === 'cracked' ? 'Verify your cracked account' : 'Verify your Minecraft account')
      .addComponents(new ActionRowBuilder().addComponents(ign), new ActionRowBuilder().addComponents(server)),
  );
}

export async function submitVerifyModal(interaction, type) {
  const { guildId, user } = interaction;
  await interaction.deferReply(EPHEMERAL);
  assertNotBusy(guildId, user.id);
  const cfg = getConfig(guildId);
  assertTypeAllowed(cfg, type);

  const input = interaction.fields.getTextInputValue('ign').trim();
  const server = interaction.fields.getTextInputValue('server').trim() || null;
  let profile;

  if (type === 'cracked') {
    if (!USERNAME_RE.test(input)) throw new UserError('Usernames are 3–16 characters: letters, numbers and underscores.');
    // When premium is also accepted, don't let a cracked account take a premium player's name.
    if (cfg.account_mode === 'both') {
      const premium = await lookupMinecraft(input);
      if (premium) {
        throw new UserError(`**${premium.ign}** is a premium account name. If it is yours, verify as **Premium** instead.`);
      }
    }
    profile = { ign: input, uuid: offlineUuid(input), cracked: 1 };
  } else {
    const found = await lookupMinecraft(input);
    if (!found) throw new UserError(`No premium Java Edition account named \`${input}\` exists.`);
    profile = { ...found, cracked: 0 };
  }

  // Offline names are case-sensitive UUID-wise but servers treat them case-insensitively, so compare names too.
  const owner = one(
    'SELECT user_id FROM players WHERE guild_id = ? AND (uuid = ? OR lower(ign) = lower(?)) AND user_id != ?',
    guildId, profile.uuid, profile.ign, user.id,
  );
  if (owner) throw new UserError(`**${profile.ign}** is already linked to another member. Contact staff if it is yours.`);

  run(
    `INSERT INTO players (guild_id, user_id, ign, uuid, server, verified_at, cracked) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (guild_id, user_id) DO UPDATE SET ign = excluded.ign, uuid = excluded.uuid, server = excluded.server,
       verified_at = excluded.verified_at, cracked = excluded.cracked`,
    guildId, user.id, profile.ign, profile.uuid, server, Date.now(), profile.cracked,
  );

  const current = getPlayer(guildId, user.id).region;
  const select = new StringSelectMenuBuilder()
    .setCustomId('verify:region')
    .setPlaceholder('Choose your region')
    .addOptions(Object.entries(REGIONS).map(([value, name]) => ({ label: `${value} · ${name}`, value, default: value === current })));

  await interaction.editReply({
    content: `Linked **${displayName(profile)}**. Now pick the region you want to be tested in:`,
    components: [new ActionRowBuilder().addComponents(select)],
  });
}

export async function selectRegion(interaction) {
  const { guildId, user } = interaction;
  assertNotBusy(guildId, user.id);
  const player = getPlayer(guildId, user.id);
  if (!player) throw new UserError('Press **Verify Account** first.');

  const region = interaction.values[0];
  run('UPDATE players SET region = ? WHERE guild_id = ? AND user_id = ?', region, guildId, user.id);
  await interaction.update({
    content: `✅ Verified as **${displayName(player)}** · region **${region}**. You can now enter a waitlist.`,
    components: [],
  });
}

export async function enterWaitlist(interaction, gamemode) {
  const { guildId, user } = interaction;
  const cfg = getConfig(guildId);
  const player = requireVerified(guildId, user.id);
  assertCanTest(guildId, user.id, gamemode, cfg);

  const existing = one('SELECT region FROM waitlist WHERE guild_id = ? AND gamemode = ? AND user_id = ?', guildId, gamemode, user.id);
  if (existing) throw new UserError(`You are already on the **${gamemode}** waitlist (${existing.region}).`);

  const q = getQueue(guildId, gamemode, player.region);
  if (!q) throw new UserError(`This server has no **${gamemode}** queue for **${player.region}** yet.`);

  run('INSERT INTO waitlist VALUES (?, ?, ?, ?, ?)', guildId, gamemode, user.id, player.region, Date.now());
  if (q.waitlist_role_id) await interaction.member.roles.add(q.waitlist_role_id).catch(() => {});

  return {
    content:
      `✅ You joined the **${gamemode}** waitlist for **${player.region}**.\n` +
      (q.open
        ? `The queue is open right now — press **Join Queue** in <#${q.channel_id}>.`
        : `You will be pinged in <#${q.channel_id}> when a tester opens the queue.`),
  };
}

export async function leaveWaitlist(interaction, gamemode) {
  const { guildId, user } = interaction;
  const w = one('SELECT region FROM waitlist WHERE guild_id = ? AND gamemode = ? AND user_id = ?', guildId, gamemode, user.id);
  if (!w) throw new UserError(`You are not on the **${gamemode}** waitlist.`);

  run('DELETE FROM waitlist WHERE guild_id = ? AND gamemode = ? AND user_id = ?', guildId, gamemode, user.id);
  const queued = run('DELETE FROM queue_entries WHERE guild_id = ? AND gamemode = ? AND user_id = ?', guildId, gamemode, user.id);
  if (queued.changes) await refreshQueue(interaction.client, guildId, gamemode, w.region);

  const q = getQueue(guildId, gamemode, w.region);
  if (q?.waitlist_role_id) await interaction.member.roles.remove(q.waitlist_role_id).catch(() => {});
  return { content: `You left the **${gamemode}** waitlist.` };
}

export async function showStatus(interaction, gamemode) {
  const { guildId, user } = interaction;
  const cfg = getConfig(guildId);
  const player = getPlayer(guildId, user.id);
  const w = one('SELECT region FROM waitlist WHERE guild_id = ? AND gamemode = ? AND user_id = ?', guildId, gamemode, user.id);
  const cd = cooldownEnds(guildId, user.id, gamemode, cfg);
  const ticket = openTicketFor(guildId, user.id);

  let queueLine = 'Not in a queue';
  const entry = one('SELECT region FROM queue_entries WHERE guild_id = ? AND gamemode = ? AND user_id = ?', guildId, gamemode, user.id);
  if (entry) {
    const pos = queueEntries(guildId, gamemode, entry.region).findIndex((e) => e.user_id === user.id) + 1;
    queueLine = `#${pos} in the ${entry.region} queue`;
  }

  const lines = [
    `**Account:** ${player ? `${displayName(player)} · ${player.region ?? 'no region'}` : 'Not verified'}`,
    `**Waitlist:** ${w ? `On the ${w.region} waitlist` : 'Not on the waitlist'}`,
    `**Queue:** ${queueLine}`,
    `**Cooldown:** ${cd ? `Can test again ${ts(cd)}` : 'Ready to test'}`,
  ];
  if (ticket) lines.push(`**Open ticket:** <#${ticket.channel_id}>`);
  return {
    embeds: [new EmbedBuilder().setColor(COLORS.primary).setTitle(`${gamemode} status`).setDescription(lines.join('\n'))],
  };
}

