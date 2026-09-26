import assert from 'node:assert/strict';
import test from 'node:test';
import { asUser, channels, dms, fields, lastText, mkChannel, mkGuild, mkInteraction, mkMember, run } from './helpers.mjs';
import { one, all, run as sql } from '../src/db.js';
import { handleInteraction } from '../src/router.js';

// Mojang stand-in: every name exists except "nobody_xx".
globalThis.fetch = async (url) => {
  const name = decodeURIComponent(String(url).split('/').pop());
  if (name === 'nobody_xx') return { status: 404 };
  return { status: 200, json: async () => ({ id: `uuid-${name.toLowerCase()}`, name }) };
};

const guild = mkGuild('T1', 'Tier Server');
const admin = mkMember(guild, 'admin', { admin: true });
const tester = mkMember(guild, 'tester', { roles: ['tester-role'] });
const highTester = mkMember(guild, 'hightester', { roles: ['tester-role', 'high-role'] });
const queueChannel = mkChannel('T1', 'eu-queue');
const resultsChannel = mkChannel('T1', 'results');
const highChannel = mkChannel('T1', 'high-tests');

const cmd = (name, member, values, extra = {}) =>
  run(handleInteraction, mkInteraction(guild, member, { commandName: name, isChatInputCommand: () => true, options: opts(values), ...extra }));
const button = (customId, member, extra = {}) =>
  run(handleInteraction, mkInteraction(guild, member, { customId, isButton: () => true, ...extra }));
const modal = (customId, member, values, extra = {}) =>
  run(handleInteraction, mkInteraction(guild, member, { customId, isModalSubmit: () => true, fields: fields(values), ...extra }));
const select = (customId, member, values, extra = {}) =>
  run(handleInteraction, mkInteraction(guild, member, { customId, isStringSelectMenu: () => true, values, ...extra }));

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

async function verify(member, ign, region = 'EU') {
  await modal('verify:modal:premium', member, { ign });
  await select('verify:region', member, [region]);
}

/** Verify → waitlist → queue → ticket, returning the ticket channel. */
async function openTicket(member, ign) {
  if (!one('SELECT 1 FROM players WHERE user_id = ?', member.id)) await verify(member, ign);
  await button('panel:waitlist:Sword', member);
  await cmd('queue', tester, { sub: 'open', gamemode: 'Sword', region: 'EU' });
  await button('queue:join:Sword:EU', member);
  await button('queue:next:Sword:EU', tester);
  const ticket = one('SELECT channel_id FROM tickets WHERE user_id = ? AND closed_at IS NULL', member.id);
  return channels.get(ticket.channel_id);
}

test('setup creates gamemodes, queues and config', async () => {
  await cmd('setup', admin, { group: 'gamemode', sub: 'add', name: 'Sword' });
  await cmd('setup', admin, {
    sub: 'config',
    tester_role: { id: 'tester-role' },
    results_channel: resultsChannel,
    cooldown_days: 30,
  });
  await cmd('setup', admin, { sub: 'queue', gamemode: 'Sword', region: 'EU', channel: queueChannel });
  assert.equal(one('SELECT tester_role_id FROM guild_config WHERE guild_id = ?', 'T1').tester_role_id, 'tester-role');
  assert.ok(one("SELECT 1 FROM queues WHERE guild_id = 'T1' AND region = 'EU'"));
});

test('verification rejects unknown and duplicate accounts', async () => {
  const player = mkMember(guild, 'alice');
  assert.match(await modal('verify:modal:premium', player, { ign: 'nobody_xx' }), /No premium Java/);
  await verify(player, 'AliceMC');
  assert.equal(one("SELECT ign FROM players WHERE user_id = 'alice'").ign, 'AliceMC');

  const thief = mkMember(guild, 'thief');
  assert.match(await modal('verify:modal:premium', thief, { ign: 'alicemc' }), /already linked/);
});

