# Tier Test Bot

An open-source, multi-server Discord bot (discord.js v14) for Minecraft PvP communities. It is built from **modules** that each server can switch on or off:

| Module | What it does |
|---|---|
| **Tier Testing** (`testing`) | MCTiers-style testing: verify → waitlist → live regional queue → private test ticket → result + cooldown, with leaderboards and tester stats |
| **Community** (`community`) | Announcements (`/announce`) and support tickets (`/support`) |

Every server that adds the bot gets its own isolated data: its own settings, gamemodes, queues, roles, players, results and tickets. Nothing is shared between servers.

## Running the bot

1. Create an application at https://discord.com/developers/applications, add a bot, and copy the token and application ID. No privileged intents are needed unless you turn on support ticket transcripts (see [Community module](#community-module)).
2. `cp .env.example .env` and fill it in.
3. `npm install`
4. `npm run deploy` registers the slash commands. Without `DEV_GUILD_ID` they are global and can take up to an hour to appear the first time.
5. `npm start`, or `npm run shard` once the bot is in more than 2,500 servers.

Invite link (Manage Roles, Manage Channels, View Channels, Send Messages, Embed Links, Attach Files, Read Message History, Mention Everyone):

```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=268684304&scope=bot+applications.commands
```

## Modules

Server admins manage modules with `/modules list`, `/modules enable <module>` and `/modules disable <module>`. Both modules are on by default.

- **When a module is off on a server:** its commands and buttons refuse to run there, and its data is kept.
- **Hiding the commands:** Discord still lists them in the menu. To hide them too, use Server Settings → Integrations → the bot.
- **Removing a module for every server:** set `DISABLED_MODULES=community` (comma-separated) in `.env`, then run `npm run deploy` again. The module's commands are then never registered.

## Tier Testing module

### How testing works

1. **Verify Account**: the player enters their username and optional preferred server, then picks a region (EU / NA / AS / AU). Premium names are checked against Mojang's API. Cracked names are accepted if the server allows them (see [Cracked accounts](#cracked-accounts)).
2. **Enter Waitlist**: the player gets that region's waitlist role. This fails if they are on cooldown, restricted, or already in a ticket.
3. A tester runs `/queue open`. The live queue message turns green and the waitlist role is pinged.
4. Waitlisted players press **Join Queue**. The embed lists the available testers and the queue order.
5. The tester presses **Next Player** (or runs `/queue next`). The bot opens a private `test-<ign>` ticket for the player and tester, showing the player's current and peak tier and their preferred server.
6. The tester runs `/result <tier>`. The bot saves the result, updates the tier role, posts a results embed, starts the cooldown and deletes the ticket 10 seconds later. `/close` ends a ticket with no result and no cooldown.

Tiers go HT1 > LT1 > HT2 > … > LT5. Points follow MCTiers (HT1 60, LT1 45, HT2 30, LT2 20, HT3 10, LT3 6, HT4 4, LT4 3, HT5 2, LT5 1) and are counted from each gamemode's **peak** tier. Players get titles from Rookie to Combat Grandmaster.

### Configure tier testing (admins, needs Manage Server)

```
/setup gamemode add name:Sword
/setup config tester_role:@Tester ticket_category:#Tests results_channel:#results log_channel:#test-logs accounts:Premium only
/setup queue gamemode:Sword region:EU channel:#eu-queue waitlist_role:@EU Waitlist
/setup queue gamemode:Sword region:NA channel:#na-queue waitlist_role:@NA Waitlist
/setup tierroles gamemode:Sword        (optional: creates "Sword HT1" … "Sword LT5")
/setup panel gamemode:Sword            (run in your #request-test channel)
/setup view                            (check config and missing bot permissions)
```

The bot's role must be above the waitlist and tier roles so it can assign them.

### Tier testing commands

| Command | Who | What |
|---|---|---|
| `/setup config · gamemode add/remove · queue · panel · tierroles · view` | Admin | Server configuration |
| `/queue open · leave · close · next · remove` | Tester | Run a region queue |
| `/result tier [notes]` | Assigned tester / admin | Record the result and close the ticket |
| `/close [reason]` | Assigned tester / admin | Close the ticket without a result |
| `/ticket add · spectate · remove · rename` | Assigned tester / admin | Manage who is in the ticket |
| `/profile [user]` | Everyone | Tiers, peak, points, title, cooldowns |
| `/leaderboard [gamemode]` | Everyone | Overall points or per-gamemode ranking |
| `/tester stats [user] [days] · top [days]` | Everyone | Tester activity, e.g. for quotas |
| `/admin settier · resetcooldown · restrict · unrestrict · unlink` | Admin | Staff tools |

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

## Core commands

These are always available and don't belong to a module.

| Command | Who | What |
|---|---|---|
| `/about` | Everyone | Version, server count, license and a link to the source code |
| `/modules list · enable · disable` | Admin | Turn modules on or off for this server |
| `/bugreport [screenshot]` | Everyone | Send a bug report to the bot developer |

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
  core/             always-on commands: /modules, /bugreport
  modules/
    testing/        Tier Testing module (schema, queue, tickets, panel, commands/)
    community/      Community module (schema, announce, support)
  db.js · util.js   shared SQLite connection and helpers
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

## Contributing

Issues and pull requests are welcome. Please keep the existing style: small functions, `UserError` for messages meant for users, and every table keyed by `guild_id`. Try your change on a test server (`DEV_GUILD_ID`) before opening a PR.

## License

Copyright (C) 2026 creeperdiamonds

This program is free software: you can redistribute it and/or modify it under the terms of the
GNU Affero General Public License as published by the Free Software Foundation, either version 3
of the License, or (at your option) any later version. See [LICENSE](LICENSE).

In short: you may use, change and host this bot. If you run a **modified** version for others, for
example as a public bot, you must share your changed source code under the same license with the
people who use it (AGPL §13). Point `SOURCE_URL` in `.env` at your fork; `/about` shows that link to your users.
