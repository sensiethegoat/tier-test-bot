import { readFileSync } from 'node:fs';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  InteractionContextType,
  SlashCommandBuilder,
} from 'discord.js';
import { isEnabled, modules } from '../modules.js';
import { COLORS, ts } from '../util.js';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

// AGPL §13: if you run a modified version of this bot for others, point SOURCE_URL at your
// modified source so its users can get it.
export const SOURCE_URL =
  process.env.SOURCE_URL || pkg.repository?.url?.replace(/^git\+/, '').replace(/\.git$/, '') || 'https://github.com/creeperdiamonds/tier-test-bot';

const startedAt = Date.now();

const data = new SlashCommandBuilder()
  .setName('about')
  .setDescription('About this bot, its license and source code')
  .setContexts(InteractionContextType.Guild);

async function serverCount(client) {
  if (!client.shard) return client.guilds.cache.size;
  const counts = await client.shard.fetchClientValues('guilds.cache.size').catch(() => null);
  return counts ? counts.reduce((a, b) => a + b, 0) : client.guilds.cache.size;
}

async function execute(interaction) {
  const { client, guildId } = interaction;
  const active = modules.filter((m) => isEnabled(guildId, m)).map((m) => m.name);

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle(client.user.username)
    .setThumbnail(client.user.displayAvatarURL())
    .setDescription(
      'Open-source bot for Minecraft PvP communities: tier testing, announcements and support tickets.\n\n' +
        'Licensed under the **GNU AGPL v3 or later**. You can use, study, change and share it; ' +
        'if you run a changed version for others, you must share its source with them too.',
    )
    .addFields(
      { name: 'Version', value: pkg.version, inline: true },
      { name: 'Servers', value: String(await serverCount(client)), inline: true },
      { name: 'Online since', value: ts(startedAt), inline: true },
      { name: 'Modules on here', value: active.join(', ') || 'None' },
      { name: 'Source code', value: SOURCE_URL },
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('Source code').setStyle(ButtonStyle.Link).setURL(SOURCE_URL),
    new ButtonBuilder().setLabel('License').setStyle(ButtonStyle.Link).setURL('https://www.gnu.org/licenses/agpl-3.0.html'),
  );
  await interaction.reply({ embeds: [embed], components: [row] });
}

export default [{ data, execute }];
