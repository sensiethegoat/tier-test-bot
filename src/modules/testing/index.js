import './schema.js';
import { run } from '../../db.js';
import admin from './commands/admin.js';
import autosetup from './commands/autosetup.js';
import queue from './commands/queue.js';
import setup from './commands/setup.js';
import stats from './commands/stats.js';
import ticket from './commands/ticket.js';
import { handleComponent } from './components.js';
import { sweepClosedTickets } from './tickets.js';
import { gamemodes } from './util.js';

export default {
  id: 'testing',
  name: 'Tier Testing',
  description: 'MCTiers-style verification, waitlists, regional queues, test tickets, results and leaderboards.',
  commands: [...autosetup, ...setup, ...queue, ...ticket, ...stats, ...admin],
  // Custom-ID scopes (the part before the first ":") that belong to this module.
  componentScopes: ['panel', 'verify', 'queue', 'ticket'],
  handleComponent,

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'gamemode') return interaction.respond([]);
    const query = focused.value.toLowerCase();
    const matches = gamemodes(interaction.guildId).filter((g) => g.toLowerCase().includes(query));
    await interaction.respond(matches.slice(0, 25).map((g) => ({ name: g, value: g })));
  },

  events: {
    ready: sweepClosedTickets,
    channelDelete(channel) {
      run('UPDATE tickets SET closed_at = COALESCE(closed_at, ?), deleted = 1 WHERE channel_id = ?', Date.now(), channel.id);
      run('UPDATE queues SET message_id = NULL WHERE channel_id = ?', channel.id);
    },
  },
};
