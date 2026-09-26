import assert from 'node:assert/strict';
import { PermissionFlagsBits } from 'discord.js';
import test from 'node:test';
import { asUser, channels, dms, fields, mkChannel, mkGuild, mkInteraction, mkMember, run } from './helpers.mjs';
import { all, one, run as sql } from '../src/db.js';
import { handleInteraction } from '../src/router.js';

// Mojang stand-in: "Notch" is a premium account, nothing else is.
globalThis.fetch = async (url) => {
  const name = decodeURIComponent(String(url).split('/').pop());
  if (name.toLowerCase() === 'notch') return { status: 200, json: async () => ({ id: 'notch-uuid', name: 'Notch' }) };
  if (String(url).startsWith('https://cdn/')) return { json: async () => backupFile };
  return { status: 404 };
};
let backupFile;

const guild = mkGuild('M1', 'Community Server');
const admin = mkMember(guild, 'admin', { admin: true });
const staff = mkMember(guild, 'staff', { roles: ['support-role'] });
const member = mkMember(guild, 'member');
const news = mkChannel('M1', 'news');
const general = mkChannel('M1', 'general');
const logs = mkChannel('M1', 'ticket-logs');

function opts(values = {}) {
  return {
    getSubcommand: () => values.sub,
    getSubcommandGroup: () => values.group ?? null,
    getString: (k) => values[k] ?? null,
    getInteger: (k) => values[k] ?? null,
    getBoolean: (k) => (k in values ? values[k] : null),
    getUser: (k) => values[k] ?? null,
    getRole: (k) => values[k] ?? null,
    getChannel: (k) => values[k] ?? null,
    getAttachment: (k) => values[k] ?? null,
  };
}
const cmd = (name, who, values, extra = {}) =>
  run(handleInteraction, mkInteraction(guild, who, { commandName: name, isChatInputCommand: () => true, options: opts(values), ...extra }));
const button = (customId, who, extra = {}) =>
  run(handleInteraction, mkInteraction(guild, who, { customId, isButton: () => true, ...extra }));
const modal = (customId, who, values, extra = {}) =>
  run(handleInteraction, mkInteraction(guild, who, { customId, isModalSubmit: () => true, fields: fields(values), ...extra }));
const raw = async (name, who, values, extra = {}) => {
  const interaction = mkInteraction(guild, who, { commandName: name, isChatInputCommand: () => true, options: opts(values), ...extra });
  await handleInteraction(interaction);
  return interaction;
};

test('modules can be turned off per server', async () => {
  const list = await raw('modules', admin, { sub: 'list' });
  const description = list.replies[0].embeds[0].data.description;
  for (const id of ['testing', 'community', 'web']) assert.match(description, new RegExp(`\`${id}\``));

  assert.match(await cmd('modules', admin, { sub: 'disable', module: 'community' }), /is off/);
  assert.match(await cmd('announce', admin, { channel: general }), /module is turned off/);
  assert.match(await button('support:open', member), /module is turned off/);
  assert.match(await cmd('modules', admin, { sub: 'disable', module: 'community' }), /already off/);
  assert.match(await cmd('modules', admin, { sub: 'enable', module: 'community' }), /is on/);
  // Testing is unaffected by the Community switch.
  assert.doesNotMatch(await cmd('profile', member, {}), /module is turned off/);
});

test('announcements respect the sender\'s ping permissions', async () => {
  const poster = mkMember(guild, 'poster');
  poster.permissions = { has: (p) => p !== PermissionFlagsBits.MentionEveryone };
  assert.match(await cmd('announce', poster, { channel: general, ping: 'everyone' }), /Mention @everyone/);

  const opened = await raw('announce', admin, { channel: news, ping: 'everyone', color: '#F1C40F' });
  const key = opened.replies[0].modal.split(':')[1];
  assert.match(await modal(`announce:${key}`, admin, { title: 'Event', message: 'Sign up!' }), /Posted/);
  const posted = [...news.messages_.values()].at(-1).payload;
  assert.equal(posted.content, '@everyone');
  assert.deepEqual(posted.allowedMentions, { parse: ['everyone'], roles: [] });
  assert.equal(posted.embeds[0].data.title, 'Event');
  assert.equal(posted.embeds[0].data.color, 0xf1c40f);

  assert.match(await modal(`announce:${key}`, admin, { message: 'again' }), /form expired/);
  assert.match(await cmd('announce', admin, { channel: general, color: 'red' }), /Colors look like/);
});

