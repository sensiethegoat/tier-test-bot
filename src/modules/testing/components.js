import { enterWaitlist, leaveWaitlist, selectRegion, showStatus, showVerifyModal, startVerify, submitVerifyModal } from './panel.js';
import { joinQueue, leaveQueue, nextPlayer } from './queue.js';
import { handleHighComponent, requestHighTest } from './highTest.js';
import { handleTicketComponent } from './ticketButtons.js';
import { resolveGamemode } from './util.js';
import { EPHEMERAL } from '../../util.js';

// Custom IDs look like `scope:action[:gamemode[:region]]`.
export async function handleComponent(interaction) {
  const [scope, action, rawGamemode, region] = interaction.customId.split(':');

  if (scope === 'panel' && action === 'verify') return startVerify(interaction);
  // For verify:type and verify:modal the third part is the account type, not a gamemode.
  if (scope === 'verify' && action === 'type') return showVerifyModal(interaction, rawGamemode);
  if (scope === 'verify' && action === 'modal') return submitVerifyModal(interaction, rawGamemode ?? 'premium');
  if (scope === 'verify' && action === 'region') return selectRegion(interaction);
  if (scope === 'ticket') return handleTicketComponent(interaction, action, rawGamemode);
  // For high:* the third part is a request id.
  if (scope === 'high') return handleHighComponent(interaction, action, rawGamemode);

  // Everything below may touch roles or edit the queue message, so defer to stay inside the 3s window.
  await interaction.deferReply(EPHEMERAL);
  const gamemode = resolveGamemode(interaction.guildId, rawGamemode);

  if (scope === 'panel') {
    const handler = { waitlist: enterWaitlist, leave: leaveWaitlist, status: showStatus, high: requestHighTest }[action];
    if (handler) return interaction.editReply(await handler(interaction, gamemode));
  }

  if (scope === 'queue') {
    if (action === 'join') {
      const pos = await joinQueue(interaction, gamemode, region);
      return interaction.editReply(`✅ You joined the queue at **#${pos}**. Stay nearby — you will be pinged in your ticket.`);
    }
    if (action === 'leave') {
      await leaveQueue(interaction, gamemode, region);
      return interaction.editReply('You left the queue. You are still on the waitlist.');
    }
    if (action === 'next') {
      const channel = await nextPlayer(interaction, gamemode, region);
      return interaction.editReply(`Opened ${channel}.`);
    }
  }

  await interaction.editReply('This button is no longer supported.');
}
