import { Client, Message, EmbedBuilder, ChannelType, TextChannel } from "discord.js";
import { db } from "@workspace/db";
import { botConfigTable, ctpCategoriesTable, ctpCooldownsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const CTP_PREFIX = "-";

function formatSeconds(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m > 0 && s > 0) return `${m}m ${s}s`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

export function registerCTPModule(client: Client) {
  client.on("messageCreate", async (message: Message) => {
    if (message.author.bot) return;
    if (!message.guild) return;
    if (!message.content.startsWith(CTP_PREFIX)) return;

    const content = message.content.slice(CTP_PREFIX.length).trim();
    if (!content) return;

    const member = message.member;
    if (!member) return;

    const voiceChannel = member.voice.channel;

    if (!voiceChannel) {
      const allConfigs = await db
        .select()
        .from(ctpCategoriesTable)
        .where(and(eq(ctpCategoriesTable.guildId, message.guild.id), eq(ctpCategoriesTable.enabled, 1)));

      await message.delete().catch(() => {});
      const gameNames = allConfigs.map((c) => `**${c.gameName}**`).join(", ");
      const notice = await message.channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0xe74c3c)
            .setDescription(
              allConfigs.length
                ? `You must join a **${gameNames}** voice channel first before tagging.`
                : "You must be in a game voice channel first before tagging."
            ),
        ],
      });
      setTimeout(() => notice.delete().catch(() => {}), 6000);
      return;
    }

    const categoryId = voiceChannel.parentId;

    if (!categoryId) {
      await message.delete().catch(() => {});
      const notice = await message.channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0xe74c3c)
            .setDescription("This voice channel is not set up for Call to Play."),
        ],
      });
      setTimeout(() => notice.delete().catch(() => {}), 6000);
      return;
    }

    const ctpConfig = await db
      .select()
      .from(ctpCategoriesTable)
      .where(
        and(
          eq(ctpCategoriesTable.guildId, message.guild.id),
          eq(ctpCategoriesTable.categoryId, categoryId),
          eq(ctpCategoriesTable.enabled, 1)
        )
      )
      .limit(1);

    if (!ctpConfig.length) {
      const allConfigs = await db
        .select()
        .from(ctpCategoriesTable)
        .where(and(eq(ctpCategoriesTable.guildId, message.guild.id), eq(ctpCategoriesTable.enabled, 1)));

      await message.delete().catch(() => {});
      const gameNames = allConfigs.map((c) => `**${c.gameName}**`).join(", ");
      const notice = await message.channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0xe74c3c)
            .setDescription(
              allConfigs.length
                ? `You must join a ${gameNames} voice channel first before tagging.`
                : "This voice channel is not set up for Call to Play."
            ),
        ],
      });
      setTimeout(() => notice.delete().catch(() => {}), 6000);
      return;
    }

    const config = ctpConfig[0];
    const now = new Date();

    const serverConfig = await db
      .select()
      .from(botConfigTable)
      .where(eq(botConfigTable.guildId, message.guild.id))
      .limit(1);

    const gameManagerRoleId = serverConfig[0]?.gameManagerRoleId;
    const staffRoleId = serverConfig[0]?.staffRoleId;
    const isGameManager = !!(
      (gameManagerRoleId && member.roles.cache.has(gameManagerRoleId)) ||
      (staffRoleId && member.roles.cache.has(staffRoleId))
    );

    const cooldownRecord = await db
      .select()
      .from(ctpCooldownsTable)
      .where(
        and(
          eq(ctpCooldownsTable.guildId, message.guild.id),
          eq(ctpCooldownsTable.categoryId, categoryId)
        )
      )
      .limit(1);

    if (!isGameManager && cooldownRecord.length) {
      const lastUsed = cooldownRecord[0].lastUsedAt;
      const elapsed = (now.getTime() - lastUsed.getTime()) / 1000;
      if (elapsed < config.cooldownSeconds) {
        const remaining = Math.ceil(config.cooldownSeconds - elapsed);
        const timeStr = formatSeconds(remaining);

        await message.delete().catch(() => {});
        const notice = await message.channel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0xe74c3c)
              .setTitle("Cooldown Active")
              .setDescription(
                `The **${config.gameName}** tag was used recently.\n` +
                `You can re-tag in **${timeStr}**.`
              )
              .setFooter({ text: `Cooldown: ${formatSeconds(config.cooldownSeconds)} • Night Stars CTP` }),
          ],
        });
        setTimeout(() => notice.delete().catch(() => {}), 8000);
        return;
      }
    }

    const pingText = config.pingMessage ?? content;

    const pingEmbed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle(`${config.gameName} — Call to Play`)
      .setDescription(
        `<@&${config.gameRoleId}>\n\n` +
        `**${member.displayName}** is calling:\n` +
        `> ${pingText}`
      )
      .addFields({
        name: "Voice Channel",
        value: voiceChannel.name,
        inline: true,
      })
      .setFooter({ text: `Night Stars CTP • Cooldown: ${formatSeconds(config.cooldownSeconds)}` })
      .setTimestamp();

    let outputChannel: TextChannel;
    if (config.outputChannelId) {
      const ch = message.guild.channels.cache.get(config.outputChannelId);
      outputChannel = (ch?.type === ChannelType.GuildText ? ch : message.channel) as TextChannel;
    } else {
      outputChannel = message.channel as TextChannel;
    }

    await message.delete().catch(() => {});
    await outputChannel.send({ embeds: [pingEmbed] });

    const confirmChannel = message.channel as TextChannel;
    const confirmMsg = isGameManager
      ? `Tag sent! (Cooldown bypassed — game manager)`
      : `Tag sent! You can re-tag after **${formatSeconds(config.cooldownSeconds)}**.`;

    const confirm = await confirmChannel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0xff0000)
          .setDescription(`✅ ${confirmMsg}`),
      ],
    });
    setTimeout(() => confirm.delete().catch(() => {}), 6000);

    if (cooldownRecord.length) {
      await db
        .update(ctpCooldownsTable)
        .set({ lastUsedAt: now })
        .where(
          and(
            eq(ctpCooldownsTable.guildId, message.guild.id),
            eq(ctpCooldownsTable.categoryId, categoryId)
          )
        );
    } else {
      await db.insert(ctpCooldownsTable).values({
        guildId: message.guild.id,
        categoryId,
        lastUsedAt: now,
      });
    }
  });
}
