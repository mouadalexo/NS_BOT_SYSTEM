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
import { botConfigTable, jailCasesTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { isMainGuild } from "../../utils/guildFilter.js";

const JAIL_PREFIX = "=";
const CONFIRMATION_TTL = 3000;
const CLEANUP_HOURS = 10;

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

function simpleEmbed(color: number, description: string) {
  return new EmbedBuilder()
    .setColor(color)
    .setDescription(description)
    .setFooter({ text: "Night Stars • Jail System" });
}

function errorEmbed(description: string) {
  return simpleEmbed(0xff4d4d, description);
}

async function sendTemporary(message: Message, embed: EmbedBuilder) {
  await message.delete().catch(() => {});
  const sent = await message.channel.send({ embeds: [embed] }).catch(() => null);
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

function getHammerRoleIds(config: Awaited<ReturnType<typeof getConfig>>) {
  if (!config) return [];
  if (config.jailHammerRoleIdsJson) {
    try {
      const parsed = JSON.parse(config.jailHammerRoleIdsJson);
      if (Array.isArray(parsed)) return parsed.filter((id): id is string => typeof id === "string" && id.length > 0);
    } catch {}
  }
  return config.jailHammerRoleId ? [config.jailHammerRoleId] : [];
}

function hasJailPermission(member: GuildMember, hammerRoleIds: string[]) {
  return (
    member.permissions.has(PermissionsBitField.Flags.Administrator) ||
    hammerRoleIds.some((roleId) => member.roles.cache.has(roleId))
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

function displayName(member: GuildMember): string {
  return member.displayName || member.user.username;
}

async function deleteInChannel(
  channel: TextChannel | NewsChannel,
  targetId: string,
  cutoff: number,
  guild: import("discord.js").Guild,
) {
  const permissions = channel.permissionsFor(guild.members.me!);
  if (
    !permissions?.has(PermissionsBitField.Flags.ViewChannel) ||
    !permissions.has(PermissionsBitField.Flags.ManageMessages)
  ) return;

  let before: string | undefined;

  for (let page = 0; page < 3; page += 1) {
    const fetched = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!fetched?.size) break;

    const targets = fetched.filter((msg) => msg.author.id === targetId && msg.createdTimestamp >= cutoff);
    if (targets.size) await channel.bulkDelete(targets, true).catch(() => {});

    const oldest = fetched.last();
    if (!oldest || oldest.createdTimestamp < cutoff) break;
    before = oldest.id;
  }
}

function deleteRecentMessages(message: Message, targetId: string) {
  const cutoff = Date.now() - CLEANUP_HOURS * 60 * 60 * 1000;

  message.guild!.channels.fetch().catch(() => null).then(() => {
    const channels = [...message.guild!.channels.cache
      .filter((ch): ch is TextChannel | NewsChannel =>
        ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement,
      )
      .values()];

    Promise.all(channels.map((ch) => deleteInChannel(ch, targetId, cutoff, message.guild!))).catch(() => {});
  });
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

      if (!lower.startsWith("jail ") && !lower.startsWith("unjail ") && !lower.startsWith("case ")) return;

      const member = message.member;
      if (!member) return;

      if (lower.startsWith("case ")) {
        await handleCase(message, member, content.slice(5).trim());
        return;
      }

      const config = await getConfig(message.guild.id);
      const hammerRoleIds = getHammerRoleIds(config);
      if (!config?.jailRoleId || !config?.memberRoleId || !hammerRoleIds.length) {
        await sendTemporary(message, errorEmbed("The jail system is not configured yet. Use `/setup-jail` first."));
        return;
      }

      if (!hasJailPermission(member, hammerRoleIds)) {
        await sendTemporary(message, errorEmbed("You need one of the configured **Hammer Roles** to use jail commands."));
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

async function handleJail(
  message: Message,
  moderator: GuildMember,
  args: string,
  jailRoleId: string,
  logsChannelId?: string | null,
) {
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

  if (target.roles.cache.has(jailRoleId)) {
    await sendTemporary(message, errorEmbed(`**${displayName(target)}** is already jailed.`));
    return;
  }

  if (!canModerateTarget(moderator, target)) {
    await sendTemporary(message, errorEmbed("You cannot jail someone with an equal or higher role than yours."));
    return;
  }

  if (!target.manageable) {
    await sendTemporary(message, errorEmbed("I cannot manage this member. Move my bot role above this member's highest role."));
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

  const removableRoles = target.roles.cache.filter(
    (role) => role.id !== target.guild.id && role.id !== jailRoleId && !role.managed && role.editable,
  );
  if (removableRoles.size) await target.roles.remove(removableRoles, `Jailed by ${moderator.user.tag}: ${reason}`);
  await target.roles.add(jailRoleId, `Jailed by ${moderator.user.tag}: ${reason}`);

  const [caseRecord] = await db
    .insert(jailCasesTable)
    .values({
      guildId: message.guild!.id,
      targetId: target.id,
      targetTag: displayName(target),
      moderatorId: moderator.id,
      moderatorTag: displayName(moderator),
      reason,
    })
    .returning({ id: jailCasesTable.id })
    .catch(() => [null]);

  // Confirmation fires immediately — deletes command message, auto-deletes after 3s
  await sendTemporary(message, simpleEmbed(0x5000ff, "This user was jailed."));

  // Log fires immediately — no waiting for message deletion
  const caseRef = caseRecord ? ` • Case #${caseRecord.id}` : "";
  await sendLog(
    message,
    logsChannelId,
    buildEmbed(
      0x5000ff,
      `🔨 Jail Log${caseRef}`,
      `**User**: ${displayName(target)}\n` +
      `**Hammer**: ${displayName(moderator)}\n` +
      `**Reason**: ${reason}`,
    ),
  );

  // Message deletion runs fully in background — fire and forget
  deleteRecentMessages(message, target.id);
}

async function handleUnjail(
  message: Message,
  moderator: GuildMember,
  args: string,
  jailRoleId: string,
  memberRoleId: string,
  logsChannelId?: string | null,
) {
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

  if (!target.roles.cache.has(jailRoleId)) {
    await sendTemporary(message, errorEmbed(`**${displayName(target)}** is not jailed.`));
    return;
  }

  if (!canModerateTarget(moderator, target)) {
    await sendTemporary(message, errorEmbed("You cannot unjail someone with an equal or higher role than yours."));
    return;
  }

  if (!target.manageable) {
    await sendTemporary(message, errorEmbed("I cannot manage this member. Move my bot role above this member's highest role."));
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

  await sendTemporary(message, simpleEmbed(0x00c851, "This user was unjailed."));

  await sendLog(
    message,
    logsChannelId,
    buildEmbed(
      0x00c851,
      "🔓 Unjail Log",
      `**User**: ${displayName(target)}\n` +
      `**Hammer**: ${displayName(moderator)}`,
    ),
  );
}

async function handleCase(message: Message, moderator: GuildMember, args: string) {
  const config = await getConfig(message.guild!.id);
  const hammerRoleIds = getHammerRoleIds(config);
  if (!hasJailPermission(moderator, hammerRoleIds)) {
    await sendTemporary(message, errorEmbed("You need one of the configured **Hammer Roles** to use this command."));
    return;
  }

  const targetId = extractMentionedMemberId(args);
  if (!targetId) {
    await sendTemporary(message, errorEmbed("Usage: `=case @user`"));
    return;
  }

  const target = await message.guild!.members.fetch(targetId).catch(() => null);
  if (!target) {
    await sendTemporary(message, errorEmbed("Member not found."));
    return;
  }

  const jailRoleId = config?.jailRoleId;
  if (!jailRoleId || !target.roles.cache.has(jailRoleId)) {
    await sendTemporary(message, simpleEmbed(0xff4d4d, `**${displayName(target)}** is not jailed.`));
    return;
  }

  const rows = await db
    .select()
    .from(jailCasesTable)
    .where(and(eq(jailCasesTable.targetId, target.id), eq(jailCasesTable.guildId, message.guild!.id)))
    .orderBy(desc(jailCasesTable.id))
    .limit(1);

  const record = rows[0];
  if (!record) {
    await sendTemporary(message, simpleEmbed(0x5000ff, `The jail reason of **${displayName(target)}** is unknown (no record found).`));
    return;
  }

  await sendTemporary(
    message,
    simpleEmbed(0x5000ff, `The jail reason of **${displayName(target)}** is: ${record.reason}`),
  );
}
