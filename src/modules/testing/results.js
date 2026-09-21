import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { db, run } from '../../db.js';
import { resultLink } from '../../links.js';
import { COLORS, UserError } from '../../util.js';
import { TIERS, bestTier } from './constants.js';
import { finishClose, markClosed } from './tickets.js';
import { applyTierRole, avatarUrl, displayName, getConfig, getPlayer, getRank, syncNickname } from './util.js';

/** "3-1", "3 - 1" → "3-1". Empty → null. */
export function normalizeScore(input) {
  const value = input?.trim();
  if (!value) return null;
  const m = /^(\d{1,2})\s*[-:]\s*(\d{1,2})$/.exec(value);
  if (!m) throw new UserError('Scores look like `3-1`.');
  return `${Number(m[1])}-${Number(m[2])}`;
}

/**
 * Saves the result of an open ticket, updates roles and nickname, posts it to the results
 * channel and closes the ticket. Used by /result and the ticket's Finish Test button.
 */
export async function recordResult(interaction, ticket, { tier, score, notes }) {
  const { guild, guildId, user } = interaction;
  if (!TIERS.includes(tier)) throw new UserError('Pick a tier from HT1 to LT5.');
  score = normalizeScore(score);
  notes = notes?.trim() || null;

  const cfg = getConfig(guildId);
  const player = getPlayer(guildId, ticket.user_id);
  if (!player) throw new UserError('The player unlinked their account; cancel this ticket instead.');
  const prev = getRank(guildId, ticket.user_id, ticket.gamemode);
  const now = Date.now();

  const testId = db.transaction(() => {
    if (!markClosed(ticket.channel_id)) throw new UserError('This ticket is already closed.');
    run(
      `INSERT INTO ranks (guild_id, user_id, gamemode, tier, peak_tier, last_tested_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (guild_id, user_id, gamemode) DO UPDATE SET
         tier = excluded.tier, peak_tier = excluded.peak_tier, last_tested_at = excluded.last_tested_at`,
      guildId, ticket.user_id, ticket.gamemode, tier, bestTier(prev?.peak_tier, tier), now,
    );
    return run(
      `INSERT INTO tests (guild_id, user_id, tester_id, gamemode, region, ign, prev_tier, new_tier, score, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      guildId, ticket.user_id, user.id, ticket.gamemode, ticket.region, player.ign, prev?.tier ?? null, tier, score, notes, now,
    ).lastInsertRowid;
  })();

  const member = await guild.members.fetch(ticket.user_id).catch(() => null);
  if (member) {
    await applyTierRole(member, ticket.gamemode, tier);
    await syncNickname(member);
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.gold)
    .setTitle(`${player.ign}'s Test Results 🏆`)
    .setThumbnail(avatarUrl(player))
    .addFields(
      { name: 'Tester', value: `<@${user.id}>` },
      { name: 'Region', value: ticket.region },
      { name: 'Username', value: displayName(player) },
      { name: 'Previous Rank', value: prev?.tier ?? 'Unranked' },
      { name: 'Rank Earned', value: tier },
    )
    .setFooter({ text: ticket.gamemode })
    .setTimestamp();
  if (score) embed.addFields({ name: 'Score', value: score });

  const url = resultLink(guildId, testId);
  const components = url
    ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('View on website').setStyle(ButtonStyle.Link).setURL(url))]
    : [];

  const results = cfg.results_channel_id && (await guild.channels.fetch(cfg.results_channel_id).catch(() => null));
  await results
    ?.send({ content: `<@${ticket.user_id}>`, embeds: [embed], components, allowedMentions: { users: [ticket.user_id] } })
    .catch(() => {});

  const channel = await guild.channels.fetch(ticket.channel_id).catch(() => null);
  const summary = [`Result: ${tier}`, score && `score ${score}`, notes].filter(Boolean).join(' — ');
  if (channel) await finishClose(channel, ticket, user.id, summary);
  return { embed, components };
}
