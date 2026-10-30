# MCBE Vanguard Tiers (MVT) Bot Setup

This repository is a customized version of the existing tier-testing Discord bot for MCBE Vanguard Tiers.

## Download

You can download the project ZIP directly from GitHub:

- Repo: https://github.com/sensiethegoat/tier-test-bot
- ZIP: https://github.com/sensiethegoat/tier-test-bot/archive/refs/heads/main.zip

## Included MVT rules

- 38 kits total
- 3 categories:
  - Vanilla (15 kits)
  - Modded KB (11 kits)
  - MCBE-J (12 kits)
- Tier ladder is HT/LT only:
  - HT1 → LT1 → HT2 → LT2 → HT3 → LT3 → HT4 → LT4 → HT5 → LT5
- No MT tiers are used in the active MVT system
- Untested kits display as `Unranked`
- Rankings are kept independent by category so duplicate kit names do not overwrite one another

## Important notes

- The original architecture and project structure were kept intact.
- The existing tier-testing bot, database flow, setup commands, and command system were preserved.
- The project was customized rather than rebuilt from scratch.
- The MVT-specific profile logic was added to the existing `/profile` flow without replacing the original bot systems.

## Required environment variables

Copy `.env.example` to `.env` if needed, then fill in the values:

```env
DISCORD_TOKEN=your_discord_bot_token
DEV_GUILD_ID=
AUTO_DEPLOY=true
BUG_REPORT_CHANNEL_ID=
DISABLED_MODULES=
ENABLE_TRANSCRIPTS=false
SOURCE_URL=
WEB_BASE_URL=
WEB_PORT=
WEB_HOST=0.0.0.0
TRUST_PROXY=false
DATABASE_PATH=data/bot.db
```

## Local install

```bash
npm install
npm start
```

If using the provided package script, the runtime starts with:

```bash
node --env-file=.env src/index.js
```

## Wispbyte deployment

Set the same values as environment variables in the Wispbyte dashboard.

- A `.env` file is not strictly required if Wispbyte injects environment variables directly.
- A physical `.env` file is required only when running locally or in a container that uses the `--env-file=.env` startup behavior.
- If Node reports `.env: not found`, ensure the file exists in the project root or configure the variables in the hosting platform.

## Deployment checklist

- Use Node 22+
- Set `DISCORD_TOKEN`
- Set `DATABASE_PATH` if needed
- Use `npm start` as the startup command
- Ensure `src/index.js` is the entry point
- Keep secrets out of the repo and out of the ZIP

## Support

Use the official repo for updates and releases:

https://github.com/sensiethegoat/tier-test-bot
