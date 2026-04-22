import {
  Client,
  EmbedBuilder,
  Message,
  PermissionsBitField,
} from "discord.js";
import { pool } from "@workspace/db";
import { isMainGuild } from "../../utils/guildFilter.js";

const TRIGGER_RE = /^aji\s+(?:<@!?(\d{15,25})>|(\d{15,25}))\s*$/i;
const CONFIRM_TTL = 5000;

function embed(color: number, description: string) {
  return new EmbedBuilder()
    .setColor(color)
    .setDescription(description)
    .setFooter({ text: "Night Stars \u2022 Move" })
    .setTimestamp();
}

async function sendTemp(message: Message, eb: EmbedBuilder) {
  await message.delete().catch(() => {});
  const sent = await message.channel.send({ embeds: [eb] }).catch(() => null);
  if (sent) setTimeout(() => sent.delete().catch(() => {}), CONFIRM_TTL);
}

async function getMoveRoleIds(guildId: string): Promise<string[]> {
  const result = await pool.query<{ move_role_ids_json: string | null }>(
    "select move_role_ids_json from bot_config where guild_id = $1 limit 1",
    [guildId],
  );
  const raw = result.rows[0]?.move_role_ids_json;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return [...new Set(parsed.filter((id): id is string => typeof id === "string" && /^\d+$/.test(id)))];
    }
  } catch {}
  return [];
}

export function registerMoveModule(client: Client) {
  client.on("messageCreate", async (message: Message) => {
    try {
      if (message.author.bot || !message.guild) return;
      if (!isMainGuild(message.guild.id)) return;
      const match = message.content.trim().match(TRIGGER_RE);
      if (!match) return;

      const actor = message.member;
      if (!actor) return;

      const allowedRoleIds = await getMoveRoleIds(message.guild.id);
      const isAdmin = actor.permissions.has(PermissionsBitField.Flags.Administrator);
      const hasMoveRole = allowedRoleIds.some((id) => actor.roles.cache.has(id));
      if (!isAdmin && !hasMoveRole) {
        await sendTemp(message, embed(0xff4d4d, "\u274C You don't have a move role. Ask an admin to run `/setup-move`."));
        return;
      }

      const me = message.guild.members.me;
      if (!me?.permissions.has(PermissionsBitField.Flags.MoveMembers)) {
        await sendTemp(message, embed(0xff4d4d, "\u274C I'm missing the **Move Members** permission."));
        return;
      }

      const actorVoice = actor.voice.channel;
      if (!actorVoice) {
        await sendTemp(message, embed(0xff4d4d, "\u274C You must be in a voice channel first."));
        return;
      }

      const targetId = match[1] ?? match[2]!;
      const target = await message.guild.members.fetch(targetId).catch(() => null);
      if (!target) {
        await sendTemp(message, embed(0xff4d4d, "\u274C Member not found."));
        return;
      }
      if (target.user.bot) {
        await sendTemp(message, embed(0xff4d4d, "\u274C I can't move bots."));
        return;
      }
      if (!target.voice.channel) {
        await sendTemp(message, embed(0xff4d4d, `\u274C **${target.displayName}** is not in any voice channel.`));
        return;
      }
      if (target.voice.channelId === actorVoice.id) {
        await sendTemp(message, embed(0xff4d4d, `\u274C **${target.displayName}** is already in your voice channel.`));
        return;
      }

      const targetTopRole = target.roles.highest.position;
      if (!isAdmin && actor.roles.highest.position <= targetTopRole && actor.id !== message.guild.ownerId) {
        await sendTemp(message, embed(0xff4d4d, "\u274C You can't move someone with an equal or higher role."));
        return;
      }
      if (me.roles.highest.position <= targetTopRole) {
        await sendTemp(message, embed(0xff4d4d, "\u274C I can't move this member \u2014 my role must be above theirs."));
        return;
      }

      try {
        await target.voice.setChannel(actorVoice, `Move by ${actor.user.tag} via aji`);
        await sendTemp(
          message,
          embed(0x00c851, `\u2705 Moved **${target.displayName}** to **${actorVoice.name}**.`),
        );
      } catch (err: any) {
        console.error("[Move] setChannel failed:", err);
        await sendTemp(message, embed(0xff4d4d, `\u274C Failed to move: ${err?.message ?? "unknown error"}`));
      }
    } catch (err) {
      console.error("[Move] messageCreate error:", err);
    }
  });
}
