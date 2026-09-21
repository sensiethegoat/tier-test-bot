import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { one, run } from '../../../db.js';
import { closeQueue, getQueue, nextPlayer, openQueue, refreshQueue, testerLeave } from '../queue.js';
import { gamemodeOption, regionOption, requireTester, resolveGamemode } from '../util.js';
import { EPHEMERAL, UserError } from '../../../util.js';

const data = new SlashCommandBuilder()
  .setName('queue')
  .setDescription('Tester queue controls')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) =>
    s
      .setName('open')
      .setDescription('Open a queue (or join it as an extra tester) and ping the waitlist')
      .addStringOption((o) => gamemodeOption(o))
      .addStringOption((o) => regionOption(o)),
  )
  .addSubcommand((s) =>
    s
      .setName('leave')
      .setDescription('Stop testing in a queue; it closes when no testers are left')
      .addStringOption((o) => gamemodeOption(o))
      .addStringOption((o) => regionOption(o)),
  )
  .addSubcommand((s) =>
    s
      .setName('close')
      .setDescription('Close a queue for everyone and clear it')
      .addStringOption((o) => gamemodeOption(o))
      .addStringOption((o) => regionOption(o)),
  )
  .addSubcommand((s) =>
    s
      .setName('next')
      .setDescription('Open a ticket with the next player in the queue')
      .addStringOption((o) => gamemodeOption(o))
      .addStringOption((o) => regionOption(o)),
  )
  .addSubcommand((s) =>
    s
      .setName('remove')
      .setDescription('Remove a player from a queue')
      .addUserOption((o) => o.setName('user').setDescription('Player').setRequired(true))
      .addStringOption((o) => gamemodeOption(o)),
  );

async function execute(interaction) {
  requireTester(interaction);
  const { client, guildId, options, user } = interaction;
  const sub = options.getSubcommand();
  const gamemode = resolveGamemode(guildId, options.getString('gamemode', true));
  const region = options.getString('region');
  await interaction.deferReply(EPHEMERAL);

  if (sub === 'open') {
    const q = await openQueue(interaction, gamemode, region);
    return interaction.editReply(`You are testing in the **${gamemode} ${region}** queue in <#${q.channel_id}>.`);
  }

  if (sub === 'leave') {
    if (!getQueue(guildId, gamemode, region)?.open) throw new UserError('That queue is not open.');
    const left = await testerLeave(client, guildId, gamemode, region, user.id);
    return interaction.editReply(left ? 'You stopped testing in this queue.' : 'You stopped testing; the queue is now closed.');
  }

  if (sub === 'close') {
    if (!getQueue(guildId, gamemode, region)?.open) throw new UserError('That queue is not open.');
    await closeQueue(client, guildId, gamemode, region);
    return interaction.editReply(`Closed the **${gamemode} ${region}** queue.`);
  }

  if (sub === 'next') {
    const channel = await nextPlayer(interaction, gamemode, region);
    return interaction.editReply(`Opened ${channel}.`);
  }

  if (sub === 'remove') {
    const target = options.getUser('user', true);
    const entry = one('SELECT region FROM queue_entries WHERE guild_id = ? AND gamemode = ? AND user_id = ?', guildId, gamemode, target.id);
    if (!entry) throw new UserError(`${target} is not in a ${gamemode} queue.`);
    run('DELETE FROM queue_entries WHERE guild_id = ? AND gamemode = ? AND user_id = ?', guildId, gamemode, target.id);
    await refreshQueue(client, guildId, gamemode, entry.region);
    return interaction.editReply(`Removed ${target} from the **${gamemode} ${entry.region}** queue.`);
  }
}

export default [{ data, execute }];
