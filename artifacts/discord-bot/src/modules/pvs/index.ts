import {
  Client,
  Message,
  EmbedBuilder,
  PermissionsBitField,
  ChannelType,
  GuildMember,
  OverwriteType,
  VoiceChannel,
  Guild,
} from "discord.js";
import { db } from "@workspace/db";
import { pvsVoicesTable, pvsKeysTable, botConfigTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const PVS_PREFIX = "=";
const MANAGER_PREFIX = "+";

const OWNER_PERMS = [
  PermissionsBitField.Flags.ViewChannel,
  PermissionsBitField.Flags.Connect,
  PermissionsBitField.Flags.Speak,
  PermissionsBitField.Flags.Stream,
  PermissionsBitField.Flags.ReadMessageHistory,
  PermissionsBitField.Flags.DeafenMembers,
  PermissionsBitField.Flags.UseVAD,
  PermissionsBitField.Flags.UseSoundboard,
  PermissionsBitField.Flags.UseExternalSounds,
  PermissionsBitField.Flags.SendMessages,
  PermissionsBitField.Flags.EmbedLinks,
  PermissionsBitField.Flags.AttachFiles,
  PermissionsBitField.Flags.AddReactions,
];

const KEY_HOLDER_PERMS = [
  PermissionsBitField.Flags.ViewChannel,
  PermissionsBitField.Flags.Connect,
  PermissionsBitField.Flags.Speak,
  PermissionsBitField.Flags.Stream,
  PermissionsBitField.Flags.ReadMessageHistory,
  PermissionsBitField.Flags.UseVAD,
  PermissionsBitField.Flags.UseSoundboard,
  PermissionsBitField.Flags.UseExternalSounds,
  PermissionsBitField.Flags.SendMessages,
  PermissionsBitField.Flags.EmbedLinks,
  PermissionsBitField.Flags.AttachFiles,
  PermissionsBitField.Flags.AddReactions,
];

async function sendTemp(msg: Message, embed: EmbedBuilder, delay = 12000) {
  try {
    await msg.delete().catch(() => {});
    const sent = await msg.channel.send({ embeds: [embed] });
    setTimeout(() => sent.delete().catch(() => {}), delay);
  } catch {}
}

function errorEmbed(text: string) {
  return new EmbedBuilder().setColor(0x5000ff).setDescription(`❌ ${text}`);
}

function successEmbed(text: string) {
  return new EmbedBuilder().setColor(0x5000ff).setDescription(text);
}

async function getOwnerVoice(member: GuildMember): Promise<VoiceChannel | null> {
  if (!member.voice.channel) return null;
  const vc = member.voice.channel;
  if (vc.type !== ChannelType.GuildVoice) return null;

  const voice = await db
    .select()
    .from(pvsVoicesTable)
    .where(and(eq(pvsVoicesTable.channelId, vc.id), eq(pvsVoicesTable.ownerId, member.id)))
    .limit(1);

  if (voice.length === 0) return null;
  return vc as VoiceChannel;
}

async function getConfig(guildId: string) {
  const result = await db
    .select()
    .from(botConfigTable)
    .where(eq(botConfigTable.guildId, guildId))
    .limit(1);
  return result[0] ?? null;
}

async function pushWaitingRoomToBottom(guild: Guild, categoryId: string, waitingRoomChannelId: string) {
  const categoryChannels = guild.channels.cache
    .filter((c) => c.parentId === categoryId && c.type === ChannelType.GuildVoice)
    .sort((a, b) => (a as VoiceChannel).rawPosition - (b as VoiceChannel).rawPosition);

  if (categoryChannels.size === 0) return;

  const channelArray = [...categoryChannels.values()] as VoiceChannel[];
  const minPos = channelArray[0].rawPosition;

  const reordered = [
    ...channelArray.filter((c) => c.id !== waitingRoomChannelId),
    ...channelArray.filter((c) => c.id === waitingRoomChannelId),
  ];

  await guild.channels.setPositions(
    reordered.map((c, i) => ({ channel: c.id, position: minPos + i }))
  ).catch(() => {});
}

export function registerPVSModule(client: Client) {
  client.on("messageCreate", async (message) => {
    try {
      if (message.author.bot) return;
      if (!message.guild) return;

      const member = message.member;
      if (!member) return;

      if (message.content.startsWith(MANAGER_PREFIX)) {
        const content = message.content.slice(MANAGER_PREFIX.length).trim();
        if (content.toLowerCase().startsWith("pv delete ")) {
          await handleManagerDeletePVS(message, member, content.slice(10).trim());
        } else if (content.toLowerCase().startsWith("pv ")) {
          await handleManagerCreatePVS(message, member, content.slice(3).trim());
        }
        return;
      }

      if (!message.content.startsWith(PVS_PREFIX)) return;

      const content = message.content.slice(PVS_PREFIX.length).trim();

      if (content.toLowerCase().startsWith("key ")) {
        await handleKey(message, member, content.slice(4).trim());
      } else if (content.toLowerCase() === "clear keys") {
        await handleClearKeys(message, member);
      } else if (content.toLowerCase() === "see keys") {
        await handleSeeKeys(message, member);
      } else if (content.toLowerCase().startsWith("name ")) {
        await handleRename(message, member, content.slice(5).trim());
      } else if (content.toLowerCase().startsWith("pull ")) {
        await handlePull(message, member, content.slice(5).trim());
      }
    } catch (err) {
      console.error("[PVS] Unhandled error in messageCreate:", err);
    }
  });
}

async function createPrivateVoice(
  member: GuildMember,
  guild: import("discord.js").Guild,
  categoryId: string | null,
  waitingRoomChannelId?: string | null
) {
  try {
    const newChannel = await guild.channels.create({
      name: `${member.displayName} Premium Voice`,
      type: ChannelType.GuildVoice,
      parent: categoryId ?? undefined,
      permissionOverwrites: [
        {
          id: guild.id,
          deny: [PermissionsBitField.Flags.Connect],
        },
        {
          id: member.id,
          type: OverwriteType.Member,
          allow: OWNER_PERMS,
        },
        {
          id: guild.members.me!.id,
          type: OverwriteType.Member,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.Connect,
            PermissionsBitField.Flags.ManageChannels,
            PermissionsBitField.Flags.MoveMembers,
          ],
        },
      ],
    });

    await db.insert(pvsVoicesTable).values({
      guildId: guild.id,
      channelId: newChannel.id,
      ownerId: member.id,
    });

    if (waitingRoomChannelId && newChannel.parentId) {
      await pushWaitingRoomToBottom(guild, newChannel.parentId, waitingRoomChannelId);
    }

    const welcomeEmbed = new EmbedBuilder()
      .setColor(0x5000ff)
      .setTitle("🎙️ Welcome to your Premium Voice!")
      .setDescription(
        `Hey <@${member.id}>! Your private room is ready.\n\n` +
        "Use these commands to manage who gets in:"
      )
      .addFields(
        { name: "`=key @user`", value: "Give or remove access for a member.", inline: false },
        { name: "`=pull @user`", value: "Pull a member from the waiting room into your room.", inline: false },
        { name: "`=see keys`", value: "See who currently has access.", inline: false },
        { name: "`=clear keys`", value: "Remove all keys — room goes fully private.", inline: false },
        { name: "`=name NewName`", value: "Rename your voice room.", inline: false },
      )
      .setFooter({ text: "Night Stars • PVS" })
      .setTimestamp();

    await newChannel.send({ content: `<@${member.id}>`, embeds: [welcomeEmbed] }).catch(() => {});

  } catch (err) {
    console.error("PVS: failed to create private voice", err);
  }
}

