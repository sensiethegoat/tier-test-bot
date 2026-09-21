import { ShardingManager } from 'discord.js';

// Discord requires sharding past 2,500 servers. Each shard is its own process sharing the
// same SQLite file (WAL mode handles concurrent access). Below that, `npm start` is enough.
const manager = new ShardingManager(new URL('./index.js', import.meta.url).pathname, {
  token: process.env.DISCORD_TOKEN,
  totalShards: 'auto',
});

manager.on('shardCreate', (shard) => console.log(`Launched shard ${shard.id}`));
await manager.spawn();
