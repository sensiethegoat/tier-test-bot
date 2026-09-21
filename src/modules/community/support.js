import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  InteractionContextType,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { all, one, run } from '../../db.js';
import { COLORS, EPHEMERAL, UserError, isAdmin } from '../../util.js';

const DELETE_DELAY = 5_000;
// Reading message text needs the privileged Message Content intent (see ENABLE_TRANSCRIPTS in .env.example).
const TRANSCRIPTS = process.env.ENABLE_TRANSCRIPTS === 'true';

const MEMBER_PERMS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.EmbedLinks,
];

function getConfig(guildId) {
  run('INSERT OR IGNORE INTO support_config (guild_id) VALUES (?)', guildId);
  return one('SELECT * FROM support_config WHERE guild_id = ?', guildId);
}

const isStaff = (member, cfg) => isAdmin(member) || Boolean(cfg.staff_role_id && member.roles.cache.has(cfg.staff_role_id));
const pad = (n) => String(n).padStart(4, '0');

function requireOpenTicket(interaction) {
  const ticket = one('SELECT * FROM support_tickets WHERE channel_id = ?', interaction.channelId);
  if (!ticket || ticket.closed_at) throw new UserError('This is not an open support ticket.');
  return ticket;
}

function requireStaff(interaction) {
  const cfg = getConfig(interaction.guildId);
  if (!isStaff(interaction.member, cfg)) throw new UserError('Only support staff can do that.');
  return cfg;
}

async function sendLog(guild, cfg, payload) {
  if (!cfg.log_channel_id) return;
  const channel = await guild.channels.fetch(cfg.log_channel_id).catch(() => null);
  await channel?.send({ ...payload, allowedMentions: { parse: [] } }).catch(() => {});
}

// ─── /support ────────────────────────────────────────────────────────────────

const data = new SlashCommandBuilder()
  .setName('support')
  .setDescription('Support tickets')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) =>
    s
      .setName('setup')
      .setDescription('Configure support tickets (admins; only the options you pass change)')
      .addRoleOption((o) => o.setName('staff_role').setDescription('Role that handles tickets'))
      .addChannelOption((o) => o.setName('category').setDescription('Category for ticket channels').addChannelTypes(ChannelType.GuildCategory))
      .addChannelOption((o) =>
        o.setName('log_channel').setDescription('Where closed tickets are logged').addChannelTypes(ChannelType.GuildText),
      )
      .addIntegerOption((o) => o.setName('max_open').setDescription('Open tickets allowed per member (default 1)').setMinValue(1).setMaxValue(5)),
  )
  .addSubcommand((s) =>
    s
      .setName('panel')
      .setDescription('Post the "Open a ticket" panel in this channel (admins)')
      .addStringOption((o) => o.setName('title').setDescription('Panel title').setMaxLength(256))
      .addStringOption((o) => o.setName('description').setDescription('Panel text').setMaxLength(2000)),
  )
  .addSubcommand((s) =>
    s
      .setName('close')
      .setDescription('Close this ticket')
      .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(300)),
  )
  .addSubcommand((s) => s.setName('claim').setDescription('Take ownership of this ticket (staff)'))
  .addSubcommand((s) =>
    s
      .setName('add')
      .setDescription('Add someone to this ticket (staff)')
      .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('remove')
      .setDescription('Remove someone from this ticket (staff)')
      .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)),
  );

