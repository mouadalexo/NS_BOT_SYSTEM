import {
  AttachmentBuilder,
  Client,
  EmbedBuilder,
  Guild,
  GuildMember,
  NewsChannel,
  TextChannel,
} from "discord.js";
import { pool } from "@workspace/db";
import { isMainGuild } from "../../utils/guildFilter.js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import sharp from "sharp";

// ============================================================================
// Types & defaults
// ============================================================================

export type ServerWelcome = {
  enabled: boolean;
  /** Single-line text shown under the image. Supports {tokens} and ;emojiname */
  message: string;
  /** Optional override of the composited template image URL. Empty = bundled template. */
  imageUrl: string | null;
};

export type DmWelcome = {
  enabled: boolean;
  mode: "embed" | "text";
  /** Single editor — used as content (text mode) or as the embed description (embed mode). */
  message: string;
};

export type WelcomeConfig = {
  channelId: string | null;
  server: ServerWelcome;
  dm: DmWelcome;
};

const DEFAULTS: WelcomeConfig = {
  channelId: null,
  server: {
    enabled: false,
    message: ";fire MRHBA BIK {user_mention} F NIGHT STARS ;fire",
    imageUrl: null,
  },
  dm: {
    enabled: false,
    mode: "embed",
    message:
      "Welcome to **{server}**, {user}! \uD83C\uDF1F\n\nWe're glad you're here. Take a moment to read the rules and introduce yourself in the community channels. Have fun!",
  },
};

export function defaultWelcomeConfig(): WelcomeConfig {
  return JSON.parse(JSON.stringify(DEFAULTS));
}

function mergeConfig(raw: any): WelcomeConfig {
  const base = defaultWelcomeConfig();
  if (!raw || typeof raw !== "object") return base;
  base.channelId = typeof raw.channelId === "string" ? raw.channelId : null;
  if (raw.server && typeof raw.server === "object") {
    base.server = {
      enabled: !!raw.server.enabled,
      message:
        typeof raw.server.message === "string"
          ? raw.server.message
          : typeof raw.server.description === "string"
            ? raw.server.description
            : base.server.message,
      imageUrl: typeof raw.server.imageUrl === "string" && raw.server.imageUrl ? raw.server.imageUrl : null,
    };
  }
  if (raw.dm && typeof raw.dm === "object") {
    base.dm = {
      enabled: !!raw.dm.enabled,
      mode: raw.dm.mode === "text" ? "text" : "embed",
      message:
        typeof raw.dm.message === "string"
          ? raw.dm.message
          : typeof raw.dm.description === "string"
            ? raw.dm.description
            : base.dm.message,
    };
  }
  return base;
}

export async function getWelcomeConfig(guildId: string): Promise<WelcomeConfig> {
  const result = await pool.query<{ welcome_config_json: string | null }>(
    "select welcome_config_json from bot_config where guild_id = $1 limit 1",
    [guildId],
  );
  const raw = result.rows[0]?.welcome_config_json;
  if (!raw) return defaultWelcomeConfig();
  try {
    return mergeConfig(JSON.parse(raw));
  } catch {
    return defaultWelcomeConfig();
  }
}

export async function saveWelcomeConfig(guildId: string, config: WelcomeConfig): Promise<void> {
  const json = JSON.stringify(config);
  await pool.query(
    `insert into bot_config (guild_id, welcome_config_json, updated_at)
     values ($1, $2, now())
     on conflict (guild_id) do update set welcome_config_json = excluded.welcome_config_json, updated_at = now()`,
    [guildId, json],
  );
}

// ============================================================================
// Variable + emoji substitution
// ============================================================================

export function applyVariables(template: string, member: GuildMember): string {
  const guild = member.guild;
  return template
    .replace(/\{user_mention\}/gi, `<@${member.id}>`)
    .replace(/\{user\.tag\}/gi, member.user.tag)
    .replace(/\{user\.name\}/gi, member.user.username)
    .replace(/\{user\}/gi, member.displayName || member.user.username)
    .replace(/\{server\}/gi, guild.name)
    .replace(/\{membercount\}/gi, String(guild.memberCount))
    .replace(/\{member_count\}/gi, String(guild.memberCount));
}

/** Replaces ;emojiname tokens with actual guild emoji markup if the emoji exists. */
export function applyEmojis(text: string, guild: Guild): string {
  return text.replace(/;([a-zA-Z0-9_]{2,32})/g, (full, name: string) => {
    const e = guild.emojis.cache.find((em) => em.name?.toLowerCase() === name.toLowerCase());
    if (!e) return full;
    return e.animated ? `<a:${e.name}:${e.id}>` : `<:${e.name}:${e.id}>`;
  });
}

function applyAll(template: string, member: GuildMember): string {
  return applyEmojis(applyVariables(template, member), member.guild);
}

// ============================================================================
// Image compositing — overlay user avatar onto the welcome template
// ============================================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// modules/welcome/index.ts → ../../../assets/welcome_template.png
const TEMPLATE_PATH = path.resolve(__dirname, "../../../assets/welcome_template.png");

// Coordinates detected from the template (1080x1350): red dot center & radius.
const DOT_CENTER_X = 360;
const DOT_CENTER_Y = 996;
const DOT_RADIUS = 199;

