import {
  ActionRowBuilder,
  ChannelType,
  EmbedBuilder,
  InteractionContextType,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { COLORS, EPHEMERAL, UserError } from '../../util.js';

// Options from /announce wait here until the text form is submitted.
const pending = new Map();

const data = new SlashCommandBuilder()
  .setName('announce')
  .setDescription('Post an announcement')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .setContexts(InteractionContextType.Guild)
  .addChannelOption((o) =>
    o
      .setName('channel')
      .setDescription('Where to post it')
      .setRequired(true)
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
  )
  .addStringOption((o) =>
    o
      .setName('ping')
      .setDescription('Ping everyone or online members')
      .addChoices({ name: '@everyone', value: 'everyone' }, { name: '@here', value: 'here' }),
  )
  .addRoleOption((o) => o.setName('role').setDescription('Role to ping'))
  .addAttachmentOption((o) => o.setName('image').setDescription('Image shown in the announcement'))
  .addStringOption((o) => o.setName('color').setDescription('Embed color as hex, e.g. #F1C40F').setMaxLength(7))
  .addBooleanOption((o) =>
    o.setName('publish').setDescription('Publish to servers following this channel (announcement channels only)'),
  );

async function execute(interaction) {
  const { member, options } = interaction;
  const channel = options.getChannel('channel', true);
  const ping = options.getString('ping');
  const role = options.getRole('role');
  const image = options.getAttachment('image');
  const color = options.getString('color');

  // The bot pings on the member's behalf, so the member must be allowed to do everything it does.
  const mine = channel.permissionsFor(member);
  if (!mine.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
    throw new UserError(`You can't post in ${channel}.`);
  }
  const needsMentionEveryone = ping || (role && !role.mentionable);
  if (needsMentionEveryone && !mine.has(PermissionFlagsBits.MentionEveryone)) {
    throw new UserError(`You need **Mention @everyone, @here and All Roles** in ${channel} for that ping.`);
  }
  const bot = channel.permissionsFor(interaction.guild.members.me);
  const botNeeds = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
  if (image) botNeeds.push(PermissionFlagsBits.AttachFiles);
  if (needsMentionEveryone) botNeeds.push(PermissionFlagsBits.MentionEveryone);
  if (!bot.has(botNeeds)) throw new UserError(`I'm missing permissions in ${channel} (send, embed, attach files or mention).`);

  if (image && !image.contentType?.startsWith('image/')) throw new UserError('The image option only takes images.');
  if (color && !/^#?[0-9a-f]{6}$/i.test(color)) throw new UserError('Colors look like `#F1C40F`.');

  pending.set(interaction.id, {
    channelId: channel.id,
    ping,
    roleId: role?.id,
    image,
    color: color ? parseInt(color.replace('#', ''), 16) : COLORS.primary,
    publish: options.getBoolean('publish') ?? false,
  });
  setTimeout(() => pending.delete(interaction.id), 15 * 60_000).unref();

  await interaction.showModal(
    new ModalBuilder()
      .setCustomId(`announce:${interaction.id}`)
      .setTitle(`Announcement in #${channel.name}`.slice(0, 45))
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('title').setLabel('Title (optional)').setStyle(TextInputStyle.Short).setMaxLength(256).setRequired(false),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('message').setLabel('Message').setStyle(TextInputStyle.Paragraph).setMaxLength(4000).setRequired(true),
        ),
      ),
  );
}

export async function submitAnnouncement(interaction, key) {
  const opts = pending.get(key);
  pending.delete(key);
  if (!opts) throw new UserError('This form expired. Run `/announce` again.');
  await interaction.deferReply(EPHEMERAL);

  const { guild, user } = interaction;
  const channel = await guild.channels.fetch(opts.channelId).catch(() => null);
  if (!channel) throw new UserError('That channel no longer exists.');

  const embed = new EmbedBuilder()
    .setColor(opts.color)
    .setAuthor({ name: guild.name, iconURL: guild.iconURL() ?? undefined })
    .setDescription(interaction.fields.getTextInputValue('message'))
    .setFooter({ text: `Announced by ${user.tag}` })
    .setTimestamp();
  const title = interaction.fields.getTextInputValue('title').trim();
  if (title) embed.setTitle(title);

  const files = [];
  if (opts.image) {
    // Re-upload so the image keeps working after Discord's attachment link expires.
    const name = opts.image.name.replace(/[^\w.-]/g, '_');
    files.push({ attachment: opts.image.url, name });
    embed.setImage(`attachment://${name}`);
  }

  const mentions = [opts.ping && `@${opts.ping}`, opts.roleId && `<@&${opts.roleId}>`].filter(Boolean).join(' ');
  const message = await channel.send({
    content: mentions || undefined,
    embeds: [embed],
    files,
    allowedMentions: { parse: opts.ping ? ['everyone'] : [], roles: opts.roleId ? [opts.roleId] : [] },
  });

  let note = '';
  if (opts.publish) {
    if (channel.type !== ChannelType.GuildAnnouncement) note = ' (not published: that is not an announcement channel)';
    else note = (await message.crosspost().then(() => ' and published it', () => ' (publishing failed)'));
  }
  await interaction.editReply(`✅ Posted ${message.url}${note}.`);
}

export default [{ data, execute }];
