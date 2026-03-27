import { Client, Message, EmbedBuilder, ChannelType, TextChannel } from "discord.js";
import { db } from "@workspace/db";
import { ctpCategoriesTable, ctpCooldownsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const CTP_PREFIX = "-";

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
                ? `❌ You must join a **${gameNames}** voice channel first before tagging.`
                : "❌ You must be in a game voice channel first before tagging."
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
            .setDescription("❌ This voice channel is not set up for Call to Play."),
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
                ? `❌ You must join a ${gameNames} voice channel first before tagging.`
                : "❌ This voice channel is not set up for Call to Play."
            ),
        ],
      });
      setTimeout(() => notice.delete().catch(() => {}), 6000);
      return;
    }

    const config = ctpConfig[0];
    const now = new Date();

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

    if (cooldownRecord.length) {
      const lastUsed = cooldownRecord[0].lastUsedAt;
      const elapsed = (now.getTime() - lastUsed.getTime()) / 1000;
      if (elapsed < config.cooldownSeconds) {
        const remaining = Math.ceil(config.cooldownSeconds - elapsed);
        const minutes = Math.floor(remaining / 60);
        const seconds = remaining % 60;
        const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

        await message.delete().catch(() => {});
        const notice = await message.channel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0xe74c3c)
              .setTitle("⏳ Cooldown Active")
              .setDescription(
                `The **${config.gameName}** tag was used recently.\n` +
                `You can re-tag in **${timeStr}**.`
              )
              .setFooter({ text: `Cooldown: ${config.cooldownSeconds}s • Night Stars CTP` }),
          ],
        });
        setTimeout(() => notice.delete().catch(() => {}), 8000);
        return;
      }
    }

    const pingText = config.pingMessage ?? content;

    const pingEmbed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle(`🎮 ${config.gameName} — Call to Play`)
      .setDescription(
        `<@&${config.gameRoleId}>\n\n` +
        `**${member.displayName}** is calling:\n` +
        `> ${pingText}`
      )
      .addFields({
        name: "Voice Channel",
        value: `🔊 ${voiceChannel.name}`,
        inline: true,
      })
      .setFooter({ text: `Night Stars CTP • Cooldown resets in ${config.cooldownSeconds}s` })
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
    const confirm = await confirmChannel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x2ecc71)
          .setDescription(`✅ Tag sent! You can re-tag after **${config.cooldownSeconds}s**.`),
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
