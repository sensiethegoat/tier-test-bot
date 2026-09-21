import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { EPHEMERAL } from '../../../util.js';
import { cancelHighTest, listPending, requestHighTest } from '../highTest.js';
import { gamemodeOption, resolveGamemode } from '../util.js';

const data = new SlashCommandBuilder()
  .setName('hightest')
  .setDescription('High tests for the tiers above the regular test cap')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) => s.setName('request').setDescription('Ask for a high test').addStringOption((o) => gamemodeOption(o)))
  .addSubcommand((s) => s.setName('cancel').setDescription('Withdraw your high test request').addStringOption((o) => gamemodeOption(o)))
  .addSubcommand((s) => s.setName('pending').setDescription('List waiting requests (high testers)'));

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'pending') return interaction.reply({ ...EPHEMERAL, ...listPending(interaction) });
  const gamemode = resolveGamemode(interaction.guildId, interaction.options.getString('gamemode', true));
  if (sub === 'cancel') return interaction.reply({ ...EPHEMERAL, ...cancelHighTest(interaction, gamemode) });
  await interaction.deferReply(EPHEMERAL);
  await interaction.editReply(await requestHighTest(interaction, gamemode));
}

export default [{ data, execute }];
