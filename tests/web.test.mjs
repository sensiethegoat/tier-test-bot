import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import './helpers.mjs'; // points DATABASE_PATH at a temporary file
import { one, run as sql } from '../src/db.js';
import '../src/modules/testing/schema.js'; // the website reads the testing module's tables
import '../src/modules/web/schema.js';

process.env.WEB_PORT = '38512';
process.env.WEB_HOST = '127.0.0.1';
process.env.WEB_BASE_URL = 'https://tiers.example.com';

await import('../src/modules/web/index.js'); // registers the result-link builder
const { startWebServer } = await import('../src/modules/web/server.js');
const { resultLink } = await import('../src/links.js');

const BASE = 'http://127.0.0.1:38512';
let server;

function seed(guildId, userId, ign, tier, peak, { cracked = 0, retired = 0 } = {}) {
  sql(
    'INSERT INTO players (guild_id, user_id, ign, uuid, region, verified_at, cracked, retired) VALUES (?, ?, ?, ?, ?, 1, ?, ?)',
    guildId, userId, ign, `mc-${ign}`, 'EU', cracked, retired,
  );
  sql("INSERT INTO ranks VALUES (?, ?, 'Sword', ?, ?, 5)", guildId, userId, tier, peak);
  sql(
    `INSERT INTO tests (guild_id, user_id, tester_id, gamemode, region, ign, prev_tier, new_tier, score, notes, created_at, high)
     VALUES (?, ?, 'tester-1', 'Sword', 'EU', ?, NULL, ?, '3-1', 'PRIVATE NOTE', 1790000000000, 0)`,
    guildId, userId, ign, tier,
  );
}

before(async () => {
  sql("INSERT INTO gamemodes (guild_id, name, icon) VALUES ('W1', 'Sword', '⚔️'), ('W1', 'Axe', NULL), ('W2', 'Sword', NULL)");
  sql("INSERT INTO guild_config (guild_id, tier_set) VALUES ('W1', 10), ('W2', 10)");
  seed('W1', '111111111111111111', 'AliceMC', 'HT2', 'HT1');
  seed('W1', '222', 'Steve_1', 'LT3', 'LT3', { cracked: 1 });
  seed('W1', '333', 'OldTimer', 'HT1', 'HT1', { retired: 1 });
  seed('W2', '444', 'HiddenPlayer', 'HT1', 'HT1');
  sql("INSERT INTO web_config VALUES ('W1', 'sword', '<script>x</script> Tiers', NULL, 1), ('W2', 'hidden', 'Hidden', NULL, 0)");
  server = startWebServer();
  await new Promise((resolve) => server.once('listening', resolve));
});

after(() => server?.close());

const get = async (path, options) => {
  const res = await fetch(BASE + path, { redirect: 'manual', ...options });
  return { status: res.status, headers: res.headers, body: await res.text() };
};
const json = async (path) => JSON.parse((await get(path)).body);

test('landing page lists only published servers', async () => {
  const { status, body } = await get('/');
  assert.equal(status, 200);
  assert.match(body, /href="\/sword"/);
  assert.doesNotMatch(body, /href="\/hidden"/);
  assert.match(body, /&lt;script&gt;/); // the server name is escaped
  assert.doesNotMatch(body, /<script>x<\/script>/);
});

test('unpublished servers and unknown slugs are hidden', async () => {
  assert.equal((await get('/hidden')).status, 404);
  assert.equal((await get('/nope')).status, 404);
  assert.equal((await get('/api/hidden/leaderboard')).status, 404);
});

test('leaderboards hide retired players unless asked', async () => {
  const overall = await get('/sword');
  assert.match(overall.body, /AliceMC/);
  assert.doesNotMatch(overall.body, /OldTimer/);
  assert.match(overall.body, /Include retired players/);

  const withRetired = await get('/sword?retired=1');
  assert.match(withRetired.body, /OldTimer/);

  const board = await json('/api/sword/leaderboard?mode=Sword');
  assert.deepEqual(board.players.map((p) => p.ign), ['AliceMC', 'Steve_1']);
  assert.equal(board.players[0].peak, 'HT1');
});

