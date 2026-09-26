# Tier Test Bot

An open-source, multi-server Discord bot (discord.js v14) for Minecraft PvP communities. It is built from **modules** that each server can switch on or off:

| Module | What it does |
|---|---|
| **Tier Testing** (`testing`) | MCTiers-style testing: verify → waitlist → live regional queue → private test ticket → result + cooldown, with leaderboards and tester stats |
| **Community** (`community`) | Announcements (`/announce`) and support tickets (`/support`) |
| **Website** (`web`) | Public leaderboard, player pages, results and a JSON API. Private until an admin runs `/website publish` |

Every server that adds the bot gets its own isolated data: its own settings, gamemodes, queues, roles, players, results and tickets. Nothing is shared between servers.

## Running the bot

1. Create an application at https://discord.com/developers/applications, add a bot, and copy the token and application ID. No privileged intents are needed unless you turn on support ticket transcripts (see [Community module](#community-module)).
2. Install **Node.js 22 or newer** (on hosting panels, pick a Node 22 Docker image). `cp .env.example .env` and fill it in.
3. `npm install`
4. `npm start`. The bot registers its slash commands on startup whenever they change, so there is no separate deploy step. Without `DEV_GUILD_ID` they are global and can take up to an hour to appear the first time. `npm run deploy` forces a re-register without starting the bot.
5. Use `npm run shard` instead of `npm start` once the bot is in more than 2,500 servers.

Invite link (Manage Roles, Manage Channels, View Channels, Send Messages, Embed Links, Attach Files, Read Message History, Mention Everyone):

```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=268684304&scope=bot+applications.commands
```

## Modules

Server admins manage modules with `/modules list`, `/modules enable <module>` and `/modules disable <module>`. Both modules are on by default.

- **When a module is off on a server:** its commands and buttons refuse to run there, and its data is kept.
- **Hiding the commands:** Discord still lists them in the menu. To hide them too, use Server Settings → Integrations → the bot.
- **Removing a module for every server:** set `DISABLED_MODULES=community` (comma-separated) in `.env` and restart the bot. Its commands are then removed from Discord.

## Tier Testing module

### How testing works

1. **Verify Account**: the player enters their username and optional preferred server, then picks a region (EU / NA / AS / AU). Premium names are checked against Mojang's API. Cracked names are accepted if the server allows them (see [Cracked accounts](#cracked-accounts)).
2. **Enter Waitlist**: the player gets that region's waitlist role. This fails if they are on cooldown, restricted, or already in a ticket.
3. A tester runs `/queue open`. The live queue message turns green and the waitlist role is pinged.
4. Waitlisted players press **Join Queue**. The embed lists the available testers and the queue order.
5. The tester presses **Next Player** (or runs `/queue next`). The bot opens a private `test-<ign>` ticket for the player and tester, showing the player's current and peak tier and their preferred server.
6. The tester presses **Finish Test** (picks the tier, then enters an optional score like `3-1` and notes), or runs `/result <tier> [score]`. The bot saves the result, updates the tier role, posts a results embed, starts the cooldown and deletes the ticket 10 seconds later. **Cancel Test** or `/close` ends a ticket with no result and no cooldown.

### Tiers, points and rankings

