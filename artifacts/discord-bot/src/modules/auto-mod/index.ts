import {
  Client,
  Message,
  GuildMember,
  PermissionsBitField,
  ChannelType,
  Collection,
  EmbedBuilder,
  TextChannel,
} from "discord.js";
import { pool } from "@workspace/db";
import { isMainGuild } from "../../utils/guildFilter.js";
import { applyTemplate } from "../../utils/templates.js";

// ============================================================================
// Types
// ============================================================================

export type AutoModConfig = {
  guildId: string;
  ignoredRoleIds: string[];
  // Anti-Link
  linksEnabled: boolean;
  linksWhitelist: string[];
  linksIgnoredRoleIds: string[];
  // Anti-Spam
  spamEnabled: boolean;
  spamIgnoredCategoryIds: string[];
  // Channel modes
  imageOnlyChannelIds: string[];
  linkOnlyChannelIds: string[];
  // Logs
  logsChannelId: string | null;
};

export type AutoResponse = {
  id: number;
  guildId: string;
  triggerText: string;
  matchType: "contains" | "exact" | "starts_with";
  responseText: string;
  enabledRoleIds: string[];
  allowedChannelIds: string[];
  enabled: boolean;
  cooldownSeconds: number;
};

// ============================================================================
// Whitelist seed (from staff screenshot)
// ============================================================================

export const DEFAULT_LINK_WHITELIST: string[] = [
  "tenor.com",
  "youtube.com",
  "youtu.be",
  "spotify.com",
  "soundcloud.com",
  "music.apple.com",
  "deezer.com",
  "shazam.com",
  "genius.com",
  "instagram.com",
  "tiktok.com",
  "reddit.com",
  "steampowered.com",
  "store.steampowered.com",
  "riotgames.com",
  "epicgames.com",
  "ea.com",
  "wikipedia.org",
  "drive.google.com",
  "imgur.com",
  "giphy.com",
  "maps.google.com",
  "forms.google.com",
  "codenames.game",
  "discord.gg/nightstars",
  "capitoly.duckdns.org",
];

const DEFAULT_BLOCK_REPLY = "Link not allowed by server staff. Open a ticket if you need an exception.";
const DEFAULT_IMAGE_ONLY_REPLY = "This channel is image-only. Please share an image or attachment.";
const DEFAULT_LINK_ONLY_REPLY = "This channel is link-only. Please share a link.";

// ============================================================================
// Schema
// ============================================================================

export async function ensureAutoModSchema(): Promise<void> {
  await pool.query(`
    create table if not exists auto_mod_config (
      guild_id text primary key,
      ignored_role_ids_json text not null default '[]',
      links_enabled boolean not null default false,
      links_whitelist_json text not null default '[]',
      links_ignored_role_ids_json text not null default '[]',
      spam_enabled boolean not null default false,
      spam_ignored_category_ids_json text not null default '[]',
      image_only_channel_ids_json text not null default '[]',
      link_only_channel_ids_json text not null default '[]',
      logs_channel_id text,
      seeded boolean not null default false,
      updated_at timestamp default now() not null
    );
    alter table auto_mod_config add column if not exists logs_channel_id text;
    create table if not exists auto_mod_responses (
      id serial primary key,
      guild_id text not null,
      trigger_text text not null,
      match_type text not null default 'contains',
      response_text text not null,
      enabled_role_ids_json text not null default '[]',
      allowed_channel_ids_json text not null default '[]',
      enabled boolean not null default true,
      cooldown_seconds int not null default 0,
      created_at timestamp default now() not null,
      updated_at timestamp default now() not null
    );
    create index if not exists auto_mod_responses_guild_idx
      on auto_mod_responses(guild_id);
  `);
}

