import {
  ChannelType,
  Client,
  EmbedBuilder,
  PermissionsBitField,
} from "discord.js";
import type {
  GuildMember,
  Message,
  NewsChannel,
  TextChannel,
} from "discord.js";
import { db } from "@workspace/db";
import { botConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isMainGuild } from "../../utils/guildFilter.js";

const JAIL_PREFIX = "=";
const CONFIRMATION_TTL = 5000;
const CLEANUP_DAYS = 7;

async function getConfig(guildId: string) {
  const rows = await db.select().from(botConfigTable).where(eq(botConfigTable.guildId, guildId)).limit(1);
  return rows[0] ?? null;
}

function buildEmbed(color: number, title: string, description: string) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: "Night Stars • Jail System" })
    .setTimestamp();
}

function errorEmbed(description: string) {
  return buildEmbed(0xff4d4d, "Action blocked", description);
}

async function sendTemporary(message: Message, embed: EmbedBuilder) {
  const sent = await message.channel.send({ embeds: [embed] }).catch(() => null);
  await message.delete().catch(() => {});
  if (sent) setTimeout(() => sent.delete().catch(() => {}), CONFIRMATION_TTL);
}

async function sendLog(message: Message, logsChannelId: string | null | undefined, embed: EmbedBuilder) {
  if (!logsChannelId) return;
  const channel = message.guild!.channels.cache.get(logsChannelId);
  if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) return;
  await (channel as TextChannel | NewsChannel).send({ embeds: [embed] }).catch(() => {});
}

function extractMentionedMemberId(input: string) {
  return input.match(/^<@!?(\d+)>/)?.[1] ?? input.split(/\s+/)[0]?.replace(/[<@!>]/g, "");
}

function extractReason(input: string) {
  return input.replace(/^<@!?\d+>\s*/, "").replace(/^\d+\s*/, "").trim();
}

function hasJailPermission(member: GuildMember, hammerRoleId?: string | null) {
  return (
    member.permissions.has(PermissionsBitField.Flags.Administrator) ||
    !!(hammerRoleId && member.roles.cache.has(hammerRoleId))
  );
}

function canModerateTarget(moderator: GuildMember, target: GuildMember) {
  if (moderator.guild.ownerId === moderator.id) return true;
  return moderator.roles.highest.position > target.roles.highest.position;
}

function findUnmanageableRoles(target: GuildMember, jailRoleId: string) {
  return target.roles.cache.filter((role) =>
    role.id !== target.guild.id &&
    role.id !== jailRoleId &&
    !role.managed &&
    !role.editable,
  );
}

async function deleteRecentMessages(message: Message, targetId: string) {
  const cutoff = Date.now() - CLEANUP_DAYS * 24 * 60 * 60 * 1000;
  let deleted = 0;
  let scannedChannels = 0;
  let skippedChannels = 0;

  await message.guild!.channels.fetch().catch(() => null);

  const channels = message.guild!.channels.cache.filter(
    (channel): channel is TextChannel | NewsChannel =>
      channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement,
  );

  for (const channel of channels.values()) {
    const permissions = channel.permissionsFor(message.guild!.members.me!);
    if (!permissions?.has(PermissionsBitField.Flags.ViewChannel) || !permissions.has(PermissionsBitField.Flags.ManageMessages)) {
      skippedChannels += 1;
      continue;
    }

    scannedChannels += 1;
    let before: string | undefined;

    for (let page = 0; page < 25; page += 1) {
      const fetched = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
      if (!fetched?.size) break;

      const recentTargetMessages = fetched.filter((msg) => msg.author.id === targetId && msg.createdTimestamp >= cutoff);
      if (recentTargetMessages.size) {
        const removed = await channel.bulkDelete(recentTargetMessages, true).catch(() => null);
        deleted += removed?.size ?? 0;
      }

      const oldest = fetched.last();
      if (!oldest || oldest.createdTimestamp < cutoff) break;
      before = oldest.id;
    }
  }

  return { deleted, scannedChannels, skippedChannels };
}

export function registerJailModule(client: Client) {
  client.on("messageCreate", async (message) => {
    try {
      if (message.author.bot) return;
      if (!message.guild) return;
      if (!isMainGuild(message.guild.id)) return;
      if (!message.content.startsWith(JAIL_PREFIX)) return;

      const content = message.content.slice(JAIL_PREFIX.length).trim();
      const lower = content.toLowerCase();
      if (!lower.startsWith("jail ") && !lower.startsWith("unjail ")) return;

      const member = message.member;
      if (!member) return;

      const config = await getConfig(message.guild.id);
      if (!config?.jailRoleId || !config?.memberRoleId || !config?.jailHammerRoleId) {
        await sendTemporary(message, errorEmbed("The jail system is not configured yet. Use `/setup-jail` first."));
        return;
      }

      if (!hasJailPermission(member, config.jailHammerRoleId)) {
        await sendTemporary(message, errorEmbed("You need the configured **Hammer Role** to use jail commands."));
        return;
      }

      if (lower.startsWith("jail ")) {
        await handleJail(message, member, content.slice(5).trim(), config.jailRoleId, config.jailLogsChannelId);
      } else {
        await handleUnjail(message, member, content.slice(7).trim(), config.jailRoleId, config.memberRoleId, config.jailLogsChannelId);
      }
    } catch (err) {
      console.error("[Jail] Unhandled error in messageCreate:", err);
      await sendTemporary(message, errorEmbed("Something went wrong while processing this jail command. Check my role and channel permissions."));
    }
  });
}

