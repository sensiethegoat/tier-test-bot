import { EmbedBuilder, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { all } from '../../../db.js';
import { COLORS, EPHEMERAL, UserError } from '../../../util.js';
import { GAMEMODE_RE } from '../constants.js';
import { ALL_REGIONS, autosetup } from '../provision.js';
import { gamemodes } from '../util.js';

const data = new SlashCommandBuilder()
  .setName('autosetup')
  .setDescription('Create channels, roles, queues and the panel for a gamemode in one go')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .addStringOption((o) =>
    o.setName('gamemode').setDescription('Existing or new gamemode, e.g. Sword').setRequired(true).setMaxLength(24).setAutocomplete(true),
  )
  .addStringOption((o) =>
    o.setName('regions').setDescription(`Comma-separated, e.g. EU,NA (default: all, or the existing ones on a re-run)`).setMaxLength(30),
  );

function parseRegions(input, guildId, gamemode) {
  if (!input) {
    // Re-running for a gamemode keeps its regions; a new gamemode gets all of them.
    const existing = all('SELECT region FROM queues WHERE guild_id = ? AND gamemode = ?', guildId, gamemode ?? '').map((r) => r.region);
    return existing.length ? existing : ALL_REGIONS;
  }
  const regions = [...new Set(input.toUpperCase().split(/[\s,]+/).filter(Boolean))];
  const bad = regions.filter((r) => !ALL_REGIONS.includes(r));
  if (bad.length || !regions.length) throw new UserError(`Regions must be from ${ALL_REGIONS.join(', ')}.`);
  return regions;
}

async function execute(interaction) {
  const { guild, guildId, options } = interaction;
  const input = options.getString('gamemode', true).trim();

  let gamemode = gamemodes(guildId).find((g) => g.toLowerCase() === input.toLowerCase());
  if (!gamemode) {
    if (!GAMEMODE_RE.test(input)) throw new UserError('Gamemode names can only use letters, numbers and spaces (max 24).');
    if (gamemodes(guildId).length >= 25) throw new UserError('A server can have at most 25 gamemodes.');
    gamemode = input;
  }
  const regions = parseRegions(options.getString('regions'), guildId, gamemode);

  await interaction.deferReply(EPHEMERAL);
  const r = await autosetup(guild, gamemode, regions);

  const embed = new EmbedBuilder()
    .setColor(COLORS.success)
    .setTitle(`✅ ${gamemode} testing is set up`)
    .setDescription(
      [
        `**Panel:** ${r.request}${r.postedPanel ? '' : ' (already there)'}`,
        `**Queues:** ${r.queues.map((q) => `${q.channel} → ${q.waitlist}`).join(' · ')}`,
        `**Results:** ${r.results} · **Logs:** ${r.logs} (testers only)`,
        `**Tickets category:** ${r.tickets.name}`,
        `**Tester role:** ${r.tester}${r.tierRoles.length ? ` · created ${r.tierRoles.length} tier roles` : ''}`,
        '',
        `Next: give ${r.tester} to your testers. Make sure my role is above the waitlist and tier roles in Server Settings → Roles.`,
        'Run this again with another gamemode to add it next to this one.',
      ].join('\n'),
    );
  await interaction.editReply({ embeds: [embed] });
}

export default [{ data, execute }];