// ============================================================================
// Config helpers
// ============================================================================

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function getAutoModConfig(guildId: string): Promise<AutoModConfig> {
  const { rows } = await pool.query(
    `select * from auto_mod_config where guild_id = $1 limit 1`,
    [guildId],
  );
  let row = rows[0];

  if (!row) {
    // Seed default whitelist on first creation
    await pool.query(
      `insert into auto_mod_config (guild_id, links_whitelist_json, seeded)
       values ($1, $2, true)
       on conflict (guild_id) do nothing`,
      [guildId, JSON.stringify(DEFAULT_LINK_WHITELIST)],
    );
    const seeded = await pool.query(
      `select * from auto_mod_config where guild_id = $1 limit 1`,
      [guildId],
    );
    row = seeded.rows[0];
  } else if (!row.seeded) {
    // Existing row not yet seeded — seed defaults if whitelist is empty
    const wl = parseJsonArray(row.links_whitelist_json);
    if (wl.length === 0) {
      await pool.query(
        `update auto_mod_config
            set links_whitelist_json = $2, seeded = true, updated_at = now()
          where guild_id = $1`,
        [guildId, JSON.stringify(DEFAULT_LINK_WHITELIST)],
      );
      row.links_whitelist_json = JSON.stringify(DEFAULT_LINK_WHITELIST);
    } else {
      await pool.query(
        `update auto_mod_config set seeded = true where guild_id = $1`,
        [guildId],
      );
    }
  }

  return {
    guildId,
    ignoredRoleIds: parseJsonArray(row.ignored_role_ids_json),
    linksEnabled: !!row.links_enabled,
    linksWhitelist: parseJsonArray(row.links_whitelist_json),
    linksIgnoredRoleIds: parseJsonArray(row.links_ignored_role_ids_json),
    spamEnabled: !!row.spam_enabled,
    spamIgnoredCategoryIds: parseJsonArray(row.spam_ignored_category_ids_json),
    imageOnlyChannelIds: parseJsonArray(row.image_only_channel_ids_json),
    linkOnlyChannelIds: parseJsonArray(row.link_only_channel_ids_json),
    logsChannelId: row.logs_channel_id ?? null,
  };
}

export async function setAutoModField<K extends keyof AutoModConfig>(
  guildId: string,
  field: K,
  value: AutoModConfig[K],
): Promise<void> {
  await getAutoModConfig(guildId); // ensures row exists + seeded
  const map: Record<string, string> = {
    ignoredRoleIds: "ignored_role_ids_json",
    linksWhitelist: "links_whitelist_json",
    linksIgnoredRoleIds: "links_ignored_role_ids_json",
    spamIgnoredCategoryIds: "spam_ignored_category_ids_json",
    imageOnlyChannelIds: "image_only_channel_ids_json",
    linkOnlyChannelIds: "link_only_channel_ids_json",
    linksEnabled: "links_enabled",
    spamEnabled: "spam_enabled",
    logsChannelId: "logs_channel_id",
  };
  const col = map[field as string];
  if (!col) return;
  let val: string | boolean | null;
  if (value === null || value === undefined) val = null;
  else if (typeof value === "boolean" || typeof value === "string") val = value;
  else val = JSON.stringify(value);
  await pool.query(
    `update auto_mod_config set ${col} = $2, updated_at = now() where guild_id = $1`,
    [guildId, val],
  );
}

export async function listAutoResponses(guildId: string): Promise<AutoResponse[]> {
  const { rows } = await pool.query(
    `select * from auto_mod_responses where guild_id = $1 order by id asc`,
    [guildId],
  );
  return rows.map((r) => ({
    id: r.id,
    guildId: r.guild_id,
    triggerText: r.trigger_text,
    matchType: (r.match_type as AutoResponse["matchType"]) ?? "contains",
    responseText: r.response_text,
    enabledRoleIds: parseJsonArray(r.enabled_role_ids_json),
    allowedChannelIds: parseJsonArray(r.allowed_channel_ids_json),
    enabled: !!r.enabled,
    cooldownSeconds: r.cooldown_seconds ?? 0,
  }));
}

