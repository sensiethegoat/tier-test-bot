import { EmbedBuilder, InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { DAY, POINTS, tierIndex, titleFor } from '../constants.js';
import { all, one } from '../../../db.js';
import { avatarUrl, cooldownEnds, displayName, gamemodeOption, gamemodes, getConfig, getPlayer, resolveGamemode } from '../util.js';
import { COLORS, UserError, ts } from '../../../util.js';

const profile = new SlashCommandBuilder()
  .setName('profile')
  .setDescription('Show a player\'s tiers on this server')
  .setContexts(InteractionContextType.Guild)
  .addUserOption((o) => o.setName('user').setDescription('Player (defaults to you)'));

async function executeProfile(interaction) {
  const { guildId } = interaction;
  const target = interaction.options.getUser('user') ?? interaction.user;
  const cfg = getConfig(guildId);
  const player = getPlayer(guildId, target.id);
  const ranks = all('SELECT * FROM ranks WHERE guild_id = ? AND user_id = ?', guildId, target.id);
  if (!player && !ranks.length) throw new UserError(`${target} has not verified or been tested on this server.`);

  const points = ranks.reduce((sum, r) => sum + POINTS[r.peak_tier], 0);
  const tests = one('SELECT COUNT(*) AS n FROM tests WHERE guild_id = ? AND user_id = ?', guildId, target.id).n;
  const modes = [...new Set([...gamemodes(guildId), ...ranks.map((r) => r.gamemode)])];

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle(player?.ign ?? target.username)
    .setThumbnail(player ? avatarUrl(player) : target.displayAvatarURL())
    .setDescription(
      `**${titleFor(points)}** · ${points} points\n` +
        `Account: **${player ? (player.cracked ? 'Cracked' : 'Premium') : '—'}** · Region: **${player?.region ?? '—'}** · Tests taken: **${tests}** · <@${target.id}>`,
    );

  for (const gm of modes.slice(0, 24)) {
    const r = ranks.find((x) => x.gamemode === gm);
    const cd = cooldownEnds(guildId, target.id, gm, cfg);
    const lines = [r ? `**${r.tier}**${r.peak_tier !== r.tier ? ` (peak ${r.peak_tier})` : ''}` : 'Unranked'];
    if (cd) lines.push(`Retest ${ts(cd)}`);
    embed.addFields({ name: gm, value: lines.join('\n'), inline: true });
  }
  await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
}

const leaderboard = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('Top players on this server')
  .setContexts(InteractionContextType.Guild)
  .addStringOption((o) => gamemodeOption(o, false).setDescription('Gamemode (omit for overall points)'));

async function executeLeaderboard(interaction) {
  const { guildId } = interaction;
  const input = interaction.options.getString('gamemode');
  const rows = all('SELECT r.*, p.ign, p.cracked FROM ranks r LEFT JOIN players p USING (guild_id, user_id) WHERE r.guild_id = ?', guildId);
  const name = (r) => (r.ign ? displayName(r) : `<@${r.user_id}>`);
  let title, lines;

  if (input) {
    const gm = resolveGamemode(guildId, input);
    title = `${gm} Leaderboard`;
    lines = rows
      .filter((r) => r.gamemode === gm)
      .sort((a, b) => tierIndex(a.tier) - tierIndex(b.tier) || (a.last_tested_at ?? 0) - (b.last_tested_at ?? 0))
      .slice(0, 20)
      .map((r, i) => `**${i + 1}.** ${name(r)} — ${r.tier}`);
  } else {
    title = 'Overall Leaderboard';
    const totals = new Map();
    for (const r of rows) {
      const t = totals.get(r.user_id) ?? { ...r, points: 0 };
      t.points += POINTS[r.peak_tier];
      totals.set(r.user_id, t);
    }
    lines = [...totals.values()]
      .sort((a, b) => b.points - a.points)
      .slice(0, 20)
      .map((r, i) => `**${i + 1}.** ${name(r)} — ${r.points} pts · ${titleFor(r.points)}`);
  }

  await interaction.reply({
    embeds: [new EmbedBuilder().setColor(COLORS.gold).setTitle(title).setDescription(lines.join('\n') || 'Nobody has been tested yet.')],
    allowedMentions: { parse: [] },
  });
}

const tester = new SlashCommandBuilder()
  .setName('tester')
  .setDescription('Tester activity')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) =>
    s
      .setName('stats')
      .setDescription('Tests done by a tester')
      .addUserOption((o) => o.setName('user').setDescription('Tester (defaults to you)'))
      .addIntegerOption((o) => o.setName('days').setDescription('Look back this many days (default 30)').setMinValue(1).setMaxValue(3650)),
  )
  .addSubcommand((s) =>
    s
      .setName('top')
      .setDescription('Most active testers')
      .addIntegerOption((o) => o.setName('days').setDescription('Look back this many days (default 30)').setMinValue(1).setMaxValue(3650)),
  );

async function executeTester(interaction) {
  const { guildId, options } = interaction;
  const days = options.getInteger('days') ?? 30;
  const since = Date.now() - days * DAY;

  if (options.getSubcommand() === 'stats') {
    const target = options.getUser('user') ?? interaction.user;
    const byMode = all(
      'SELECT gamemode, COUNT(*) AS n FROM tests WHERE guild_id = ? AND tester_id = ? AND created_at >= ? GROUP BY gamemode ORDER BY n DESC',
      guildId, target.id, since,
    );
    const total = byMode.reduce((s, r) => s + r.n, 0);
    const allTime = one('SELECT COUNT(*) AS n FROM tests WHERE guild_id = ? AND tester_id = ?', guildId, target.id).n;
    const embed = new EmbedBuilder()
      .setColor(COLORS.primary)
      .setTitle(`Tester stats · ${target.username}`)
      .setDescription(
        `**${total}** tests in the last ${days} days · **${allTime}** all time\n\n` +
          (byMode.map((r) => `${r.gamemode}: ${r.n}`).join('\n') || 'No tests in this period.'),
      );
    return interaction.reply({ embeds: [embed] });
  }

  const top = all(
    'SELECT tester_id, COUNT(*) AS n FROM tests WHERE guild_id = ? AND created_at >= ? GROUP BY tester_id ORDER BY n DESC LIMIT 15',
    guildId, since,
  );
  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.gold)
        .setTitle(`Top testers · last ${days} days`)
        .setDescription(top.map((r, i) => `**${i + 1}.** <@${r.tester_id}> — ${r.n} tests`).join('\n') || 'No tests in this period.'),
    ],
    allowedMentions: { parse: [] },
  });
}

export default [
  { data: profile, execute: executeProfile },
  { data: leaderboard, execute: executeLeaderboard },
  { data: tester, execute: executeTester },
];