async function handleManagerCreatePVS(message: Message, manager: GuildMember, args: string) {
  const config = await getConfig(message.guild!.id);

  const hasPvsManagerRole = config?.pvsManagerRoleId && manager.roles.cache.has(config.pvsManagerRoleId);
  const hasStaffRole = config?.staffRoleId && manager.roles.cache.has(config.staffRoleId);
  if (!hasPvsManagerRole && !hasStaffRole) {
    await sendTemp(message, errorEmbed("You need the **PVS Manager** or **Staff** role to use this command."));
    return;
  }

  const targetId = args.replace(/[<@!>]/g, "").trim();
  if (!targetId) {
    await sendTemp(message, errorEmbed("Please mention a member. Usage: `+pv @member`"));
    return;
  }

  const target = await message.guild!.members.fetch(targetId).catch(() => null);
  if (!target) {
    await sendTemp(message, errorEmbed("Member not found."));
    return;
  }

  try {
    await message.delete().catch(() => {});

    const createChannel = config.pvsCreateChannelId
      ? message.guild!.channels.cache.get(config.pvsCreateChannelId)
      : null;
    const fallbackCategoryId = createChannel?.parentId ?? null;
    const categoryId = config.pvsCategoryId ?? fallbackCategoryId;

    const newChannel = await message.guild!.channels.create({
      name: `${target.displayName} Premium Voice`,
      type: ChannelType.GuildVoice,
      parent: categoryId ?? undefined,
      permissionOverwrites: [
        { id: message.guild!.id, deny: [PermissionsBitField.Flags.Connect] },
        {
          id: target.id,
          type: OverwriteType.Member,
          allow: OWNER_PERMS,
        },
        {
          id: message.guild!.members.me!.id,
          type: OverwriteType.Member,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.Connect,
            PermissionsBitField.Flags.ManageChannels,
            PermissionsBitField.Flags.MoveMembers,
          ],
        },
      ],
    });

    await db.insert(pvsVoicesTable).values({
      guildId: message.guild!.id,
      channelId: newChannel.id,
      ownerId: target.id,
    });

    if (config.pvsWaitingRoomChannelId && newChannel.parentId) {
      await pushWaitingRoomToBottom(message.guild!, newChannel.parentId, config.pvsWaitingRoomChannelId);
    }

    const welcomeEmbed = new EmbedBuilder()
      .setColor(0x5000ff)
      .setTitle("🎙️ Welcome to your Premium Voice!")
      .setDescription(
        `Congratulations <@${target.id}>! 🎉\n\n` +
        `Your private room **${newChannel.name}** has been created.\n` +
        "Use the commands below to manage who gets in:"
      )
      .addFields(
        { name: "`=key @user`", value: "Give or remove access for a member.", inline: false },
        { name: "`=pull @user`", value: "Pull a member from the waiting room into your room.", inline: false },
        { name: "`=see keys`", value: "See who currently has access.", inline: false },
        { name: "`=clear keys`", value: "Remove all keys — room goes fully private.", inline: false },
        { name: "`=name NewName`", value: "Rename your voice room.", inline: false },
      )
      .setFooter({ text: `Created by ${manager.displayName} • Night Stars PVS` })
      .setTimestamp();

    await newChannel.send({ content: `<@${target.id}>`, embeds: [welcomeEmbed] }).catch(() => {});

    const staffNotice = await message.channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5000ff)
          .setDescription(`✅ **${newChannel.name}** created for <@${target.id}> — <#${newChannel.id}>`),
      ],
    });
    setTimeout(() => staffNotice.delete().catch(() => {}), 8000);

  } catch (err) {
    console.error("PVS: +pv create failed", err);
  }
}

