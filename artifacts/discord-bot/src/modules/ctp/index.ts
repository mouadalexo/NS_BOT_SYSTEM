import { Client, Message, EmbedBuilder, TextChannel, PermissionFlagsBits } from "discord.js";
import { db } from "@workspace/db";
import {
  ctpCategoriesTable,
  ctpCooldownsTable,
  ctpTempVoiceConfigTable,
  ctpTempVoiceGamesTable,
  ctpTempVoiceCooldownsTable,
  botConfigTable,
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

async function getGuildPrefix(guildId: string): Promise<string> {
  const [cfg] = await db
    .select({ pvsPrefix: botConfigTable.pvsPrefix })
    .from(botConfigTable)
    .where(eq(botConfigTable.guildId, guildId))
    .limit(1);
  return cfg?.pvsPrefix ?? "=";
}

export function registerCTPModule(client: Client) {
  client.on("messageCreate", async (message: Message) => {
    try {
      if (message.author.bot) return;
      if (!message.guild) return;
      if (!isMainGuild(message.guild.id)) return;

      const origContent = message.content.trim();
      const content = origContent.toLowerCase();

      const member = message.member;
      if (!member) return;
      const guildId = message.guild.id;

      // ── {prefix}tag list — show available onetap games ────────────────────
      const prefix = await getGuildPrefix(guildId);
      const isTagList = content === `${prefix.toLowerCase()}tag list`;

      if (isTagList) {
        const [tvConfig] = await db
          .select()
          .from(ctpTempVoiceConfigTable)
          .where(eq(ctpTempVoiceConfigTable.guildId, guildId))
          .limit(1);

        if (!tvConfig || !tvConfig.enabled) return;

        let gamingChatIds: string[] = [];
        try {
          gamingChatIds = tvConfig.gamingChatChannelIdsJson
            ? JSON.parse(tvConfig.gamingChatChannelIdsJson)
            : [];
          if (!Array.isArray(gamingChatIds)) gamingChatIds = [];
        } catch {
          gamingChatIds = [];
        }

        const voiceChannel = member.voice.channel;
        const inOneTapVoice = !!(tvConfig.categoryId && voiceChannel && voiceChannel.parentId === tvConfig.categoryId);
        const inGamingChat = gamingChatIds.includes(message.channel.id);

        if (!inOneTapVoice && !inGamingChat) return;

        const tvGames = await db
          .select()
          .from(ctpTempVoiceGamesTable)
          .where(eq(ctpTempVoiceGamesTable.guildId, guildId));

        if (!tvGames.length) {
          const notice = await message.channel.send({
            embeds: [new EmbedBuilder().setColor(0x5000ff).setDescription("No CTP Onetap games configured yet.")],
          });
          setTimeout(() => notice.delete().catch(() => {}), 6000);
          message.delete().catch(() => {});
          return;
        }

        const cds = await db
          .select()
          .from(ctpTempVoiceCooldownsTable)
          .where(eq(ctpTempVoiceCooldownsTable.guildId, guildId));

        const now = Date.now();
        const lines = tvGames.map((g) => {
          const eff = g.cooldownSecondsOverride ?? tvConfig.cooldownSeconds;
          const cd = cds.find((c) => c.roleId === g.roleId);
          const elapsed = cd ? (now - cd.lastUsedAt.getTime()) / 1000 : eff;
          const remaining = Math.max(0, Math.ceil(eff - elapsed));
          const status = remaining > 0 ? `\u23F3 ${formatSeconds(remaining)}` : "\u2705 ready";
          return `${status} — tag ${g.gameName}`;
        });

        const notice = await message.channel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0x5000ff)
              .setTitle("CTP Onetap Games")
              .setDescription(lines.join("\n"))
              .setFooter({ text: `Night Stars CTP \u2022 use: tag gamename [message]` }),
          ],
        });
        setTimeout(() => notice.delete().catch(() => {}), 12000);
        message.delete().catch(() => {});
        return;
      }

      // tagcd / tag cd — show remaining cooldown
      const isTagCd = content === "tagcd" || content === "tag cd";
      // Any tag command (tagcd and tag list excluded)
      const isTagCmd = !isTagCd && /^tag(\s|$)/i.test(origContent);

      if (!isTagCd && !isTagCmd) return;

      // ── tagcd / tag cd — show remaining cooldown ──────────────────────────
      if (isTagCd) {
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
              embeds: [new EmbedBuilder().setColor(0x5000ff).setDescription("No CTP Onetap games configured yet.")],
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
              ? `\u23F3 ${g.gameName} \u2014 ${formatSeconds(remaining)} left`
              : `\u2705 ${g.gameName} \u2014 ready`;
          });
          const notice = await message.channel.send({
            embeds: [
              new EmbedBuilder()
                .setColor(0x5000ff)
                .setTitle("CTP Onetap Cooldowns")
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
            ? `${ctpCfg.gameName} tag cooldown: ${formatSeconds(remaining)} remaining.`
            : `${ctpCfg.gameName} tag is ready to use.`;
          const notice = await message.channel.send({
            embeds: [new EmbedBuilder().setColor(0x5000ff).setDescription(desc).setFooter({ text: `Cooldown: ${formatSeconds(ctpCfg.cooldownSeconds)} \u2022 Night Stars CTP` })],
          });
          setTimeout(() => notice.delete().catch(() => {}), 8000);
          message.delete().catch(() => {});
          return;
        }

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
              embeds: [new EmbedBuilder().setColor(0x5000ff).setDescription("No CTP Onetap games configured yet.")],
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
              ? `\u23F3 ${g.gameName} \u2014 ${formatSeconds(remaining)} left`
              : `\u2705 ${g.gameName} \u2014 ready`;
          });
          const notice = await message.channel.send({
            embeds: [
              new EmbedBuilder()
                .setColor(0x5000ff)
                .setTitle("CTP Onetap Cooldowns")
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

      // ── tag command — determine context then route ────────────────────────
      if (isTagCmd) {
        const voiceChannel = member.voice.channel;
        const msgParentId = (message.channel as TextChannel).parentId ?? null;

        // Load onetap config
        const [tvConfig] = await db
          .select()
          .from(ctpTempVoiceConfigTable)
          .where(eq(ctpTempVoiceConfigTable.guildId, guildId))
          .limit(1);

        let gamingChatIds: string[] = [];
        try {
          gamingChatIds = tvConfig?.gamingChatChannelIdsJson
            ? JSON.parse(tvConfig.gamingChatChannelIdsJson)
            : [];
          if (!Array.isArray(gamingChatIds)) gamingChatIds = [];
        } catch {
          gamingChatIds = [];
        }

        const inOneTapVoice = !!(tvConfig && tvConfig.enabled && tvConfig.categoryId && voiceChannel && voiceChannel.parentId === tvConfig.categoryId);
        const inGamingChat = !!(tvConfig && tvConfig.enabled && gamingChatIds.includes(message.channel.id));
        const isOneTapContext = inOneTapVoice || inGamingChat;

        // Check if channel is inside a CTP game category
        const categoryId = msgParentId ?? voiceChannel?.parentId ?? null;
        const ctpConfig = categoryId
          ? await db
              .select()
              .from(ctpCategoriesTable)
              .where(and(eq(ctpCategoriesTable.guildId, guildId), eq(ctpCategoriesTable.categoryId, categoryId), eq(ctpCategoriesTable.enabled, 1)))
              .limit(1)
              .then((r) => r[0] ?? null)
          : null;

        const isCTPContext = !!ctpConfig;

        // ── CTP Onetap tag ─────────────────────────────────────────────────
        if (isOneTapContext) {
          const tailMatch = origContent.match(/^tag\s+(\S+)(?:\s+([\s\S]+))?$/i);
          const gameInput = tailMatch?.[1]?.toLowerCase() ?? null;
          const inlineMsg = tailMatch?.[2]?.trim() ?? null;

          if (!gameInput) {
            const notice = await message.channel.send({
              embeds: [new EmbedBuilder().setColor(0x5000ff).setDescription(`Specify a game name: \`tag gamename [message]\`\nUse \`${prefix}tag list\` to see available games.`)],
            });
            setTimeout(() => notice.delete().catch(() => {}), 6000);
            message.delete().catch(() => {});
            return;
          }

          // Validate message length
          if (inlineMsg && inlineMsg.length > 20) {
            const notice = await message.channel.send({
              embeds: [new EmbedBuilder().setColor(0x5000ff).setDescription("The message must be 20 characters or less.")],
            });
            setTimeout(() => notice.delete().catch(() => {}), 6000);
            message.delete().catch(() => {});
            return;
          }

          // Voice lock check — only when tagging from inside a voice channel
          if (inOneTapVoice && voiceChannel) {
            const everyoneRole = message.guild.roles.everyone;
            const everyonePerms = voiceChannel.permissionsFor(everyoneRole);
            const memberRole = message.guild.roles.cache.find((r) => r.name.toLowerCase() === "member");
            const memberPerms = memberRole ? voiceChannel.permissionsFor(memberRole) : null;

            const everyoneCanConnect = everyonePerms?.has(PermissionFlagsBits.Connect) ?? false;
            const memberCanConnect = memberPerms?.has(PermissionFlagsBits.Connect) ?? false;

            if (!everyoneCanConnect && !memberCanConnect) {
              const notice = await message.channel.send({
                embeds: [new EmbedBuilder().setColor(0x5000ff).setDescription("You must unlock the voice to tag.")],
              });
              setTimeout(() => notice.delete().catch(() => {}), 6000);
              message.delete().catch(() => {});
              return;
            }
          }

          const tvGames = await db.select().from(ctpTempVoiceGamesTable).where(eq(ctpTempVoiceGamesTable.guildId, guildId));
          const tvMatch = tvGames.find((g) => g.gameName.toLowerCase() === gameInput);

          if (!tvMatch) {
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
                    .setDescription(`${ctpMatch.gameName} has its own CTP Category! Join the game voice and type \`tag\` there.`),
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

          const effectiveCooldown = tvMatch.cooldownSecondsOverride ?? tvConfig!.cooldownSeconds;
          if (cooldownRecord) {
            const elapsed = (now.getTime() - cooldownRecord.lastUsedAt.getTime()) / 1000;
            if (elapsed < effectiveCooldown) {
              const remaining = Math.ceil(effectiveCooldown - elapsed);
              const notice = await message.channel.send({
                embeds: [
                  new EmbedBuilder()
                    .setColor(0x5000ff)
                    .setTitle("Cooldown Active")
                    .setDescription(`The ${tvMatch.gameName} tag was used recently.\nYou can re-tag in ${formatSeconds(remaining)}.`)
                    .setFooter({ text: `Cooldown: ${formatSeconds(effectiveCooldown)} \u2022 Night Stars CTP` }),
                ],
              });
              setTimeout(() => notice.delete().catch(() => {}), 8000);
              return;
            }
          }

          const targetChannel = inGamingChat
            ? (message.channel as TextChannel)
            : (voiceChannel as unknown as TextChannel);

          const pingContent = inlineMsg
            ? `${inlineMsg} - ${member.displayName} <@&${tvMatch.roleId}>`
            : `${member.displayName} <@&${tvMatch.roleId}>`;

          await targetChannel.send({
            content: pingContent,
            allowedMentions: { roles: [tvMatch.roleId] },
          });

          message.delete().catch(() => {});

          if (cooldownRecord) {
            await db.update(ctpTempVoiceCooldownsTable).set({ lastUsedAt: now }).where(and(eq(ctpTempVoiceCooldownsTable.guildId, guildId), eq(ctpTempVoiceCooldownsTable.roleId, tvMatch.roleId)));
          } else {
            await db.insert(ctpTempVoiceCooldownsTable).values({ guildId, roleId: tvMatch.roleId, lastUsedAt: now });
          }
          return;
        }

        // ── CTP Category tag ──────────────────────────────────────────────
        if (isCTPContext && ctpConfig) {
          const ctpTailMatch = origContent.match(/^tag(?:\s+([\s\S]+))?$/i);
          const ctpInlineMsg = ctpTailMatch?.[1]?.trim() ?? null;

          if (ctpInlineMsg && ctpInlineMsg.length > 20) {
            const notice = await message.channel.send({
              embeds: [new EmbedBuilder().setColor(0x5000ff).setDescription("The message must be 20 characters or less.")],
            });
            setTimeout(() => notice.delete().catch(() => {}), 6000);
            message.delete().catch(() => {});
            return;
          }

          message.delete().catch(() => {});

          const now = new Date();
          const cooldownRecord = await db
            .select()
            .from(ctpCooldownsTable)
            .where(and(eq(ctpCooldownsTable.guildId, guildId), eq(ctpCooldownsTable.categoryId, ctpConfig.categoryId)))
            .limit(1);

          if (cooldownRecord.length) {
            const elapsed = (now.getTime() - cooldownRecord[0].lastUsedAt.getTime()) / 1000;
            if (elapsed < ctpConfig.cooldownSeconds) {
              const remaining = Math.ceil(ctpConfig.cooldownSeconds - elapsed);
              const notice = await message.channel.send({
                embeds: [
                  new EmbedBuilder()
                    .setColor(0x5000ff)
                    .setTitle("Cooldown Active")
                    .setDescription(`The ${ctpConfig.gameName} tag was used recently.\nYou can re-tag in ${formatSeconds(remaining)}.`)
                    .setFooter({ text: `Cooldown: ${formatSeconds(ctpConfig.cooldownSeconds)} \u2022 Night Stars CTP` }),
                ],
              });
              setTimeout(() => notice.delete().catch(() => {}), 8000);
              return;
            }
          }

          const pingContent = ctpInlineMsg
            ? `${ctpInlineMsg} - ${member.displayName} <@&${ctpConfig.gameRoleId}>`
            : `${member.displayName} <@&${ctpConfig.gameRoleId}>`;

          await (message.channel as TextChannel).send({
            content: pingContent,
            allowedMentions: { roles: [ctpConfig.gameRoleId] },
          });

          const confirm = await (message.channel as TextChannel).send({
            embeds: [new EmbedBuilder().setColor(0x5000ff).setDescription(`\u2705 Tag sent! You can re-tag after ${formatSeconds(ctpConfig.cooldownSeconds)}.`)],
          });
          setTimeout(() => confirm.delete().catch(() => {}), 6000);

          if (cooldownRecord.length) {
            await db.update(ctpCooldownsTable).set({ lastUsedAt: now }).where(and(eq(ctpCooldownsTable.guildId, guildId), eq(ctpCooldownsTable.categoryId, ctpConfig.categoryId)));
          } else {
            await db.insert(ctpCooldownsTable).values({ guildId, categoryId: ctpConfig.categoryId, lastUsedAt: now });
          }
          return;
        }

        // Not in any configured context — stay silent
      }
    } catch (err) {
      console.error("[CTP] Unhandled error in messageCreate:", err);
    }
  });
}
