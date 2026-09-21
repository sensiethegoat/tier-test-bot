import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { DAY, bestTier } from '../constants.js';
import { run } from '../../../db.js';
import { removeEverywhere } from '../queue.js';
import { applyTierRole, gamemodeOption, getRank, resolveGamemode, tierOption } from '../util.js';
import { EPHEMERAL, UserError } from '../../../util.js';

const data = new SlashCommandBuilder()
  .setName('admin')
  .setDescription('Staff tools for tiers and players')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) =>
    s
      .setName('settier')
      .setDescription('Set a player\'s tier without a test (no cooldown change)')
      .addUserOption((o) => o.setName('user').setDescription('Player').setRequired(true))
      .addStringOption((o) => gamemodeOption(o))
      .addStringOption((o) => tierOption(o, ['Unranked']))
      .addBooleanOption((o) => o.setName('set_peak').setDescription('Also overwrite the peak tier (to correct mistakes)')),
  )
  .addSubcommand((s) =>
    s
      .setName('resetcooldown')
      .setDescription('Let a player test again right away')
      .addUserOption((o) => o.setName('user').setDescription('Player').setRequired(true))
      .addStringOption((o) => gamemodeOption(o)),
  )
  .addSubcommand((s) =>
    s
      .setName('restrict')
      .setDescription('Block a player from testing')
      .addUserOption((o) => o.setName('user').setDescription('Player').setRequired(true))
      .addIntegerOption((o) => o.setName('days').setDescription('0 = permanent').setRequired(true).setMinValue(0).setMaxValue(3650))
      .addStringOption((o) => o.setName('reason').setDescription('Reason shown to the player').setMaxLength(200)),
  )
  .addSubcommand((s) =>
    s
      .setName('unrestrict')
      .setDescription('Lift a testing restriction')
      .addUserOption((o) => o.setName('user').setDescription('Player').setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('unlink')
      .setDescription('Unlink a player\'s Minecraft account (their tiers are kept)')
      .addUserOption((o) => o.setName('user').setDescription('Player').setRequired(true)),
  );

async function execute(interaction) {
  const { client, guild, guildId, options } = interaction;
  const sub = options.getSubcommand();
  const target = options.getUser('user', true);
  await interaction.deferReply(EPHEMERAL);

  if (sub === 'settier') {
    const gm = resolveGamemode(guildId, options.getString('gamemode', true));
    const tier = options.getString('tier', true);
    const member = await guild.members.fetch(target.id).catch(() => null);

    if (tier === 'Unranked') {
      run('DELETE FROM ranks WHERE guild_id = ? AND user_id = ? AND gamemode = ?', guildId, target.id, gm);
      if (member) await applyTierRole(member, gm, null);
      return interaction.editReply(`${target} is now **Unranked** in ${gm}.`);
    }

    const prev = getRank(guildId, target.id, gm);
    const peak = options.getBoolean('set_peak') ? tier : bestTier(prev?.peak_tier, tier);
    run(
      `INSERT INTO ranks (guild_id, user_id, gamemode, tier, peak_tier) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (guild_id, user_id, gamemode) DO UPDATE SET tier = excluded.tier, peak_tier = excluded.peak_tier`,
      guildId, target.id, gm, tier, peak,
    );
    if (member) await applyTierRole(member, gm, tier);
    return interaction.editReply(`${target} is now **${tier}** in ${gm} (peak ${peak}).`);
  }

  if (sub === 'resetcooldown') {
    const gm = resolveGamemode(guildId, options.getString('gamemode', true));
    const res = run('UPDATE ranks SET last_tested_at = NULL WHERE guild_id = ? AND user_id = ? AND gamemode = ?', guildId, target.id, gm);
    if (!res.changes) throw new UserError(`${target} has no ${gm} cooldown.`);
    return interaction.editReply(`Reset ${target}'s ${gm} cooldown.`);
  }

  if (sub === 'restrict') {
    const days = options.getInteger('days', true);
    const until = days ? Date.now() + days * DAY : null;
    run('INSERT OR REPLACE INTO restrictions VALUES (?, ?, ?, ?)', guildId, target.id, until, options.getString('reason'));
    await removeEverywhere(client, guildId, target.id);
    return interaction.editReply(`${target} is restricted from testing ${days ? `for ${days} days` : 'permanently'}.`);
  }

  if (sub === 'unrestrict') {
    const res = run('DELETE FROM restrictions WHERE guild_id = ? AND user_id = ?', guildId, target.id);
    if (!res.changes) throw new UserError(`${target} is not restricted.`);
    return interaction.editReply(`${target} can test again.`);
  }

  if (sub === 'unlink') {
    const res = run('DELETE FROM players WHERE guild_id = ? AND user_id = ?', guildId, target.id);
    if (!res.changes) throw new UserError(`${target} has no linked account.`);
    await removeEverywhere(client, guildId, target.id);
    return interaction.editReply(`Unlinked ${target}'s account.`);
  }
}

export default [{ data, execute }];
