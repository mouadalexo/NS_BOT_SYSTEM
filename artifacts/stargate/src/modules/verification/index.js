import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, OverwriteType, ChannelType, PermissionsBitField, } from "discord.js";
import { db } from "@workspace/db";
import { botConfigTable, verificationSessionsTable, memberLeavesTable } from "@workspace/db";
import { eq, and, count } from "drizzle-orm";
import { isMainGuild } from "../../utils/guildFilter.js";
const BRAND = 0x5000ff;
const COLOR_PENDING = 0xffb347;
const COLOR_ACCEPT = 0x57f287;
const COLOR_DENY = 0xed4245;
const COLOR_JAIL = 0x95a5a6;
const DEFAULT_QUESTIONS = [
    "Wach nta mghribi ?",
    "Mnin dkhlti l server ?",
    "3lach dkhlti l server ?",
    "Ch7al f3mrk ?",
    "Chno lhaja libghiti tl9aha f server ?",
];
async function getQuestions(guildId) {
    const config = await db
        .select()
        .from(botConfigTable)
        .where(eq(botConfigTable.guildId, guildId))
        .limit(1);
    try {
        if (config[0]?.verificationQuestions) {
            return JSON.parse(config[0].verificationQuestions);
        }
    }
    catch { }
    return DEFAULT_QUESTIONS;
}
export function buildVerificationPanelEmbed(title, description) {
    const resolvedDesc = description ||
        "Welcome to **Night Stars**!\n\n" +
            "Click the button below and answer the questions.\n" +
            "A staff member will review your answers and verify you shortly.";
    return new EmbedBuilder()
        .setColor(BRAND)
        .setTitle(title || "Night Stars — Verification")
        .setDescription(resolvedDesc)
        .setFooter({ text: "Night Stars • Verification System" });
}
function buildStartButton() {
    return new ActionRowBuilder().addComponents(new ButtonBuilder()
        .setCustomId("verification_start")
        .setLabel("Start Verification")
        .setStyle(ButtonStyle.Primary));
}
async function buildVerificationModal(guildId) {
    const questions = await getQuestions(guildId);
    const modal = new ModalBuilder()
        .setCustomId("verification_modal")
        .setTitle("Night Stars — Verification");
    for (let i = 0; i < 5; i++) {
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
            .setCustomId(`q${i + 1}`)
            .setLabel(questions[i] ?? `Question ${i + 1}`)
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(300)));
    }
    return modal;
}
function buildRequestEmbed(memberId, memberUsername, memberAvatarUrl, createdAt, joinedAt, answers, questions, applicationNumber, hasLeftBefore) {
    const embed = new EmbedBuilder()
        .setColor(hasLeftBefore ? 0xff9900 : COLOR_PENDING)
        .setAuthor({ name: `Application #${applicationNumber}`, iconURL: memberAvatarUrl ?? undefined })
        .setTitle(hasLeftBefore ? "🔔 New Verification Request ⚠️" : "🔔 New Verification Request")
        .addFields({
        name: "👤 Member",
        value: `<@${memberId}>\n\`${memberUsername}\``,
        inline: true,
    }, {
        name: "🆔 User ID",
        value: `\`${memberId}\``,
        inline: true,
    }, {
        name: "📅 Account Age",
        value: `<t:${Math.floor(createdAt / 1000)}:R>`,
        inline: true,
    }, {
        name: "🚪 Joined Server",
        value: joinedAt ? `<t:${Math.floor(joinedAt / 1000)}:R>` : "_Unknown_",
        inline: true,
    }, ...(hasLeftBefore ? [{
            name: "⚠️ Rejoined",
            value: "This member was in the server before and left.",
            inline: false,
        }] : []), { name: "\u200B", value: "**─── Answers ───**", inline: false }, ...questions.map((q, i) => ({
        name: `${i + 1}. ${q}`,
        value: answers[i] ? `> ${answers[i]}` : "> _No answer_",
        inline: false,
    })))
        .setFooter({ text: `Application #${applicationNumber} • Pending review` })
        .setTimestamp();
    if (memberAvatarUrl) {
        embed.setThumbnail(memberAvatarUrl);
    }
    return embed;
}
function buildActionButtons(disabled = false) {
    return new ActionRowBuilder().addComponents(new ButtonBuilder()
        .setCustomId("verify_accept")
        .setLabel("Accept")
        .setEmoji("✅")
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled), new ButtonBuilder()
        .setCustomId("verify_deny")
        .setLabel("Deny")
        .setEmoji("❌")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled), new ButtonBuilder()
        .setCustomId("verify_jail")
        .setLabel("Jail")
        .setEmoji("🔒")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled), new ButtonBuilder()
        .setCustomId("verify_ticket")
        .setLabel("Ticket")
        .setEmoji("🎫")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled));
}
function buildOutcomeLogEmbed(action, memberId, memberUsername, memberAvatarUrl, staffName, staffId, applicationNumber, ticketChannelName) {
    const configs = {
        accept: { color: COLOR_ACCEPT, icon: "✅", label: "Accepted" },
        deny: { color: COLOR_DENY, icon: "❌", label: "Denied" },
        jail: { color: COLOR_JAIL, icon: "🔒", label: "Jailed" },
        ticket: { color: BRAND, icon: "🎫", label: "Ticket Opened" },
    };
    const { color, icon, label } = configs[action];
    const embed = new EmbedBuilder()
        .setColor(color)
        .setAuthor({ name: `Application #${applicationNumber}`, iconURL: memberAvatarUrl ?? undefined })
        .setTitle(`${icon} Verification ${label}`)
        .addFields({
        name: "👤 Member",
        value: `<@${memberId}> \`${memberUsername}\``,
        inline: true,
    }, {
        name: "🛡️ Staff",
        value: `<@${staffId}> \`${staffName}\``,
        inline: true,
    })
        .setTimestamp()
        .setFooter({ text: `Night Stars • Verification Logs` });
    if (action === "ticket" && ticketChannelName) {
        embed.addFields({ name: "📋 Ticket", value: `#${ticketChannelName}`, inline: true });
    }
    return embed;
}
async function getConfig(guildId) {
    const result = await db
        .select()
        .from(botConfigTable)
        .where(eq(botConfigTable.guildId, guildId))
        .limit(1);
    return result[0] ?? null;
}
export async function deployVerificationPanel(channel) {
    const config = await getConfig(channel.guild.id);
    const title = config?.panelEmbedTitle ?? null;
    const desc = config?.panelEmbedDescription ?? null;
    await channel.send({
        embeds: [buildVerificationPanelEmbed(title, desc)],
        components: [buildStartButton()],
    });
}
export function registerVerificationModule(client) {
    // ── Track member leaves for rejoin detection ──────────────────────────────
    client.on("guildMemberRemove", async (member) => {
        if (!isMainGuild(member.guild.id))
            return;
        try {
            await db.insert(memberLeavesTable).values({
                guildId: member.guild.id,
                memberId: member.id,
            });
        }
        catch { }
    });
    client.on("interactionCreate", async (interaction) => {
        if (!interaction.guild)
            return;
        if (!isMainGuild(interaction.guild.id))
            return;
        if (interaction.isButton() && interaction.customId === "verification_start") {
            const modal = await buildVerificationModal(interaction.guild.id);
            await interaction.showModal(modal);
            return;
        }
        if (interaction.isModalSubmit() && interaction.customId === "verification_modal") {
            await handleVerificationSubmit(interaction);
            return;
        }
        if (interaction.isButton()) {
            if (interaction.customId === "verify_close_ticket") {
                await handleCloseTicket(interaction);
                return;
            }
            const validIds = ["verify_accept", "verify_deny", "verify_jail", "verify_ticket"];
            if (validIds.includes(interaction.customId)) {
                await handleVerificationAction(interaction);
            }
        }
    });
}
async function handleCloseTicket(interaction) {
    const guildId = interaction.guild.id;
    const config = await getConfig(guildId);
    const member = interaction.member;
    const hasPermission = member.permissions.has(PermissionsBitField.Flags.Administrator) ||
        (config?.verificatorsRoleId
            ? member.roles.cache.has(config.verificatorsRoleId)
            : false);
    if (!hasPermission) {
        await interaction.reply({
            content: "❌ Only staff with the Verificators role can close tickets.",
            ephemeral: true,
        });
        return;
    }
    await interaction.reply({
        content: "🔒 Closing ticket…",
        ephemeral: true,
    });
    try {
        await interaction.channel.delete(`Ticket closed by ${interaction.user.tag}`);
    }
    catch {
        // Channel may already be gone
    }
}
async function handleVerificationSubmit(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const guildId = interaction.guild.id;
    const user = interaction.user;
    const answers = [
        interaction.fields.getTextInputValue("q1"),
        interaction.fields.getTextInputValue("q2"),
        interaction.fields.getTextInputValue("q3"),
        interaction.fields.getTextInputValue("q4"),
        interaction.fields.getTextInputValue("q5"),
    ];
    const existing = await db
        .select()
        .from(verificationSessionsTable)
        .where(and(eq(verificationSessionsTable.guildId, guildId), eq(verificationSessionsTable.memberId, user.id)))
        .limit(1);
    if (existing.length) {
        await db
            .update(verificationSessionsTable)
            .set({
            channelId: "modal",
            currentQuestion: 5,
            answer1: answers[0],
            answer2: answers[1],
            answer3: answers[2],
            answer4: answers[3],
            answer5: answers[4],
            status: "submitted",
        })
            .where(and(eq(verificationSessionsTable.guildId, guildId), eq(verificationSessionsTable.memberId, user.id)));
    }
    else {
        await db.insert(verificationSessionsTable).values({
            guildId,
            memberId: user.id,
            channelId: "modal",
            currentQuestion: 5,
            answer1: answers[0],
            answer2: answers[1],
            answer3: answers[2],
            answer4: answers[3],
            answer5: answers[4],
            status: "submitted",
        });
    }
    await interaction.editReply({
        embeds: [
            new EmbedBuilder()
                .setColor(COLOR_PENDING)
                .setTitle("📨 Answers Submitted")
                .setDescription("Your answers have been sent to the staff for review.\nPlease wait — you will be verified shortly.")
                .setFooter({ text: "Night Stars • Verification System" }),
        ],
    });
    const config = await getConfig(guildId);
    const requestsChannelId = config?.verificationRequestsChannelId ?? config?.verificationLogsChannelId;
    if (!requestsChannelId)
        return;
    const requestsChannel = interaction.guild.channels.cache.get(requestsChannelId);
    if (!requestsChannel)
        return;
    const countResult = await db
        .select({ total: count() })
        .from(verificationSessionsTable)
        .where(eq(verificationSessionsTable.guildId, guildId));
    const applicationNumber = countResult[0]?.total ?? 1;
    const questions = await getQuestions(guildId);
    const avatarUrl = user.displayAvatarURL({ size: 128 });
    const joinedAt = interaction.member?.joinedTimestamp ?? null;
    // Check if member has left the server before
    const leaveRecord = await db
        .select({ id: memberLeavesTable.id })
        .from(memberLeavesTable)
        .where(and(eq(memberLeavesTable.guildId, guildId), eq(memberLeavesTable.memberId, user.id)))
        .limit(1);
    const hasLeftBefore = leaveRecord.length > 0;
    const requestEmbed = buildRequestEmbed(user.id, user.username, avatarUrl, user.createdTimestamp, joinedAt, answers, questions, applicationNumber, hasLeftBefore);
    await requestsChannel.send({
        content: config?.verificatorsRoleId ? `<@&${config.verificatorsRoleId}>` : undefined,
        embeds: [requestEmbed],
        components: [buildActionButtons(false)],
    });
}
async function handleVerificationAction(interaction) {
    await interaction.deferUpdate();
    const guildId = interaction.guild.id;
    const config = await getConfig(guildId);
    if (!config)
        return;
    const isAdmin = interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator) ?? false;
    const memberRoles = interaction.member?.roles;
    const hasRole = (roleId) => {
        if (!roleId)
            return false;
        if (Array.isArray(memberRoles))
            return memberRoles.includes(roleId);
        return memberRoles?.cache?.has(roleId) ?? false;
    };
    const hasVerificatorRole = config.verificatorsRoleId ? hasRole(config.verificatorsRoleId) : false;
    const hasStaffRole = config.staffRoleId ? hasRole(config.staffRoleId) : false;
    if (!isAdmin && !hasVerificatorRole && !hasStaffRole) {
        await interaction.followUp({
            content: "You do not have permission to use these buttons.",
            ephemeral: true,
        });
        return;
    }
    const embed = interaction.message.embeds[0];
    const idField = embed?.fields?.find((f) => f.name === "🆔 User ID");
    const memberId = idField?.value?.replace(/`/g, "").trim();
    if (!memberId)
        return;
    const targetMember = await interaction.guild.members.fetch(memberId).catch(() => null);
    const disabledRow = buildActionButtons(true);
    const { customId } = interaction;
    const staffName = interaction.user.username;
    const staffId = interaction.user.id;
    const memberUsername = targetMember?.user.username ?? memberId;
    const memberAvatarUrl = targetMember?.user.displayAvatarURL({ size: 128 }) ?? null;
    const authorData = embed?.author;
    const appNumMatch = authorData?.name?.match(/#(\d+)/);
    const applicationNumber = appNumMatch ? parseInt(appNumMatch[1]) : 0;
    let actionType = "deny";
    let ticketChannelName;
    if (customId === "verify_accept") {
        actionType = "accept";
        if (config.verifiedRoleId && targetMember) {
            await targetMember.roles.add(config.verifiedRoleId).catch(() => { });
        }
        if (config.unverifiedRoleId && targetMember) {
            await targetMember.roles.remove(config.unverifiedRoleId).catch(() => { });
        }
        await targetMember
            ?.send({
            embeds: [
                new EmbedBuilder()
                    .setColor(COLOR_ACCEPT)
                    .setTitle("✅ Verification Accepted")
                    .setDescription("Welcome to **Night Stars**! You now have full access to the server."),
            ],
        })
            .catch(() => { });
        await interaction.message.edit({
            embeds: [
                EmbedBuilder.from(embed)
                    .setColor(COLOR_ACCEPT)
                    .setFooter({ text: `✅ Accepted by ${staffName}` }),
            ],
            components: [disabledRow],
        });
    }
    else if (customId === "verify_deny") {
        actionType = "deny";
        await targetMember
            ?.send({
            embeds: [
                new EmbedBuilder()
                    .setColor(COLOR_DENY)
                    .setTitle("❌ Verification Denied")
                    .setDescription("Your verification for **Night Stars** was denied. You may try again."),
            ],
        })
            .catch(() => { });
        await interaction.message.edit({
            embeds: [
                EmbedBuilder.from(embed)
                    .setColor(COLOR_DENY)
                    .setFooter({ text: `❌ Denied by ${staffName}` }),
            ],
            components: [disabledRow],
        });
    }
    else if (customId === "verify_jail") {
        actionType = "jail";
        if (config.jailRoleId && targetMember) {
            await targetMember.roles.add(config.jailRoleId).catch(() => { });
        }
        await targetMember
            ?.send({
            embeds: [
                new EmbedBuilder()
                    .setColor(COLOR_JAIL)
                    .setTitle("🔒 Verification — Jailed")
                    .setDescription("Your verification request was flagged. A staff member may contact you."),
            ],
        })
            .catch(() => { });
        await interaction.message.edit({
            embeds: [
                EmbedBuilder.from(embed)
                    .setColor(COLOR_JAIL)
                    .setFooter({ text: `🔒 Jailed by ${staffName}` }),
            ],
            components: [disabledRow],
        });
    }
    else if (customId === "verify_ticket") {
        actionType = "ticket";
        if (!config.assistanceCategoryId) {
            await interaction.followUp({
                content: "Assistance category is not configured.",
                ephemeral: true,
            });
            return;
        }
        const ticketOverwrites = [
            { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
            {
                id: interaction.guild.members.me.id,
                type: OverwriteType.Member,
                allow: [
                    PermissionsBitField.Flags.ViewChannel,
                    PermissionsBitField.Flags.SendMessages,
                    PermissionsBitField.Flags.ManageChannels,
                ],
            },
        ];
        if (config.verificatorsRoleId) {
            ticketOverwrites.push({
                id: config.verificatorsRoleId,
                allow: [
                    PermissionsBitField.Flags.ViewChannel,
                    PermissionsBitField.Flags.SendMessages,
                ],
            });
        }
        if (targetMember) {
            ticketOverwrites.push({
                id: targetMember.id,
                type: OverwriteType.Member,
                allow: [
                    PermissionsBitField.Flags.ViewChannel,
                    PermissionsBitField.Flags.SendMessages,
                ],
            });
        }
        const session = await db
            .select()
            .from(verificationSessionsTable)
            .where(and(eq(verificationSessionsTable.guildId, guildId), eq(verificationSessionsTable.memberId, memberId)))
            .limit(1);
        const ticketChannel = await interaction.guild.channels.create({
            name: `ticket-${targetMember?.user.username ?? memberId}`,
            type: ChannelType.GuildText,
            parent: config.assistanceCategoryId,
            permissionOverwrites: ticketOverwrites,
        });
        ticketChannelName = ticketChannel.name;
        const answers = session[0]
            ? [
                session[0].answer1 ?? "",
                session[0].answer2 ?? "",
                session[0].answer3 ?? "",
                session[0].answer4 ?? "",
                session[0].answer5 ?? "",
            ]
            : [];
        const questions = await getQuestions(guildId);
        const closeRow = new ActionRowBuilder().addComponents(new ButtonBuilder()
            .setCustomId("verify_close_ticket")
            .setLabel("🔒 Close Ticket")
            .setStyle(ButtonStyle.Danger));
        await ticketChannel.send({
            content: config.verificatorsRoleId ? `<@&${config.verificatorsRoleId}> <@${memberId}>` : `<@${memberId}>`,
            embeds: [
                new EmbedBuilder()
                    .setColor(BRAND)
                    .setTitle("🎫 Assistance Ticket")
                    .setDescription(`Ticket for <@${memberId}> — opened by <@${interaction.user.id}>\n\n` +
                    `-# Only staff with the Verificators role can close this ticket.`)
                    .addFields({
                    name: "Verification Answers",
                    value: answers.length
                        ? answers
                            .map((a, i) => `**${questions[i] ?? `Q${i + 1}`}**\n> ${a || "_No answer_"}`)
                            .join("\n\n")
                        : "_Not available_",
                })
                    .setFooter({ text: "Stargate • Ticket" })
                    .setTimestamp(),
            ],
            components: [closeRow],
        });
        await interaction.message.edit({
            embeds: [
                EmbedBuilder.from(embed).setFooter({
                    text: `🎫 Ticket opened by ${staffName} → #${ticketChannel.name}`,
                }),
            ],
            components: [disabledRow],
        });
    }
    await db
        .update(verificationSessionsTable)
        .set({ status: customId.replace("verify_", "") })
        .where(and(eq(verificationSessionsTable.guildId, guildId), eq(verificationSessionsTable.memberId, memberId)));
    const requestsChannelId = config.verificationRequestsChannelId ?? config.verificationLogsChannelId;
    const logsChannelId = config.verificationLogsChannelId;
    if (logsChannelId && logsChannelId !== requestsChannelId) {
        const logsChannel = interaction.guild.channels.cache.get(logsChannelId);
        if (logsChannel) {
            const logEmbed = buildOutcomeLogEmbed(actionType, memberId, memberUsername, memberAvatarUrl, staffName, staffId, applicationNumber, ticketChannelName);
            await logsChannel.send({ embeds: [logEmbed] });
        }
    }
}
