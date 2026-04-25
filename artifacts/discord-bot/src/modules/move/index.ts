import {
  Client,
  EmbedBuilder,
  Message,
  PermissionsBitField,
  ButtonInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  GuildMember,
  VoiceBasedChannel,
} from "discord.js";
import { pool } from "@workspace/db";
import { isMainGuild } from "../../utils/guildFilter.js";
import { getPartner } from "../social/index.js";

const TRIGGER_RE = /^aji\s+(?:<@!?(\d{15,25})>|(\d{15,25}))\s*$/i;
const CONFIRM_TTL = 5000;
const REQUEST_TTL = 60_000;
const COLOR_CONFIRM = 0xf2ff00;
const COLOR_ERROR = 0xff4d4d;

interface PendingMove {
  guildId: string;
  actorId: string;
  targetId: string;
  destChannelId: string;
  panelMsgId: string;
  panelChannelId: string;
  expires: number;
  reason: "instant_role" | "request_role" | "couple";
}

const pendingMoves = new Map<string, PendingMove>();

function shortEmbed(color: number, description: string) {
  return new EmbedBuilder().setColor(color).setDescription(description);
}

async function sendTemp(message: Message, eb: EmbedBuilder) {
  await message.delete().catch(() => {});
  const sent = await message.channel.send({ embeds: [eb] }).catch(() => null);
  if (sent) setTimeout(() => sent.delete().catch(() => {}), CONFIRM_TTL);
}

function decisionRow(reqId: string, disabled = false) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`mv_accept:${reqId}`)
      .setLabel("Accept")
      .setEmoji("\u2705")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`mv_reject:${reqId}`)
      .setLabel("Reject")
      .setEmoji("\u274C")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
  );
}

interface MoveRoleConfig {
  instant: string[];
  request: string[];
}

async function getMoveRoleConfig(guildId: string): Promise<MoveRoleConfig> {
  const result = await pool.query<{
    move_role_ids_json: string | null;
    move_request_role_ids_json: string | null;
  }>(
    "select move_role_ids_json, move_request_role_ids_json from bot_config where guild_id = $1 limit 1",
    [guildId],
  );
  const row = result.rows[0];
  return { instant: parseList(row?.move_role_ids_json), request: parseList(row?.move_request_role_ids_json) };
}

function parseList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      return [...new Set(arr.filter((v): v is string => typeof v === "string" && /^\d+$/.test(v)))];
    }
  } catch {}
  return [];
}

async function performMove(
  actor: GuildMember,
  target: GuildMember,
  destChannel: VoiceBasedChannel,
  bypassHierarchy = false,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const guild = actor.guild;
  const me = guild.members.me;
  if (!me?.permissions.has(PermissionsBitField.Flags.MoveMembers)) {
    return { ok: false, reason: "I'm missing the **Move Members** permission." };
  }
  const isAdmin = actor.permissions.has(PermissionsBitField.Flags.Administrator);
  const targetTopRole = target.roles.highest.position;
  if (!bypassHierarchy && !isAdmin && actor.roles.highest.position <= targetTopRole && actor.id !== guild.ownerId) {
    return { ok: false, reason: "You can't move someone with an equal or higher role." };
  }
  if (me.roles.highest.position <= targetTopRole) {
    return { ok: false, reason: "I can't move this member \u2014 my role must be above theirs." };
  }
  if (!target.voice.channel) {
    return { ok: false, reason: `**${target.displayName}** is no longer in any voice channel.` };
  }
  if (target.voice.channelId === destChannel.id) {
    return { ok: false, reason: `**${target.displayName}** is already in that channel.` };
  }
  try {
    await target.voice.setChannel(destChannel, `Move by ${actor.user.tag} via aji`);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, reason: `Failed to move: ${err?.message ?? "unknown error"}` };
  }
}