async function handleManagerDeletePVS(message: Message, manager: GuildMember, args: string) {
  const config = await getConfig(message.guild!.id);

  const hasPvsManagerRole = config?.pvsManagerRoleId && manager.roles.cache.has(config.pvsManagerRoleId);
  const hasStaffRole = config?.staffRoleId && manager.roles.cache.has(config.staffRoleId);
  if (!hasPvsManagerRole && !hasStaffRole) {
    return;
  }

  const targetId = args.replace(/[<@!>]/g, "").trim();
  if (!targetId) {
    await sendTemp(message, errorEmbed("Please mention a member. Usage: `+pv delete @member`"));
    return;
  }

  const voice = await db
    .select()
    .from(pvsVoicesTable)
    .where(and(eq(pvsVoicesTable.guildId, message.guild!.id), eq(pvsVoicesTable.ownerId, targetId)))
    .limit(1);

  if (!voice.length) {
    await sendTemp(message, errorEmbed("This member doesn't have a Premium Voice room."));
    return;
  }

  const channelId = voice[0].channelId;
  const channel = message.guild!.channels.cache.get(channelId);

  await db.delete(pvsKeysTable).where(eq(pvsKeysTable.channelId, channelId));
  await db.delete(pvsVoicesTable).where(eq(pvsVoicesTable.channelId, channelId));

  if (channel) await channel.delete().catch(() => {});

  await message.delete().catch(() => {});
  const sent = await message.channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0x5000ff)
        .setDescription(`🗑️ <@${targetId}>'s Premium Voice room has been removed by ${manager.displayName}.`)
    ],
  });
  setTimeout(() => sent.delete().catch(() => {}), 10000);
}

