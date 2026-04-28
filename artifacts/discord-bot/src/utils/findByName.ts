import {
  Guild,
  Role,
  GuildBasedChannel,
  ChannelType,
} from "discord.js";
import { normalizeName, scoreMatch } from "./normalize.js";

export type FindKind = "role" | "channel" | "category" | "voice" | "text" | "stage";

const TYPE_FOR_KIND: Record<Exclude<FindKind, "role">, ChannelType[]> = {
  channel: [
    ChannelType.GuildText,
    ChannelType.GuildVoice,
    ChannelType.GuildAnnouncement,
    ChannelType.GuildStageVoice,
    ChannelType.GuildForum,
    ChannelType.GuildMedia,
  ],
  category: [ChannelType.GuildCategory],
  voice: [ChannelType.GuildVoice, ChannelType.GuildStageVoice],
  text: [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum],
  stage: [ChannelType.GuildStageVoice],
};

interface Scored<T> {
  item: T;
  score: number;
}

export function findRoles(guild: Guild, query: string, limit = 25): Role[] {
  const q = normalizeName(query);
  if (!q) return [];
  const scored: Scored<Role>[] = [];
  for (const role of guild.roles.cache.values()) {
    if (role.id === guild.id) continue; // skip @everyone
    const score = scoreMatch(role.name, q);
    if (score > 0) scored.push({ item: role, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.item);
}

export function findChannels(
  guild: Guild,
  query: string,
  kind: Exclude<FindKind, "role"> = "channel",
  limit = 25
): GuildBasedChannel[] {
  const q = normalizeName(query);
  if (!q) return [];
  const types = new Set(TYPE_FOR_KIND[kind]);
  const scored: Scored<GuildBasedChannel>[] = [];
  for (const ch of guild.channels.cache.values()) {
    if (!types.has(ch.type)) continue;
    const score = scoreMatch(ch.name ?? "", q);
    if (score > 0) scored.push({ item: ch, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.item);
}

export function describeChannel(ch: GuildBasedChannel): string {
  switch (ch.type) {
    case ChannelType.GuildCategory:
      return `[Category] ${ch.name}`;
    case ChannelType.GuildVoice:
      return `[Voice] ${ch.name}`;
    case ChannelType.GuildStageVoice:
      return `[Stage] ${ch.name}`;
    case ChannelType.GuildAnnouncement:
      return `[News] ${ch.name}`;
    case ChannelType.GuildForum:
      return `[Forum] ${ch.name}`;
    default:
      return `#${ch.name}`;
  }
}
