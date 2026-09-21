import http from 'node:http';
import { REGIONS } from '../testing/constants.js';
import { gamemodesOf, leaderboard, player, publishedSites, result, results, siteBySlug } from './data.js';
import { errorPage, landingPage, leaderboardPage, playerPage, resultPage, resultsPage } from './pages.js';

const HEADERS = {
  'Content-Security-Policy':
    "default-src 'none'; img-src https://mc-heads.net https://cdn.discordapp.com; style-src 'unsafe-inline'; " +
    "form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'public, max-age=30',
};

// Per-IP token bucket: bursts of 60, refilling 1 request per second.
const buckets = new Map();
const LIMIT = 60;
setInterval(() => {
  const cutoff = Date.now() - 10 * 60_000;
  for (const [ip, b] of buckets) if (b.at < cutoff) buckets.delete(ip);
}, 60_000).unref();

function allowed(ip) {
  const now = Date.now();
  const b = buckets.get(ip) ?? { tokens: LIMIT, at: now };
  b.tokens = Math.min(LIMIT, b.tokens + (now - b.at) / 1000);
  b.at = now;
  buckets.set(ip, b);
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

function clientIp(req) {
  // Only trust X-Forwarded-For behind a reverse proxy you control.
  if (process.env.TRUST_PROXY === 'true') {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) return String(forwarded).split(',')[0].trim();
  }
  return req.socket.remoteAddress ?? 'unknown';
}

function send(res, status, body, type) {
  res.writeHead(status, { ...HEADERS, 'Content-Type': type });
  res.end(res.req.method === 'HEAD' ? undefined : body);
}
const html = (res, status, body) => send(res, status, body, 'text/html; charset=utf-8');
const json = (res, status, data) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  send(res, status, JSON.stringify(data), 'application/json; charset=utf-8');
};
const redirect = (res, location) => {
  res.writeHead(302, { ...HEADERS, Location: location });
  res.end();
};

function readFilters(site, query) {
  const modes = gamemodesOf(site.guild_id);
  const rawMode = query.get('mode');
  const mode = rawMode ? modes.find((m) => m.toLowerCase() === rawMode.toLowerCase()) : null;
  const rawRegion = query.get('region')?.toUpperCase();
  const region = rawRegion && rawRegion in REGIONS ? rawRegion : null;
  return { modes, mode, region, badMode: Boolean(rawMode && !mode) };
}

function handle(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { ...HEADERS, Allow: 'GET, HEAD' });
    return res.end();
  }
  if (!allowed(clientIp(req))) return send(res, 429, 'Too many requests. Slow down a little.', 'text/plain; charset=utf-8');

  let parts, query;
  try {
    const u = new URL(req.url, 'http://localhost');
    parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    query = u.searchParams;
  } catch {
    return html(res, 400, errorPage(400, 'That address is not valid.'));
  }

  if (parts.length === 0) return html(res, 200, landingPage(publishedSites()));
  if (parts[0] === 'healthz' && parts.length === 1) return send(res, 200, 'ok', 'text/plain');

  // JSON API: /api/<slug>/leaderboard, /api/<slug>/players/<ign>, /api/<slug>/results[/<id>]
  if (parts[0] === 'api') {
    const site = parts[1] && siteBySlug(parts[1]);
    if (!site) return json(res, 404, { error: 'Unknown or unpublished server.' });
    const [, , kind, arg] = parts;
    if (kind === 'leaderboard' && !arg) {
      const f = readFilters(site, query);
      if (f.badMode) return json(res, 400, { error: 'Unknown gamemode.', gamemodes: f.modes });
      return json(res, 200, { server: site.guild_name, gamemode: f.mode ?? 'Overall', region: f.region, players: leaderboard(site.guild_id, f.mode, f.region) });
    }
    if (kind === 'players' && arg) {
      const p = player(site.guild_id, arg);
      return p ? json(res, 200, p) : json(res, 404, { error: 'Player not found.' });
    }
    if (kind === 'results' && !arg) {
      const limit = Math.min(Math.max(Number.parseInt(query.get('limit'), 10) || 50, 1), 100);
      return json(res, 200, { results: results(site.guild_id, limit) });
    }
    if (kind === 'results' && /^\d+$/.test(arg)) {
      const r = result(site.guild_id, Number(arg));
      return r ? json(res, 200, r) : json(res, 404, { error: 'Result not found.' });
    }
    return json(res, 404, { error: 'Unknown endpoint.' });
  }

  // Pages: /<slug>, /<slug>/player/<ign>, /<slug>/search?ign=, /<slug>/results[/<id>]
  const site = siteBySlug(parts[0]);
  if (!site) return html(res, 404, errorPage(404, 'This server has not published a tierlist here.'));
  const [, kind, arg] = parts;

  if (!kind) {
    const f = readFilters(site, query);
    if (f.badMode) return html(res, 404, errorPage(404, 'Unknown gamemode.', site));
    return html(res, 200, leaderboardPage(site, { ...f, rows: leaderboard(site.guild_id, f.mode, f.region) }));
  }
  if (kind === 'search' && !arg) {
    const ign = query.get('ign')?.trim();
    return redirect(res, ign ? `/${encodeURIComponent(site.slug)}/player/${encodeURIComponent(ign)}` : `/${encodeURIComponent(site.slug)}`);
  }
  if (kind === 'player' && arg) {
    const p = player(site.guild_id, arg);
    return p ? html(res, 200, playerPage(site, p, gamemodesOf(site.guild_id))) : html(res, 404, errorPage(404, `No player named ${arg} here.`, site));
  }
  if (kind === 'results' && !arg) return html(res, 200, resultsPage(site, results(site.guild_id)));
  if (kind === 'results' && /^\d+$/.test(arg)) {
    const r = result(site.guild_id, Number(arg));
    return r ? html(res, 200, resultPage(site, r)) : html(res, 404, errorPage(404, 'Result not found.', site));
  }
  return html(res, 404, errorPage(404, 'Page not found.', site));
}

export function startWebServer() {
  const port = Number(process.env.WEB_PORT || process.env.SERVER_PORT || process.env.PORT || 3000);
  const host = process.env.WEB_HOST || '0.0.0.0';
  const server = http.createServer((req, res) => {
    try {
      handle(req, res);
    } catch (err) {
      console.error('Website error:', err);
      if (!res.headersSent) html(res, 500, errorPage(500, 'Something went wrong.'));
      else res.end();
    }
  });
  // A busy port shouldn't take the Discord bot down with it.
  server.on('error', (err) => console.error(`Website could not start on ${host}:${port}: ${err.message}`));
  server.listen(port, host, () => console.log(`Website listening on http://${host}:${port}`));
  return server;
}
