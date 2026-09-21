import './env.js';
import { REST, Routes } from 'discord.js';
import { commands } from './commands.js';

// Global commands work in every server the bot joins. DEV_GUILD_ID registers them to one
// server instead, which updates instantly while you are developing.
const { DISCORD_TOKEN, CLIENT_ID, DEV_GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !CLIENT_ID) throw new Error('Set DISCORD_TOKEN and CLIENT_ID in .env');

const body = [...commands.values()].map((c) => c.data.toJSON());
const rest = new REST().setToken(DISCORD_TOKEN);
const route = DEV_GUILD_ID ? Routes.applicationGuildCommands(CLIENT_ID, DEV_GUILD_ID) : Routes.applicationCommands(CLIENT_ID);

await rest.put(route, { body });
console.log(`Registered ${body.length} commands ${DEV_GUILD_ID ? `to guild ${DEV_GUILD_ID}` : 'globally'}.`);
