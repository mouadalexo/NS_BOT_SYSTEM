import {
  ChannelType,
  Client,
  EmbedBuilder,
  PermissionsBitField,
} from "discord.js";
import type { GuildMember, Message, NewsChannel, TextChannel } from "discord.js";
import { pool } from "@workspace/db";
import { isMainGuild } from "../../utils/guildFilter.js";

async function getRoleGiverPrefix(guildId: string): Promise<string> {
  const result = await pool.query<{ pvs_prefix: string | null }>(
    "select pvs_prefix from bot_config where guild_id = $1 limit 1",
    [guildId],
  );
  return result.rows[0]?.pvs_prefix ?? "=";
}

const CONFIRMATION_TTL = 5000;
const COMMAND_RE = /^[a-z0-9_-]{2,32}$/;

type RoleGiverRule = {
  id: number;
  guild_id: string;
  command_name: string;
  target_role_id: string;
  giver_role_ids_json: string;
  linked_category: string | null;
  enabled: boolean;
};

function parseGiverRoleIds(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return [...new Set(parsed.filter((id): id is string => typeof id === "string" && /^\d+$/.test(id)))];
    }
  } catch {}
  return [];
}

function embed(color: number, description: string) {
  return new EmbedBuilder()
    .setColor(color)
    .setDescription(description)
    .setFooter({ text: "Night Stars • Role Giver" })
    .setTimestamp();
}

function titleEmbed(color: number, title: string, description: string) {
  return embed(color, description).setTitle(title);
}

async function sendTemporary(message: Message, payload: EmbedBuilder, ttl = CONFIRMATION_TTL) {
  await message.delete().catch(() => {});
  const sent = await message.channel.send({ embeds: [payload] }).catch(() => null);
  if (sent) setTimeout(() => sent.delete().catch(() => {}), ttl);
}

function hasGivePermission(member: GuildMember, giverRoleIds: string[]) {
  return member.permissions.has(PermissionsBitField.Flags.Administrator) || giverRoleIds.some((id) => member.roles.cache.has(id));
}

function canManageTarget(actor: GuildMember, target: GuildMember) {
  if (actor.guild.ownerId === actor.id) return true;
  return actor.roles.highest.position > target.roles.highest.position;
}

function extractTargetId(input: string) {
  return input.match(/^<@!?(\d+)>/)?.[1] ?? input.split(/\s+/)[0]?.replace(/[<@!>]/g, "");
}

function displayName(member: GuildMember) {
  return member.displayName || member.user.username;
}

async function getRule(guildId: string, commandName: string): Promise<RoleGiverRule | null> {
  const result = await pool.query<RoleGiverRule>(
    "select * from role_giver_rules where guild_id = $1 and command_name = $2 and enabled = true limit 1",
    [guildId, commandName],
  );
  return result.rows[0] ?? null;
}

async function getLinkedSiblingRoleIds(guildId: string, linkedCategory: string | null, targetRoleId: string) {
  if (!linkedCategory) return [];
  const result = await pool.query<{ target_role_id: string }>(
    "select target_role_id from role_giver_rules where guild_id = $1 and linked_category = $2 and enabled = true and target_role_id <> $3",
    [guildId, linkedCategory, targetRoleId],
  );
  return [...new Set(result.rows.map((row) => row.target_role_id))];
}

async function logRoleGive(message: Message, rule: RoleGiverRule, actor: GuildMember, target: GuildMember, removedRoleIds: string[]) {
  const logChannel = message.guild?.channels.cache.find((channel) =>
    (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement) &&
    channel.name.toLowerCase().includes("log"),
  ) as TextChannel | NewsChannel | undefined;
  if (!logChannel) return;
  await logChannel.send({
    embeds: [
      titleEmbed(
        0x5000ff,
        "Role Giver Log",
        `**Command**: \`=${rule.command_name}\`\n` +
        `**Giver**: ${displayName(actor)}\n` +
        `**User**: ${displayName(target)}\n` +
        `**Added**: <@&${rule.target_role_id}>` +
        (removedRoleIds.length ? `\n**Removed linked roles**: ${removedRoleIds.map((id) => `<@&${id}>`).join(", ")}` : ""),
      ),
    ],
  }).catch(() => {});
}

