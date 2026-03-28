import {
  Client,
  Message,
  PermissionsBitField,
  ChannelType,
  GuildMember,
  OverwriteType,
  VoiceChannel,
} from "discord.js";
import { db } from "@workspace/db";
import { pvsVoicesTable, pvsKeysTable, botConfigTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { successEmbed, errorEmbed } from "../../utils/embeds.js";

const PVS_PREFIX = "=";

async function sendTemp(msg: Message, embed: ReturnType<typeof successEmbed>) {
  try {
    await msg.delete().catch(() => {});
    const sent = await msg.channel.send({ embeds: [embed] });
    setTimeout(() => sent.delete().catch(() => {}), 10000);
  } catch {}
}

async function getOwnerVoice(
  member: GuildMember
): Promise<VoiceChannel | null> {
  if (!member.voice.channel) return null;
  const vc = member.voice.channel;
  if (vc.type !== ChannelType.GuildVoice) return null;

  const voice = await db
    .select()
    .from(pvsVoicesTable)
    .where(
      and(
        eq(pvsVoicesTable.channelId, vc.id),
        eq(pvsVoicesTable.ownerId, member.id)
      )
    )
    .limit(1);

  if (voice.length === 0) return null;
  return vc as VoiceChannel;
}

export function registerPVSModule(client: Client) {
  client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (!message.guild) return;
    if (!message.content.startsWith(PVS_PREFIX)) return;

    const content = message.content.slice(PVS_PREFIX.length).trim();
    const member = message.member;
    if (!member) return;

    if (content.toLowerCase().startsWith("key ")) {
      await handleKey(message, member, content.slice(4).trim());
    } else if (content.toLowerCase() === "clear keys") {
      await handleClearKeys(message, member);
    } else if (content.toLowerCase() === "see keys") {
      await handleSeeKeys(message, member);
    } else if (content.toLowerCase().startsWith("rename ")) {
      await handleRename(message, member, content.slice(7).trim());
    }
  });

  client.on("voiceStateUpdate", async (oldState, newState) => {
    if (!newState.guild) return;

    const guildId = newState.guild.id;
    const config = await db
      .select()
      .from(botConfigTable)
      .where(eq(botConfigTable.guildId, guildId))
      .limit(1);

    if (!config.length || !config[0].pvsCreateChannelId) return;

    const createChannelId = config[0].pvsCreateChannelId;
    const pvsCategoryId = config[0].pvsCategoryId;

    if (
      newState.channelId === createChannelId &&
      newState.member &&
      !newState.member.user.bot
    ) {
      await createPrivateVoice(newState.member, newState.guild, pvsCategoryId);
    }

    if (oldState.channelId && oldState.channelId !== createChannelId) {
      const channel = oldState.channel;
      if (!channel || channel.type !== ChannelType.GuildVoice) return;
      if (channel.members.size > 0) return;

      const voice = await db
        .select()
        .from(pvsVoicesTable)
        .where(eq(pvsVoicesTable.channelId, oldState.channelId))
        .limit(1);

      if (voice.length === 0) return;

      await db
        .delete(pvsKeysTable)
        .where(eq(pvsKeysTable.channelId, oldState.channelId));
      await db
        .delete(pvsVoicesTable)
        .where(eq(pvsVoicesTable.channelId, oldState.channelId));
      await channel.delete().catch(() => {});
    }
  });
}

async function createPrivateVoice(
  member: GuildMember,
  guild: import("discord.js").Guild,
  pvsCategoryId: string | null
) {
  try {
    const categoryId = pvsCategoryId ?? undefined;
    const newChannel = await guild.channels.create({
      name: `${member.displayName}'s Voice`,
      type: ChannelType.GuildVoice,
      parent: categoryId,
      permissionOverwrites: [
        {
          id: guild.id,
          deny: [PermissionsBitField.Flags.Connect],
        },
        {
          id: member.id,
          type: OverwriteType.Member,
          allow: [
            PermissionsBitField.Flags.Connect,
            PermissionsBitField.Flags.ManageChannels,
            PermissionsBitField.Flags.MoveMembers,
            PermissionsBitField.Flags.MuteMembers,
            PermissionsBitField.Flags.DeafenMembers,
          ],
        },
        {
          id: guild.members.me!.id,
          type: OverwriteType.Member,
          allow: [
            PermissionsBitField.Flags.Connect,
            PermissionsBitField.Flags.ManageChannels,
            PermissionsBitField.Flags.MoveMembers,
          ],
        },
      ],
    });

    await member.voice.setChannel(newChannel).catch(() => {});

    await db.insert(pvsVoicesTable).values({
      guildId: guild.id,
      channelId: newChannel.id,
      ownerId: member.id,
    });
  } catch (err) {
    console.error("PVS: failed to create private voice", err);
  }
}