export async function getAutoResponse(id: number): Promise<AutoResponse | null> {
  const { rows } = await pool.query(
    `select * from auto_mod_responses where id = $1 limit 1`,
    [id],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    guildId: r.guild_id,
    triggerText: r.trigger_text,
    matchType: (r.match_type as AutoResponse["matchType"]) ?? "contains",
    responseText: r.response_text,
    enabledRoleIds: parseJsonArray(r.enabled_role_ids_json),
    allowedChannelIds: parseJsonArray(r.allowed_channel_ids_json),
    enabled: !!r.enabled,
    cooldownSeconds: r.cooldown_seconds ?? 0,
  };
}

export async function createAutoResponse(
  guildId: string,
  triggerText: string,
  responseText: string,
): Promise<AutoResponse> {
  const { rows } = await pool.query(
    `insert into auto_mod_responses (guild_id, trigger_text, response_text)
     values ($1, $2, $3)
     returning *`,
    [guildId, triggerText, responseText],
  );
  const r = rows[0];
  return {
    id: r.id,
    guildId: r.guild_id,
    triggerText: r.trigger_text,
    matchType: "contains",
    responseText: r.response_text,
    enabledRoleIds: [],
    allowedChannelIds: [],
    enabled: true,
    cooldownSeconds: 0,
  };
}

export async function updateAutoResponse(
  id: number,
  patch: Partial<Omit<AutoResponse, "id" | "guildId">>,
): Promise<void> {
  const sets: string[] = [];
  const vals: any[] = [id];
  const map: Record<string, string> = {
    triggerText: "trigger_text",
    matchType: "match_type",
    responseText: "response_text",
    enabledRoleIds: "enabled_role_ids_json",
    allowedChannelIds: "allowed_channel_ids_json",
    enabled: "enabled",
    cooldownSeconds: "cooldown_seconds",
  };
  for (const [k, v] of Object.entries(patch)) {
    const col = map[k];
    if (!col) continue;
    sets.push(`${col} = $${vals.length + 1}`);
    if (Array.isArray(v)) vals.push(JSON.stringify(v));
    else vals.push(v);
  }
  if (!sets.length) return;
  sets.push(`updated_at = now()`);
  await pool.query(
    `update auto_mod_responses set ${sets.join(", ")} where id = $1`,
    vals,
  );
}

export async function deleteAutoResponse(id: number): Promise<void> {
  await pool.query(`delete from auto_mod_responses where id = $1`, [id]);
}

// ============================================================================
// URL / link utilities
// ============================================================================

const URL_REGEX =
  /\b((?:https?:\/\/|discord\.gg\/|www\.)[^\s<>()"]+|[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s<>()"]*)?)\b/gi;

function normalizeWhitelistEntry(raw: string): { host: string; path: string } {
  let s = raw.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  const slash = s.indexOf("/");
  if (slash === -1) return { host: s, path: "" };
  return { host: s.slice(0, slash), path: s.slice(slash) };
}

