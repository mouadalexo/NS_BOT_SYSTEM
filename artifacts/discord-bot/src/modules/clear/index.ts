import {
  Client,
  EmbedBuilder,
  Message,
  PermissionsBitField,
} from "discord.js";
import { pool } from "@workspace/db";
import { isMainGuild } from "../../utils/guildFilter.js";

const TRIGGER_RE = /^mse7\s+(\d{1,3})\s*$/i;
const MAX_DELETE = 99; // Discord bulkDelete cap is 100 incl. command msg
const CONFIRM_TTL = 4000;

function embed(color: number, description: string) {
  return new EmbedBuilder()
    .setColor(color)
    .setDescription(description)
    .setFooter({ text: "Night Stars \u2022 Clear" })
    .setTimestamp();
}

async function sendTemp(channel: any, eb: EmbedBuilder, ttl = CONFIRM_TTL) {
  if (!channel || typeof channel.send !== "function") return;
  const sent = await channel.send({ embeds: [eb] }).catch(() => null);
  if (sent) setTimeout(() => sent.delete().catch(() => {}), ttl);
}

async function getClearRoleIds(guildId: string): Promise<string[]> {
  const result = await pool.query<{ clear_role_ids_json: string | null }>(
    "select clear_role_ids_json from bot_config where guild_id = $1 limit 1",
    [guildId],
  );
  const raw = result.rows[0]?.clear_role_ids_json;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return [...new Set(parsed.filter((id): id is string => typeof id === "string" && /^\d+$/.test(id)))];
    }
  } catch {}
  return [];
}

export function registerClearModule(client: Client) {
  client.on("messageCreate", async (message: Message) => {
    try {
      if (message.author.bot || !message.guild) return;
      if (!isMainGuild(message.guild.id)) return;
      const match = message.content.trim().match(TRIGGER_RE);
      if (!match) return;

      const channel = message.channel as any;
      if (!channel || typeof channel.bulkDelete !== "function") {
        console.log("[Clear] Triggered but channel does not support bulkDelete:", channel?.type);
        return;
      }

      const actor = message.member;
      if (!actor) return;

      const allowedRoleIds = await getClearRoleIds(message.guild.id);
      const isAdmin = actor.permissions.has(PermissionsBitField.Flags.Administrator);
      const hasClearRole = allowedRoleIds.some((id) => actor.roles.cache.has(id));
      if (!isAdmin && !hasClearRole) {
        await message.delete().catch(() => {});
        await sendTemp(channel, embed(0xff4d4d, "\u274C You don't have a clear role. Ask an admin to run `/setup-clear`."));
        return;
      }

      const me = message.guild.members.me;
      if (!me?.permissionsIn(channel).has(PermissionsBitField.Flags.ManageMessages)) {
        await sendTemp(channel, embed(0xff4d4d, "\u274C I'm missing the **Manage Messages** permission in this channel."));
        return;
      }

      const requested = parseInt(match[1]!, 10);
      if (!Number.isFinite(requested) || requested < 1) {
        await message.delete().catch(() => {});
        await sendTemp(channel, embed(0xff4d4d, "\u274C Usage: `mse7 <1-99>`"));
        return;
      }

      const count = Math.min(requested, MAX_DELETE);
      const truncated = requested > MAX_DELETE;

      // Delete the command message first
      await message.delete().catch(() => {});

      // Fetch & bulk delete (excludes messages older than 14 days automatically)
      const fetched = await channel.messages.fetch({ limit: count }).catch(() => null);
      if (!fetched || fetched.size === 0) {
        await sendTemp(channel, embed(0xff4d4d, "\u274C No messages to delete."));
        return;
      }

      let deleted = 0;
      try {
        const result = await channel.bulkDelete(fetched, true);
        deleted = result.size;
      } catch (err: any) {
        console.error("[Clear] bulkDelete failed:", err);
        await sendTemp(channel, embed(0xff4d4d, `\u274C Failed: ${err?.message ?? "unknown error"} (messages older than 14 days can't be bulk-deleted)`));
        return;
      }

      const note = truncated ? ` (capped at ${MAX_DELETE} \u2014 Discord limit)` : "";
      await sendTemp(
        channel,
        embed(0x00c851, `\u2705 Cleared **${deleted}** message${deleted === 1 ? "" : "s"}${note}.`),
        4000,
      );
    } catch (err) {
      console.error("[Clear] messageCreate error:", err);
    }
  });
}
