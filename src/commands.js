import about from './core/about.js';
import bugreport from './core/bugreport.js';
import modulesCommand from './core/modules.js';
import { modules } from './modules.js';

// Core commands always work; module commands carry their module so the router can check it.
const entries = [
  ...[...about, ...bugreport, ...modulesCommand].map((c) => ({ ...c, module: null })),
  ...modules.flatMap((m) => m.commands.map((c) => ({ ...c, module: m }))),
];

export const commands = new Map();
for (const c of entries) {
  if (commands.has(c.data.name)) throw new Error(`Two commands are named /${c.data.name}`);
  commands.set(c.data.name, c);
}
