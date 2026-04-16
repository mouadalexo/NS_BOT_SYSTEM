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
  await message.delete().catch(() => {});
  const sent = await message.channel.send({ embeds: [embed] }).catch(() => null);
  if (sent) setTimeout(() => sent.delete().catch(() => {}), CONFIRMATION_TTL);
}

function extractMentionedMemberId(input: string) {
  return input.match(/^<@!?(\d+)>/)?.[1] ?? input.split(/\s+/)[0]?.replace(/[<@!>]/g, "");
}

function extractReason(input: string) {
  return input.replace(/^<@!?\d+>\s*/, "").replace(/^\d+\s*/, "").trim();
}

async function hasJailPermission(member: GuildMember, staffRoleId?: string | null) {
  return (
    member.permissions.has(PermissionsBitField.Flags.Administrator) ||
    member.permissions.has(PermissionsBitField.Flags.ManageRoles) ||
    !!(staffRoleId && member.roles.cache.has(staffRoleId))
  );
}

function findUnmanageableRoles(target: GuildMember, jailRoleId: string) {
  return target.roles.cache.filter((role) => role.id !== target.guild.id && role.id !== jailRoleId && !role.editable);
}

async function deleteRecentMessages(message: Message, targetId: string) {
  const cutoff = Date.now() - CLEANUP_DAYS * 24 * 60 * 60 * 1000;
  let deleted = 0;
  let scannedChannels = 0;

  const channels = message.guild!.channels.cache.filter(
    (channel): channel is TextChannel | NewsChannel =>
      channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement,
  );

  for (const channel of channels.values()) {
    const permissions = channel.permissionsFor(message.guild!.members.me!);
    if (!permissions?.has(PermissionsBitField.Flags.ViewChannel) || !permissions.has(PermissionsBitField.Flags.ManageMessages)) {
      continue;
    }

    scannedChannels += 1;
    let before: string | undefined;

    for (let page = 0; page < 20; page += 1) {
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

  return { deleted, scannedChannels };
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
      if (!(await hasJailPermission(member, config?.staffRoleId))) {
        await sendTemporary(message, errorEmbed("You need the **Staff**, **Manage Roles**, or **Administrator** permission to use jail commands."));
        return;
      }

      if (!config?.jailRoleId || !config?.memberRoleId) {
        await sendTemporary(message, errorEmbed("The jail system is not configured yet. Use `/setup jail` first."));
        return;
      }

      if (lower.startsWith("jail ")) {
        await handleJail(message, member, content.slice(5).trim(), config.jailRoleId);
      } else {
        await handleUnjail(message, member, content.slice(7).trim(), config.jailRoleId, config.memberRoleId);
      }
    } catch (err) {
      console.error("[Jail] Unhandled error in messageCreate:", err);
    }
  });
}

async function handleJail(message: Message, moderator: GuildMember, args: string, jailRoleId: string) {
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

  const jailRole = message.guild!.roles.cache.get(jailRoleId);
  if (!jailRole) {
    await sendTemporary(message, errorEmbed("The configured jail role no longer exists. Please run `/setup jail` again."));
    return;
  }

  if (!jailRole.editable) {
    await sendTemporary(message, errorEmbed("I cannot manage the configured jail role. Move my bot role above the jail role."));
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

  await target.roles.set([jailRoleId], `Jailed by ${moderator.user.tag}: ${reason}`);
  const cleanup = await deleteRecentMessages(message, target.id);

  await sendTemporary(
    message,
    buildEmbed(
      0x5000ff,
      "🔒 Member Jailed",
      `<@${target.id}> has been jailed by <@${moderator.id}>.\n\n` +
      `**Reason**\n${reason}\n\n` +
      `**Cleanup**\nDeleted **${cleanup.deleted}** message(s) from the last **${CLEANUP_DAYS} days**.`,
    ),
  );
}

async function handleUnjail(message: Message, moderator: GuildMember, args: string, jailRoleId: string, memberRoleId: string) {
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

  const jailRole = message.guild!.roles.cache.get(jailRoleId);
  const memberRole = message.guild!.roles.cache.get(memberRoleId);
  if (!jailRole || !memberRole) {
    await sendTemporary(message, errorEmbed("The configured jail/member role no longer exists. Please run `/setup jail` again."));
    return;
  }

  if (!jailRole.editable || !memberRole.editable) {
    await sendTemporary(message, errorEmbed("I cannot manage the configured jail/member role. Move my bot role above both roles."));
    return;
  }

  await target.roles.remove(jailRoleId, `Unjailed by ${moderator.user.tag}`);
  await target.roles.add(memberRoleId, `Unjailed by ${moderator.user.tag}`);

  await sendTemporary(
    message,
    buildEmbed(
      0x00c851,
      "🔓 Member Unjailed",
      `<@${target.id}> has been released by <@${moderator.id}>.\n\n` +
      `The jail role was removed and <@&${memberRoleId}> was restored.`,
    ),
  );
}