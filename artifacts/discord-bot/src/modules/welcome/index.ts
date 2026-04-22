import {
  Client,
  EmbedBuilder,
  GuildMember,
  TextChannel,
  NewsChannel,
} from "discord.js";
import { pool } from "@workspace/db";
import { isMainGuild } from "../../utils/guildFilter.js";

export type WelcomeVariant = {
  enabled: boolean;
  /** "embed" or "text" */
  mode: "embed" | "text";
  text: string | null;
  title: string | null;
  description: string | null;
  color: string | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  showAvatar: boolean;
};

export type WelcomeConfig = {
  channelId: string | null;
  server: WelcomeVariant;
  dm: WelcomeVariant;
};

const DEFAULTS: WelcomeConfig = {
  channelId: null,
  server: {
    enabled: false,
    mode: "embed",
    text: null,
    title: "Welcome to {server}!",
    description: "Hey {user_mention}, welcome aboard. You're member **#{membercount}**. Enjoy your stay! \u2728",
    color: "#5000ff",
    imageUrl: null,
    thumbnailUrl: null,
    showAvatar: true,
  },
  dm: {
    enabled: false,
    mode: "embed",
    text: null,
    title: "Welcome to {server}!",
    description: "Hey {user}, glad you joined **{server}**! Make yourself at home. \uD83C\uDF1F",
    color: "#5000ff",
    imageUrl: null,
    thumbnailUrl: null,
    showAvatar: true,
  },
};

export function defaultWelcomeConfig(): WelcomeConfig {
  return JSON.parse(JSON.stringify(DEFAULTS));
}

function mergeConfig(raw: any): WelcomeConfig {
  const base = defaultWelcomeConfig();
  if (!raw || typeof raw !== "object") return base;
  base.channelId = typeof raw.channelId === "string" ? raw.channelId : null;
  for (const k of ["server", "dm"] as const) {
    const v = raw[k];
    if (v && typeof v === "object") {
      base[k] = {
        enabled: !!v.enabled,
        mode: v.mode === "text" ? "text" : "embed",
        text: typeof v.text === "string" ? v.text : base[k].text,
        title: typeof v.title === "string" ? v.title : base[k].title,
        description: typeof v.description === "string" ? v.description : base[k].description,
        color: typeof v.color === "string" ? v.color : base[k].color,
        imageUrl: typeof v.imageUrl === "string" ? v.imageUrl : null,
        thumbnailUrl: typeof v.thumbnailUrl === "string" ? v.thumbnailUrl : null,
        showAvatar: v.showAvatar === false ? false : true,
      };
    }
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

function parseColor(value: string | null): number {
  if (!value) return 0x5000ff;
  const hex = value.replace(/^#/, "").trim();
  if (!/^[0-9a-f]{6}$/i.test(hex)) return 0x5000ff;
  return parseInt(hex, 16);
}

function buildPayload(variant: WelcomeVariant, member: GuildMember) {
  if (variant.mode === "text") {
    const content = applyVariables(variant.text ?? variant.description ?? "", member);
    if (!content.trim()) return null;
    return { content, allowedMentions: { users: [member.id] } };
  }
  const eb = new EmbedBuilder().setColor(parseColor(variant.color));
  if (variant.title) eb.setTitle(applyVariables(variant.title, member));
  if (variant.description) eb.setDescription(applyVariables(variant.description, member));
  if (variant.imageUrl) eb.setImage(variant.imageUrl);
  if (variant.thumbnailUrl) {
    eb.setThumbnail(variant.thumbnailUrl);
  } else if (variant.showAvatar) {
    eb.setThumbnail(member.user.displayAvatarURL({ extension: "png", size: 256 }));
  }
  eb.setFooter({ text: `Night Stars \u2022 ${member.guild.name}` }).setTimestamp();
  const content = variant.text ? applyVariables(variant.text, member) : undefined;
  return {
    content,
    embeds: [eb],
    allowedMentions: { users: [member.id] },
  };
}

export async function previewWelcome(member: GuildMember, variant: "server" | "dm"): Promise<{ ok: boolean; reason?: string }> {
  const cfg = await getWelcomeConfig(member.guild.id);
  const v = cfg[variant];
  const payload = buildPayload(v, member);
  if (!payload) return { ok: false, reason: "Empty content" };
  if (variant === "server") {
    if (!cfg.channelId) return { ok: false, reason: "No welcome channel set" };
    const ch = member.guild.channels.cache.get(cfg.channelId);
    if (!(ch instanceof TextChannel || ch instanceof NewsChannel)) return { ok: false, reason: "Welcome channel not found" };
    await ch.send(payload);
  } else {
    try {
      await member.send(payload);
    } catch {
      return { ok: false, reason: "Member has DMs closed" };
    }
  }
  return { ok: true };
}

export function registerWelcomeModule(client: Client) {
  client.on("guildMemberAdd", async (member: GuildMember) => {
    try {
      if (member.user.bot) return;
      if (!isMainGuild(member.guild.id)) return;
      const cfg = await getWelcomeConfig(member.guild.id);

      if (cfg.server.enabled && cfg.channelId) {
        const ch = member.guild.channels.cache.get(cfg.channelId);
        if (ch instanceof TextChannel || ch instanceof NewsChannel) {
          const me = member.guild.members.me;
          if (me?.permissionsIn(ch).has("SendMessages")) {
            const payload = buildPayload(cfg.server, member);
            if (payload) {
              await ch.send(payload).catch((err) => console.error("[Welcome] server send failed:", err?.message ?? err));
            }
          } else {
            console.warn(`[Welcome] Missing SendMessages in welcome channel ${ch.id}`);
          }
        } else {
          console.warn(`[Welcome] Welcome channel ${cfg.channelId} not found in guild ${member.guild.id}`);
        }
      }

      if (cfg.dm.enabled) {
        const payload = buildPayload(cfg.dm, member);
        if (payload) {
          try {
            await member.send(payload);
          } catch (err: any) {
            console.warn(`[Welcome] DM to ${member.user.tag} failed (likely DMs closed): ${err?.message ?? err}`);
          }
        }
      }
    } catch (err) {
      console.error("[Welcome] guildMemberAdd error:", err);
    }
  });
}
