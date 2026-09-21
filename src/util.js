import { MessageFlags, PermissionFlagsBits } from 'discord.js';

/** An error whose message is safe to show the user. */
export class UserError extends Error {}

export const EPHEMERAL = { flags: MessageFlags.Ephemeral };

export const COLORS = {
  primary: 0x5865f2,
  success: 0x57f287,
  danger: 0xed4245,
  gold: 0xf1c40f,
  grey: 0x4f545c,
};

export const ts = (ms, style = 'R') => `<t:${Math.floor(ms / 1000)}:${style}>`;

export const isAdmin = (member) => member.permissions.has(PermissionFlagsBits.ManageGuild);
