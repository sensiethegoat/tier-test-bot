import { REGIONS } from '../testing/constants.js';

// Server-rendered HTML with no scripts. Every value from the database goes through esc().

export const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const url = (...parts) => '/' + parts.map((p) => encodeURIComponent(p)).join('/');
const headImg = (head, size = 32) =>
  `<img class="head" src="https://mc-heads.net/avatar/${encodeURIComponent(head)}/${size}" width="${size}" height="${size}" alt="" loading="lazy">`;
const tier = (t) => (t ? `<span class="tier t-${esc(t)}">${esc(t)}</span>` : '<span class="tier">—</span>');
const date = (iso) => `<time datetime="${esc(iso)}">${esc(iso.slice(0, 10))}</time>`;
const cracked = (p) => (p.cracked ? ' <span class="muted">(cracked)</span>' : '');

const CSS = `
:root{--bg:#0f1115;--panel:#171a21;--line:#262a33;--text:#e7e9ee;--muted:#8b93a3;--accent:#f1c40f;color-scheme:dark}
@media (prefers-color-scheme:light){:root{--bg:#f6f7f9;--panel:#fff;--line:#e3e6eb;--text:#161a20;--muted:#667085;--accent:#b7791f;color-scheme:light}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:inherit}header{border-bottom:1px solid var(--line);background:var(--panel)}
.wrap{max-width:960px;margin:0 auto;padding:0 16px}
.bar{display:flex;flex-wrap:wrap;gap:12px 20px;align-items:center;min-height:60px}
.brand{display:flex;gap:10px;align-items:center;font-weight:700;text-decoration:none;font-size:17px}
.brand img{border-radius:8px}nav{display:flex;gap:16px}nav a{text-decoration:none;color:var(--muted)}nav a.on{color:var(--text);font-weight:600}
form.search{margin-left:auto;display:flex;gap:6px}
input,select,button{font:inherit;color:inherit;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:6px 10px}
button{cursor:pointer;background:var(--accent);color:#111;border:0;font-weight:600}
main{padding:24px 0 48px}h1{font-size:24px;margin:0 0 4px}.muted{color:var(--muted)}
.tabs{display:flex;flex-wrap:wrap;gap:6px;margin:16px 0}
.tabs a{text-decoration:none;padding:5px 12px;border:1px solid var(--line);border-radius:999px;color:var(--muted)}
.tabs a.on{background:var(--text);color:var(--bg);border-color:var(--text)}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
table{width:100%;border-collapse:collapse}th,td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--line)}
th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:600}
tr:last-child td{border-bottom:0}td.n{width:48px;color:var(--muted);font-variant-numeric:tabular-nums}
.who{display:flex;gap:10px;align-items:center}.head{border-radius:4px;image-rendering:pixelated}
.tier{display:inline-block;min-width:42px;text-align:center;padding:1px 8px;border-radius:6px;font-weight:700;font-size:13px;background:var(--line)}
.t-HT1,.t-LT1{background:#f5c542;color:#1a1400}.t-HT2,.t-LT2{background:#c0c7d4;color:#111}.t-HT3,.t-LT3{background:#d08b52;color:#1a0d00}
.t-HT4,.t-LT4,.t-HT5,.t-LT5{background:#3b4252;color:#e7e9ee}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin:16px 0}
.grid .card{padding:12px}.profile{display:flex;gap:16px;align-items:center;margin-bottom:8px}
.retired{font-style:italic;opacity:.75}.scroll{overflow-x:auto}.empty{padding:24px;text-align:center;color:var(--muted)}
footer{border-top:1px solid var(--line);padding:16px 0;color:var(--muted);font-size:13px}
@media (max-width:600px){form.search{margin-left:0;width:100%}form.search input{flex:1}.hide-sm{display:none}}
`;

