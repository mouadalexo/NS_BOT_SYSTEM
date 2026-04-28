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
      // Cooldown check: exactly "tagcd" or "tag cd"
      const isTagCd = content === "tagcd" || content === "tag cd";
      // CTP category: exactly "tag" OR "tag <multi-word message>" (has a space in the tail)
      const isCTPTag = !isTagCd && (content === "tag" || /^tag\s+\S+\s+[\s\S]+$/.test(content));
      // One Tap (temp voice): "tag <single-word-gamename> [optional message]"
      const tapMatch = !isCTPTag && !isTagCd ? content.match(/^tag\s+(\S+)(?:\s+([\s\S]+))?$/) : null;
      const isTempTag = !!tapMatch;

      if (!isCTPTag && !isTempTag && !isTagCd) return;

      const member = message.member;
      if (!member) return;
      const guildId = message.guild.id;

      // ── tagcd / tag cd — show remaining cooldown ──────────────────────────
      if (isTagCd) {
        // Allow tagcd inside a configured gaming chat (lists One-Tap cooldowns)
        const [tvCfgForChat] = await db
          .select()
          .from(ctpTempVoiceConfigTable)
          .where(eq(ctpTempVoiceConfigTable.guildId, guildId))
          .limit(1);

        let chatIds: string[] = [];
        try {
          chatIds = tvCfgForChat?.gamingChatChannelIdsJson
            ? JSON.parse(tvCfgForChat.gamingChatChannelIdsJson)
            : [];
          if (!Array.isArray(chatIds)) chatIds = [];
        } catch {
          chatIds = [];
        }

        if (tvCfgForChat && tvCfgForChat.enabled && chatIds.includes(message.channel.id)) {
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
            const eff = g.cooldownSecondsOverride ?? tvCfgForChat.cooldownSeconds;
            const cd = cds.find((c) => c.roleId === g.roleId);
            const elapsed = cd ? (now - cd.lastUsedAt.getTime()) / 1000 : eff;
            const remaining = Math.max(0, Math.ceil(eff - elapsed));
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
                .setFooter({ text: `Cooldown: ${formatSeconds(tvCfgForChat.cooldownSeconds)} \u2022 Night Stars CTP` }),
            ],
          });
          setTimeout(() => notice.delete().catch(() => {}), 12000);
          message.delete().catch(() => {});
          return;
        }

        const voiceChannel = member.voice.channel;
        const msgParentId = (message.channel as TextChannel).parentId ?? null;
        const parentId = msgParentId ?? voiceChannel?.parentId ?? null;
        if (!parentId) {
          const notice = await message.channel.send({
            embeds: [new EmbedBuilder().setColor(0x5000ff).setDescription("Use this in a game category channel (text or voice) or join a game voice to check the tag cooldown.")],
          });
          setTimeout(() => notice.delete().catch(() => {}), 6000);
          return;
        }

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
            const eff = g.cooldownSecondsOverride ?? tvCfg.cooldownSeconds;
            const cd = cds.find((c) => c.roleId === g.roleId);
            const elapsed = cd ? (now - cd.lastUsedAt.getTime()) / 1000 : eff;
            const remaining = Math.max(0, Math.ceil(eff - elapsed));
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
        const msgParentId = (message.channel as TextChannel).parentId ?? null;
        const categoryId = msgParentId ?? voiceChannel?.parentId ?? null;
        if (!categoryId) {
          const notice = await message.channel.send({
            embeds: [new EmbedBuilder().setColor(0x5000ff).setDescription("Use `tag` in a channel under a game category (or join its voice channel).")],
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
            embeds: [new EmbedBuilder().setColor(0x5000ff).setDescription("This category isn't set up for Call to Play.")],
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

        const ctpRawMsg = message.content.trim().match(/^tag\s+([\s\S]+)$/i);
        const ctpInlineMsg = ctpRawMsg?.[1]?.trim() ?? null;
        const ctpContent = ctpInlineMsg
          ? `**${member.displayName}** — ${ctpInlineMsg} <@&${config.gameRoleId}>`
          : `**${member.displayName}** <@&${config.gameRoleId}>`;
        await (message.channel as TextChannel).send({
          content: ctpContent,
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

      // ── tag <gamename> in temp voice category OR a configured gaming chat ─
      if (isTempTag && tapMatch) {
        const gameInput = tapMatch[1].trim();
        if (!gameInput) return;

        // Extract optional inline message (preserve original casing)
        const origTagParts = message.content.trim().match(/^tag\s+\S+(?:\s+([\s\S]+))?$/i);
        const inlineMsg = origTagParts?.[1]?.trim() ?? null;

        const [tvConfig] = await db
          .select()
          .from(ctpTempVoiceConfigTable)
          .where(eq(ctpTempVoiceConfigTable.guildId, guildId))
          .limit(1);

        if (!tvConfig || !tvConfig.enabled || !tvConfig.categoryId) return;

        // Decide context: voice-channel inside the One-Tap category, or a gaming chat
        const voiceChannel = member.voice.channel;
        const inOneTapVoice = !!(voiceChannel && voiceChannel.parentId === tvConfig.categoryId);

        let gamingChatIds: string[] = [];
        try {
          gamingChatIds = tvConfig.gamingChatChannelIdsJson
            ? JSON.parse(tvConfig.gamingChatChannelIdsJson)
            : [];
          if (!Array.isArray(gamingChatIds)) gamingChatIds = [];
        } catch {
          gamingChatIds = [];
        }
        const inGamingChat = gamingChatIds.includes(message.channel.id);

        if (!inOneTapVoice && !inGamingChat) return;

        const tvGames = await db.select().from(ctpTempVoiceGamesTable).where(eq(ctpTempVoiceGamesTable.guildId, guildId));
        const tvMatch = tvGames.find((g) => g.gameName.toLowerCase() === gameInput);

        if (!tvMatch) {
          // In a gaming chat, category games are NOT taggable — stay silent.
          if (inGamingChat) return;

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

        const effectiveCooldown = tvMatch.cooldownSecondsOverride ?? tvConfig.cooldownSeconds;
        if (cooldownRecord) {
          const elapsed = (now.getTime() - cooldownRecord.lastUsedAt.getTime()) / 1000;
          if (elapsed < effectiveCooldown) {
            const remaining = Math.ceil(effectiveCooldown - elapsed);
            const notice = await message.channel.send({
              embeds: [
                new EmbedBuilder()
                  .setColor(0x5000ff)
                  .setTitle("Cooldown Active")
                  .setDescription(`The **${tvMatch.gameName}** tag was used recently.\nYou can re-tag in **${formatSeconds(remaining)}**.`)
                  .setFooter({ text: `Cooldown: ${formatSeconds(effectiveCooldown)} \u2022 Night Stars CTP` }),
              ],
            });
            setTimeout(() => notice.delete().catch(() => {}), 8000);
            return;
          }
        }

        // In a gaming chat we ping inside that chat. In a One-Tap voice we ping the voice channel chat.
        const targetChannel = inGamingChat
          ? (message.channel as TextChannel)
          : (voiceChannel as unknown as TextChannel);

        const pingText = inlineMsg ?? `${member.displayName} is looking for ${tvMatch.gameName} players!`;
        await targetChannel.send({
          content: `**${member.displayName}** — ${pingText} <@&${tvMatch.roleId}>`,
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