- **Tier scale:** 10 tiers (HT1 > LT1 > HT2 … LT5, like MCTiers) by default, or 15 with mid tiers (HT1 > MT1 > LT1 …, like MCPVP) via `/setup config tiers:15`. Switching back to 10 is refused while any tier or peak still uses a mid tier.
- **Points** come from each gamemode's **peak** tier (10-tier scale: HT1 60, LT1 45, HT2 30, LT2 20, HT3 10, LT3 6, HT4 4, LT4 3, HT5 2, LT5 1).
- **Overall tier badge:** total points also map to one overall tier, the way MCPVP shows "LT1 · 330 Points", alongside titles from Rookie to Combat Grandmaster.
- **Position:** `/profile` and the website show where a player sits in each gamemode (#1, #2 …).
- **Regions:** NA, EU, AS, OC, SA and ME. (Servers that used AU are moved to OC automatically.)
- **Retired players:** `/admin retire` keeps someone's tiers and peaks but takes them out of the rankings and stops them testing. `/leaderboard include_retired:True` and the website's "Include retired players" link show them again, marked 🏁. Being tested again un-retires a player.
- **Seasons:** `/admin season end name:"Beta"` archives every current tier, clears the board so everyone starts unranked, and keeps the old standings readable on the website. `/admin season list` shows past seasons.

### Configure tier testing (admins, needs Manage Server)

The quick way is one command per gamemode:

```
/autosetup gamemode:Sword regions:EU,NA
```

This creates everything:
- **Channels:** a **🏆 Tier Testing** category with `#request-test` (with the panel), `#results`, a testers-only `#test-logs`, a high-testers-only `#high-tests` and one `#<region>-queue` per region.
- **Tickets:** a private **⚔️ Test Tickets** category.
- **Roles:** **Tester** and **High Tester** roles, one **Waitlist** role per region, and colored tier roles for the gamemode.

It's safe to run again. It only creates what's missing, keeps a gamemode's regions if you leave out `regions`, and adds new gamemodes next to existing ones.

To set things up by hand instead:

```
/setup gamemode preset preset:mcpvp      (adds Vanilla, Sword, Axe, Pot, NethOP, SMP, UHC and Mace with icons)
/setup gamemode add name:Sword
/setup config tester_role:@Tester ticket_category:#Tests results_channel:#results log_channel:#test-logs accounts:Premium only
/setup queue gamemode:Sword region:EU channel:#eu-queue waitlist_role:@EU Waitlist
/setup queue gamemode:Sword region:NA channel:#na-queue waitlist_role:@NA Waitlist
/setup tierroles gamemode:Sword        (optional: creates "Sword HT1" … "Sword LT5")
/setup panel gamemode:Sword            (run in your #request-test channel)
/setup view                            (check config and missing bot permissions)
```

The bot's role must be above the waitlist and tier roles so it can assign them. `/setup config nickname_sync:True` also renames players to `[best tier] IGN` (off by default).

### High testing

Like MCTiers, regular testers can only rank players up to a cap (**HT3** by default). The tiers above it need a **high test** run by high testers. `/autosetup` turns this on. To set it up by hand:

```
/setup config high_test_channel:#high-tests high_tester_role:@High Tester high_test_cap:HT3
```

1. **Capped regular tests:** the Finish Test menu only offers tiers up to the cap, and `/result` refuses anything higher.
2. **Requesting:** players at the cap or above press **Request High Test** on the panel (or run `/hightest request`). Reaching the cap in a regular test earns the request right away, without waiting out the regular cooldown.
3. **The request:** it appears in the high-test channel with **Accept** and **Deny** and pings the High Tester role.
4. **Accept:** opens a private `high-<ign>` ticket that high testers can see, and takes the player out of that gamemode's regular queue. Any tier can be given. The result is marked as a high test in Discord and on the website, and the normal cooldown follows.
5. **Deny:** takes an optional reason and DMs it to the player. They can ask again after 24 hours. Players can withdraw a request with `/hightest cancel`.

`/hightest pending` lists waiting requests for high testers. `/setup config disable_high_testing:True` turns the feature off and removes the cap. Servers that never set it up have no cap.

### Tier testing commands

| Command | Who | What |
|---|---|---|
| `/autosetup gamemode [regions]` | Admin | Create the channels, roles, queues and panel for a gamemode |
| `/setup config · gamemode add/remove/icon/preset · queue · panel · tierroles · view` | Admin | Server configuration, gamemode icons and presets |
| `/queue open · leave · close · next · remove` | Tester | Run a region queue |
| `/hightest request · cancel` | Player | Ask for (or withdraw) a high test |
| `/hightest pending` | High tester | List waiting high test requests |
| `/result tier [score] [notes]` | Assigned tester / admin | Record the result and close the ticket (or use the **Finish Test** button) |
| `/close [reason]` | Assigned tester / admin | Close the ticket without a result (or **Cancel Test**) |
| `/ticket add · spectate · remove · rename` | Assigned tester / admin | Manage who is in the ticket |
| `/profile [user]` | Everyone | Tiers, peak, points, title, cooldowns |
| `/leaderboard [gamemode] [include_retired]` | Everyone | Overall points or per-gamemode ranking |
| `/tester stats [user] [days] · top [days]` | Everyone | Tester activity, e.g. for quotas |
| `/admin settier · resetcooldown · restrict · unrestrict · unlink · transfer · retire · unretire · season end/list` | Admin | Staff tools: fix tiers, move an account to another Discord account, retire players, and end a season |

Testers are members with the configured tester role. Anyone with Manage Server also counts as a tester.

### Cracked accounts

Cracked (offline-mode) accounts aren't registered with Mojang, so they can't be looked up. Each server picks what it accepts with `/setup config accounts:`:

| Mode | Verify button | Checks |
|---|---|---|
| **Premium only** (default) | Opens the premium form | The name must be a real Java account |
| **Premium and cracked** | Asks "Premium or Cracked?" first | Cracked names can't be names that belong to a premium account, so nobody can pose as a premium player |
| **Cracked only** | Opens the cracked form | Any valid name (3–16 letters, numbers, `_`); Mojang isn't contacted |

- **Stored UUID:** cracked players get the same UUID an offline-mode server would give them (the `OfflinePlayer:<name>` UUID).
- **Duplicate names:** a name can only be linked once per server, whatever its capitalisation.
- **Where it shows:** cracked players are marked "(cracked)" on results, profiles and leaderboards, with the default Steve head.
- **Test tickets:** the ticket says **Cracked (test on an offline-mode server)** so the tester knows which server to use.
- **Switching back to premium only:** cracked players already linked can't join a waitlist until they verify a premium account. Their tiers are kept.

## Community module

### Announcements

`/announce channel:#news [ping:@everyone|@here] [role] [image] [color] [publish]` opens a form for the title and message. The bot then posts it as an embed.

- **Who can use it:** by default, members with **Manage Messages**. Change this in Server Settings → Integrations.
- **Ping rules:** pinging @everyone, @here or an unmentionable role needs the member to have **Mention @everyone** in that channel. The bot pings for them, so it can't give anyone more power than they already have.
- **Images:** attached images are uploaded again, so they don't disappear when Discord's attachment link expires.
- **Publishing:** `publish:True` in an announcement channel also sends the post to servers that follow that channel.

### Support tickets

```
/support setup staff_role:@Support category:#Tickets log_channel:#ticket-logs max_open:1
/support panel                        (run in the channel where members should open tickets)
```

- **Opening a ticket:** members press **Open a ticket** and describe their problem. The bot creates a private `ticket-0001` channel for them and the staff role, and pings both.
- **Staff actions:** staff can `/support claim`, `/support add` or `/support remove` members, and close the ticket. The **Claim** and **Close** buttons in the ticket do the same.
- **Closing:** the member who opened a ticket can close it too. Closing logs who opened, claimed and closed it, the subject and the reason, then deletes the channel.
- **Transcripts (optional):** set `ENABLE_TRANSCRIPTS=true` and turn on **Message Content Intent** in the Developer Portal → Bot. A `.txt` log of each ticket is then attached to the log message. Discord treats this intent as privileged: once the bot is in 100+ servers, Discord must approve it.

| Command | Who | What |
|---|---|---|
| `/announce …` | Manage Messages | Post an announcement |
| `/support setup · panel` | Admin | Configure tickets, post the panel |
| `/support claim · add · remove` | Staff | Manage a ticket |
| `/support close [reason]` | Staff / ticket owner | Close a ticket |

## Website module

Each server can publish a public tierlist site. It is private by default.

```
/website publish slug:swordtiers     → https://your-host/swordtiers
/website link [user]                 → buttons to the leaderboard, results or a player's page
/website unpublish                   → take it offline again
```

- **Pages:** an overall leaderboard (overall tier, points and titles) and one per gamemode, filterable by region, with gamemode icons, positions, peaks and past seasons. There are also player pages with tiers, peaks and test history, a recent-results page, and a page for each result. Result embeds in Discord get a **View on website** button.
- **JSON API:** `/api/<slug>/leaderboard?mode=Sword&region=EU&retired=1`, `/api/<slug>/players/<ign>`, `/api/<slug>/results`, `/api/<slug>/results/<id>`, `/api/<slug>/seasons` and `/api/<slug>/seasons/<id>`.
- **What's public:** only Minecraft names, regions, tiers, scores and dates. Discord accounts, tester identities and staff notes never appear.
- **Hosting:** the bot host sets `WEB_BASE_URL` (the public address) and opens a port. The site listens on `WEB_PORT`, then `SERVER_PORT` (set automatically on Pterodactyl hosts such as Wispbyte), then `PORT`, defaulting to 3000.
- **Built-in protection:** the site uses Node's built-in web server with no extra dependencies. It only allows reading, sends strict security headers, escapes everything it shows, and rate-limits each IP. Set `TRUST_PROXY=true` only behind your own reverse proxy.

## Core commands

These are always available and don't belong to a module.

| Command | Who | What |
|---|---|---|
| `/about` | Everyone | Version, server count, license and a link to the source code |
| `/modules list · enable · disable` | Admin | Turn modules on or off for this server |
| `/backup export · import` | Administrator | Download or restore this server's data as JSON |
| `/bugreport [screenshot]` | Everyone | Send a bug report to the bot developer |

### Backups

`/backup export` sends an administrator a JSON file with this server's data from every module. `/backup import` replaces this server's data with such a file.

- **Scope:** only this server's data. Every imported row is forced to this server, and only known tables and columns are written, so a file can never reach another server.
- **Safety:** the import runs in one transaction. A broken file changes nothing.
- **What's left out:** open tickets and queue spots aren't included, and queues come back closed.
- **Moving to another server:** set `from_other_server:True`. Channels, roles and the website address then need to be set up again in the new server.

### Bug reports

`/bugreport` opens a form with a summary, what happened, and optional steps to reproduce. You can also attach a screenshot. Reports go to **you, the bot developer**, not to the server's staff:

- **Where they go:** set `BUG_REPORT_CHANNEL_ID` in `.env` to a channel in your own server. The bot must be in that server. If it isn't set, the bot DMs the application owner, or the team owner if the bot belongs to a developer team.
- **What a report includes:** the reporter, the server it came from, and the screenshot, re-uploaded because Discord attachment links expire.
- **Mark fixed:** the button (developer only) turns the report green and DMs the reporter that it's fixed.
- **Saved copy:** every report is also saved in the `bug_reports` table, so nothing is lost if delivery fails.
- **Rate limit:** one report per user every 2 minutes.

## Notes

- Data lives in SQLite (`data/bot.db`), and every table is keyed by server ID. If the bot is kicked, that server's data is kept, so re-inviting it restores everything.
- "Verify" checks that the account exists (premium only) and that no one else in the same server has linked it. It does not prove the player owns the account. With cracked accounts anyone can type any free name, so ownership only really exists on your own offline-mode server (e.g. through an AuthMe login). For that you would need an in-game check, e.g. a small plugin or a Microsoft OAuth link.
- Run a single process per database file. With `npm run shard`, the shards share the file, which WAL mode supports.

## Project layout

```
src/
  index.js          Discord client, events
  router.js         sends commands/buttons to their module; refuses disabled modules
  modules.js        module registry, per-server on/off
  commands.js       all slash commands (core + enabled modules)
  links.js          lets modules link to each other without importing each other
  core/             always-on commands: /about, /backup, /bugreport, /modules; command registration
  modules/
    testing/        Tier Testing module (schema, queue, tickets, results, panel, provision, commands/)
    community/      Community module (schema, announce, support)
    web/            Website module (schema, data, pages, server, /website)
  db.js · util.js   shared SQLite connection and helpers
tests/              npm test — the bot's code against fake Discord objects
```

### Writing a module

A module is a folder in `src/modules/` whose `index.js` exports:

```js
export default {
  id: 'mymodule',
  name: 'My Module',
  description: 'Shown in /modules list.',
  commands: [{ data: new SlashCommandBuilder()..., execute(interaction) {} }],
  componentScopes: ['mymodule'],     // custom IDs like "mymodule:action" are routed here
  handleComponent(interaction) {},   // buttons, select menus, modals
  autocomplete(interaction) {},      // optional
  events: { ready(client) {}, channelDelete(channel) {} }, // optional
};
```

Add it to `allModules` in `src/modules.js`. Create its tables in its own `schema.js`, and key every table by `guild_id`.

## Tests

```
npm test
```

`tests/` runs the real command, button and website code against fake Discord objects and a temporary database, covering testing, high tests, seasons, retirement, the Community module, backups and the website (including its privacy and security rules). No Discord token is needed.

## Contributing

Issues and pull requests are welcome. Please keep the existing style: small functions, `UserError` for messages meant for users, and every table keyed by `guild_id`. Run `npm test`, and try your change on a test server (`DEV_GUILD_ID`) before opening a PR.

## License

Copyright (C) 2026 creeperdiamonds

This program is free software: you can redistribute it and/or modify it under the terms of the
GNU Affero General Public License as published by the Free Software Foundation, either version 3
of the License, or (at your option) any later version. See [LICENSE](LICENSE).

In short: you may use, change and host this bot. If you run a **modified** version for others, for
example as a public bot, you must share your changed source code under the same license with the
people who use it (AGPL §13). Point `SOURCE_URL` in `.env` at your fork; `/about` shows that link to your users.