function layout({ title, site, active, body, seasons = 0 }) {
  const nav = site
    ? `<nav><a href="${url(site.slug)}" class="${active === 'board' ? 'on' : ''}">Leaderboard</a>
       <a href="${url(site.slug, 'results')}" class="${active === 'results' ? 'on' : ''}">Results</a>
       ${seasons ? `<a href="${url(site.slug, 'seasons')}" class="${active === 'seasons' ? 'on' : ''}">Seasons</a>` : ''}</nav>
       <form class="search" action="${url(site.slug, 'search')}" method="get" role="search">
         <input name="ign" placeholder="Find a player" maxlength="16" aria-label="Minecraft username"><button>Search</button></form>`
    : '';
  const brand = site
    ? `<a class="brand" href="${url(site.slug)}">${site.icon_url ? `<img src="${esc(site.icon_url)}" width="32" height="32" alt="">` : ''}${esc(site.guild_name)}</a>`
    : '<a class="brand" href="/">Tierlists</a>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>${CSS}</style></head><body>
<header><div class="wrap bar">${brand}${nav}</div></header>
<main class="wrap">${body}</main>
<footer><div class="wrap">Powered by <a href="https://github.com/creeperdiamonds/tier-test-bot">Tier Test Bot</a> · AGPL-3.0</div></footer>
</body></html>`;
}

export function landingPage(sites) {
  const list = sites.length
    ? `<div class="card"><table><tbody>${sites
        .map((s) => `<tr><td><a class="brand" href="${url(s.slug)}">${s.icon_url ? `<img src="${esc(s.icon_url)}" width="28" height="28" alt="">` : ''}${esc(s.guild_name)}</a></td></tr>`)
        .join('')}</tbody></table></div>`
    : '<p class="muted">No server has published its tierlist yet.</p>';
  return layout({ title: 'Tierlists', body: `<h1>Tierlists</h1><p class="muted">Servers that publish their rankings.</p>${list}` });
}

export function leaderboardPage(site, { modes, mode, region, rows, includeRetired, seasons = 0 }) {
  const q = (m, r, retired = includeRetired) => {
    const params = new URLSearchParams();
    if (m) params.set('mode', m);
    if (r) params.set('region', r);
    if (retired) params.set('retired', '1');
    const s = params.toString();
    return url(site.slug) + (s ? `?${s}` : '');
  };
  const tabs = `<div class="tabs">${[{ name: '', icon: null, label: 'Overall' }, ...modes.map((m) => ({ ...m, label: m.name }))]
    .map((m) => `<a href="${esc(q(m.name, region))}" class="${(mode ?? '') === m.name ? 'on' : ''}">${m.icon ? `${esc(m.icon)} ` : ''}${esc(m.label)}</a>`)
    .join('')}</div>
  <div class="tabs">${[['', 'All regions'], ...Object.keys(REGIONS).map((r) => [r, r])]
    .map(([r, label]) => `<a href="${esc(q(mode, r))}" class="${(region ?? '') === r ? 'on' : ''}">${esc(label)}</a>`)
    .join('')}</div>`;

  const who = (r) =>
    `<a class="who" href="${url(site.slug, 'player', r.ign)}">${headImg(r.head)}<span class="${r.retired ? 'retired' : ''}">${esc(r.ign)}${cracked(r)}${
      r.retired ? ' 🏁' : ''
    }</span></a>`;
  const table = !rows.length
    ? '<div class="empty">Nobody has been tested here yet.</div>'
    : mode
      ? `<table><thead><tr><th>#</th><th>Player</th><th>Tier</th><th class="hide-sm">Peak</th><th class="hide-sm">Region</th></tr></thead><tbody>${rows
          .map((r) => `<tr><td class="n">${r.rank}</td><td>${who(r)}</td><td>${tier(r.tier)}</td><td class="hide-sm">${tier(r.peak)}</td><td class="hide-sm">${esc(r.region)}</td></tr>`)
          .join('')}</tbody></table>`
      : `<table><thead><tr><th>#</th><th>Player</th><th>Overall</th><th>Points</th><th class="hide-sm">Title</th><th class="hide-sm">Region</th></tr></thead><tbody>${rows
          .map(
            (r) => `<tr><td class="n">${r.rank}</td><td>${who(r)}</td><td>${tier(r.overall)}</td><td><strong>${r.points}</strong></td>
              <td class="hide-sm">${esc(r.title)}</td><td class="hide-sm">${esc(r.region)}</td></tr>`,
          )
          .join('')}</tbody></table>`;

  return layout({
    title: `${mode ?? 'Overall'} · ${site.guild_name}`,
    site,
    active: 'board',
    seasons,
    body: `<h1>${esc(mode ?? 'Overall')} leaderboard</h1>${tabs}<div class="card scroll">${table}</div>
      <p class="muted"><a href="${esc(q(mode, region, !includeRetired))}">${includeRetired ? 'Hide retired players' : 'Include retired players'}</a></p>`,
  });
}

function historyTable(site, rows, { showPlayer, icons = new Map() }) {
  if (!rows.length) return '<div class="empty">No tests yet.</div>';
  return `<table><thead><tr>${showPlayer ? '<th>Player</th>' : ''}<th>Gamemode</th><th>Result</th><th>Score</th><th class="hide-sm">Region</th><th>Date</th></tr></thead><tbody>${rows
    .map(
      (r) => `<tr>${showPlayer ? `<td><a class="who" href="${url(site.slug, 'player', r.ign)}">${headImg(r.head, 24)}<span>${esc(r.ign)}</span></a></td>` : ''}
      <td>${icons.get(r.gamemode) ? `${esc(icons.get(r.gamemode))} ` : ''}${esc(r.gamemode)}${r.highTest ? ' <span class="muted">· high</span>' : ''}</td><td><a href="${url(site.slug, 'results', r.id)}">${tier(r.previousTier === 'Unranked' ? null : r.previousTier)} → ${tier(r.tier)}</a></td>
      <td>${esc(r.score ?? '—')}</td><td class="hide-sm">${esc(r.region)}</td><td>${date(r.testedAt)}</td></tr>`,
    )
    .join('')}</tbody></table>`;
}

export function playerPage(site, p, modes) {
  const icons = new Map(modes.map((m) => [m.name, m.icon]));
  const all = [...new Set([...modes.map((m) => m.name), ...Object.keys(p.tiers)])];
  const cards = all
    .map((m) => {
      const t = p.tiers[m];
      return `<div class="card"><div class="muted">${icons.get(m) ? `${esc(icons.get(m))} ` : ''}${esc(m)}</div>
        <div>${tier(t?.tier)}${t?.position ? ` <span class="muted">#${t.position}</span>` : ''}</div>
        ${t && t.peak !== t.tier ? `<div class="muted">Peak ${esc(t.peak)}</div>` : ''}</div>`;
    })
    .join('');
  return layout({
    title: `${p.ign} · ${site.guild_name}`,
    site,
    body: `<div class="profile">${headImg(p.head, 72)}<div><h1 class="${p.retired ? 'retired' : ''}">${esc(p.ign)}${cracked(p)}${p.retired ? ' 🏁' : ''}</h1>
      <div class="muted">${tier(p.overall)} ${p.points} points · ${esc(p.title)} · ${esc(p.region ?? '—')}${p.retired ? ' · retired' : ''}</div></div></div>
      <div class="grid">${cards}</div><h2>Test history</h2><div class="card scroll">${historyTable(site, p.history, { showPlayer: false, icons })}</div>`,
  });
}

export const resultsPage = (site, rows, modes = []) =>
  layout({
    title: `Results · ${site.guild_name}`,
    site,
    active: 'results',
    body: `<h1>Recent results</h1><p class="muted">The latest ${rows.length} tests.</p>
      <div class="card scroll">${historyTable(site, rows, { showPlayer: true, icons: new Map(modes.map((m) => [m.name, m.icon])) })}</div>`,
  });

export const resultPage = (site, r) =>
  layout({
    title: `${r.ign} · ${r.gamemode} result · ${site.guild_name}`,
    site,
    active: 'results',
    body: `<div class="profile">${headImg(r.head, 72)}<div><h1><a href="${url(site.slug, 'player', r.ign)}">${esc(r.ign)}</a></h1>
      <div class="muted">${esc(r.gamemode)} ${r.highTest ? 'high test' : 'test'} · ${esc(r.region)} · ${date(r.testedAt)}</div></div></div>
      <div class="grid"><div class="card"><div class="muted">Previous</div>${tier(r.previousTier === 'Unranked' ? null : r.previousTier)}</div>
      <div class="card"><div class="muted">Earned</div>${tier(r.tier)}</div>
      <div class="card"><div class="muted">Score</div><strong>${esc(r.score ?? '—')}</strong></div></div>`,
  });

export const seasonsPage = (site, seasons) =>
  layout({
    title: `Seasons · ${site.guild_name}`,
    site,
    active: 'seasons',
    seasons: seasons.length,
    body: `<h1>Seasons</h1><p class="muted">Final standings from earlier seasons.</p>
      <div class="card">${
        seasons.length
          ? `<table><tbody>${seasons
              .map((s) => `<tr><td><a href="${url(site.slug, 'seasons', s.id)}">${esc(s.name)}</a></td><td class="muted">ended ${date(s.endedAt)}</td></tr>`)
              .join('')}</tbody></table>`
          : '<div class="empty">No finished seasons yet.</div>'
      }</div>`,
  });

export function seasonPage(site, season, { modes, mode, rows, seasons }) {
  const q = (m) => url(site.slug, 'seasons', season.id) + (m ? `?mode=${encodeURIComponent(m)}` : '');
  const tabs = `<div class="tabs">${[{ name: '', label: 'Overall' }, ...modes.map((m) => ({ ...m, label: m.name }))]
    .map((m) => `<a href="${esc(q(m.name))}" class="${(mode ?? '') === m.name ? 'on' : ''}">${m.icon ? `${esc(m.icon)} ` : ''}${esc(m.label)}</a>`)
    .join('')}</div>`;
  const who = (r) => `<a class="who" href="${url(site.slug, 'player', r.ign)}">${headImg(r.head)}<span>${esc(r.ign)}</span></a>`;
  const table = !rows.length
    ? '<div class="empty">Nothing was ranked in this season.</div>'
    : mode
      ? `<table><thead><tr><th>#</th><th>Player</th><th>Final tier</th><th class="hide-sm">Peak</th></tr></thead><tbody>${rows
          .map((r) => `<tr><td class="n">${r.rank}</td><td>${who(r)}</td><td>${tier(r.tier)}</td><td class="hide-sm">${tier(r.peak)}</td></tr>`)
          .join('')}</tbody></table>`
      : `<table><thead><tr><th>#</th><th>Player</th><th>Overall</th><th>Points</th><th class="hide-sm">Title</th></tr></thead><tbody>${rows
          .map((r) => `<tr><td class="n">${r.rank}</td><td>${who(r)}</td><td>${tier(r.overall)}</td><td><strong>${r.points}</strong></td><td class="hide-sm">${esc(r.title)}</td></tr>`)
          .join('')}</tbody></table>`;
  return layout({
    title: `${esc(season.name)} · ${site.guild_name}`,
    site,
    active: 'seasons',
    seasons,
    body: `<h1>${esc(season.name)}</h1><p class="muted">Final standings · ended ${date(new Date(season.ended_at).toISOString())}</p>${tabs}
      <div class="card scroll">${table}</div><p class="muted"><a href="${url(site.slug, 'seasons')}">All seasons</a></p>`,
  });
}

export const errorPage = (status, message, site) =>
  layout({ title: `${status}`, site, body: `<h1>${status}</h1><p class="muted">${esc(message)}</p><p><a href="/">Home</a></p>` });
