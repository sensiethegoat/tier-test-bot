import { createHash } from 'node:crypto';
import { REST, Routes } from 'discord.js';
import { commands } from '../commands.js';
import { one, run } from '../db.js';

/**
 * Registers every slash command with Discord: globally, or to DEV_GUILD_ID while developing.
 * A hash of the command list is saved, so unchanged commands are not re-sent on every restart.
 */
export async function deployCommands({
  token,
  applicationId,
  guildId = process.env.DEV_GUILD_ID || null,
  force = false,
  rest = new REST().setToken(token),
}) {
  const body = [...commands.values()].map((c) => c.data.toJSON());
  const target = guildId ? `server ${guildId}` : 'globally';
  const hash = createHash('sha256').update(`${target}\n${JSON.stringify(body)}`).digest('hex');
  const key = `commands:${applicationId}`;

  if (!force && one('SELECT value FROM bot_meta WHERE key = ?', key)?.value === hash) {
    return { changed: false, count: body.length, target };
  }
  const route = guildId ? Routes.applicationGuildCommands(applicationId, guildId) : Routes.applicationCommands(applicationId);
  await rest.put(route, { body });
  run('INSERT INTO bot_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', key, hash);
  return { changed: true, count: body.length, target };
}