async function execute(interaction) {
  const { guildId, options } = interaction;
  const sub = options.getSubcommand();

  if (sub === 'setup') {
    if (!isAdmin(interaction.member)) throw new UserError('You need **Manage Server** for this.');
    getConfig(guildId);
    const updates = {
      staff_role_id: options.getRole('staff_role')?.id,
      category_id: options.getChannel('category')?.id,
      log_channel_id: options.getChannel('log_channel')?.id,
      max_open: options.getInteger('max_open'),
    };
    for (const [col, value] of Object.entries(updates)) {
      if (value !== undefined && value !== null) run(`UPDATE support_config SET ${col} = ? WHERE guild_id = ?`, value, guildId);
    }
    const cfg = getConfig(guildId);
    const fmt = (id, kind) => (id ? `<${kind}${id}>` : '*not set*');
    return interaction.reply({
      ...EPHEMERAL,
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.primary)
          .setTitle('Support tickets')
          .addFields(
            { name: 'Staff role', value: fmt(cfg.staff_role_id, '@&'), inline: true },
            { name: 'Category', value: fmt(cfg.category_id, '#'), inline: true },
            { name: 'Log channel', value: fmt(cfg.log_channel_id, '#'), inline: true },
            { name: 'Open tickets per member', value: String(cfg.max_open), inline: true },
            { name: 'Transcripts', value: TRANSCRIPTS ? 'On' : 'Off (bot host sets ENABLE_TRANSCRIPTS)', inline: true },
          ),
      ],
    });
  }

  if (sub === 'panel') {
    if (!isAdmin(interaction.member)) throw new UserError('You need **Manage Server** for this.');
    const embed = new EmbedBuilder()
      .setColor(COLORS.primary)
      .setTitle(options.getString('title') ?? '🎫 Need help?')
      .setDescription(options.getString('description') ?? 'Press the button below to open a private ticket with our staff.');
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('support:open').setLabel('Open a ticket').setEmoji('🎫').setStyle(ButtonStyle.Primary),
    );
    await interaction.channel.send({ embeds: [embed], components: [row] });
    return interaction.reply({ ...EPHEMERAL, content: 'Posted the ticket panel.' });
  }

  if (sub === 'close') return closeTicket(interaction, options.getString('reason'));
  if (sub === 'claim') return claimTicket(interaction);

  const ticket = requireOpenTicket(interaction);
  requireStaff(interaction);
  const target = options.getUser('user', true);
  if (sub === 'add') {
    await interaction.channel.permissionOverwrites.edit(target.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
    return interaction.reply(`Added ${target}.`);
  }
  if (target.id === ticket.user_id) throw new UserError('You cannot remove the person who opened the ticket.');
  await interaction.channel.permissionOverwrites.delete(target.id);
  return interaction.reply(`Removed ${target}.`);
}

// ─── Buttons and form ────────────────────────────────────────────────────────

export async function handleComponent(interaction) {
  const [, action] = interaction.customId.split(':');
  if (action === 'open') return showOpenForm(interaction);
  if (action === 'modal') return openTicket(interaction);
  if (action === 'close') return closeTicket(interaction, null);
  if (action === 'claim') return claimTicket(interaction);
  throw new UserError('This button is no longer supported.');
}

function assertCanOpen(guildId, userId, cfg) {
  const open = all('SELECT channel_id FROM support_tickets WHERE guild_id = ? AND user_id = ? AND closed_at IS NULL', guildId, userId);
  if (open.length >= cfg.max_open) {
    throw new UserError(`You already have an open ticket: ${open.map((t) => `<#${t.channel_id}>`).join(', ')}`);
  }
}

async function showOpenForm(interaction) {
  assertCanOpen(interaction.guildId, interaction.user.id, getConfig(interaction.guildId));
  await interaction.showModal(
    new ModalBuilder()
      .setCustomId('support:modal')
      .setTitle('Open a ticket')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('subject')
            .setLabel('What do you need help with?')
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(1000)
            .setRequired(true),
        ),
      ),
  );
}

async function openTicket(interaction) {
  const { guild, guildId, user } = interaction;
  await interaction.deferReply(EPHEMERAL);
  const cfg = getConfig(guildId);
  assertCanOpen(guildId, user.id, cfg);
  const subject = interaction.fields.getTextInputValue('subject').trim();

  const { n } = one('UPDATE support_config SET next_number = next_number + 1 WHERE guild_id = ? RETURNING next_number - 1 AS n', guildId);
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: guild.client.user.id, allow: MEMBER_PERMS },
    { id: user.id, allow: MEMBER_PERMS },
  ];
  if (cfg.staff_role_id) overwrites.push({ id: cfg.staff_role_id, allow: MEMBER_PERMS });
  const parent = cfg.category_id && guild.channels.cache.has(cfg.category_id) ? cfg.category_id : null;

  let channel;
  try {
    channel = await guild.channels.create({ name: `ticket-${pad(n)}`, type: ChannelType.GuildText, parent, permissionOverwrites: overwrites });
  } catch (err) {
    console.error(`Support ticket creation failed in ${guildId}:`, err.message);
    throw new UserError('I could not create the ticket channel. Ask an admin to give me **Manage Channels** and **Manage Roles**.');
  }
  run(
    'INSERT INTO support_tickets (channel_id, guild_id, number, user_id, subject, opened_at) VALUES (?, ?, ?, ?, ?, ?)',
    channel.id, guildId, n, user.id, subject, Date.now(),
  );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('support:claim').setLabel('Claim').setEmoji('🙋').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('support:close').setLabel('Close').setEmoji('🔒').setStyle(ButtonStyle.Danger),
  );
  await channel.send({
    content: [`${user}`, cfg.staff_role_id && `<@&${cfg.staff_role_id}>`].filter(Boolean).join(' '),
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle(`Ticket #${pad(n)}`)
        .setDescription(subject)
        .addFields({ name: 'Opened by', value: `${user}` })
        .setFooter({ text: 'Staff will be with you soon. Press Close when you are done.' })
        .setTimestamp(),
    ],
    components: [row],
    allowedMentions: { users: [user.id], roles: cfg.staff_role_id ? [cfg.staff_role_id] : [] },
  });
  await interaction.editReply(`Your ticket is open: ${channel}`);
}