test('a player queues and a tester opens a ticket', async () => {
  const ticket = await openTicket(guild.members.cache.get('alice'), 'AliceMC');
  assert.match(ticket.name, /^test-alicemc$/);
  assert.equal(one('SELECT high FROM tickets WHERE channel_id = ?', ticket.id).high, 0);
});

test('only the tester can finish, and a score is saved', async () => {
  const player = guild.members.cache.get('alice');
  const ticket = channels.get(one("SELECT channel_id FROM tickets WHERE user_id = 'alice' AND closed_at IS NULL").channel_id);
  const inTicket = { channel: ticket, channelId: ticket.id };
  assert.match(await button('ticket:finish', player, inTicket), /Only the assigned tester/);
  assert.match(await cmd('result', tester, { tier: 'HT3', score: 'three' }, inTicket), /Scores look like/);
  assert.match(await cmd('result', tester, { tier: 'HT3', score: '3 - 1' }, inTicket), /Result saved/);

  const saved = one("SELECT new_tier, score, high FROM tests WHERE user_id = 'alice'");
  assert.deepEqual({ ...saved }, { new_tier: 'HT3', score: '3-1', high: 0 });
  assert.equal(one("SELECT tier FROM ranks WHERE user_id = 'alice'").tier, 'HT3');
  // The ticket is closed, so a second result cannot be recorded.
  assert.match(await cmd('result', tester, { tier: 'LT1' }, inTicket), /not an open test ticket/);
});

test('cooldown blocks a new waitlist entry', async () => {
  assert.match(await button('panel:waitlist:Sword', guild.members.cache.get('alice')), /tested in \*\*Sword\*\* recently/);
});

test('high testing caps regular tests and runs its own flow', async () => {
  await cmd('setup', admin, { sub: 'config', high_test_channel: highChannel, high_tester_role: { id: 'high-role' } });

  const bob = mkMember(guild, 'bob');
  const ticket = await openTicket(bob, 'BobMC');
  const inTicket = { channel: ticket, channelId: ticket.id };
  assert.match(await cmd('result', tester, { tier: 'HT2' }, inTicket), /Regular tests go up to \*\*HT3\*\*/);
  await cmd('result', tester, { tier: 'HT3' }, inTicket);

  // Reaching the cap earns a request even though the regular cooldown is running.
  assert.match(await button('panel:high:Sword', bob), /request was sent/);
  const request = one("SELECT * FROM high_requests WHERE user_id = 'bob'");
  assert.equal(request.status, 'pending');
  assert.match(await button(`high:accept:${request.id}`, tester), /Only high testers/);
  assert.match(await button(`high:accept:${request.id}`, highTester), /Opened/);

  const high = channels.get(one("SELECT channel_id FROM tickets WHERE user_id = 'bob' AND closed_at IS NULL").channel_id);
  assert.match(high.name, /^high-bobmc$/);
  assert.match(await cmd('result', highTester, { tier: 'LT1' }, { channel: high, channelId: high.id }), /Result saved/);
  assert.equal(one("SELECT high FROM tests WHERE user_id = 'bob' ORDER BY id DESC").high, 1);
  assert.equal(one("SELECT tier FROM ranks WHERE user_id = 'bob'").tier, 'LT1');
});

test('high test requests can be denied, with a DM and a cool-off', async () => {
  const carl = mkMember(guild, 'carl');
  await verify(carl, 'CarlMC');
  await cmd('admin', admin, { sub: 'settier', user: asUser('carl'), gamemode: 'Sword', tier: 'HT3' });
  await cmd('hightest', carl, { sub: 'request', gamemode: 'Sword' });
  const request = one("SELECT * FROM high_requests WHERE user_id = 'carl'");

  assert.equal(await button(`high:deny:${request.id}`, highTester), `modal high:denied:${request.id}`);
  assert.match(await modal(`high:denied:${request.id}`, highTester, { reason: 'Practice more' }), /Request denied/);
  assert.equal(one('SELECT status FROM high_requests WHERE id = ?', request.id).status, 'denied');
  assert.match(dms.at(-1)[1], /Practice more/);
  assert.match(await cmd('hightest', carl, { sub: 'request', gamemode: 'Sword' }), /was denied. You can ask again/);
});