export function registerMoveModule(client: Client) {
  // Periodic cleanup of expired requests
  setInterval(() => {
    const now = Date.now();
    for (const [id, req] of pendingMoves) if (req.expires < now) pendingMoves.delete(id);
  }, 30_000);

  client.on("messageCreate", async (message: Message) => {
    try {
      if (message.author.bot || !message.guild) return;
      if (!isMainGuild(message.guild.id)) return;
      const match = message.content.trim().match(TRIGGER_RE);
      if (!match) return;

      const actor = message.member;
      if (!actor) return;

      const targetId = match[1] ?? match[2]!;
      const target = await message.guild.members.fetch(targetId).catch(() => null);

      const cfg = await getMoveRoleConfig(message.guild.id);
      const isAdmin = actor.permissions.has(PermissionsBitField.Flags.Administrator);
      const hasInstant = cfg.instant.some((id) => actor.roles.cache.has(id));
      const hasRequestRole = cfg.request.some((id) => actor.roles.cache.has(id));
      // Anyone with the Move Members permission is auto-allowed for the
      // confirmation flow (without needing a configured role).
      const hasMovePerm = actor.permissions.has(PermissionsBitField.Flags.MoveMembers);
      const hasRequest = hasRequestRole || hasMovePerm;

      // Couple check
      const partnerOfActor = await getPartner(message.guild.id, actor.id);
      const isCouple = !!(partnerOfActor && target && partnerOfActor === target.id);

      // Permission gate: silently ignore if no permission AT ALL and not partner
      if (!isAdmin && !hasInstant && !hasRequest && !isCouple) {
        return; // silent ignore as requested
      }

      const me = message.guild.members.me;
      if (!me?.permissions.has(PermissionsBitField.Flags.MoveMembers)) {
        await sendTemp(message, shortEmbed(COLOR_ERROR, "\u274C I'm missing the **Move Members** permission."));
        return;
      }

      const actorVoice = actor.voice.channel;
      if (!actorVoice) {
        await sendTemp(message, shortEmbed(COLOR_ERROR, "\u274C You must be in a voice channel first."));
        return;
      }

      if (!target) {
        await sendTemp(message, shortEmbed(COLOR_ERROR, "\u274C Member not found."));
        return;
      }
      if (target.user.bot) {
        await sendTemp(message, shortEmbed(COLOR_ERROR, "\u274C I can't move bots."));
        return;
      }
      if (target.id === actor.id) {
        await sendTemp(message, shortEmbed(COLOR_ERROR, "\u274C You can't move yourself."));
        return;
      }
      if (!target.voice.channel) {
        await sendTemp(message, shortEmbed(COLOR_ERROR, `\u274C **${target.displayName}** is not in any voice channel.`));
        return;
      }
      if (target.voice.channelId === actorVoice.id) {
        await sendTemp(message, shortEmbed(COLOR_ERROR, `\u274C **${target.displayName}** is already in your voice channel.`));
        return;
      }

      // Decide path:
      //  Admin, instant role, or couple-partner → direct move (no confirm)
      //  Request role / Move Members permission → confirmation flow
      if (isAdmin || hasInstant || isCouple) {
        await message.delete().catch(() => {});
        const r = await performMove(actor, target, actorVoice);
        if (!r.ok) {
          const err = await message.channel.send({ embeds: [shortEmbed(COLOR_ERROR, `\u274C ${r.reason}`)] });
          setTimeout(() => err.delete().catch(() => {}), CONFIRM_TTL);
          return;
        }
        const ok = await message.channel.send({
          embeds: [shortEmbed(COLOR_CONFIRM, `\u2705 Moved <@${target.id}> to **${actorVoice.name}**.`)],
        });
        setTimeout(() => ok.delete().catch(() => {}), CONFIRM_TTL);
        return;
      }

      // Confirmation flow (request role OR couple)
      const reqId = `${actor.id}_${target.id}_${Date.now().toString(36)}`;
      const actorName = actor.displayName;
      const why = isCouple
        ? `Your partner **${actorName}** wants to bring you to **${actorVoice.name}**.`
        : `**${actorName}** wants to bring you to **${actorVoice.name}**.`;

      const panel = new EmbedBuilder()
        .setColor(COLOR_CONFIRM)
        .setTitle("\uD83D\uDCE2 Move Request")
        .setDescription(`${why}\n\nDo you accept?`)
        .setFooter({ text: "Night Stars \u2022 Move \u2022 expires in 60s" });

      let panelMsg;
      try {
        panelMsg = await message.channel.send({
          content: `<@${target.id}>`,
          embeds: [panel],
          components: [decisionRow(reqId)],
          allowedMentions: { users: [target.id] },
        });
      } catch (err) {
        console.error("[Move] failed to send request panel:", err);
        return;
      }

      pendingMoves.set(reqId, {
        guildId: message.guild.id,
        actorId: actor.id,
        targetId: target.id,
        destChannelId: actorVoice.id,
        panelMsgId: panelMsg.id,
        panelChannelId: panelMsg.channelId,
        expires: Date.now() + REQUEST_TTL,
        reason: isCouple ? "couple" : "request_role",
      });

      // Auto-expire: delete the request message when TTL runs out
      setTimeout(async () => {
        const stale = pendingMoves.get(reqId);
        if (!stale) return;
        pendingMoves.delete(reqId);
        const ch = await message.guild!.channels.fetch(stale.panelChannelId).catch(() => null);
        if (!ch || !ch.isTextBased()) return;
        const msg = await ch.messages.fetch(stale.panelMsgId).catch(() => null);
        if (!msg) return;
        await msg.delete().catch(() => {});
      }, REQUEST_TTL + 1000);

      message.delete().catch(() => {});
    } catch (err) {
      console.error("[Move] messageCreate error:", err);
    }
  });
}

