import { AttachmentBuilder, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { db } from '../db.js';
import { EPHEMERAL, UserError } from '../util.js';

const FORMAT = 'tier-test-bot-backup';
const VERSION = 1;
const MAX_BYTES = 10 * 1024 * 1024;
// Live state (open tickets, queue spots) and the developer's bug reports are never backed up.
const SKIP = new Set(['bug_reports', 'tickets', 'support_tickets', 'queue_entries', 'queue_testers']);

/** Every table with a guild_id column, and its columns. Found at runtime so new modules are included. */
function guildTables() {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map(({ name }) => ({ name, columns: db.prepare(`PRAGMA table_info("${name}")`).all() }))
    .filter((t) => !SKIP.has(t.name) && t.columns.some((c) => c.name === 'guild_id'));
}

// An INTEGER PRIMARY KEY is a global row id: leave it out so imported rows get fresh ids.
const rowIdColumn = (columns) => columns.find((c) => c.pk === 1 && c.type.toUpperCase() === 'INTEGER')?.name;

const data = new SlashCommandBuilder()
  .setName('backup')
  .setDescription("Export or restore this server's bot data")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) => s.setName('export').setDescription("Download this server's data as a JSON file"))
  .addSubcommand((s) =>
    s
      .setName('import')
      .setDescription("Replace this server's data with a backup file")
      .addAttachmentOption((o) => o.setName('file').setDescription('A backup made with /backup export').setRequired(true))
      .addBooleanOption((o) => o.setName('confirm').setDescription("True = replace this server's current data").setRequired(true))
      .addBooleanOption((o) => o.setName('from_other_server').setDescription('Allow a backup made in a different server')),
  );

async function execute(interaction) {
  if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
    throw new UserError('Only administrators can use backups.');
  }
  return interaction.options.getSubcommand() === 'export' ? exportBackup(interaction) : importBackup(interaction);
}

async function exportBackup(interaction) {
  const { guild } = interaction;
  const tables = {};
  for (const t of guildTables()) tables[t.name] = db.prepare(`SELECT * FROM "${t.name}" WHERE guild_id = ?`).all(guild.id);
  const backup = { format: FORMAT, version: VERSION, guildId: guild.id, guildName: guild.name, exportedAt: new Date().toISOString(), tables };

  const count = Object.values(tables).reduce((n, rows) => n + rows.length, 0);
  const file = new AttachmentBuilder(Buffer.from(JSON.stringify(backup, null, 2)), {
    name: `backup-${guild.id}-${new Date().toISOString().slice(0, 10)}.json`,
  });
  await interaction.reply({
    ...EPHEMERAL,
    content: `Here's this server's data (${count} rows). Keep it private: it contains linked accounts and staff notes.`,
    files: [file],
  });
}

async function importBackup(interaction) {
  const { guild, options } = interaction;
  if (!options.getBoolean('confirm', true)) throw new UserError('Set `confirm` to True to replace this server\'s data.');
  const file = options.getAttachment('file', true);
  if (file.size > MAX_BYTES) throw new UserError('That file is too large.');
  await interaction.deferReply(EPHEMERAL);

  let backup;
  try {
    const res = await fetch(file.url, { signal: AbortSignal.timeout(15_000) });
    backup = await res.json();
  } catch {
    throw new UserError('That file is not a valid backup.');
  }
  if (backup?.format !== FORMAT || backup.version !== VERSION || typeof backup.tables !== 'object' || !backup.tables) {
    throw new UserError('That file is not a backup from `/backup export`.');
  }
  if (backup.guildId !== guild.id && !options.getBoolean('from_other_server')) {
    throw new UserError(
      `That backup is from another server (${backup.guildName ?? backup.guildId}). Set \`from_other_server\` to True to import it anyway; ` +
        'channels and roles from the other server will need to be set up again.',
    );
  }

  // Only known tables and columns are written, and every row is forced to this server's guild_id,
  // so a hand-edited file can't reach other servers' data.
  let imported = 0;
  const tables = guildTables().filter((t) => Array.isArray(backup.tables[t.name]));
  try {
    db.transaction(() => {
      for (const t of tables) {
        const skip = rowIdColumn(t.columns);
        const known = t.columns.map((c) => c.name).filter((c) => c !== skip && c !== 'guild_id');
        db.prepare(`DELETE FROM "${t.name}" WHERE guild_id = ?`).run(guild.id);
        for (const row of backup.tables[t.name]) {
          if (!row || typeof row !== 'object') continue;
          // Columns the row doesn't have (e.g. added in a later version) keep their defaults.
          const columns = ['guild_id', ...known.filter((c) => c in row)];
          db.prepare(
            `INSERT INTO "${t.name}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
          ).run(...columns.map((c) => (c === 'guild_id' ? guild.id : row[c])));
          imported++;
        }
      }
      // Queues come back closed; testers reopen them.
      if (tables.some((t) => t.name === 'queues')) db.prepare('UPDATE queues SET open = 0 WHERE guild_id = ?').run(guild.id);
    })();
  } catch (err) {
    console.error(`Backup import failed in ${guild.id}:`, err.message);
    throw new UserError('That backup has invalid or conflicting data, so nothing was changed.');
  }

  await interaction.editReply(
    `✅ Restored ${imported} rows across ${tables.length} tables. Queues are closed; testers can reopen them. ` +
      'If you use the testing module, run `/setup view` to check the channels and roles still exist.',
  );
}

export default [{ data, execute }];
