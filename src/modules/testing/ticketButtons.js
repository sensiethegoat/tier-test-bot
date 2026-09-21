import {
  ActionRowBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { EPHEMERAL, UserError } from '../../util.js';
import { recordResult } from './results.js';
import { closeTicket, requireTicket } from './tickets.js';
import { allowedTiers, getConfig } from './util.js';

// Finish Test → pick a tier → form for score and notes → result saved.
// Cancel Test → ticket closed without a result or cooldown.
export async function handleTicketComponent(interaction, action, arg) {
  const ticket = requireTicket(interaction);

  if (action === 'finish') {
    const select = new StringSelectMenuBuilder()
      .setCustomId('ticket:tier')
      .setPlaceholder('Tier earned')
      .addOptions(allowedTiers(getConfig(interaction.guildId), ticket).map((t) => ({ label: t, value: t })));
    return interaction.reply({
      ...EPHEMERAL,
      content: `Which tier did <@${ticket.user_id}> earn in **${ticket.gamemode}**?`,
      components: [new ActionRowBuilder().addComponents(select)],
    });
  }

  if (action === 'tier') {
    const tier = interaction.values[0];
    return interaction.showModal(
      new ModalBuilder()
        .setCustomId(`ticket:result:${tier}`)
        .setTitle(`Result: ${tier} in ${ticket.gamemode}`.slice(0, 45))
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('score').setLabel('Score (optional), e.g. 3-1').setStyle(TextInputStyle.Short).setMaxLength(7).setRequired(false),
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('notes').setLabel('Notes (optional, staff log only)').setStyle(TextInputStyle.Paragraph).setMaxLength(500).setRequired(false),
          ),
        ),
    );
  }

  if (action === 'result') {
    await interaction.deferReply();
    const { embed } = await recordResult(interaction, ticket, {
      tier: arg,
      score: interaction.fields.getTextInputValue('score'),
      notes: interaction.fields.getTextInputValue('notes'),
    });
    return interaction.editReply({ content: 'Result saved. This ticket closes in 10 seconds.', embeds: [embed] });
  }

  if (action === 'cancel') {
    await closeTicket(interaction.channel, ticket, interaction.user.id, 'Cancelled by the tester');
    return interaction.reply('Test cancelled. No result or cooldown was recorded. This ticket closes in 10 seconds.');
  }

  throw new UserError('This button is no longer supported.');
}
