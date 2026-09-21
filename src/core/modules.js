import { EmbedBuilder, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { allModules, isEnabled, isGloballyDisabled, setEnabled } from '../modules.js';
import { COLORS, EPHEMERAL, UserError } from '../util.js';

const moduleOption = (o) =>
  o
    .setName('module')
    .setDescription('Module')
    .setRequired(true)
    .addChoices(...allModules.map((m) => ({ name: m.name, value: m.id })));

const data = new SlashCommandBuilder()
  .setName('modules')
  .setDescription('Turn bot features on or off for this server')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) => s.setName('list').setDescription('Show every module and whether it is on'))
  .addSubcommand((s) => s.setName('enable').setDescription('Turn a module on').addStringOption(moduleOption))
  .addSubcommand((s) => s.setName('disable').setDescription('Turn a module off').addStringOption(moduleOption));

async function execute(interaction) {
  const { guildId, options } = interaction;
  const sub = options.getSubcommand();

  if (sub === 'list') {
    const lines = allModules.map((m) => {
      const state = isGloballyDisabled(m.id) ? '⛔ Unavailable (turned off by the bot host)' : isEnabled(guildId, m) ? '🟢 On' : '🔴 Off';
      return `**${m.name}** (\`${m.id}\`) · ${state}\n${m.description}`;
    });
    return interaction.reply({
      ...EPHEMERAL,
      embeds: [new EmbedBuilder().setColor(COLORS.primary).setTitle('Modules').setDescription(lines.join('\n\n'))],
    });
  }

  const mod = allModules.find((m) => m.id === options.getString('module', true));
  if (isGloballyDisabled(mod.id)) throw new UserError(`**${mod.name}** is turned off by whoever hosts this bot.`);
  const enable = sub === 'enable';
  if (isEnabled(guildId, mod) === enable) throw new UserError(`**${mod.name}** is already ${enable ? 'on' : 'off'}.`);
  setEnabled(guildId, mod.id, enable);

  const names = mod.commands.map((c) => `/${c.data.name}`).join(', ');
  await interaction.reply({
    ...EPHEMERAL,
    content: enable
      ? `🟢 **${mod.name}** is on.`
      : `🔴 **${mod.name}** is off. Its commands (${names}) and buttons now refuse to run here; your data is kept.\n` +
        'To hide the commands from the menu too: Server Settings → Integrations → this bot.',
  });
}

export default [{ data, execute }];
