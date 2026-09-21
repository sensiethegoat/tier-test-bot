import './env.js';
import { REST, Routes } from 'discord.js';
import { deployCommands } from './core/deploy.js';

// The bot registers its commands by itself on startup. This script forces a re-register
// without starting the bot (e.g. if commands were deleted in the Developer Portal).
const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error('Set DISCORD_TOKEN in .env');

const rest = new REST().setToken(token);
const applicationId = process.env.CLIENT_ID || (await rest.get(Routes.currentApplication())).id;
const { count, target } = await deployCommands({ token, applicationId, force: true, rest });
console.log(`Registered ${count} commands ${target}.`);