async function handleJail(message: Message, moderator: GuildMember, args: string, jailRoleId: string, logsChannelId?: string | null) {
  const targetId = extractMentionedMemberId(args);
  const reason = extractReason(args);

  if (!targetId || !reason) {
    await sendTemporary(message, errorEmbed("Usage: `=jail @user reason`"));
    return;
  }

  if (targetId === moderator.id) {
    await sendTemporary(message, errorEmbed("You cannot jail yourself."));
    return;
  }

  const target = await message.guild!.members.fetch(targetId).catch(() => null);
  if (!target) {
    await sendTemporary(message, errorEmbed("Member not found."));
    return;
  }

  if (target.user.bot) {
    await sendTemporary(message, errorEmbed("Bots cannot be jailed."));
    return;
  }

  if (!canModerateTarget(moderator, target)) {
    await sendTemporary(message, errorEmbed("You cannot jail someone with an equal or higher role than yours."));
    return;
  }

  if (!target.manageable) {
    await sendTemporary(message, errorEmbed("I cannot manage this member. Move my bot role above this member’s highest role."));
    return;
  }

  const jailRole = message.guild!.roles.cache.get(jailRoleId);
  if (!jailRole) {
    await sendTemporary(message, errorEmbed("The configured jailed role no longer exists. Please run `/setup-jail` again."));
    return;
  }

  if (!jailRole.editable) {
    await sendTemporary(message, errorEmbed("I cannot manage the configured jailed role. Move my bot role above the jailed role."));
    return;
  }

  const protectedRoles = findUnmanageableRoles(target, jailRoleId);
  if (protectedRoles.size) {
    await sendTemporary(
      message,
      errorEmbed(
        "I cannot clear all roles from this member because some roles are above my bot role:\n" +
        protectedRoles.map((role) => `<@&${role.id}>`).join(", "),
      ),
    );
    return;
  }

  const removableRoles = target.roles.cache.filter((role) => role.id !== target.guild.id && role.id !== jailRoleId && !role.managed && role.editable);
  if (removableRoles.size) await target.roles.remove(removableRoles, `Jailed by ${moderator.user.tag}: ${reason}`);
  await target.roles.add(jailRoleId, `Jailed by ${moderator.user.tag}: ${reason}`);
  const cleanup = await deleteRecentMessages(message, target.id);

  const confirmation = buildEmbed(
    0x5000ff,
    "🔨 Member Jailed",
    `<@${target.id}> has been jailed by <@${moderator.id}>.\n\n` +
    `**Reason**\n${reason}\n\n` +
    `**Cleanup**\nDeleted **${cleanup.deleted}** message(s) from the last **${CLEANUP_DAYS} days**.`,
  );

  await sendTemporary(message, confirmation);
  await sendLog(
    message,
    logsChannelId,
    buildEmbed(
      0x5000ff,
      "🔨 Jail Log",
      `**Member**: <@${target.id}> (${target.id})\n` +
      `**Hammer**: <@${moderator.id}> (${moderator.id})\n` +
      `**Reason**: ${reason}\n` +
      `**Messages deleted**: ${cleanup.deleted}\n` +
      `**Channels scanned**: ${cleanup.scannedChannels}\n` +
      `**Channels skipped**: ${cleanup.skippedChannels}`,
    ),
  );
}

async function handleUnjail(message: Message, moderator: GuildMember, args: string, jailRoleId: string, memberRoleId: string, logsChannelId?: string | null) {
  const targetId = extractMentionedMemberId(args);
  if (!targetId) {
    await sendTemporary(message, errorEmbed("Usage: `=unjail @user`"));
    return;
  }

  const target = await message.guild!.members.fetch(targetId).catch(() => null);
  if (!target) {
    await sendTemporary(message, errorEmbed("Member not found."));
    return;
  }

  if (!canModerateTarget(moderator, target)) {
    await sendTemporary(message, errorEmbed("You cannot unjail someone with an equal or higher role than yours."));
    return;
  }

  if (!target.manageable) {
    await sendTemporary(message, errorEmbed("I cannot manage this member. Move my bot role above this member’s highest role."));
    return;
  }

  const jailRole = message.guild!.roles.cache.get(jailRoleId);
  const memberRole = message.guild!.roles.cache.get(memberRoleId);
  if (!jailRole || !memberRole) {
    await sendTemporary(message, errorEmbed("The configured jailed/member role no longer exists. Please run `/setup-jail` again."));
    return;
  }

  if (!jailRole.editable || !memberRole.editable) {
    await sendTemporary(message, errorEmbed("I cannot manage the configured jailed/member role. Move my bot role above both roles."));
    return;
  }

  await target.roles.remove(jailRoleId, `Unjailed by ${moderator.user.tag}`);
  await target.roles.add(memberRoleId, `Unjailed by ${moderator.user.tag}`);

  const confirmation = buildEmbed(
    0x00c851,
    "🔓 Member Unjailed",
    `<@${target.id}> has been released by <@${moderator.id}>.\n\n` +
    `The jailed role was removed and <@&${memberRoleId}> was restored.`,
  );

  await sendTemporary(message, confirmation);
  await sendLog(
    message,
    logsChannelId,
    buildEmbed(
      0x00c851,
      "🔓 Unjail Log",
      `**Member**: <@${target.id}> (${target.id})\n` +
      `**Hammer**: <@${moderator.id}> (${moderator.id})\n` +
      `**Member role restored**: <@&${memberRoleId}>`,
    ),
  );
}