let templateBufferCache: Buffer | null = null;
function loadTemplate(): Buffer {
  if (!templateBufferCache) {
    templateBufferCache = fs.readFileSync(TEMPLATE_PATH);
  }
  return templateBufferCache;
}

export async function composeWelcomeImage(member: GuildMember): Promise<Buffer> {
  const template = loadTemplate();
  const avatarUrl = member.displayAvatarURL({ extension: "png", size: 512, forceStatic: true });
  const avatarRes = await fetch(avatarUrl);
  const avatarBuf = Buffer.from(await avatarRes.arrayBuffer());

  const diameter = DOT_RADIUS * 2;
  // Resize the avatar to the dot diameter
  const sizedAvatar = await sharp(avatarBuf).resize(diameter, diameter, { fit: "cover" }).png().toBuffer();

  // Build a circular alpha mask
  const mask = Buffer.from(
    `<svg width="${diameter}" height="${diameter}"><circle cx="${DOT_RADIUS}" cy="${DOT_RADIUS}" r="${DOT_RADIUS}" fill="white"/></svg>`,
  );
  const circularAvatar = await sharp(sizedAvatar)
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();

  const left = DOT_CENTER_X - DOT_RADIUS;
  const top = DOT_CENTER_Y - DOT_RADIUS;
  return sharp(template)
    .composite([{ input: circularAvatar, left, top }])
    .png()
    .toBuffer();
}

// ============================================================================
// Payload builders & sending
// ============================================================================

async function buildServerPayload(member: GuildMember, cfg: WelcomeConfig) {
  const v = cfg.server;
  const content = applyAll(v.message ?? "", member).trim() || `${applyAll("{user_mention}", member)} just joined!`;

  // Custom remote image overrides the composited template entirely.
  if (v.imageUrl) {
    return {
      content,
      files: [v.imageUrl],
      allowedMentions: { users: [member.id] },
    };
  }

  try {
    const buf = await composeWelcomeImage(member);
    const file = new AttachmentBuilder(buf, { name: "welcome.png" });
    return {
      content,
      files: [file],
      allowedMentions: { users: [member.id] },
    };
  } catch (err) {
    console.error("[Welcome] image compose failed, sending text only:", err);
    return {
      content,
      allowedMentions: { users: [member.id] },
    };
  }
}

function buildDmPayload(member: GuildMember, cfg: WelcomeConfig) {
  const v = cfg.dm;
  const text = applyAll(v.message ?? "", member);
  if (!text.trim()) return null;
  if (v.mode === "text") {
    return { content: text };
  }
  const eb = new EmbedBuilder().setColor(0x5000ff).setDescription(text);
  return { embeds: [eb] };
}

export async function sendWelcomePreview(
  member: GuildMember,
  variant: "server" | "dm",
): Promise<{ ok: boolean; reason?: string }> {
  const cfg = await getWelcomeConfig(member.guild.id);
  if (variant === "server") {
    if (!cfg.channelId) return { ok: false, reason: "No welcome channel set" };
    const ch = member.guild.channels.cache.get(cfg.channelId);
    if (!(ch instanceof TextChannel || ch instanceof NewsChannel)) {
      return { ok: false, reason: "Welcome channel not found" };
    }
    const payload = await buildServerPayload(member, cfg);
    await ch.send(payload);
    return { ok: true };
  }
  const payload = buildDmPayload(member, cfg);
  if (!payload) return { ok: false, reason: "Empty DM message" };
  try {
    await member.send(payload);
    return { ok: true };
  } catch {
    return { ok: false, reason: "Member has DMs closed" };
  }
}

// ============================================================================
// Join handler — fires once per member join
// ============================================================================

const sentRecently = new Set<string>();

export function registerWelcomeModule(client: Client) {
  client.on("guildMemberAdd", async (member: GuildMember) => {
    try {
      if (member.user.bot) return;
      if (!isMainGuild(member.guild.id)) return;

      // Dedupe per process (Discord shouldn't fire twice but be safe).
      const key = `${member.guild.id}:${member.id}`;
      if (sentRecently.has(key)) return;
      sentRecently.add(key);
      setTimeout(() => sentRecently.delete(key), 60_000);

      const cfg = await getWelcomeConfig(member.guild.id);

      if (cfg.server.enabled && cfg.channelId) {
        const ch = member.guild.channels.cache.get(cfg.channelId);
        if (ch instanceof TextChannel || ch instanceof NewsChannel) {
          const me = member.guild.members.me;
          if (me?.permissionsIn(ch).has("SendMessages")) {
            const payload = await buildServerPayload(member, cfg);
            await ch.send(payload).catch((err) => console.error("[Welcome] server send failed:", err?.message ?? err));
          } else {
            console.warn(`[Welcome] Missing SendMessages in welcome channel ${ch.id}`);
          }
        } else {
          console.warn(`[Welcome] Welcome channel ${cfg.channelId} not found in guild ${member.guild.id}`);
        }
      }

      if (cfg.dm.enabled) {
        const payload = buildDmPayload(member, cfg);
        if (payload) {
          try {
            await member.send(payload);
          } catch (err: any) {
            console.warn(`[Welcome] DM to ${member.user.tag} failed: ${err?.message ?? err}`);
          }
        }
      }
    } catch (err) {
      console.error("[Welcome] guildMemberAdd error:", err);
    }
  });
}
