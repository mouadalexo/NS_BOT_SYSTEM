import type { Guild, GuildMember } from "discord.js";

/**
 * Replace ;emojiname tokens with the matching custom emoji from the guild.
 * If no emoji with that name exists, the literal token is left untouched.
 */
export function applyEmojis(text: string, guild: Guild | null | undefined): string {
  if (!text || !guild) return text;
  return text.replace(/;([a-zA-Z0-9_]{2,32})/g, (full, name: string) => {
    const e = guild.emojis.cache.find((em) => em.name?.toLowerCase() === name.toLowerCase());
    if (!e) return full;
    return e.animated ? `<a:${e.name}:${e.id}>` : `<:${e.name}:${e.id}>`;
  });
}

/**
 * Replace user/server placeholders. Safe to call without a member.
 */
export function applyVariables(
  template: string,
  member?: GuildMember | null,
  guild?: Guild | null,
): string {
  let out = template ?? "";
  if (member) {
    out = out
      .replace(/\{user_mention\}/gi, `<@${member.id}>`)
      .replace(/\{user\.tag\}/gi, member.user.tag)
      .replace(/\{user\.name\}/gi, member.user.username)
      .replace(/\{user\}/gi, `<@${member.id}>`);
  }
  const g = guild ?? member?.guild ?? null;
  if (g) {
    out = out
      .replace(/\{server\}/gi, g.name)
      .replace(/\{membercount\}/gi, String(g.memberCount))
      .replace(/\{member_count\}/gi, String(g.memberCount));
  }
  return out;
}

/** Convenience: variables then emojis. */
export function applyTemplate(
  template: string,
  member: GuildMember | null | undefined,
  guild: Guild,
): string {
  return applyEmojis(applyVariables(template, member ?? null, guild), guild);
}
