import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  InteractionContextType,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { one, run } from '../db.js';
import { COLORS, EPHEMERAL, UserError, ts } from '../util.js';

// Reports go to the bot developer, not the server's staff: to BUG_REPORT_CHANNEL_ID if set
// (a channel in your own server), otherwise as a DM to the application owner.

const COOLDOWN = 2 * 60_000;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // Discord's upload limit for bots in unboosted servers
const lastReport = new Map(); // userId → timestamp
const pendingFiles = new Map(); // command interaction id → attachment, until the modal is submitted

const data = new SlashCommandBuilder()
  .setName('bugreport')
  .setDescription('Report a bug in this bot to its developer')
  .setContexts(InteractionContextType.Guild)
  .addAttachmentOption((o) => o.setName('screenshot').setDescription('Optional screenshot or file'));

function checkCooldown(userId) {
  const wait = (lastReport.get(userId) ?? 0) + COOLDOWN - Date.now();
  if (wait > 0) throw new UserError(`You just sent a report. You can send another ${ts(Date.now() + wait)}.`);
}

async function execute(interaction) {
  checkCooldown(interaction.user.id);

  const file = interaction.options.getAttachment('screenshot');
  if (file) {
    pendingFiles.set(interaction.id, file);
    setTimeout(() => pendingFiles.delete(interaction.id), 15 * 60_000).unref();
  }

  const input = (id, label, style, max, required, placeholder) =>
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId(id)
        .setLabel(label)
        .setStyle(style)
        .setMaxLength(max)
        .setRequired(required)
        .setPlaceholder(placeholder),
    );

  await interaction.showModal(
    new ModalBuilder()
      .setCustomId(`bugreport:${interaction.id}`)
      .setTitle('Report a bug')
      .addComponents(
        input('title', 'Short summary', TextInputStyle.Short, 100, true, 'Join Queue button says "Something went wrong"'),
        input('description', 'What happened?', TextInputStyle.Paragraph, 1500, true, 'What did you expect, and what happened instead?'),
        input('steps', 'How can we make it happen again? (optional)', TextInputStyle.Paragraph, 1000, false, '1. Press Verify Account\n2. ...'),
      ),
  );
}

export async function submitBugReport(interaction, key) {
  const { user, guild } = interaction;
  checkCooldown(user.id);
  await interaction.deferReply(EPHEMERAL);

  const title = interaction.fields.getTextInputValue('title').trim();
  const description = interaction.fields.getTextInputValue('description').trim();
  const steps = interaction.fields.getTextInputValue('steps').trim() || null;
  const file = pendingFiles.get(key);
  pendingFiles.delete(key);

  const { lastInsertRowid: id } = run(
    `INSERT INTO bug_reports (guild_id, user_id, title, description, steps, attachment_url, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    interaction.guildId, user.id, title, description, steps, file?.url ?? null, Date.now(),
  );
  lastReport.set(user.id, Date.now());

  const embed = new EmbedBuilder()
    .setColor(COLORS.danger)
    .setTitle(`Bug #${id}: ${title}`.slice(0, 256))
    .setDescription(description)
    .addFields(
      { name: 'Reporter', value: `${user} · ${user.tag} (${user.id})` },
      { name: 'Server', value: `${guild.name} (${guild.id})` },
    )
    .setFooter({ text: 'Open' })
    .setTimestamp();
  if (steps) embed.spliceFields(0, 0, { name: 'Steps to reproduce', value: steps });

  // Re-upload the file: Discord attachment links expire, so a bare URL would stop working.
  const files = [];
  if (file && file.size <= MAX_FILE_BYTES) {
    const name = file.name.replace(/[^\w.-]/g, '_');
    files.push({ attachment: file.url, name });
    if (file.contentType?.startsWith('image/')) embed.setImage(`attachment://${name}`);
  } else if (file) {
    embed.addFields({ name: 'Attachment', value: `Too large to re-upload: ${file.url}` });
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`bug:resolve:${id}`).setLabel('Mark fixed').setStyle(ButtonStyle.Success),
  );

  const delivered = await deliver(interaction.client, { embeds: [embed], components: [row], files });
  if (!delivered) console.error(`Bug report #${id} could not be delivered; it is saved in the bug_reports table.`);

  await interaction.editReply(
    `✅ Thanks! Your report was sent to the developer as **#${id}**. You'll get a DM when it's fixed (if your DMs are open).`,
  );
}

async function deliver(client, payload) {
  const send = async (target) => {
    try {
      await target.send(payload);
    } catch {
      // Retry without the file in case the upload was the problem.
      await target.send({ ...payload, files: [], embeds: payload.embeds.map((e) => EmbedBuilder.from(e).setImage(null)) });
    }
  };
  try {
    const channelId = process.env.BUG_REPORT_CHANNEL_ID;
    if (channelId) {
      await send(await client.channels.fetch(channelId));
    } else {
      const app = await client.application.fetch();
      const owner = app.owner?.owner?.user ?? app.owner; // a Team's owner is a TeamMember; otherwise owner is a User
      await send(owner);
    }
    return true;
  } catch (err) {
    console.error('Bug report delivery failed:', err.message);
    return false;
  }
}

/** Application owner, or every member if the bot belongs to a Discord developer team. */
async function isDeveloper(client, userId) {
  const app = await client.application.fetch();
  if (app.owner?.members) return app.owner.members.has(userId);
  return app.owner?.id === userId;
}

/** "Mark fixed" button on a delivered report. Works in the report channel and in DMs. */
export async function resolveBugReport(interaction, id) {
  if (!(await isDeveloper(interaction.client, interaction.user.id))) {
    throw new UserError('Only the bot developer can resolve bug reports.');
  }
  const report = one('SELECT * FROM bug_reports WHERE id = ?', id);
  if (!report) throw new UserError(`Bug #${id} no longer exists.`);
  if (report.status === 'resolved') throw new UserError(`Bug #${id} is already resolved.`);

  run('UPDATE bug_reports SET status = ?, resolved_at = ? WHERE id = ?', 'resolved', Date.now(), id);
  const embed = EmbedBuilder.from(interaction.message.embeds[0])
    .setColor(COLORS.success)
    .setFooter({ text: `Fixed by ${interaction.user.tag}` });
  await interaction.update({ embeds: [embed], components: [] });

  const reporter = await interaction.client.users.fetch(report.user_id).catch(() => null);
  await reporter
    ?.send(`✅ Your bug report **#${id}: ${report.title}** has been fixed. Thanks for reporting it!`)
    .catch(() => {}); // DMs closed
}

export default [{ data, execute }];