async function handleKey(message: Message, member: GuildMember, args: string) {
  const vc = await getOwnerVoice(member);
  if (!vc) {
    await sendTemp(message, errorEmbed("You must be the owner of a private voice channel to use this."));
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
    .where(and(eq(pvsKeysTable.channelId, vc.id), eq(pvsKeysTable.userId, targetId)))
    .limit(1);

  if (existing.length > 0) {
    await db.delete(pvsKeysTable).where(
      and(eq(pvsKeysTable.channelId, vc.id), eq(pvsKeysTable.userId, targetId))
    );
    await vc.permissionOverwrites.delete(targetId).catch(() => {});
    await sendTemp(message, new EmbedBuilder()
      .setColor(0x5000ff)
      .setDescription(`🔑 <@${targetId}> **lost their key** to your voice room.`)
    );
  } else {
    await db.insert(pvsKeysTable).values({ channelId: vc.id, userId: targetId });
    await vc.permissionOverwrites.edit(targetId, {
      ViewChannel: true,
      Connect: true,
      Speak: true,
      Stream: true,
      ReadMessageHistory: true,
      UseVAD: true,
      UseSoundboard: true,
      UseExternalSounds: true,
      SendMessages: true,
      EmbedLinks: true,
      AttachFiles: true,
      AddReactions: true,
    });
    await sendTemp(message, new EmbedBuilder()
      .setColor(0x5000ff)
      .setDescription(`🔑 <@${targetId}> **received the key** to your voice room!`)
    );
  }
}

async function handleClearKeys(message: Message, member: GuildMember) {
  const vc = await getOwnerVoice(member);
  if (!vc) {
    await sendTemp(message, errorEmbed("You must be the owner of a private voice channel to use this."));
    return;
  }

  const keys = await db.select().from(pvsKeysTable).where(eq(pvsKeysTable.channelId, vc.id));
  for (const key of keys) {
    await vc.permissionOverwrites.delete(key.userId).catch(() => {});
  }
  await db.delete(pvsKeysTable).where(eq(pvsKeysTable.channelId, vc.id));

  await sendTemp(message, successEmbed("🧹 All keys have been cleared. Your room is fully private again."));
}

async function handleSeeKeys(message: Message, member: GuildMember) {
  const vc = await getOwnerVoice(member);
  if (!vc) {
    await sendTemp(message, errorEmbed("You must be the owner of a private voice channel to use this."));
    return;
  }

  const keys = await db.select().from(pvsKeysTable).where(eq(pvsKeysTable.channelId, vc.id));

  if (keys.length === 0) {
    await sendTemp(message, new EmbedBuilder()
      .setColor(0x5000ff)
      .setDescription("🔒 No keys given yet — your room is fully private.")
    );
    return;
  }

  const mentions = keys.map((k) => `<@${k.userId}>`).join(" • ");
  await sendTemp(message, new EmbedBuilder()
    .setColor(0x5000ff)
    .setTitle("🔑 Current Keys")
    .setDescription(mentions)
  );
}

async function handleRename(message: Message, member: GuildMember, newName: string) {
  if (!newName) {
    await sendTemp(message, errorEmbed("Please provide a new name. Usage: `=name NewName`"));
    return;
  }

  const vc = await getOwnerVoice(member);
  if (!vc) {
    await sendTemp(message, errorEmbed("You must be the owner of a private voice channel to use this."));
    return;
  }

  await vc.setName(newName).catch(() => {});
  await sendTemp(message, successEmbed(`✏️ Your voice room has been renamed to **${newName}**.`));
}

async function handlePull(message: Message, member: GuildMember, args: string) {
  const vc = await getOwnerVoice(member);
  if (!vc) {
    await sendTemp(message, errorEmbed("You must be the owner of a private voice channel to use this."));
    return;
  }

  const config = await getConfig(message.guild!.id);
  if (!config?.pvsWaitingRoomChannelId) {
    await sendTemp(message, errorEmbed("No waiting room has been configured for this server."));
    return;
  }

  const targetId = args.replace(/[<@!>]/g, "").trim();
  if (!targetId) {
    await sendTemp(message, errorEmbed("Please mention a member to pull. Usage: `=pull @member`"));
    return;
  }

  if (targetId === member.id) {
    await sendTemp(message, errorEmbed("You can't pull yourself."));
    return;
  }

  const target = await message.guild!.members.fetch(targetId).catch(() => null);
  if (!target) {
    await sendTemp(message, errorEmbed("Member not found."));
    return;
  }

  if (target.voice.channelId !== config.pvsWaitingRoomChannelId) {
    await sendTemp(message, errorEmbed(`<@${targetId}> is not in the waiting room.`));
    return;
  }

  await target.voice.setChannel(vc).catch(() => {});
  await message.delete().catch(() => {});

  await vc.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0x5000ff)
        .setDescription(`🚪 <@${member.id}> pulled <@${targetId}> in from the waiting room.`),
    ],
  }).catch(() => {});
}
