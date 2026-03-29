import { Client, Message, EmbedBuilder, TextChannel } from "discord.js";
import { db } from "@workspace/db";
import {
  botConfigTable,
  ctpCategoriesTable,
  ctpCooldownsTable,
  ctpTempVoiceConfigTable,
  ctpTempVoiceGamesTable,
  ctpTempVoiceCooldownsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { isMainGuild } from "../../utils/guildFilter.js";

const CTP_COMMAND = "-tag";

function formatSeconds(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m > 0 && s > 0) return `${m}m ${s}s`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

export function registerCTPModule(client: Client) {
  client.on("messageCreate", async (message: Message) => {
    try {
      if (message.author.bot) return;
      if (!message.guild) return;
      if (!isMainGuild(message.guild.id)) return;

      const content = message.content.toLowerCase().trim();
      const isCTPTag = content === CTP_COMMAND;
      const isTempTag = content.startsWith("-") && !isCTPTag && content.length > 1;

      if (!isCTPTag && !isTempTag) return;

      const member = message.member;
      if (!member) return;
      const guildId = message.guild.id;

      // ── -tag in CTP game category ─────────────────────────────────────────
      if (isCTPTag) {
        const voiceChannel = member.voice.channel;
        if (!voiceChannel) {
          const notice = await message.channel.send({
            embeds: [new EmbedBuilder().setColor(0x5000ff).setDescription("You must be in a game voice channel to use this.")],
          });
          setTimeout(() => notice.delete().catch(() => {}), 6000);
          return;
        }

        const categoryId = voiceChannel.parentId;
        if (!categoryId) {
          const notice = await message.channel.send({
            embeds: [new EmbedBuilder().setColor(0x5000ff).setDescription("This voice channel is not under a configured game category.")],
          });
          setTimeout(() => notice.delete().catch(() => {}), 6000);
          return;
        }

        const config = await db
          .select()
          .from(ctpCategoriesTable)
          .where(and(eq(ctpCategoriesTable.guildId, guildId), eq(ctpCategoriesTable.categoryId, categoryId), eq(ctpCategoriesTable.enabled, 1)))
          .limit(1)
          .then((r) => r[0] ?? null);

        if (!config) {
          const notice = await message.channel.send({
            embeds: [new EmbedBuilder().setColor(0x5000ff).setDescription("This voice channel's category is not set up for Call to Play.")],
          });
          setTimeout(() => notice.delete().catch(() => {}), 6000);
          return;
        }

        const serverConfig = await db.select().from(botConfigTable).where(eq(botConfigTable.guildId, guildId)).limit(1);
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
          .where(and(eq(ctpCooldownsTable.guildId, guildId), eq(ctpCooldownsTable.categoryId, config.categoryId)))
          .limit(1);

        if (!isGameManager && cooldownRecord.length) {
          const elapsed = (now.getTime() - cooldownRecord[0].lastUsedAt.getTime()) / 1000;
          if (elapsed < config.cooldownSeconds) {
            const remaining = Math.ceil(config.cooldownSeconds - elapsed);
            const notice = await message.channel.send({
              embeds: [
                new EmbedBuilder()
                  .setColor(0x5000ff)
                  .setTitle("Cooldown Active")
                  .setDescription(`The **${config.gameName}** tag was used recently.\nYou can re-tag in **${formatSeconds(remaining)}**.`)
                  .setFooter({ text: `Cooldown: ${formatSeconds(config.cooldownSeconds)} • Night Stars CTP` }),
              ],
            });
            setTimeout(() => notice.delete().catch(() => {}), 8000);
            return;
          }
        }

        const pingMessage = config.pingMessage ?? "Looking for players!";
        const pingEmbed = new EmbedBuilder()
          .setColor(0x5000ff)
          .setDescription(`**${member.displayName}** — ${pingMessage}`)
          .setFooter({ text: `Next tag available in ${formatSeconds(config.cooldownSeconds)}` });

        await voiceChannel.send({
          content: `<@&${config.gameRoleId}>`,
          embeds: [pingEmbed],
          allowedMentions: { roles: [config.gameRoleId] },
        });

        const confirmMsg = isGameManager ? "Tag sent! (Cooldown bypassed)" : `Tag sent! You can re-tag after **${formatSeconds(config.cooldownSeconds)}**.`;
        const confirm = await (message.channel as TextChannel).send({
          embeds: [new EmbedBuilder().setColor(0x5000ff).setDescription(`✅ ${confirmMsg}`)],
        });
        setTimeout(() => confirm.delete().catch(() => {}), 6000);

        if (cooldownRecord.length) {
          await db.update(ctpCooldownsTable).set({ lastUsedAt: now }).where(and(eq(ctpCooldownsTable.guildId, guildId), eq(ctpCooldownsTable.categoryId, config.categoryId)));
        } else {
          await db.insert(ctpCooldownsTable).values({ guildId, categoryId: config.categoryId, lastUsedAt: now });
        }
        return;
      }

      // ── -gamename in temp voice category ──────────────────────────────────
      if (isTempTag) {
        const gameInput = content.slice(1).trim();
        if (!gameInput) return;

        const voiceChannel = member.voice.channel;
        if (!voiceChannel) return;

        const [tvConfig] = await db
          .select()
          .from(ctpTempVoiceConfigTable)
          .where(eq(ctpTempVoiceConfigTable.guildId, guildId))
          .limit(1);

        if (!tvConfig || !tvConfig.enabled || !tvConfig.categoryId) return;
        if (voiceChannel.parentId !== tvConfig.categoryId) return;

        // Check temp voice games list first (added to temp = can be used here regardless of CTP category)
        const tvGames = await db.select().from(ctpTempVoiceGamesTable).where(eq(ctpTempVoiceGamesTable.guildId, guildId));
        const tvMatch = tvGames.find((g) => g.gameName.toLowerCase() === gameInput);

        if (!tvMatch) {
          // Not in temp voice list — if it has a CTP category, redirect
          const allCTPGames = await db
            .select()
            .from(ctpCategoriesTable)
            .where(and(eq(ctpCategoriesTable.guildId, guildId), eq(ctpCategoriesTable.enabled, 1)));
          const ctpMatch = allCTPGames.find((g) => g.gameName.toLowerCase() === gameInput);
          if (ctpMatch) {
            const notice = await message.channel.send({
              embeds: [
                new EmbedBuilder()
                  .setColor(0x5000ff)
                  .setDescription(`**${ctpMatch.gameName}** has its own voice category! Join the game voice and use -tag there.`),
              ],
            });
            setTimeout(() => notice.delete().catch(() => {}), 8000);
            message.delete().catch(() => {});
          }
          return;
        }

        // Cooldown check
        const now = new Date();
        const [cooldownRecord] = await db
          .select()
          .from(ctpTempVoiceCooldownsTable)
          .where(and(eq(ctpTempVoiceCooldownsTable.guildId, guildId), eq(ctpTempVoiceCooldownsTable.roleId, tvMatch.roleId)))
          .limit(1);

        if (cooldownRecord) {
          const elapsed = (now.getTime() - cooldownRecord.lastUsedAt.getTime()) / 1000;
          if (elapsed < tvConfig.cooldownSeconds) {
            const remaining = Math.ceil(tvConfig.cooldownSeconds - elapsed);
            const notice = await message.channel.send({
              embeds: [
                new EmbedBuilder()
                  .setColor(0x5000ff)
                  .setTitle("Cooldown Active")
                  .setDescription(`The **${tvMatch.gameName}** tag was used recently.\nYou can re-tag in **${formatSeconds(remaining)}**.`)
                  .setFooter({ text: `Cooldown: ${formatSeconds(tvConfig.cooldownSeconds)} • Night Stars CTP` }),
              ],
            });
            setTimeout(() => notice.delete().catch(() => {}), 8000);
            return;
          }
        }

        await voiceChannel.send({
          content: `<@&${tvMatch.roleId}>`,
          embeds: [
            new EmbedBuilder()
              .setColor(0x5000ff)
              .setDescription(`**${member.displayName}** is looking for **${tvMatch.gameName}** players!`)
              .setFooter({ text: `Next tag available in ${formatSeconds(tvConfig.cooldownSeconds)}` }),
          ],
          allowedMentions: { roles: [tvMatch.roleId] },
        });

        message.delete().catch(() => {});

        if (cooldownRecord) {
          await db.update(ctpTempVoiceCooldownsTable).set({ lastUsedAt: now }).where(and(eq(ctpTempVoiceCooldownsTable.guildId, guildId), eq(ctpTempVoiceCooldownsTable.roleId, tvMatch.roleId)));
        } else {
          await db.insert(ctpTempVoiceCooldownsTable).values({ guildId, roleId: tvMatch.roleId, lastUsedAt: now });
        }
      }
    } catch (err) {
      console.error("[CTP] Unhandled error in messageCreate:", err);
    }
  });
}