test('support tickets: open, claim, close', async () => {
  assert.match(await cmd('support', member, { sub: 'setup' }), /need \*\*Manage Server\*\*/);
  await cmd('support', admin, { sub: 'setup', staff_role: { id: 'support-role' }, log_channel: logs });
  assert.match(await cmd('support', admin, { sub: 'panel' }, { channel: general }), /Posted the ticket panel/);

  assert.equal(await button('support:open', member), 'modal support:modal');
  assert.match(await modal('support:modal', member, { subject: 'My rank role is missing' }), /Your ticket is open/);
  const ticket = one("SELECT * FROM support_tickets WHERE user_id = 'member'");
  const channel = channels.get(ticket.channel_id);
  assert.match(channel.name, /^ticket-0001$/);
  assert.match(await button('support:open', member), /already have an open ticket/);

  const inTicket = { channel, channelId: channel.id };
  assert.match(await button('support:claim', member, inTicket), /Only support staff/);
  assert.match(await button('support:claim', staff, inTicket), /will handle this ticket/);
  assert.match(await button('support:claim', staff, inTicket), /already claimed/);
  assert.match(await cmd('support', staff, { sub: 'remove', user: asUser('member') }, inTicket), /cannot remove the person/);

  assert.match(await cmd('support', member, { sub: 'close', reason: 'sorted' }, inTicket), /Closing this ticket/);
  assert.equal(one('SELECT closed_at IS NOT NULL AS closed FROM support_tickets WHERE channel_id = ?', channel.id).closed, 1);
  const log = [...logs.messages_.values()].at(-1).payload.embeds[0].data;
  assert.match(log.title, /Ticket #0001 closed/);
  assert.match(log.fields.find((f) => f.name === 'Reason').value, /sorted/);

  // Numbering continues for the next ticket.
  await modal('support:modal', member, { subject: 'another question' });
  assert.ok(all("SELECT number FROM support_tickets WHERE guild_id = 'M1'").some((t) => t.number === 2));
});

test('cracked accounts follow the server setting', async () => {
  sql("INSERT INTO gamemodes (guild_id, name) VALUES ('M1', 'Sword')");
  const cracked = mkMember(guild, 'cracked');

  // Premium only (default): the cracked form is refused even if someone forges the button.
  assert.match(await modal('verify:modal:cracked', cracked, { ign: 'Steve123' }), /only accepts premium/);

  await cmd('setup', admin, { sub: 'config', accounts: 'both' });
  assert.match(await button('panel:verify', cracked), /Which kind of account/);
  assert.match(await modal('verify:modal:cracked', cracked, { ign: 'notch' }), /premium account name/);
  assert.match(await modal('verify:modal:cracked', cracked, { ign: 'Steve123' }), /Linked \*\*Steve123 \(cracked\)\*\*/);
  // Offline-mode UUID, as an offline server would assign it.
  assert.equal(one("SELECT uuid FROM players WHERE user_id = 'cracked'").uuid, 'de5d1be1767b33968e38ef8fc57dcd23');

  const copycat = mkMember(guild, 'copycat');
  assert.match(await modal('verify:modal:cracked', copycat, { ign: 'STEVE123' }), /already linked/);
});

test('bug reports reach the developer and can be resolved', async () => {
  process.env.BUG_REPORT_CHANNEL_ID = general.id;
  const opened = await raw('bugreport', member, {});
  const key = opened.replies[0].modal.split(':')[1];
  assert.match(await modal(`bugreport:${key}`, member, { title: 'Queue broken', description: 'It errors' }), /sent to the developer/);

  const report = one('SELECT * FROM bug_reports ORDER BY id DESC');
  assert.equal(report.status, 'open');
  const posted = [...general.messages_.values()].at(-1).payload;
  assert.match(posted.embeds[0].data.title, /Bug #\d+: Queue broken/);

  // Only the application owner may resolve it.
  const owner = mkMember(guild, 'owner');
  assert.match(await button(`bug:resolve:${report.id}`, member, { message: { embeds: [posted.embeds[0].toJSON()] } }), /Only the bot developer/);
  await button(`bug:resolve:${report.id}`, owner, { message: { embeds: [posted.embeds[0].toJSON()] } });
  assert.equal(one('SELECT status FROM bug_reports WHERE id = ?', report.id).status, 'resolved');
  assert.match(dms.at(-1)[1], /has been fixed/);
});

test('backups cover one server only and reject bad files', async () => {
  sql("INSERT INTO players (guild_id, user_id, ign, uuid, verified_at) VALUES ('M2', 'other', 'OtherServer', 'u-other', 1)");
  const exported = await raw('backup', admin, { sub: 'export' });
  backupFile = JSON.parse(exported.replies[0].files[0].attachment.toString());
  assert.equal(backupFile.guildId, 'M1');
  assert.ok(Object.values(backupFile.tables).flat().every((row) => row.guild_id === 'M1'));
  assert.ok(!('tickets' in backupFile.tables) && !('bug_reports' in backupFile.tables));

  // A hand-edited row aimed at another server is pulled back to this one.
  backupFile.tables.players.push({ guild_id: 'M2', user_id: 'sneaky', ign: 'Injected', uuid: 'u-sneak', verified_at: 1 });
  const file = { size: 100, url: 'https://cdn/backup.json' };
  assert.match(await cmd('backup', admin, { sub: 'import', file, confirm: false }), /Set `confirm` to True/);
  assert.match(await cmd('backup', admin, { sub: 'import', file, confirm: true }), /Restored/);
  assert.equal(one("SELECT COUNT(*) AS n FROM players WHERE guild_id = 'M2'").n, 1); // untouched
  assert.ok(one("SELECT 1 FROM players WHERE guild_id = 'M1' AND ign = 'Injected'"));

  const before = JSON.stringify(all("SELECT * FROM players WHERE guild_id = 'M1'"));
  backupFile.tables.players.push({ user_id: 'dupe', ign: 'Dupe', uuid: 'u-sneak', verified_at: 1 }); // duplicate UUID
  assert.match(await cmd('backup', admin, { sub: 'import', file, confirm: true }), /invalid or conflicting/);
  assert.equal(JSON.stringify(all("SELECT * FROM players WHERE guild_id = 'M1'")), before, 'a failed import changes nothing');

  backupFile = { format: 'nope' };
  assert.match(await cmd('backup', admin, { sub: 'import', file, confirm: true }), /not a backup/);
});
