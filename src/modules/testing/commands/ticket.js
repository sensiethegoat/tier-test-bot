import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { recordResult } from '../results.js';
import { closeTicket, requireTicket } from '../tickets.js';
import { tierOption } from '../util.js';
import { EPHEMERAL, UserError } from '../../../util.js';

const result = new SlashCommandBuilder()
  .setName('result')
  .setDescription('Submit the result of this test and close the ticket')
  .setContexts(InteractionContextType.Guild)
  .addStringOption((o) => tierOption(o))
  .addStringOption((o) => o.setName('score').setDescription('Match score, e.g. 3-1').setMaxLength(7))
  .addStringOption((o) => o.setName('notes').setDescription('Optional notes for the log').setMaxLength(500));

async function executeResult(interaction) {
  const ticket = requireTicket(interaction);
  const { options } = interaction;
  await interaction.deferReply();
  const { embed } = await recordResult(interaction, ticket, {
    tier: options.getString('tier', true),
    score: options.getString('score'),
    notes: options.getString('notes'),
  });
  await interaction.editReply({ content: 'Result saved. This ticket closes in 10 seconds.', embeds: [embed] });
}

const close = new SlashCommandBuilder()
  .setName('close')
  .setDescription('Close this ticket without a result')
  .setContexts(InteractionContextType.Guild)
  .addStringOption((o) => o.setName('reason').setDescription('Why the test did not happen').setMaxLength(300));

async function executeClose(interaction) {
  const ticket = requireTicket(interaction);
  const reason = interaction.options.getString('reason');
  await interaction.reply('Closing this ticket in 10 seconds. No result was recorded and no cooldown applies.');
  await closeTicket(interaction.channel, ticket, interaction.user.id, reason);
}

const ticket = new SlashCommandBuilder()
  .setName('ticket')
  .setDescription('Manage the current test ticket')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) =>
    s
      .setName('add')
      .setDescription('Let someone view and talk in this ticket')
      .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('spectate')
      .setDescription('Let someone view this ticket without talking')
      .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('remove')
      .setDescription('Remove someone from this ticket')
      .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('rename')
      .setDescription('Rename this ticket (Discord allows 2 renames per 10 minutes)')
      .addStringOption((o) => o.setName('name').setDescription('New channel name').setRequired(true).setMaxLength(90)),
  );

async function executeTicket(interaction) {
  const t = requireTicket(interaction);
  const { channel, options } = interaction;
  const sub = options.getSubcommand();

  if (sub === 'rename') {
    await interaction.deferReply(EPHEMERAL);
    await channel.setName(options.getString('name', true));
    return interaction.editReply(`Renamed to ${channel}.`);
  }

  const target = options.getUser('user', true);
  if (sub === 'remove') {
    if (target.id === t.user_id || target.id === t.tester_id) throw new UserError('You cannot remove the player or tester.');
    await channel.permissionOverwrites.delete(target.id);
    return interaction.reply(`Removed ${target}.`);
  }

  const talk = sub === 'add';
  await channel.permissionOverwrites.edit(target.id, {
    ViewChannel: true,
    ReadMessageHistory: true,
    SendMessages: talk,
    AddReactions: talk,
  });
  return interaction.reply(talk ? `Added ${target}.` : `${target} is now spectating.`);
}

export default [
  { data: result, execute: executeResult },
  { data: close, execute: executeClose },
  { data: ticket, execute: executeTicket },
];