test('overall ranking uses points from peak tiers', async () => {
  const { players } = await json('/api/sword/leaderboard');
  assert.equal(players[0].ign, 'AliceMC');
  assert.equal(players[0].points, 60); // peak HT1 on the 10-tier scale
  assert.equal(players[0].overall, 'HT4'); // 60 points
  assert.equal(players[1].points, 6);
});

test('player pages show tiers, position and history without private data', async () => {
  const page = await get('/sword/player/alicemc');
  assert.equal(page.status, 200);
  assert.match(page.body, /⚔️ Sword/); // gamemode icon
  assert.match(page.body, /#1/); // position in the gamemode
  assert.match(page.body, /3-1/); // score
  assert.doesNotMatch(page.body, /111111111111111111|PRIVATE NOTE|tester-1/);

  const api = await json('/api/sword/players/AliceMC');
  assert.equal(api.tiers.Sword.position, 1);
  assert.equal(api.retired, false);
  assert.doesNotMatch(JSON.stringify(api), /111111111111111111|PRIVATE NOTE|tester-1|user_id/);
  assert.equal((await get('/sword/player/Nobody')).status, 404);
});

test('results are scoped to their server', async () => {
  const mine = one("SELECT id FROM tests WHERE guild_id = 'W1' AND ign = 'AliceMC'").id;
  const other = one("SELECT id FROM tests WHERE guild_id = 'W2'").id;
  assert.equal((await get(`/sword/results/${mine}`)).status, 200);
  assert.equal((await get(`/sword/results/${other}`)).status, 404);
  assert.equal(resultLink('W1', mine), `https://tiers.example.com/sword/results/${mine}`);
  assert.equal(resultLink('W2', other), null); // not published
});

test('season pages appear once a season is archived', async () => {
  assert.doesNotMatch((await get('/sword')).body, /Seasons</);
  sql("INSERT INTO seasons (id, guild_id, name, ended_at) VALUES (7, 'W1', 'Beta', 1790000000000)");
  sql("INSERT INTO season_ranks VALUES (7, 'W1', '111111111111111111', 'AliceMC', 'Sword', 'HT2', 'HT1')");

  assert.match((await get('/sword')).body, /Seasons</);
  const list = await get('/sword/seasons');
  assert.match(list.body, /Beta/);
  const page = await get('/sword/seasons/7?mode=Sword');
  assert.match(page.body, /AliceMC/);
  assert.equal((await get('/sword/seasons/99')).status, 404);
  assert.equal((await json('/api/sword/seasons')).seasons[0].name, 'Beta');
});

test('a disabled Website module hides the pages', async () => {
  sql("INSERT INTO guild_modules VALUES ('W1', 'web', 0)");
  assert.equal((await get('/sword')).status, 404);
  assert.equal(resultLink('W1', 1), null);
  sql("DELETE FROM guild_modules WHERE guild_id = 'W1'");
  assert.equal((await get('/sword')).status, 200);
});

test('security basics: headers, methods, bad input, rate limit', async () => {
  const { headers } = await get('/sword');
  assert.match(headers.get('content-security-policy'), /default-src 'none'/);
  assert.equal(headers.get('x-content-type-options'), 'nosniff');

  assert.equal((await get('/sword', { method: 'POST' })).status, 405);
  assert.equal((await get('/sword/player/%E0%A4%A')).status, 400);
  assert.equal((await get('/../../etc/passwd')).status, 404);
  assert.equal((await get('/api/sword/leaderboard?mode=nope')).status, 400);
  assert.equal((await json('/api/sword/results?limit=9999')).results.length, 3);

  const codes = [];
  for (let i = 0; i < 70; i++) codes.push((await get('/healthz')).status);
  assert.ok(codes.includes(429), 'the rate limit eventually returns 429');
});