function parseUrl(token: string): { host: string; path: string } | null {
  let s = token.trim().toLowerCase();
  if (!/^https?:\/\//.test(s)) {
    if (/^discord\.gg\//.test(s)) s = `https://${s}`;
    else if (/^www\./.test(s) || /^[a-z0-9-]+(?:\.[a-z0-9-]+)+/.test(s)) s = `https://${s}`;
    else return null;
  }
  try {
    const u = new URL(s);
    return { host: u.hostname.replace(/^www\./, ""), path: u.pathname };
  } catch {
    return null;
  }
}

function isHostMatch(host: string, entryHost: string): boolean {
  if (!entryHost) return false;
  return host === entryHost || host.endsWith("." + entryHost);
}

function isUrlWhitelisted(url: { host: string; path: string }, whitelist: string[]): boolean {
  for (const raw of whitelist) {
    const { host: eh, path: ep } = normalizeWhitelistEntry(raw);
    if (!eh) continue;
    if (!isHostMatch(url.host, eh)) continue;
    if (!ep) return true; // host-only entry → any path on that host is allowed
    // Path entry: URL path must start with it (case-insensitive)
    if (url.path.toLowerCase().startsWith(ep.toLowerCase())) return true;
  }
  return false;
}

function extractUrls(text: string): { host: string; path: string }[] {
  const found = new Map<string, { host: string; path: string }>();
  for (const m of text.matchAll(URL_REGEX)) {
    const u = parseUrl(m[0]);
    if (!u) continue;
    const key = u.host + u.path;
    if (!found.has(key)) found.set(key, u);
  }
  return [...found.values()];
}

// ============================================================================
// Self-deleting "ephemeral-style" warnings
// ============================================================================

async function sendTransientWarning(message: Message, body: string): Promise<void> {
  if (!message.channel || !("send" in message.channel)) return;
  try {
    const sent = await message.channel.send({
      content: `<@${message.author.id}> ${body}`,
      allowedMentions: { users: [message.author.id], roles: [], parse: [] },
    });
    setTimeout(() => {
      sent.delete().catch(() => {});
    }, 6000);
  } catch {
    /* ignore */
  }
}

async function safeDelete(message: Message): Promise<void> {
  try {
    if (message.deletable) await message.delete();
  } catch {
    /* may already be gone */
  }
}

// ============================================================================
// Mod log
// ============================================================================

const LOG_COLORS = {
  link: 0xff5555,
  imageOnly: 0xffa500,
  linkOnly: 0xffa500,
  spam: 0xff4444,
  timeout: 0xb00020,
  response: 0x5000ff,
} as const;

type ModAction =
  | { kind: "link"; url: string }
  | { kind: "imageOnly" }
  | { kind: "linkOnly" }
  | { kind: "spam"; count: number }
  | { kind: "timeout"; durationMin: number; reason: string }
  | { kind: "response"; trigger: string; responseId: number };

function actionTitle(a: ModAction): string {
  switch (a.kind) {
    case "link": return "🔗 Link removed";
    case "imageOnly": return "🖼️ Image-only channel — message removed";
    case "linkOnly": return "🔗 Link-only channel — message removed";
    case "spam": return "⚡ Spam burst removed";
    case "timeout": return "⏱️ Timeout applied";
    case "response": return "💬 Auto-response triggered";
  }
}

function actionColor(a: ModAction): number {
  switch (a.kind) {
    case "link": return LOG_COLORS.link;
    case "imageOnly": return LOG_COLORS.imageOnly;
    case "linkOnly": return LOG_COLORS.linkOnly;
    case "spam": return LOG_COLORS.spam;
    case "timeout": return LOG_COLORS.timeout;
    case "response": return LOG_COLORS.response;
  }
}

function snippet(s: string, max = 800): string {
  if (!s) return "_(empty)_";
  const t = s.replace(/```/g, "ʼʼʼ");
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + "…";
}

async function logModAction(
  message: Message,
  cfg: AutoModConfig,
  action: ModAction,
): Promise<void> {
  const channelId = cfg.logsChannelId;
  if (!channelId) return;
  const guild = message.guild;
  if (!guild) return;
  let logChannel: TextChannel | null = null;
  try {
    const fetched = guild.channels.cache.get(channelId)
      ?? (await guild.channels.fetch(channelId).catch(() => null));
    if (fetched && fetched.type === ChannelType.GuildText) {
      logChannel = fetched as TextChannel;
    }
  } catch { /* ignore */ }
  if (!logChannel) return;

  const embed = new EmbedBuilder()
    .setColor(actionColor(action))
    .setTitle(actionTitle(action))
    .setTimestamp(new Date());

  const fields: { name: string; value: string; inline?: boolean }[] = [
    { name: "Member", value: `<@${message.author.id}> \`${message.author.tag}\``, inline: true },
    { name: "Channel", value: `<#${message.channelId}>`, inline: true },
  ];

  if (action.kind === "link") {
    fields.push({ name: "Blocked URL", value: `\`${snippet(action.url, 200)}\``, inline: false });
  } else if (action.kind === "spam") {
    fields.push({ name: "Messages removed", value: `${action.count}`, inline: true });
  } else if (action.kind === "timeout") {
    fields.push(
      { name: "Duration", value: `${action.durationMin} min`, inline: true },
      { name: "Reason", value: action.reason, inline: false },
    );
  } else if (action.kind === "response") {
    fields.push(
      { name: "Trigger", value: `\`${snippet(action.trigger, 80)}\``, inline: true },
      { name: "Response ID", value: `#${action.responseId}`, inline: true },
    );
  }

  if (action.kind !== "response" && message.content) {
    fields.push({ name: "Message content", value: "```\n" + snippet(message.content, 900) + "\n```", inline: false });
  }

  embed.addFields(...fields);
  embed.setFooter({ text: `Night Stars • Auto-Mod • ${message.author.id}` });

  try {
    await logChannel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch { /* ignore */ }
}

// ============================================================================
// Spam tracker (in-memory)
// ============================================================================

type SpamRecord = {
  timestamps: number[];
  warnedAt: number; // last time we deleted+warned
  warnCount: number; // resets after a quiet window
};

const SPAM_WINDOW_MS = 5_000;
const SPAM_THRESHOLD = 5;
const SPAM_RESET_MS = 5 * 60_000;
const TIMEOUT_MS = 10 * 60_000;

const spamRecords = new Map<string, SpamRecord>();
// also track recent message ids per user so we can delete the burst
const recentMessages = new Map<string, { id: string; channelId: string; ts: number }[]>();

function spamKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

function trackMessage(guildId: string, userId: string, msg: Message): SpamRecord {
  const key = spamKey(guildId, userId);
  const now = Date.now();
  const rec = spamRecords.get(key) ?? { timestamps: [], warnedAt: 0, warnCount: 0 };
  rec.timestamps = rec.timestamps.filter((t) => now - t <= SPAM_WINDOW_MS);
  rec.timestamps.push(now);
  if (rec.warnedAt && now - rec.warnedAt > SPAM_RESET_MS) rec.warnCount = 0;
  spamRecords.set(key, rec);

  const recent = recentMessages.get(key) ?? [];
  const pruned = recent.filter((m) => now - m.ts <= SPAM_WINDOW_MS);
  pruned.push({ id: msg.id, channelId: msg.channelId, ts: now });
  recentMessages.set(key, pruned);

  return rec;
}

async function deleteSpamBurst(message: Message): Promise<number> {
  const key = spamKey(message.guildId!, message.author.id);
  const recent = recentMessages.get(key) ?? [];
  const channel = message.channel;
  if (!channel || !("messages" in channel)) return 0;
  const ids = recent.filter((m) => m.channelId === message.channelId).map((m) => m.id);
  if (ids.length === 0) return 0;
  // bulkDelete only works for messages < 14 days old, which is always true here
  try {
    if (ids.length > 1 && (channel as any).bulkDelete) {
      await (channel as any).bulkDelete(ids, true).catch(() => {});
    } else {
      for (const id of ids) {
        await channel.messages.delete(id).catch(() => {});
      }
    }
    recentMessages.set(key, []);
    return ids.length;
  } catch {
    return ids.length;
  }
}

// ============================================================================
// Auto-respond cooldowns (in-memory)
// ============================================================================

const respondCooldowns = new Map<string, number>(); // `${guildId}:${responseId}:${userId}` → expiry ms

function isOnCooldown(key: string): boolean {
  const until = respondCooldowns.get(key);
  if (!until) return false;
  if (Date.now() >= until) {
    respondCooldowns.delete(key);
    return false;
  }
  return true;
}

function setCooldown(key: string, seconds: number): void {
  if (seconds <= 0) return;
  respondCooldowns.set(key, Date.now() + seconds * 1000);
}

function matchesTrigger(content: string, trigger: string, type: AutoResponse["matchType"]): boolean {
  const c = content.trim().toLowerCase();
  const t = trigger.trim().toLowerCase();
  if (!t) return false;
  switch (type) {
    case "exact":
      return c === t;
    case "starts_with":
      return c.startsWith(t);
    case "contains":
    default: {
      // word-ish match: trigger as substring with word boundaries when possible
      if (/^\w+$/.test(t)) {
        const re = new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
        return re.test(content);
      }
      return c.includes(t);
    }
  }
}

// ============================================================================
// Per-guild caches with short TTL to avoid hammering the DB on every message
// ============================================================================

const CACHE_TTL_MS = 10_000;
const configCache = new Map<string, { value: AutoModConfig; until: number }>();
const responsesCache = new Map<string, { value: AutoResponse[]; until: number }>();

async function getCachedConfig(guildId: string): Promise<AutoModConfig> {
  const hit = configCache.get(guildId);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = await getAutoModConfig(guildId);
  configCache.set(guildId, { value, until: Date.now() + CACHE_TTL_MS });
  return value;
}

async function getCachedResponses(guildId: string): Promise<AutoResponse[]> {
  const hit = responsesCache.get(guildId);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = await listAutoResponses(guildId);
  responsesCache.set(guildId, { value, until: Date.now() + CACHE_TTL_MS });
  return value;
}

export function invalidateAutoModCache(guildId: string): void {
  configCache.delete(guildId);
  responsesCache.delete(guildId);
}

// ============================================================================
// Main message handler
// ============================================================================

function memberRoleIds(member: GuildMember | null): string[] {
  if (!member) return [];
  return [...member.roles.cache.keys()];
}

function memberHasAny(member: GuildMember | null, ids: string[]): boolean {
  if (!member || ids.length === 0) return false;
  for (const id of ids) {
    if (member.roles.cache.has(id)) return true;
  }
  return false;
}

function isAdmin(member: GuildMember | null): boolean {
  if (!member) return false;
  return member.permissions.has(PermissionsBitField.Flags.Administrator);
}

async function handleMessage(message: Message): Promise<void> {
  if (!message.guild || message.author.bot) return;
  if (!isMainGuild(message.guildId)) return;
  if (
    message.channel.type !== ChannelType.GuildText &&
    message.channel.type !== ChannelType.GuildAnnouncement &&
    message.channel.type !== ChannelType.PublicThread &&
    message.channel.type !== ChannelType.PrivateThread &&
    message.channel.type !== ChannelType.AnnouncementThread
  ) {
    return;
  }

  const config = await getCachedConfig(message.guildId!);
  const member = (message.member ?? null) as GuildMember | null;
  const admin = isAdmin(member);

  // Server-wide ignored roles bypass moderation entirely (still get auto-respond).
  const globallyIgnored = memberHasAny(member, config.ignoredRoleIds);

  let deleted = false;

  // --- Image-only channels --------------------------------------------------
  if (
    !deleted &&
    !admin &&
    !globallyIgnored &&
    config.imageOnlyChannelIds.includes(message.channelId)
  ) {
    const hasAttachmentImage = message.attachments.some((a) => {
      const ct = a.contentType ?? "";
      const url = a.url ?? "";
      return ct.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|tiff?)(\?|$)/i.test(url);
    });
    const hasEmbedImage = message.embeds.some((e) => !!(e.image || e.thumbnail));
    if (!hasAttachmentImage && !hasEmbedImage) {
      await safeDelete(message);
      await sendTransientWarning(message, DEFAULT_IMAGE_ONLY_REPLY);
      void logModAction(message, config, { kind: "imageOnly" });
      deleted = true;
    }
  }

  // --- Link-only channels ---------------------------------------------------
  if (
    !deleted &&
    !admin &&
    !globallyIgnored &&
    config.linkOnlyChannelIds.includes(message.channelId)
  ) {
    const urls = extractUrls(message.content ?? "");
    if (urls.length === 0) {
      await safeDelete(message);
      await sendTransientWarning(message, DEFAULT_LINK_ONLY_REPLY);
      void logModAction(message, config, { kind: "linkOnly" });
      deleted = true;
    }
  }

  // --- Anti-link ------------------------------------------------------------
  if (
    !deleted &&
    !admin &&
    !globallyIgnored &&
    config.linksEnabled &&
    !memberHasAny(member, config.linksIgnoredRoleIds) &&
    // Don't double-check link-only channels (any link is allowed there)
    !config.linkOnlyChannelIds.includes(message.channelId)
  ) {
    const urls = extractUrls(message.content ?? "");
    if (urls.length > 0) {
      const blocked = urls.find((u) => !isUrlWhitelisted(u, config.linksWhitelist));
      if (blocked) {
        await safeDelete(message);
        await sendTransientWarning(message, DEFAULT_BLOCK_REPLY);
        void logModAction(message, config, {
          kind: "link",
          url: blocked.host + blocked.path,
        });
        deleted = true;
      }
    }
  }

  // --- Anti-spam ------------------------------------------------------------
  if (!deleted && !admin && !globallyIgnored && config.spamEnabled) {
    const parentId = (message.channel as any).parentId ?? null;
    const ignored = parentId && config.spamIgnoredCategoryIds.includes(parentId);
    if (!ignored) {
      const rec = trackMessage(message.guildId!, message.author.id, message);
      if (rec.timestamps.length >= SPAM_THRESHOLD) {
        // Only act once per burst — clear timestamps so we don't re-trigger
        rec.timestamps = [];
        rec.warnCount += 1;
        rec.warnedAt = Date.now();
        const removed = await deleteSpamBurst(message);
        void logModAction(message, config, { kind: "spam", count: removed });
        if (rec.warnCount >= 2 && member) {
          try {
            await member.timeout(TIMEOUT_MS, "Auto-Mod: spam (5 msg/5s, repeat offense)");
            await sendTransientWarning(
              message,
              "you have been timed out for 10 minutes for repeated spam.",
            );
            void logModAction(message, config, {
              kind: "timeout",
              durationMin: TIMEOUT_MS / 60_000,
              reason: "Repeated spam (5 msg / 5s)",
            });
          } catch {
            await sendTransientWarning(
              message,
              "spam detected — please slow down.",
            );
          }
        } else {
          await sendTransientWarning(
            message,
            "spam detected — your messages were removed. Please slow down.",
          );
        }
        deleted = true;
      }
    }
  }

  if (deleted) return;

  // --- Auto-Respond ---------------------------------------------------------
  const responses = await getCachedResponses(message.guildId!);
  if (!responses.length) return;
  for (const r of responses) {
    if (!r.enabled) continue;
    if (r.allowedChannelIds.length > 0 && !r.allowedChannelIds.includes(message.channelId)) continue;
    if (r.enabledRoleIds.length > 0 && !memberHasAny(member, r.enabledRoleIds)) continue;
    if (!matchesTrigger(message.content ?? "", r.triggerText, r.matchType)) continue;
    const cdKey = `${message.guildId}:${r.id}:${message.author.id}`;
    if (isOnCooldown(cdKey)) continue;
    const rendered = applyTemplate(r.responseText, member, message.guild!);
    try {
      await message.reply({
        content: rendered,
        allowedMentions: { parse: ["users"], repliedUser: false },
      });
      setCooldown(cdKey, r.cooldownSeconds);
      void logModAction(message, config, {
        kind: "response",
        trigger: r.triggerText,
        responseId: r.id,
      });
    } catch {
      /* ignore */
    }
    break; // one response per message
  }
}

// ============================================================================
// Registration
// ============================================================================

export async function registerAutoModModule(client: Client): Promise<void> {
  await ensureAutoModSchema();
  client.on("messageCreate", (msg) => {
    void handleMessage(msg as Message).catch((err) =>
      console.error("[AutoMod] handler error:", err),
    );
  });
  console.log("[AutoMod] module registered");
}
