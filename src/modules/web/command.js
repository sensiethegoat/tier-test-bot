import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  InteractionContextType,
  SlashCommandBuilder,
} from 'discord.js';
import { one, run } from '../../db.js';
import { COLORS, EPHEMERAL, UserError, isAdmin } from '../../util.js';
import { siteByGuild } from './data.js';

/** The public address set by the bot host, or null if none is configured. */
export const baseUrl = () => (process.env.WEB_BASE_URL || '').replace(/\/+$/, '') || null;
export const siteUrl = (slug, ...parts) =>
  baseUrl() && `${baseUrl()}/${[slug, ...parts].map((p) => encodeURIComponent(p)).join('/')}`;

const data = new SlashCommandBuilder()
  .setName('website')
  .setDescription("This server's public tierlist website")
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) =>
    s
      .setName('link')
      .setDescription('Get links to the leaderboard, results or a player page')
      .addUserOption((o) => o.setName('user').setDescription('Show this player\'s page')),
  )
  .addSubcommand((s) =>
    s
      .setName('publish')
      .setDescription('Make this server\'s leaderboard and results public (admins)')
      .addStringOption((o) =>
        o.setName('slug').setDescription('Address name, e.g. "swordtiers" → /swordtiers').setRequired(true).setMinLength(3).setMaxLength(32),
      ),
  )
  .addSubcommand((s) => s.setName('unpublish').setDescription('Take this server\'s pages offline (admins)'));

async function execute(interaction) {
  const { guild, guildId, options } = interaction;
  const sub = options.getSubcommand();

  if (sub === 'publish') {
    if (!isAdmin(interaction.member)) throw new UserError('You need **Manage Server** for this.');
    const slug = options.getString('slug', true).toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug) || ['api', 'healthz'].includes(slug)) {
      throw new UserError('Use lowercase letters, numbers and dashes (3–32), not starting or ending with a dash.');
    }
    if (one('SELECT 1 FROM web_config WHERE slug = ? AND guild_id != ?', slug, guildId)) {
      throw new UserError(`\`${slug}\` is taken by another server. Pick another.`);
    }
    run(
      `INSERT INTO web_config (guild_id, slug, guild_name, icon_url, published) VALUES (?, ?, ?, ?, 1)
       ON CONFLICT (guild_id) DO UPDATE SET slug = excluded.slug, guild_name = excluded.guild_name,
         icon_url = excluded.icon_url, published = 1`,
      guildId, slug, guild.name, guild.iconURL({ size: 64 }),
    );
    const link = siteUrl(slug);
    return interaction.reply({
      ...EPHEMERAL,
      content:
        `🌐 Published at ${link ?? `\`/${slug}\` (the bot host hasn't set WEB_BASE_URL, so I can't show the full address)`}.\n` +
        'Anyone can now see linked usernames, regions, tiers and test results (not Discord accounts or staff notes). ' +
        'Undo with `/website unpublish`.',
    });
  }

  if (sub === 'unpublish') {
    if (!isAdmin(interaction.member)) throw new UserError('You need **Manage Server** for this.');
    const res = run('UPDATE web_config SET published = 0 WHERE guild_id = ? AND published = 1', guildId);
    if (!res.changes) throw new UserError('This server\'s pages are not published.');
    return interaction.reply({ ...EPHEMERAL, content: 'Your pages are offline. `/website publish` brings them back.' });
  }

  const site = siteByGuild(guildId);
  if (!site) throw new UserError('This server hasn\'t published a tierlist website. An admin can run `/website publish`.');
  if (!baseUrl()) throw new UserError('The bot host hasn\'t set WEB_BASE_URL, so there is no public address to link to.');

  const target = options.getUser('user');
  const ign = target && one('SELECT ign FROM players WHERE guild_id = ? AND user_id = ?', guildId, target.id)?.ign;
  if (target && !ign) throw new UserError(`${target} hasn't linked a Minecraft account here.`);

  const buttons = [
    new ButtonBuilder().setLabel('Leaderboard').setStyle(ButtonStyle.Link).setURL(siteUrl(site.slug)),
    new ButtonBuilder().setLabel('Recent results').setStyle(ButtonStyle.Link).setURL(siteUrl(site.slug, 'results')),
  ];
  if (ign) buttons.unshift(new ButtonBuilder().setLabel(`${ign}'s page`).setStyle(ButtonStyle.Link).setURL(siteUrl(site.slug, 'player', ign)));
  await interaction.reply({
    embeds: [new EmbedBuilder().setColor(COLORS.primary).setTitle(`${site.guild_name} tierlist`).setDescription(siteUrl(site.slug))],
    components: [new ActionRowBuilder().addComponents(buttons)],
  });
}

export default [{ data, execute }];