export async function handleMoveButton(interaction: ButtonInteraction) {
  const [action, reqId] = interaction.customId.split(":");
  if (!reqId) return;
  const req = pendingMoves.get(reqId);
  if (!req) {
    await interaction.reply({ content: "This move request is no longer valid.", ephemeral: true });
    return;
  }
  if (interaction.user.id !== req.targetId) {
    await interaction.reply({ content: "Only the tagged member can answer this request.", ephemeral: true });
    return;
  }

  const guild = interaction.guild!;
  const target = await guild.members.fetch(req.targetId).catch(() => null);
  const actor = await guild.members.fetch(req.actorId).catch(() => null);

  const DELETE_DELAY = 4000;

  if (action === "mv_reject") {
    pendingMoves.delete(reqId);
    await interaction.update({
      embeds: [
        new EmbedBuilder()
          .setColor(COLOR_ERROR)
          .setTitle("\u274C Move Declined")
          .setDescription(`<@${req.targetId}> declined the move request.`)
          .setFooter({ text: "Night Stars \u2022 Move" }),
      ],
      components: [],
    });
    setTimeout(() => interaction.message.delete().catch(() => {}), DELETE_DELAY);
    return;
  }

  if (action !== "mv_accept") return;

  if (!target || !actor) {
    pendingMoves.delete(reqId);
    await interaction.update({
      embeds: [shortEmbed(COLOR_ERROR, "\u274C One of the members is no longer in the server.")],
      components: [],
    });
    setTimeout(() => interaction.message.delete().catch(() => {}), DELETE_DELAY);
    return;
  }
  const dest = await guild.channels.fetch(req.destChannelId).catch(() => null);
  if (!dest || !dest.isVoiceBased()) {
    pendingMoves.delete(reqId);
    await interaction.update({
      embeds: [shortEmbed(COLOR_ERROR, "\u274C The destination voice channel no longer exists.")],
      components: [],
    });
    setTimeout(() => interaction.message.delete().catch(() => {}), DELETE_DELAY);
    return;
  }

  const result = await performMove(actor, target, dest, true);
  pendingMoves.delete(reqId);

  if (!result.ok) {
    await interaction.update({
      embeds: [shortEmbed(COLOR_ERROR, `\u274C ${result.reason}`)],
      components: [],
    });
    setTimeout(() => interaction.message.delete().catch(() => {}), DELETE_DELAY);
    return;
  }

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(COLOR_CONFIRM)
        .setTitle("\u2705 Move Accepted")
        .setDescription(`<@${req.targetId}> joined **${dest.name}**.`)
        .setFooter({ text: "Night Stars \u2022 Move" }),
    ],
    components: [],
  });
  setTimeout(() => interaction.message.delete().catch(() => {}), DELETE_DELAY);
}
