import { ChannelType, EmbedBuilder, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { ACCOUNT_MODES, GAMEMODE_RE } from '../constants.js';
import { all, db, one, run } from '../../../db.js';
import { panelView } from '../panel.js';
import { ensureTierRoles } from '../provision.js';
import { refreshQueue } from '../queue.js';
import { gamemodeOption, gamemodes, getConfig, regionOption, resolveGamemode } from '../util.js';
import { COLORS, EPHEMERAL, UserError } from '../../../util.js';

const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Configure the testing bot for this server')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) =>
    s
      .setName('config')
      .setDescription('Set roles, channels and limits (only the options you pass are changed)')
      .addRoleOption((o) => o.setName('tester_role').setDescription('Role allowed to run tests'))
      .addChannelOption((o) =>
        o.setName('ticket_category').setDescription('Category for test tickets').addChannelTypes(ChannelType.GuildCategory),
      )
      .addChannelOption((o) =>
        o.setName('results_channel').setDescription('Where test results are posted').addChannelTypes(...TEXT_CHANNELS),
      )
      .addChannelOption((o) => o.setName('log_channel').setDescription('Staff log channel').addChannelTypes(...TEXT_CHANNELS))
      .addIntegerOption((o) =>
        o.setName('cooldown_days').setDescription('Days between tests per gamemode (default 30)').setMinValue(0).setMaxValue(365),
      )
      .addIntegerOption((o) =>
        o.setName('max_queue').setDescription('Max players per queue (default 20)').setMinValue(1).setMaxValue(50),
      )
      .addBooleanOption((o) => o.setName('nickname_sync').setDescription('Rename players to "[best tier] IGN" (default off)'))
      .addStringOption((o) =>
        o
          .setName('accounts')
          .setDescription('Which Minecraft accounts can verify (default: premium only)')
          .addChoices(...Object.entries(ACCOUNT_MODES).map(([value, name]) => ({ name, value }))),
      ),
  )
  .addSubcommandGroup((g) =>
    g
      .setName('gamemode')
      .setDescription('Manage the gamemodes this server tests')
      .addSubcommand((s) =>
        s
          .setName('add')
          .setDescription('Add a gamemode')
          .addStringOption((o) => o.setName('name').setDescription('e.g. Sword, Axe, Crystal, UHC').setRequired(true).setMaxLength(24)),
      )
      .addSubcommand((s) =>
        s.setName('remove').setDescription('Remove a gamemode and its queues (results are kept)').addStringOption((o) => gamemodeOption(o)),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('queue')
      .setDescription('Create or update a region queue for a gamemode')
      .addStringOption((o) => gamemodeOption(o))
      .addStringOption((o) => regionOption(o))
      .addChannelOption((o) =>
        o.setName('channel').setDescription('Channel the live queue is posted in').setRequired(true).addChannelTypes(...TEXT_CHANNELS),
      )
      .addRoleOption((o) => o.setName('waitlist_role').setDescription('Role given on the waitlist and pinged when the queue opens')),
  )
  .addSubcommand((s) =>
    s
      .setName('panel')
      .setDescription('Post the request-test panel for a gamemode in this channel')
      .addStringOption((o) => gamemodeOption(o)),
  )
  .addSubcommand((s) =>
    s
      .setName('tierroles')
      .setDescription('Create HT1–LT5 roles for a gamemode (existing ones are reused)')
      .addStringOption((o) => gamemodeOption(o)),
  )
  .addSubcommand((s) => s.setName('view').setDescription('Show this server\'s configuration'));

async function execute(interaction) {
  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();
  const { guild, guildId, options } = interaction;

  if (group === 'gamemode' && sub === 'add') {
    const name = options.getString('name', true).trim();
    if (!GAMEMODE_RE.test(name)) throw new UserError('Gamemode names can only use letters, numbers and spaces (max 24).');
    if (gamemodes(guildId).some((g) => g.toLowerCase() === name.toLowerCase())) throw new UserError(`**${name}** already exists.`);
    if (gamemodes(guildId).length >= 25) throw new UserError('A server can have at most 25 gamemodes.');
    run('INSERT INTO gamemodes VALUES (?, ?)', guildId, name);
    return interaction.reply({
      ...EPHEMERAL,
      content: `Added **${name}**. Next: \`/setup queue\` for each region, then \`/setup panel\`.`,
    });
  }

  if (group === 'gamemode' && sub === 'remove') {
    const gm = resolveGamemode(guildId, options.getString('gamemode', true));
    db.transaction(() => {
      for (const table of ['gamemodes', 'queues', 'queue_testers', 'queue_entries', 'waitlist', 'tier_roles']) {
        const col = table === 'gamemodes' ? 'name' : 'gamemode';
        run(`DELETE FROM ${table} WHERE guild_id = ? AND ${col} = ?`, guildId, gm);
      }
    })();
    return interaction.reply({ ...EPHEMERAL, content: `Removed **${gm}**. Existing results and tier history are kept.` });
  }

  if (sub === 'config') {
    const updates = {
      tester_role_id: options.getRole('tester_role')?.id,
      ticket_category_id: options.getChannel('ticket_category')?.id,
      results_channel_id: options.getChannel('results_channel')?.id,
      log_channel_id: options.getChannel('log_channel')?.id,
      cooldown_days: options.getInteger('cooldown_days'),
      max_queue: options.getInteger('max_queue'),
      account_mode: options.getString('accounts'),
      nick_sync: options.getBoolean('nickname_sync') === null ? null : Number(options.getBoolean('nickname_sync')),
    };
    getConfig(guildId);
    for (const [col, value] of Object.entries(updates)) {
      if (value !== undefined && value !== null) run(`UPDATE guild_config SET ${col} = ? WHERE guild_id = ?`, value, guildId);
    }
    return interaction.reply({ ...EPHEMERAL, embeds: [configEmbed(interaction)] });
  }

  if (sub === 'queue') {
    const gm = resolveGamemode(guildId, options.getString('gamemode', true));
    const region = options.getString('region', true);
    const channel = options.getChannel('channel', true);
    const role = options.getRole('waitlist_role');
    const me = guild.members.me;
    if (!channel.permissionsFor(me).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
      throw new UserError(`I need View Channel, Send Messages and Embed Links in ${channel}.`);
    }
    if (role && (role.managed || role.position >= me.roles.highest.position)) {
      throw new UserError(`I can't assign ${role} — move my role above it.`);
    }

    const existing = one('SELECT * FROM queues WHERE guild_id = ? AND gamemode = ? AND region = ?', guildId, gm, region);
    run(
      `INSERT INTO queues (guild_id, gamemode, region, channel_id, waitlist_role_id) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (guild_id, gamemode, region) DO UPDATE SET channel_id = excluded.channel_id,
         waitlist_role_id = excluded.waitlist_role_id,
         message_id = CASE WHEN queues.channel_id = excluded.channel_id THEN queues.message_id ELSE NULL END`,
      guildId, gm, region, channel.id, role?.id ?? null,
    );
    await interaction.deferReply(EPHEMERAL);
    await refreshQueue(interaction.client, guildId, gm, region);
    return interaction.editReply(`${existing ? 'Updated' : 'Created'} the **${gm} ${region}** queue in ${channel}.`);
  }

  if (sub === 'panel') {
    const gm = resolveGamemode(guildId, options.getString('gamemode', true));
    await interaction.channel.send(panelView(gm, getConfig(guildId)));
    return interaction.reply({ ...EPHEMERAL, content: `Posted the **${gm}** request-test panel.` });
  }

  if (sub === 'tierroles') {
    const gm = resolveGamemode(guildId, options.getString('gamemode', true));
    await interaction.deferReply(EPHEMERAL);
    const created = await ensureTierRoles(guild, gm);
    return interaction.editReply(
      created.length ? `Created ${created.length} roles: ${created.map(String).join(' ')}` : 'All tier roles already exist.',
    );
  }

  if (sub === 'view') return interaction.reply({ ...EPHEMERAL, embeds: [configEmbed(interaction)] });
}

function configEmbed(interaction) {
  const { guild, guildId } = interaction;
  const cfg = getConfig(guildId);
  const fmt = (id, kind) => (id ? (kind === 'role' ? `<@&${id}>` : `<#${id}>`) : '*not set*');
  const queues = all('SELECT * FROM queues WHERE guild_id = ? ORDER BY gamemode, region', guildId);
  const needed = ['ManageChannels', 'ManageRoles', 'SendMessages', 'EmbedLinks', 'ViewChannel'];
  const missing = needed.filter((p) => !guild.members.me.permissions.has(PermissionFlagsBits[p]));

  return new EmbedBuilder()
    .setColor(missing.length ? COLORS.danger : COLORS.primary)
    .setTitle(`Testing setup · ${guild.name}`)
    .addFields(
      { name: 'Tester role', value: fmt(cfg.tester_role_id, 'role'), inline: true },
      { name: 'Ticket category', value: fmt(cfg.ticket_category_id), inline: true },
      { name: 'Results channel', value: fmt(cfg.results_channel_id), inline: true },
      { name: 'Log channel', value: fmt(cfg.log_channel_id), inline: true },
      { name: 'Cooldown', value: `${cfg.cooldown_days} days`, inline: true },
      { name: 'Max queue', value: String(cfg.max_queue), inline: true },
      { name: 'Accounts', value: ACCOUNT_MODES[cfg.account_mode], inline: true },
      { name: 'Nickname sync', value: cfg.nick_sync ? 'On' : 'Off', inline: true },
      { name: 'Gamemodes', value: gamemodes(guildId).join(', ') || '*none — `/setup gamemode add`*' },
      {
        name: 'Queues',
        value:
          queues
            .map((q) => `${q.gamemode} ${q.region} → <#${q.channel_id}>${q.waitlist_role_id ? ` · <@&${q.waitlist_role_id}>` : ''}${q.open ? ' 🟢' : ''}`)
            .join('\n')
            .slice(0, 1024) || '*none — `/setup queue`*',
      },
      { name: 'Missing permissions', value: missing.join(', ') || 'None ✅' },
    );
}

export default [{ data, execute }];
