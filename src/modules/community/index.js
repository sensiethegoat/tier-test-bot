import './schema.js';
import { run } from '../../db.js';
import announce, { submitAnnouncement } from './announce.js';
import support, { handleComponent as handleSupport, sweepClosed } from './support.js';

export default {
  id: 'community',
  name: 'Community',
  description: 'Announcements (/announce) and support tickets (/support).',
  commands: [...announce, ...support],
  componentScopes: ['announce', 'support'],

  handleComponent(interaction) {
    const [scope, key] = interaction.customId.split(':');
    if (scope === 'announce') return submitAnnouncement(interaction, key);
    return handleSupport(interaction);
  },

  events: {
    ready: sweepClosed,
    channelDelete(channel) {
      run('UPDATE support_tickets SET closed_at = COALESCE(closed_at, ?), deleted = 1 WHERE channel_id = ?', Date.now(), channel.id);
    },
  },
};
