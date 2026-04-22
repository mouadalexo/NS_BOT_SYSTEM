import {
  Client,
  EmbedBuilder,
  Message,
  PermissionsBitField,
  ChannelType,
} from "discord.js";
import type { GuildMember, VoiceBasedChannel } from "discord.js";
import { db, botConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isMainGuild } from "../../utils/guildFilter.js";

const EVENT_COLOR = 0xff8000;

async function getStagePrefix(guildId: string): Promise<string> {
  const rows = await db
    .select({ pvsPrefix: botConfigTable.pvsPrefix })
    .from(botConfigTable)
    .where(eq(botConfigTable.guildId, guildId))
    .limit(1);
  return rows[0]?.pvsPrefix ?? "=";
}

function reply(message: Message, description: string) {
  const embed = new EmbedBuilder()
    .setColor(EVENT_COLOR)
    .setDescription(description);
  return message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } }).catch(() => {});
}

async function isAuthorized(member: GuildMember): Promise<boolean> {
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  if (member.guild.ownerId === member.id) return true;
  const cfg = await db
    .select({ eventHosterRoleId: botConfigTable.eventHosterRoleId })
    .from(botConfigTable)
    .where(eq(botConfigTable.guildId, member.guild.id))
    .limit(1);
  const hosterId = cfg[0]?.eventHosterRoleId;
  if (hosterId && member.roles.cache.has(hosterId)) return true;
  return false;
}

async function getMemberRoleId(guildId: string): Promise<string | null> {
  const cfg = await db
    .select({ memberRoleId: botConfigTable.memberRoleId })
    .from(botConfigTable)
    .where(eq(botConfigTable.guildId, guildId))
    .limit(1);
  return cfg[0]?.memberRoleId ?? null;
}

function getTargetChannel(member: GuildMember): VoiceBasedChannel | null {
  const ch = member.voice.channel;
  if (!ch) return null;
  if (ch.type !== ChannelType.GuildVoice && ch.type !== ChannelType.GuildStageVoice) return null;
  return ch;
}

async function applyLock(message: Message, lock: boolean) {
  if (!message.guild || !message.member) return;
  if (!(await isAuthorized(message.member))) {
    await reply(message, "You need Administrator or the Event Hoster role to use this.");
    return;
  }

  const channel = getTargetChannel(message.member);
  if (!channel) {
    await reply(message, "Join a voice or stage channel first, then run this command there.");
    return;
  }

  const memberRoleId = await getMemberRoleId(message.guild.id);
  if (!memberRoleId) {
    await reply(message, "Set the Member Role first via the setup panel.");
    return;
  }

  const memberRole = message.guild.roles.cache.get(memberRoleId)
    ?? (await message.guild.roles.fetch(memberRoleId).catch(() => null));
  if (!memberRole) {
    await reply(message, "The configured member role no longer exists.");
    return;
  }

  const me = message.guild.members.me;
  if (!me?.permissionsIn(channel).has(PermissionsBitField.Flags.ManageChannels)) {
    await reply(message, "I need **Manage Channels** permission on this channel.");
    return;
  }

  // Detect current state from existing overwrite
  const existing = channel.permissionOverwrites.cache.get(memberRole.id);
  const denied = existing?.deny.has(PermissionsBitField.Flags.Connect) ?? false;
  const allowed = existing?.allow.has(PermissionsBitField.Flags.Connect) ?? false;
  const isCurrentlyLocked = denied;
  const isCurrentlyUnlocked = allowed || (!denied && !allowed);

  try {
    if (lock) {
      if (isCurrentlyLocked) {
        await reply(message, "Event stage already locked");
        return;
      }
      await channel.permissionOverwrites.edit(
        memberRole.id,
        { Connect: false },
        { reason: `Stage locked by ${message.author.tag}` },
      );
      await reply(message, "Event stage locked !");
    } else {
      if (isCurrentlyUnlocked && !isCurrentlyLocked) {
        await reply(message, "Event stage already unlocked");
        return;
      }
      await channel.permissionOverwrites.edit(
        memberRole.id,
        { Connect: true },
        { reason: `Stage unlocked by ${message.author.tag}` },
      );
      await reply(message, "Event stage unlocked !");
    }
  } catch (err) {
    console.error("[StageLock] Failed to update permissions:", err);
    await reply(message, "Could not update channel permissions. Check role hierarchy.");
  }
}

export function registerStageLockModule(client: Client) {
  client.on("messageCreate", async (message: Message) => {
    try {
      if (!message.guild || message.author.bot) return;
      if (!isMainGuild(message.guild.id)) return;
      const PREFIX = await getStagePrefix(message.guild.id);
      if (!message.content.startsWith(PREFIX)) return;

      const cmd = message.content.slice(PREFIX.length).trim().split(/\s+/)[0]?.toLowerCase();
      if (cmd === "stagelock") {
        await applyLock(message, true);
      } else if (cmd === "stageunlock") {
        await applyLock(message, false);
      }
    } catch (err) {
      console.error("[StageLock] messageCreate error:", err);
    }
  });
}
