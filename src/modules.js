import { one, run } from './db.js';
import community from './modules/community/index.js';
import testing from './modules/testing/index.js';
import web from './modules/web/index.js';

/*
 * A module is a plain object:
 *   id, name, description   identity shown in /modules
 *   commands                [{ data: SlashCommandBuilder, execute(interaction) }]
 *   componentScopes         custom-ID prefixes (before the first ":") its buttons/forms use
 *   handleComponent(i)      handles those buttons, select menus and forms
 *   autocomplete(i)         optional, for its commands' autocomplete options
 *   events                  optional { ready(client), channelDelete(channel) }
 *   defaultEnabled          optional, defaults to true
 *
 * Server admins switch modules on or off with /modules. The bot host can remove a module
 * everywhere with DISABLED_MODULES in .env; its commands are then not registered at all.
 */
export const allModules = [testing, community, web];

const globallyOff = new Set(
  (process.env.DISABLED_MODULES ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);

export const isGloballyDisabled = (id) => globallyOff.has(id);
export const modules = allModules.filter((m) => !globallyOff.has(m.id));

export function isEnabled(guildId, mod) {
  const row = one('SELECT enabled FROM guild_modules WHERE guild_id = ? AND module = ?', guildId, mod.id);
  return row ? Boolean(row.enabled) : (mod.defaultEnabled ?? true);
}

export function setEnabled(guildId, id, enabled) {
  run(
    `INSERT INTO guild_modules (guild_id, module, enabled) VALUES (?, ?, ?)
     ON CONFLICT (guild_id, module) DO UPDATE SET enabled = excluded.enabled`,
    guildId, id, enabled ? 1 : 0,
  );
}

export const moduleForScope = (scope) => modules.find((m) => m.componentScopes.includes(scope));
