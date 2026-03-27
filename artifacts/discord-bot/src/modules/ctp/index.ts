import { Client, Message, EmbedBuilder, TextChannel } from "discord.js";
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

    const gameName = message.content.slice(CTP_PREFIX.length).trim();
    if (!gameName) return;

    const member = message.member;
    if (!member) return;

    const guildId = message.guild.id;

    const allConfigs = await db
      .select()
      .from(ctpCategoriesTable)
      .where(and(eq(ctpCategoriesTable.guildId, guildId), eq(ctpCategoriesTable.enabled, 1)));

    if (!allConfigs.length) return;

    const config = allConfigs.find(
      (c) => c.gameName.toLowerCase() === gameName.toLowerCase()
    );

    if (!config) {
      const gameList = allConfigs.map((c) => `**${c.gameName}**`).join(", ");
      const notice = await message.channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0xe74c3c)
            .setDescription(`No game found with that name. Available: ${gameList}`),
        ],
      });
      setTimeout(() => notice.delete().catch(() => {}), 8000);
      return;
    }

    const voiceChannel = member.voice.channel;
    if (!voiceChannel) {
      const notice = await message.channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0xe74c3c)
            .setDescription(`You must join a **${config.gameName}** voice channel first.`),
        ],
      });
      setTimeout(() => notice.delete().catch(() => {}), 6000);
      return;
    }

    if (voiceChannel.parentId !== config.categoryId) {
      const notice = await message.channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0xe74c3c)
            .setDescription(`You must be in a **${config.gameName}** voice channel to use this tag.`),
        ],
      });
      setTimeout(() => notice.delete().catch(() => {}), 6000);
      return;
    }

    const serverConfig = await db
      .select()
      .from(botConfigTable)
      .where(eq(botConfigTable.guildId, guildId))
      .limit(1);

    const gameManagerRoleId = serverConfig[0]?.gameManagerRoleId;
    const staffRoleId = serverConfig[0]?.staffRoleId;
    const isGameManager = !!(
      (gameManagerRoleId && member.roles.cache.has(gameManagerRoleId)) ||
      (staffRoleId && member.roles.cache.has(staffRoleId))
    );

    const now = new Date();

    const cooldownRecord = await db
      .select()
      .from(ctpCooldownsTable)
      .where(
        and(
          eq(ctpCooldownsTable.guildId, guildId),
          eq(ctpCooldownsTable.categoryId, config.categoryId)
        )
      )
      .limit(1);

    if (!isGameManager && cooldownRecord.length) {
      const lastUsed = cooldownRecord[0].lastUsedAt;
      const elapsed = (now.getTime() - lastUsed.getTime()) / 1000;
      if (elapsed < config.cooldownSeconds) {
        const remaining = Math.ceil(config.cooldownSeconds - elapsed);
        const timeStr = formatSeconds(remaining);
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

    const pingMessage = config.pingMessage ?? "Looking for players!";

    const pingEmbed = new EmbedBuilder()
      .setColor(0xff0000)
      .setDescription(
        `<@&${config.gameRoleId}>\n` +
        `**${member.displayName}** — ${pingMessage}`
      );

    await voiceChannel.send({ embeds: [pingEmbed] });

    const confirmMsg = isGameManager
      ? `Tag sent! (Cooldown bypassed)`
      : `Tag sent! You can re-tag after **${formatSeconds(config.cooldownSeconds)}**.`;

    const confirm = await (message.channel as TextChannel).send({
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
            eq(ctpCooldownsTable.guildId, guildId),
            eq(ctpCooldownsTable.categoryId, config.categoryId)
          )
        );
    } else {
      await db.insert(ctpCooldownsTable).values({
        guildId,
        categoryId: config.categoryId,
        lastUsedAt: now,
      });
    }
  });
}