export function registerRoleGiverModule(client: Client) {
  client.on("messageCreate", async (message) => {
    try {
      if (message.author.bot) return;
      if (!message.guild) return;
      if (!isMainGuild(message.guild.id)) return;
      const PREFIX = await getRoleGiverPrefix(message.guild.id);
      if (!message.content.startsWith(PREFIX)) return;

      const [rawCommand, ...rest] = message.content.slice(PREFIX.length).trim().split(/\s+/);
      const commandName = rawCommand?.toLowerCase();
      if (!commandName || !COMMAND_RE.test(commandName)) return;

      const rule = await getRule(message.guild.id, commandName);
      if (!rule) return;

      const actor = message.member;
      if (!actor) return;

      const giverRoleIds = parseGiverRoleIds(rule.giver_role_ids_json);
      if (!hasGivePermission(actor, giverRoleIds)) {
        await sendTemporary(message, embed(0xff4d4d, "You do not have permission to use this role-giver command."));
        return;
      }

      const targetId = extractTargetId(rest.join(" "));
      if (!targetId) {
        await sendTemporary(message, embed(0xff4d4d, `Usage: \`=${commandName} @user\``));
        return;
      }

      const target = await message.guild.members.fetch(targetId).catch(() => null);
      if (!target) {
        await sendTemporary(message, embed(0xff4d4d, "Member not found."));
        return;
      }
      if (target.user.bot) {
        await sendTemporary(message, embed(0xff4d4d, "Bots cannot receive role-giver roles."));
        return;
      }
      if (!canManageTarget(actor, target)) {
        await sendTemporary(message, embed(0xff4d4d, "You cannot give roles to someone with an equal or higher role than yours."));
        return;
      }
      if (!target.manageable) {
        await sendTemporary(message, embed(0xff4d4d, "I cannot manage this member. Move my bot role above this member's highest role."));
        return;
      }

      const targetRole = message.guild.roles.cache.get(rule.target_role_id);
      if (!targetRole) {
        await sendTemporary(message, embed(0xff4d4d, "The configured role no longer exists. Ask an admin to update Role Giver setup."));
        return;
      }
      if (!targetRole.editable) {
        await sendTemporary(message, embed(0xff4d4d, "I cannot manage the configured role. Move my bot role above it."));
        return;
      }

      const siblingRoleIds = await getLinkedSiblingRoleIds(message.guild.id, rule.linked_category, rule.target_role_id);
      const removableSiblingIds = siblingRoleIds.filter((roleId) => {
        const role = message.guild!.roles.cache.get(roleId);
        return role && role.editable && !role.managed && target.roles.cache.has(roleId);
      });

      if (removableSiblingIds.length) {
        await target.roles.remove(removableSiblingIds, `Linked Role Giver: =${commandName} by ${actor.user.tag}`);
      }
      if (!target.roles.cache.has(rule.target_role_id)) {
        await target.roles.add(rule.target_role_id, `Role Giver: =${commandName} by ${actor.user.tag}`);
      }

      await sendTemporary(
        message,
        embed(
          0x00c851,
          `Gave <@&${rule.target_role_id}> to **${displayName(target)}**.` +
          (removableSiblingIds.length ? ` Removed linked role(s): ${removableSiblingIds.map((id) => `<@&${id}>`).join(", ")}.` : ""),
        ),
      );
      await logRoleGive(message, rule, actor, target, removableSiblingIds);
    } catch (err) {
      console.error("[RoleGiver] messageCreate error:", err);
      await sendTemporary(message, embed(0xff4d4d, "Something went wrong while giving this role. Check bot role permissions."));
    }
  });
}
