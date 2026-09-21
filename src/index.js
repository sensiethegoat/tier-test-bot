import './env.js';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { modules } from './modules.js';
import { handleInteraction } from './router.js';

// Slash commands, buttons and forms only need the Guilds intent. Support ticket transcripts
// read message text, which needs the privileged Message Content intent (also switch it on
// in the Developer Portal → Bot).
const intents = [GatewayIntentBits.Guilds];
if (process.env.ENABLE_TRANSCRIPTS === 'true') intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
const client = new Client({ intents });

async function runEvent(name, ...args) {
  for (const mod of modules) {
    try {
      await mod.events?.[name]?.(...args);
    } catch (err) {
      console.error(`${mod.id} ${name} handler failed:`, err);
    }
  }
}

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag} · ${c.guilds.cache.size} servers · modules: ${modules.map((m) => m.id).join(', ')}`);
  await runEvent('ready', c);
});

client.on(Events.GuildCreate, (guild) => console.log(`Joined ${guild.name} (${guild.id})`));
// Data is kept when the bot is removed, so re-inviting it restores the server's setup.
client.on(Events.GuildDelete, (guild) => console.log(`Removed from ${guild.name ?? guild.id}`));
client.on(Events.ChannelDelete, (channel) => runEvent('channelDelete', channel));

client.on(Events.InteractionCreate, handleInteraction);

process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));

client.login(process.env.DISCORD_TOKEN);
