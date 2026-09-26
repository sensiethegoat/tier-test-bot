// Minimal stand-ins for the Discord objects the bot touches, so the real command,
// button and website code can run against a temporary SQLite database.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATABASE_PATH ??= join(mkdtempSync(join(tmpdir(), 'tier-test-')), 'test.db');

// discord.js collections are Maps with find/filter, which the bot relies on.
class Cache extends Map {
  find(fn) {
    for (const v of this.values()) if (fn(v)) return v;
    return undefined;
  }
  filter(fn) {
    return [...this.values()].filter(fn);
  }
}

export const channels = new Cache();
export const dms = [];
let nextId = 1000;
export const newId = () => String(nextId++);

export function mkChannel(guildId, name, extra = {}) {
  const id = newId();
  const messages = new Map();
  const channel = {
    id,
    name,
    guildId,
    type: 0,
    parentId: null,
    messages_: messages,
    overwrites: new Map(),
    isTextBased: () => true,
    toString: () => `#${name}`,
    // Channel permissions come from the member, so permission checks can actually fail.
    permissionsFor: (who) => ({
      has: (perm) => [perm].flat().every((p) => who?.permissions?.has?.(p) ?? true),
    }),
    async send(payload) {
      const message = {
        id: newId(),
        author: { id: 'bot' },
        payload,
        url: `https://discord.com/channels/${guildId}/${id}/m`,
        components: (payload.components ?? []).map((row) => ({
          components: (row.components ?? []).map((c) => ({ customId: c.data?.custom_id })),
        })),
        embeds: payload.embeds ?? [],
        async edit(next) {
          message.payload = { ...message.payload, ...next };
          return message;
        },
        async crosspost() {
          message.published = true;
        },
      };
      messages.set(message.id, message);
      return message;
    },
    messages: {
      async fetch(query) {
        if (typeof query === 'string') {
          const found = messages.get(query);
          if (!found) throw new Error('unknown message');
          return found;
        }
        return messages;
      },
    },
    permissionOverwrites: {
      async edit(id, value) {
        channel.overwrites.set(id, value);
      },
      async delete(id) {
        channel.overwrites.delete(id);
      },
    },
    async setName(name) {
      channel.name = name;
    },
    async delete() {
      channels.delete(id);
      channel.deleted = true;
    },
    ...extra,
  };
  channels.set(id, channel);
  return channel;
}

export function mkGuild(id = 'G1', name = 'Test Server') {
  const members = new Map();
  const roles = new Cache();
  const guild = {
    id,
    name,
    iconURL: () => null,
    roles: {
      everyone: { id },
      cache: roles,
      async create({ name, colors }) {
        const role = { id: newId(), name, colors, managed: false, position: 1, toString: () => `@${name}` };
        roles.set(role.id, role);
        return role;
      },
    },
    channels: {
      cache: channels,
      async fetch(cid) {
        return channels.get(cid) ?? null;
      },
      async create(options) {
        const channel = mkChannel(id, options.name);
        channel.type = options.type ?? 0;
        channel.parentId = options.parent ?? null;
        channel.createOptions = options;
        channel.guild = guild;
        return channel;
      },
    },
    members: {
      cache: members,
      me: { id: 'bot', permissions: { has: () => true }, roles: { highest: { position: 99 } } },
      async fetch(uid) {
        const member = members.get(uid);
        if (!member) throw new Error('unknown member');
        return member;
      },
    },
  };
  guild.client = {
    user: { id: 'bot', username: 'TierBot', displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png' },
    guilds: { cache: new Map([[id, guild]]) },
    channels: { fetch: async (cid) => channels.get(cid) ?? null },
    users: { fetch: async (uid) => ({ id: uid, send: async (m) => dms.push([uid, m]) }) },
    application: { fetch: async () => ({ owner: { id: 'owner' } }) },
  };
  return guild;
}

export function mkMember(guild, id, { admin = false, roles = [] } = {}) {
  const set = new Set(roles);
  const member = {
    id,
    guild,
    manageable: true,
    nickname: null,
    permissions: { has: () => admin },
    roles: {
      cache: { has: (r) => set.has(r) },
      async add(r) {
        [r].flat().forEach((x) => set.add(x));
      },
      async remove(r) {
        [r].flat().forEach((x) => set.delete(x));
      },
    },
    roleIds: set,
    user: { id, username: id, tag: id, toString: () => `<@${id}>`, displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png' },
    async setNickname(nick) {
      member.nickname = nick;
    },
  };
  guild.members.cache.set(id, member);
  return member;
}

const options = (values) => ({
  getSubcommand: () => values.sub,
  getSubcommandGroup: () => values.group ?? null,
  getString: (k) => values[k] ?? null,
  getInteger: (k) => values[k] ?? null,
  getBoolean: (k) => (k in values ? values[k] : null),
  getUser: (k) => values[k] ?? null,
  getRole: (k) => values[k] ?? null,
  getChannel: (k) => values[k] ?? null,
  getAttachment: (k) => values[k] ?? null,
  getFocused: () => values.focused,
});

/** Builds an interaction and records whatever the bot replies with. */
export function mkInteraction(guild, member, extra = {}) {
  const replies = [];
  const interaction = {
    id: newId(),
    guild,
    guildId: guild.id,
    member,
    user: member.user,
    client: guild.client,
    replies,
    deferred: false,
    replied: false,
    memberPermissions: member.permissions,
    inCachedGuild: () => true,
    isRepliable: () => true,
    isAutocomplete: () => false,
    isChatInputCommand: () => false,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    async deferReply() {
      interaction.deferred = true;
    },
    async reply(payload) {
      interaction.replied = true;
      replies.push(payload);
    },
    async editReply(payload) {
      interaction.replied = true;
      replies.push(payload);
    },
    async followUp(payload) {
      replies.push(payload);
    },
    async update(payload) {
      replies.push(payload);
    },
    async showModal(modal) {
      replies.push({ modal: modal.data.custom_id });
    },
    async respond(choices) {
      replies.push({ choices });
    },
    ...extra,
  };
  return interaction;
}

/** The text of the last reply, whatever shape it came in. */
export function lastText(interaction) {
  const reply = interaction.replies.at(-1);
  if (reply === undefined) return '';
  if (typeof reply === 'string') return reply;
  if (reply.modal) return `modal ${reply.modal}`;
  if (reply.choices) return reply.choices.map((c) => c.value).join(',');
  return reply.content ?? reply.embeds?.[0]?.data?.description ?? reply.embeds?.[0]?.data?.title ?? JSON.stringify(reply);
}

export const fields = (values) => ({ getTextInputValue: (k) => values[k] ?? '' });
export const asUser = (id) => ({ id, username: id, toString: () => `<@${id}>` });

/** Runs an interaction through the real router and returns the reply text (errors included). */
export async function run(handler, interaction) {
  try {
    await handler(interaction);
  } catch (err) {
    return `ERROR: ${err.message}`;
  }
  return lastText(interaction);
}
