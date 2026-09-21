import { commands } from './commands.js';
import { resolveBugReport, submitBugReport } from './core/bugreport.js';
import { isEnabled, moduleForScope } from './modules.js';
import { EPHEMERAL, UserError } from './util.js';

const disabledError = (mod) =>
  new UserError(`The **${mod.name}** module is turned off on this server. An admin can turn it on with \`/modules enable\`.`);

export async function handleInteraction(interaction) {
  // Bug report "Mark fixed" buttons may be pressed in the developer's DMs.
  const bugButton = interaction.isButton() && interaction.customId.startsWith('bug:resolve:');
  if (!bugButton && !interaction.inCachedGuild()) {
    if (interaction.isRepliable()) await interaction.reply({ ...EPHEMERAL, content: 'This bot only works inside servers.' });
    return;
  }

  try {
    if (bugButton) return await resolveBugReport(interaction, Number(interaction.customId.split(':')[2]));

    if (interaction.isAutocomplete()) {
      const command = commands.get(interaction.commandName);
      if (!command?.module?.autocomplete || !isEnabled(interaction.guildId, command.module)) return await interaction.respond([]);
      return await command.module.autocomplete(interaction);
    }

    if (interaction.isChatInputCommand()) {
      const command = commands.get(interaction.commandName);
      if (!command) return;
      if (command.module && !isEnabled(interaction.guildId, command.module)) throw disabledError(command.module);
      return await command.execute(interaction);
    }

    if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) {
      const [scope, key] = interaction.customId.split(':');
      if (scope === 'bugreport') return await submitBugReport(interaction, key);
      const mod = moduleForScope(scope);
      if (!mod) throw new UserError('This button is no longer available.');
      if (!isEnabled(interaction.guildId, mod)) throw disabledError(mod);
      return await mod.handleComponent(interaction);
    }
  } catch (err) {
    if (!(err instanceof UserError)) console.error(`Error handling ${interaction.commandName ?? interaction.customId}:`, err);
    if (!interaction.isRepliable()) return;
    const content = err instanceof UserError ? `❌ ${err.message}` : '❌ Something went wrong. Please try again.';
    if (interaction.deferred && !interaction.replied) await interaction.editReply({ content, embeds: [], components: [] }).catch(() => {});
    else if (interaction.replied) await interaction.followUp({ ...EPHEMERAL, content }).catch(() => {});
    else await interaction.reply({ ...EPHEMERAL, content }).catch(() => {});
  }
}
