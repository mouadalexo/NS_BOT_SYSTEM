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
    if (!voiceChannel) return;

    const categoryId = voiceChannel.parentId;
    if (!categoryId) return;

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

    if (!ctpConfig.length) return;

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
        const notice = await message.reply({
          content: `Cooldown active. Please wait **${remaining}s** before calling again.`,
        });
        setTimeout(() => notice.delete().catch(() => {}), 5000);
        await message.delete().catch(() => {});
        return;
      }
    }

    const firstSentence = content.split(/[.!?]/)[0].trim();
    const pingText = config.pingMessage ?? firstSentence;

    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setDescription(
        `<@&${config.gameRoleId}>\n${pingText}\n\n*Requested by ${member.displayName} — ${config.gameName}*`
      );

    let targetChannel: TextChannel;

    if (config.outputChannelId) {
      const ch = message.guild.channels.cache.get(config.outputChannelId);
      if (ch && ch.type === ChannelType.GuildText) {
        targetChannel = ch as TextChannel;
      } else {
        targetChannel = message.channel as TextChannel;
      }
    } else {
      targetChannel = message.channel as TextChannel;
    }

    await targetChannel.send({ embeds: [embed] });
    await message.delete().catch(() => {});

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
