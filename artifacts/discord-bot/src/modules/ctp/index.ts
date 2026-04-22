import { Client, Message, EmbedBuilder, TextChannel } from "discord.js";
import { db } from "@workspace/db";
import {
  ctpCategoriesTable,
  ctpCooldownsTable,
  ctpTempVoiceConfigTable,
  ctpTempVoiceGamesTable,
  ctpTempVoiceCooldownsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { isMainGuild } from "../../utils/guildFilter.js";

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
      // CTP category: exactly "tag" (no prefix, nothing else with it)
      const isCTPTag = content === "tag";
      // Cooldown check: exactly "tagcd" or "tag cd"
      const isTagCd = !isCTPTag && (content === "tagcd" || content === "tag cd");
      // One Tap (temp voice): "tag <gamename>" — must be exactly two tokens, no extras
      const tapMatch = !isCTPTag && !isTagCd ? content.match(/^tag\s+(\S+)\s*$/) : null;
      const isTempTag = !!tapMatch;

      if (!isCTPTag && !isTempTag && !isTagCd) return;

      const member = message.member;
      if (!member) return;
      const guildId = message.guild.id;

      // ── tagcd / tag cd — show remaining cooldown ──────────────────────────
      if (isTagCd) {
        const voiceChannel = member.voice.channel;
        if (!voiceChannel || !voiceChannel.parentId) {
          const notice = await message.channel.send({
            embeds: [new EmbedBuilder().setColor(0x5000ff).setDescription("Join a game voice channel to check the tag cooldown.")],
          });
          setTimeout(() => notice.delete().catch(() => {}), 6000);
          return;
        }
        const parentId = voiceChannel.parentId;

        // Try CTP category first
        const [ctpCfg] = await db
          .select()
          .from(ctpCategoriesTable)
          .where(and(
            eq(ctpCategoriesTable.guildId, guildId),
            eq(ctpCategoriesTable.categoryId, parentId),
            eq(ctpCategoriesTable.enabled, 1),
          ))
          .limit(1);

        if (ctpCfg) {
          const [cd] = await db
            .select()
            .from(ctpCooldownsTable)
            .where(and(
              eq(ctpCooldownsTable.guildId, guildId),
              eq(ctpCooldownsTable.categoryId, ctpCfg.categoryId),
            ))
            .limit(1);
          const now = Date.now();
          const elapsed = cd ? (now - cd.lastUsedAt.getTime()) / 1000 : ctpCfg.cooldownSeconds;
          const remaining = Math.max(0, Math.ceil(ctpCfg.cooldownSeconds - elapsed));
          const desc = remaining > 0
            ? `**${ctpCfg.gameName}** tag cooldown: **${formatSeconds(remaining)}** remaining.`
            : `**${ctpCfg.gameName}** tag is **ready** to use.`;
          const notice = await message.channel.send({
            embeds: [new EmbedBuilder().setColor(0x5000ff).setDescription(desc).setFooter({ text: `Cooldown: ${formatSeconds(ctpCfg.cooldownSeconds)} \u2022 Night Stars CTP` })],
          });
          setTimeout(() => notice.delete().catch(() => {}), 8000);
          message.delete().catch(() => {});
          return;
        }

        // Otherwise, check temp-voice category — list every game's remaining cd
        const [tvCfg] = await db
          .select()
          .from(ctpTempVoiceConfigTable)
          .where(eq(ctpTempVoiceConfigTable.guildId, guildId))
          .limit(1);

        if (tvCfg && tvCfg.enabled && tvCfg.categoryId === parentId) {
          const tvGames = await db
            .select()
            .from(ctpTempVoiceGamesTable)
            .where(eq(ctpTempVoiceGamesTable.guildId, guildId));
          if (!tvGames.length) {
            const notice = await message.channel.send({
              embeds: [new EmbedBuilder().setColor(0x5000ff).setDescription("No one-tap games configured yet.")],
            });
            setTimeout(() => notice.delete().catch(() => {}), 6000);
            return;
          }
          const cds = await db
            .select()
            .from(ctpTempVoiceCooldownsTable)
            .where(eq(ctpTempVoiceCooldownsTable.guildId, guildId));
          const now = Date.now();
          const lines = tvGames.map((g) => {
            const cd = cds.find((c) => c.roleId === g.roleId);
            const elapsed = cd ? (now - cd.lastUsedAt.getTime()) / 1000 : tvCfg.cooldownSeconds;
            const remaining = Math.max(0, Math.ceil(tvCfg.cooldownSeconds - elapsed));
            return remaining > 0
              ? `\u23F3 **${g.gameName}** \u2014 ${formatSeconds(remaining)} left`
              : `\u2705 **${g.gameName}** \u2014 ready`;
          });
          const notice = await message.channel.send({
            embeds: [
              new EmbedBuilder()
                .setColor(0x5000ff)
                .setTitle("One-Tap Cooldowns")
                .setDescription(lines.join("\n"))
                .setFooter({ text: `Cooldown: ${formatSeconds(tvCfg.cooldownSeconds)} \u2022 Night Stars CTP` }),
            ],
          });
          setTimeout(() => notice.delete().catch(() => {}), 12000);
          message.delete().catch(() => {});
          return;
        }

        const notice = await message.channel.send({
          embeds: [new EmbedBuilder().setColor(0x5000ff).setDescription("This voice channel's category isn't configured for Call to Play.")],
        });
        setTimeout(() => notice.delete().catch(() => {}), 6000);
        return;
      }

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
        message.delete().catch(() => {});

        const now = new Date();
        const cooldownRecord = await db
          .select()
          .from(ctpCooldownsTable)
          .where(and(eq(ctpCooldownsTable.guildId, guildId), eq(ctpCooldownsTable.categoryId, config.categoryId)))
          .limit(1);

        if (cooldownRecord.length) {
          const elapsed = (now.getTime() - cooldownRecord[0].lastUsedAt.getTime()) / 1000;
          if (elapsed < config.cooldownSeconds) {
            const remaining = Math.ceil(config.cooldownSeconds - elapsed);
            const notice = await message.channel.send({
              embeds: [
                new EmbedBuilder()
                  .setColor(0x5000ff)
                  .setTitle("Cooldown Active")
                  .setDescription(`The **${config.gameName}** tag was used recently.\nYou can re-tag in **${formatSeconds(remaining)}**.`)
                  .setFooter({ text: `Cooldown: ${formatSeconds(config.cooldownSeconds)} \u2022 Night Stars CTP` }),
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

        const confirm = await (message.channel as TextChannel).send({
          embeds: [new EmbedBuilder().setColor(0x5000ff).setDescription(`\u2705 Tag sent! You can re-tag after **${formatSeconds(config.cooldownSeconds)}**.`)],
        });
        setTimeout(() => confirm.delete().catch(() => {}), 6000);

        if (cooldownRecord.length) {
          await db.update(ctpCooldownsTable).set({ lastUsedAt: now }).where(and(eq(ctpCooldownsTable.guildId, guildId), eq(ctpCooldownsTable.categoryId, config.categoryId)));
        } else {
          await db.insert(ctpCooldownsTable).values({ guildId, categoryId: config.categoryId, lastUsedAt: now });
        }
        return;
      }

      // ── tag <gamename> in temp voice category ─────────────────────────────
      if (isTempTag && tapMatch) {
        const gameInput = tapMatch[1].trim();
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

        const tvGames = await db.select().from(ctpTempVoiceGamesTable).where(eq(ctpTempVoiceGamesTable.guildId, guildId));
        const tvMatch = tvGames.find((g) => g.gameName.toLowerCase() === gameInput);

        if (!tvMatch) {
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
                  .setDescription(`**${ctpMatch.gameName}** has its own voice category! Join the game voice and type \`tag\` there.`),
              ],
            });
            setTimeout(() => notice.delete().catch(() => {}), 8000);
            message.delete().catch(() => {});
          }
          return;
        }

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
                  .setFooter({ text: `Cooldown: ${formatSeconds(tvConfig.cooldownSeconds)} \u2022 Night Stars CTP` }),
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
