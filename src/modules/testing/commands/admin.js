import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { DAY, bestTier, tiersOf } from '../constants.js';
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
import { EPHEMERAL, UserError, ts } from '../../../util.js';

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
      .setName('retire')
      .setDescription('Retire a player: they keep their tiers but leave the rankings and cannot test')
      .addUserOption((o) => o.setName('user').setDescription('Player').setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('unretire')
      .setDescription('Bring a retired player back into the rankings')
      .addUserOption((o) => o.setName('user').setDescription('Player').setRequired(true)),
  )
  .addSubcommandGroup((g) =>
    g
      .setName('season')
      .setDescription('Archive the current tiers and start over')
      .addSubcommand((s) =>
        s
          .setName('end')
          .setDescription('Save every current tier as a finished season, then clear tiers and cooldowns')
          .addStringOption((o) => o.setName('name').setDescription('Season name, e.g. "Beta"').setRequired(true).setMaxLength(60)),
      )
      .addSubcommand((s) => s.setName('list').setDescription('List finished seasons')),
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
  if (options.getSubcommandGroup(false) === 'season') return season(interaction, sub);
  if (sub === 'transfer') return transfer(interaction);
  const target = options.getUser('user', true);
  await interaction.deferReply(EPHEMERAL);

  if (sub === 'settier') {
    const gm = resolveGamemode(guildId, options.getString('gamemode', true));
    const tier = options.getString('tier', true);
    const cfg = getConfig(guildId);
    if (tier !== 'Unranked' && !tiersOf(cfg).includes(tier)) {
      throw new UserError(`This server uses ${tiersOf(cfg).length} tiers: ${tiersOf(cfg)[0]}–${tiersOf(cfg).at(-1)}.`);
    }
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

  if (sub === 'retire' || sub === 'unretire') {
    const retire = sub === 'retire';
    const res = run(
      'UPDATE players SET retired = ?, retired_at = ? WHERE guild_id = ? AND user_id = ? AND retired = ?',
      retire ? 1 : 0, retire ? Date.now() : null, guildId, target.id, retire ? 0 : 1,
    );
    if (!res.changes) throw new UserError(`${target} is ${retire ? 'already retired' : 'not retired'} (or has no account here).`);
    if (retire) await removeEverywhere(client, guildId, target.id);
    return interaction.editReply(
      retire
        ? `${target} is retired. They keep their tiers and peaks, but leave the leaderboards and can't test until you run \`/admin unretire\`.`
        : `${target} is back in the rankings.`,
    );
  }

  if (sub === 'unlink') {
    const res = run('DELETE FROM players WHERE guild_id = ? AND user_id = ?', guildId, target.id);
    if (!res.changes) throw new UserError(`${target} has no linked account.`);
    await removeEverywhere(client, guildId, target.id);
    return interaction.editReply(`Unlinked ${target}'s account.`);
  }
}

async function season(interaction, sub) {
  const { guildId, options } = interaction;
  if (sub === 'list') {
    const rows = all('SELECT id, name, ended_at FROM seasons WHERE guild_id = ? ORDER BY id DESC LIMIT 25', guildId);
    return interaction.reply({
      ...EPHEMERAL,
      content: rows.length
        ? rows.map((s) => `**${s.id}. ${s.name}** — ended ${ts(s.ended_at)}`).join('\n')
        : 'No finished seasons yet. `/admin season end` archives the current tiers and starts a new one.',
    });
  }

  const name = options.getString('name', true).trim();
  const now = Date.now();
  const counts = db.transaction(() => {
    const previous = one('SELECT MAX(ended_at) AS at FROM seasons WHERE guild_id = ?', guildId)?.at ?? null;
    const { lastInsertRowid: id } = run(
      'INSERT INTO seasons (guild_id, name, started_at, ended_at) VALUES (?, ?, ?, ?)',
      guildId, name, previous, now,
    );
    const archived = run(
      `INSERT INTO season_ranks (season_id, guild_id, user_id, ign, gamemode, tier, peak_tier)
       SELECT ?, r.guild_id, r.user_id, p.ign, r.gamemode, r.tier, r.peak_tier
       FROM ranks r LEFT JOIN players p ON p.guild_id = r.guild_id AND p.user_id = r.user_id
       WHERE r.guild_id = ?`,
      id, guildId,
    ).changes;
    run('UPDATE tests SET season_id = ? WHERE guild_id = ? AND season_id IS NULL', id, guildId);
    run('DELETE FROM ranks WHERE guild_id = ?', guildId);
    return { id, archived };
  })();

  await interaction.reply({
    ...EPHEMERAL,
    content:
      `🏁 Season **${name}** (#${counts.id}) is archived with ${counts.archived} tier(s). Everyone starts unranked and can test again right away.\n` +
      'Tier roles are left on members; they are corrected on each player\'s next result, or you can clear them in Server Settings → Roles.',
  });
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