async function claimTicket(interaction) {
  const ticket = requireOpenTicket(interaction);
  requireStaff(interaction);
  if (ticket.claimed_by) throw new UserError(`<@${ticket.claimed_by}> already claimed this ticket.`);
  run('UPDATE support_tickets SET claimed_by = ? WHERE channel_id = ?', interaction.user.id, ticket.channel_id);
  await interaction.reply({ content: `🙋 ${interaction.user} will handle this ticket.`, allowedMentions: { parse: [] } });
}

async function closeTicket(interaction, reason) {
  const ticket = requireOpenTicket(interaction);
  const cfg = getConfig(interaction.guildId);
  if (ticket.user_id !== interaction.user.id && !isStaff(interaction.member, cfg)) {
    throw new UserError('Only the ticket owner or staff can close this ticket.');
  }
  run('UPDATE support_tickets SET closed_at = ? WHERE channel_id = ?', Date.now(), ticket.channel_id);
  await interaction.reply(`🔒 Closing this ticket in ${DELETE_DELAY / 1000} seconds.`);

  const { channel } = interaction;
  const files = [];
  if (TRANSCRIPTS) {
    const text = await buildTranscript(channel).catch(() => null);
    if (text) files.push(new AttachmentBuilder(Buffer.from(text, 'utf8'), { name: `ticket-${pad(ticket.number)}.txt` }));
  }
  await sendLog(interaction.guild, cfg, {
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.danger)
        .setTitle(`Ticket #${pad(ticket.number)} closed`)
        .addFields(
          { name: 'Opened by', value: `<@${ticket.user_id}>`, inline: true },
          { name: 'Closed by', value: `${interaction.user}`, inline: true },
          { name: 'Claimed by', value: ticket.claimed_by ? `<@${ticket.claimed_by}>` : '—', inline: true },
          { name: 'Subject', value: ticket.subject.slice(0, 1024) },
          { name: 'Reason', value: reason || 'No reason given' },
        )
        .setTimestamp(),
    ],
    files,
  });

  setTimeout(() => deleteChannel(channel), DELETE_DELAY);
}

async function buildTranscript(channel) {
  const messages = [];
  let before;
  for (let page = 0; page < 10; page++) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    messages.push(...batch.values());
    if (batch.size < 100) break;
    before = batch.last().id;
  }
  return messages
    .reverse()
    .map((m) => {
      const extras = [...m.attachments.values()].map((a) => a.url);
      if (m.embeds.length) extras.push(`[${m.embeds.length} embed(s)]`);
      return `[${new Date(m.createdTimestamp).toISOString()}] ${m.author.tag}: ${m.content} ${extras.join(' ')}`.trimEnd();
    })
    .join('\n');
}

async function deleteChannel(channel) {
  await channel.delete().catch(() => {});
  run('UPDATE support_tickets SET deleted = 1 WHERE channel_id = ?', channel.id);
}

/** Deletes channels of tickets that were closed right before a restart. */
export async function sweepClosed(client) {
  for (const t of all('SELECT channel_id, guild_id FROM support_tickets WHERE closed_at IS NOT NULL AND deleted = 0')) {
    if (!client.guilds.cache.has(t.guild_id)) continue; // another shard's guild
    const channel = await client.channels.fetch(t.channel_id).catch(() => null);
    if (channel) await deleteChannel(channel);
    else run('UPDATE support_tickets SET deleted = 1 WHERE channel_id = ?', t.channel_id);
  }
}

export default [{ data, execute }];