async function handleKey(message: Message, member: GuildMember, args: string) {
  const vc = await getOwnerVoice(member);
  if (!vc) {
    await sendTemp(
      message,
      errorEmbed("You must be the owner of a private voice channel to use this command.")
    );
    return;
  }

  const targetId = args.replace(/[<@!>]/g, "").trim();
  if (!targetId) {
    await sendTemp(message, errorEmbed("Please mention a valid user."));
    return;
  }

  if (targetId === member.id) {
    await sendTemp(message, errorEmbed("You cannot modify your own permissions."));
    return;
  }

  const existing = await db
    .select()
    .from(pvsKeysTable)
    .where(
      and(eq(pvsKeysTable.channelId, vc.id), eq(pvsKeysTable.userId, targetId))
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .delete(pvsKeysTable)
      .where(
        and(
          eq(pvsKeysTable.channelId, vc.id),
          eq(pvsKeysTable.userId, targetId)
        )
      );

    await vc.permissionOverwrites.delete(targetId).catch(() => {});
    await sendTemp(
      message,
      successEmbed(`⚠️ <@${targetId}> lost the key!`)
    );
  } else {
    await db.insert(pvsKeysTable).values({
      channelId: vc.id,
      userId: targetId,
    });

    await vc.permissionOverwrites.edit(targetId, {
      Connect: true,
    });

    await sendTemp(
      message,
      successEmbed(`✅ <@${targetId}> got the key successfully!`)
    );
  }
}

async function handleClearKeys(message: Message, member: GuildMember) {
  const vc = await getOwnerVoice(member);
  if (!vc) {
    await sendTemp(
      message,
      errorEmbed("You must be the owner of a private voice channel to use this command.")
    );
    return;
  }

  const keys = await db
    .select()
    .from(pvsKeysTable)
    .where(eq(pvsKeysTable.channelId, vc.id));

  for (const key of keys) {
    await vc.permissionOverwrites.delete(key.userId).catch(() => {});
  }

  await db.delete(pvsKeysTable).where(eq(pvsKeysTable.channelId, vc.id));

  await sendTemp(message, successEmbed("✅ All keys cleared successfully!"));
}

async function handleSeeKeys(message: Message, member: GuildMember) {
  const vc = await getOwnerVoice(member);
  if (!vc) {
    await sendTemp(
      message,
      errorEmbed("You must be the owner of a private voice channel to use this command.")
    );
    return;
  }

  const keys = await db
    .select()
    .from(pvsKeysTable)
    .where(eq(pvsKeysTable.channelId, vc.id));

  if (keys.length === 0) {
    await sendTemp(message, successEmbed("✅ No keys have been granted yet."));
    return;
  }

  const mentions = keys.map((k) => `<@${k.userId}>`).join(", ");
  await sendTemp(message, successEmbed(`✅ Current keys: ${mentions}`));
}

async function handleRename(
  message: Message,
  member: GuildMember,
  newName: string
) {
  if (!newName) {
    await sendTemp(message, errorEmbed("Please provide a new name."));
    return;
  }

  const vc = await getOwnerVoice(member);
  if (!vc) {
    await sendTemp(
      message,
      errorEmbed("You must be the owner of a private voice channel to use this command.")
    );
    return;
  }

  await vc.setName(newName).catch(() => {});
  await sendTemp(message, successEmbed("✅ Voice renamed successfully!"));
}
