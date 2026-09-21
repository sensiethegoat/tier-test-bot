import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { DAY, bestTier } from '../constants.js';
import { all, db, one, run } from '../../../db.js';
import { removeEverywhere } from '../queue.js';
import {
  applyTierRole,
  gamemodeOption,
  getConfig,
  getRank,
  openTicketFor,
  resolveGamemode,
  syncNickname,
  tierOption,
} from '../util.js';
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
  )
  .addSubcommand((s) =>
    s
      .setName('transfer')
      .setDescription('Move a player\'s account, tiers and history to another Discord account')
      .addUserOption((o) => o.setName('from').setDescription('Current owner').setRequired(true))
      .addUserOption((o) => o.setName('to').setDescription('New owner (must not be verified here yet)').setRequired(true)),
  );

async function execute(interaction) {
  const { client, guild, guildId, options } = interaction;
  const sub = options.getSubcommand();
  if (sub === 'transfer') return transfer(interaction);
  const target = options.getUser('user', true);
  await interaction.deferReply(EPHEMERAL);

  if (sub === 'settier') {
    const gm = resolveGamemode(guildId, options.getString('gamemode', true));
    const tier = options.getString('tier', true);
    const member = await guild.members.fetch(target.id).catch(() => null);

    if (tier === 'Unranked') {
      run('DELETE FROM ranks WHERE guild_id = ? AND user_id = ? AND gamemode = ?', guildId, target.id, gm);
      if (member) {
        await applyTierRole(member, gm, null);
        await syncNickname(member);
      }
      return interaction.editReply(`${target} is now **Unranked** in ${gm}.`);
    }

    const prev = getRank(guildId, target.id, gm);
    const peak = options.getBoolean('set_peak') ? tier : bestTier(prev?.peak_tier, tier);
    run(
      `INSERT INTO ranks (guild_id, user_id, gamemode, tier, peak_tier) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (guild_id, user_id, gamemode) DO UPDATE SET tier = excluded.tier, peak_tier = excluded.peak_tier`,
      guildId, target.id, gm, tier, peak,
    );
    if (member) {
      await applyTierRole(member, gm, tier);
      await syncNickname(member);
    }
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

async function transfer(interaction) {
  const { guild, guildId, options } = interaction;
  const from = options.getUser('from', true);
  const to = options.getUser('to', true);
  if (from.id === to.id) throw new UserError('Pick two different accounts.');
  const has = (table, id) => one(`SELECT 1 FROM ${table} WHERE guild_id = ? AND user_id = ?`, guildId, id);
  if (!has('players', from.id) && !has('ranks', from.id)) throw new UserError(`${from} has no account or tiers here.`);
  if (has('players', to.id) || has('ranks', to.id)) throw new UserError(`${to} already has an account or tiers here. Unlink them first.`);
  for (const id of [from.id, to.id]) {
    if (has('waitlist', id) || has('queue_entries', id) || openTicketFor(guildId, id)) {
      throw new UserError(`<@${id}> is on a waitlist, in a queue or in a test. Wait until that's finished.`);
    }
  }
  await interaction.deferReply(EPHEMERAL);

  // Restrictions move too, so a transfer can't be used to escape one.
  db.transaction(() => {
    for (const table of ['players', 'ranks', 'tests', 'restrictions']) {
      run(`UPDATE ${table} SET user_id = ? WHERE guild_id = ? AND user_id = ?`, to.id, guildId, from.id);
    }
  })();

  const [oldMember, newMember] = await Promise.all([from, to].map((u) => guild.members.fetch(u.id).catch(() => null)));
  const ranks = all('SELECT gamemode, tier FROM ranks WHERE guild_id = ? AND user_id = ?', guildId, to.id);
  for (const r of ranks) {
    if (oldMember) await applyTierRole(oldMember, r.gamemode, null);
    if (newMember) await applyTierRole(newMember, r.gamemode, r.tier);
  }
  if (newMember) await syncNickname(newMember);
  if (oldMember?.manageable && getConfig(guildId).nick_sync) await oldMember.setNickname(null).catch(() => {});

  await interaction.editReply(`Moved ${from}'s account, ${ranks.length} tier(s) and test history to ${to}.`);
}

export default [{ data, execute }];