const tierSetting = async () => {
  const interaction = await interactionFor('setup', admin, { sub: 'view' });
  return interaction.replies[0].embeds[0].data.fields.find((f) => f.name === 'Tiers').value;
};

test('mid tiers can be switched on, and off only when unused', async () => {
  await cmd('setup', admin, { sub: 'config', tiers: 15 });
  assert.match(await tierSetting(), /^15 · HT1–LT5$/);
  assert.match(await cmd('admin', admin, { sub: 'settier', user: asUser('carl'), gamemode: 'Sword', tier: 'MT2' }), /MT2/);
  assert.match(await cmd('setup', admin, { sub: 'config', tiers: 10 }), /use mid tiers/);

  // The peak counts too, so it has to be cleared as well.
  await cmd('admin', admin, { sub: 'settier', user: asUser('carl'), gamemode: 'Sword', tier: 'HT3', set_peak: true });
  await cmd('setup', admin, { sub: 'config', tiers: 10 });
  assert.match(await tierSetting(), /^10 · HT1–LT5$/);
  // A tier outside the server's scale is refused.
  assert.match(await cmd('admin', admin, { sub: 'settier', user: asUser('carl'), gamemode: 'Sword', tier: 'MT2' }), /uses 10 tiers/);
});

test('profile shows the overall badge and a position', async () => {
  const reply = await cmd('profile', guild.members.cache.get('bob'), {});
  assert.match(reply, /^\*\*[HML]T[1-5]\*\* · \d+ points/); // overall badge, points, title
  assert.match(reply, /points/);
  const embed = (await interactionFor('profile', guild.members.cache.get('bob'))).replies[0].embeds[0].data;
  const sword = embed.fields.find((f) => f.name === 'Sword');
  assert.match(sword.value, /#\d/); // rank position inside the gamemode
});

async function interactionFor(name, member, values = {}) {
  const interaction = mkInteraction(guild, member, { commandName: name, isChatInputCommand: () => true, options: opts(values) });
  await handleInteraction(interaction);
  return interaction;
}

test('retired players leave the rankings and cannot test', async () => {
  assert.match(await cmd('admin', admin, { sub: 'retire', user: asUser('bob') }), /retired/);
  assert.equal(one("SELECT retired FROM players WHERE user_id = 'bob'").retired, 1);
  assert.match(await button('panel:waitlist:Sword', guild.members.cache.get('bob')), /profile is retired/);

  const visible = await interactionFor('leaderboard', admin, {});
  assert.doesNotMatch(visible.replies[0].embeds[0].data.description, /BobMC/);
  const withRetired = await interactionFor('leaderboard', admin, { include_retired: true });
  assert.match(withRetired.replies[0].embeds[0].data.description, /BobMC/);

  assert.match(await cmd('admin', admin, { sub: 'unretire', user: asUser('bob') }), /back in the rankings/);
  assert.equal(one("SELECT retired FROM players WHERE user_id = 'bob'").retired, 0);
});

test('gamemode presets and icons', async () => {
  assert.match(await cmd('setup', admin, { group: 'gamemode', sub: 'preset', preset: 'mcpvp' }), /Vanilla/);
  assert.ok(all("SELECT name FROM gamemodes WHERE guild_id = 'T1'").length > 5);
  assert.match(await cmd('setup', admin, { group: 'gamemode', sub: 'icon', gamemode: 'Sword', emoji: '🗡️' }), /🗡️/);
  assert.equal(one("SELECT icon FROM gamemodes WHERE guild_id = 'T1' AND name = 'Sword'").icon, '🗡️');
});

test('a season archives tiers and clears the board', async () => {
  const before = all("SELECT * FROM ranks WHERE guild_id = 'T1'").length;
  assert.ok(before > 0);
  assert.match(await cmd('admin', admin, { group: 'season', sub: 'end', name: 'Beta' }), /archived/);
  assert.equal(all("SELECT * FROM ranks WHERE guild_id = 'T1'").length, 0);
  assert.equal(all("SELECT * FROM season_ranks WHERE guild_id = 'T1'").length, before);
  assert.ok(one("SELECT season_id FROM tests WHERE guild_id = 'T1' LIMIT 1").season_id);
  assert.match(await cmd('admin', admin, { group: 'season', sub: 'list' }), /Beta/);
});

test('tier autocomplete follows the server scale', async () => {
  const interaction = mkInteraction(guild, tester, {
    commandName: 'result',
    isAutocomplete: () => true,
    options: { getFocused: () => ({ name: 'tier', value: '' }) },
  });
  await handleInteraction(interaction);
  const values = interaction.replies[0].choices.map((c) => c.value);
  assert.equal(values.length, 10);
  assert.ok(!values.includes('MT1'));
});

test('restrictions and transfers', async () => {
  const dave = mkMember(guild, 'dave');
  await verify(dave, 'DaveMC');
  await cmd('admin', admin, { sub: 'restrict', user: asUser('dave'), days: 7, reason: 'cheating' });
  assert.match(await button('panel:waitlist:Sword', dave), /restricted from testing/);

  const newAccount = mkMember(guild, 'dave2');
  assert.match(await cmd('admin', admin, { sub: 'transfer', from: asUser('dave'), to: asUser('dave2') }), /Moved/);
  assert.equal(one("SELECT user_id FROM players WHERE ign = 'DaveMC'").user_id, 'dave2');
  // The restriction follows the account, so a transfer is no escape.
  assert.match(await button('panel:waitlist:Sword', newAccount), /restricted from testing/);
});

test('autosetup builds the layout once and is safe to repeat', async () => {
  const fresh = mkGuild('T2', 'Fresh Server');
  const owner = mkMember(fresh, 'owner', { admin: true });
  const setup = (values) =>
    run(
      handleInteraction,
      mkInteraction(fresh, owner, { commandName: 'autosetup', isChatInputCommand: () => true, options: opts(values) }),
    );

  assert.match(await setup({ gamemode: 'Sword', regions: 'EU,MARS' }), /Regions must be from/);
  assert.match(await setup({ gamemode: 'Sword', regions: 'eu, na' }), /\*\*Queues:\*\* #eu-queue .* #na-queue/);

  const names = [...channels.values()].filter((c) => c.guildId === 'T2').map((c) => c.name);
  for (const name of ['🏆 Tier Testing', '⚔️ Test Tickets', 'request-test', 'results', 'test-logs', 'high-tests', 'eu-queue', 'na-queue']) {
    assert.ok(names.includes(name), `created ${name}`);
  }
  assert.ok(fresh.roles.cache.find((r) => r.name === 'Tester'));
  assert.ok(fresh.roles.cache.find((r) => r.name === 'High Tester'));
  assert.equal(fresh.roles.cache.filter((r) => r.name.startsWith('Sword ')).length, 10);
  assert.equal(all("SELECT * FROM queues WHERE guild_id = 'T2'").length, 2);

  const channelCount = names.length;
  const roleCount = fresh.roles.cache.size;
  await setup({ gamemode: 'sword' }); // same gamemode again: nothing new, one panel only
  assert.equal([...channels.values()].filter((c) => c.guildId === 'T2').length, channelCount);
  assert.equal(fresh.roles.cache.size, roleCount);
  const panels = [...[...channels.values()].find((c) => c.guildId === 'T2' && c.name === 'request-test').messages_.values()];
  assert.equal(panels.length, 1);
});
