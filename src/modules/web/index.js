import './schema.js';
import { run } from '../../db.js';
import { setResultLinker } from '../../links.js';
import website, { siteUrl } from './command.js';
import { siteByGuild } from './data.js';
import { startWebServer } from './server.js';

// Result embeds get a "View on website" button when the server is published and the host set WEB_BASE_URL.
setResultLinker((guildId, testId) => {
  const site = siteByGuild(guildId);
  return site ? siteUrl(site.slug, 'results', String(testId)) : null;
});

export default {
  id: 'web',
  name: 'Website',
  description: 'Public leaderboard, player pages and results. Private until an admin runs /website publish.',
  commands: [...website],
  componentScopes: [],

  events: {
    ready(client) {
      // With sharding, only shard 0 serves the site; it reads every server's data from the shared database.
      if (client.shard && !client.shard.ids.includes(0)) return;
      startWebServer();
      // Keep published names and icons current.
      for (const guild of client.guilds.cache.values()) {
        run('UPDATE web_config SET guild_name = ?, icon_url = ? WHERE guild_id = ?', guild.name, guild.iconURL({ size: 64 }), guild.id);
      }
    },
  },
};
