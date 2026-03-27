import {
  Client,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ButtonInteraction,
  ModalSubmitInteraction,
  TextChannel,
  OverwriteType,
  ChannelType,
  PermissionsBitField,
} from "discord.js";
import { db } from "@workspace/db";
import { botConfigTable, verificationSessionsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const DEFAULT_QUESTIONS = [
  "Wach nta mghribi ?",
  "Mnin dkhlti l server ?",
  "3lach dkhlti l server ?",
  "Ch7al f3mrk ?",
  "Chno lhaja libghiti tl9aha f server ?",
];

async function getQuestions(guildId: string): Promise<string[]> {
  const config = await db
    .select()
    .from(botConfigTable)
    .where(eq(botConfigTable.guildId, guildId))
    .limit(1);
  try {
    if (config[0]?.verificationQuestions) {
      return JSON.parse(config[0].verificationQuestions);
    }
  } catch {}
  return DEFAULT_QUESTIONS;
}

export function buildVerificationPanelEmbed() {
  return new EmbedBuilder()
    .setColor(0xff0000)
    .setTitle("Night Stars — Verification")
    .setDescription(
      "Welcome to **Night Stars**!\n\n" +
      "Click the button below and answer the questions.\n" +
      "A staff member will review your answers and verify you shortly."
    )
    .setFooter({ text: "Night Stars • Verification System" })
    .setTimestamp();
}

function buildStartButton() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("verification_start")
      .setLabel("Start Verification")
      .setStyle(ButtonStyle.Primary)
  );
}

async function buildVerificationModal(guildId: string) {
  const questions = await getQuestions(guildId);

  const modal = new ModalBuilder()
    .setCustomId("verification_modal")
    .setTitle("Night Stars — Verification");

  const styles = [
    TextInputStyle.Short,
    TextInputStyle.Short,
    TextInputStyle.Paragraph,
    TextInputStyle.Short,
    TextInputStyle.Paragraph,
  ];

  for (let i = 0; i < 5; i++) {
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(`q${i + 1}`)
          .setLabel(questions[i] ?? `Question ${i + 1}`)
          .setStyle(styles[i] ?? TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(300)
      )
    );
  }

  return modal;
}

function buildVerificationLogEmbed(
  memberId: string,
  memberUsername: string,
  createdAt: number,
  answers: string[],
  questions: string[]
) {
  return new EmbedBuilder()
    .setColor(0xff0000)
    .setTitle("New Verification Request")
    .addFields(
      { name: "Member", value: `<@${memberId}> (${memberUsername})`, inline: true },
      { name: "ID", value: memberId, inline: true },
      { name: "Account Created", value: `<t:${Math.floor(createdAt / 1000)}:R>`, inline: true },
      { name: "\u200B", value: "**Answers**", inline: false },
      ...questions.map((q, i) => ({
        name: `${i + 1}. ${q}`,
        value: answers[i] || "_No answer_",
        inline: false,
      }))
    )
    .setFooter({ text: "Verificators: choose an action below" })
    .setTimestamp();
}

function buildActionButtons(disabled = false) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("verify_accept")
      .setLabel("Accept")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId("verify_deny")
      .setLabel("Deny")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId("verify_jail")
      .setLabel("Jail")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId("verify_ticket")
      .setLabel("Open Ticket")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled)
  );
}

async function getConfig(guildId: string) {
  const result = await db
    .select()
    .from(botConfigTable)
    .where(eq(botConfigTable.guildId, guildId))
    .limit(1);
  return result[0] ?? null;
}

export async function deployVerificationPanel(channel: TextChannel) {
  await channel.send({
    embeds: [buildVerificationPanelEmbed()],
    components: [buildStartButton()],
  });
}

export function registerVerificationModule(client: Client) {
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.guild) return;

    if (interaction.isButton() && interaction.customId === "verification_start") {
      const modal = await buildVerificationModal(interaction.guild.id);
      await interaction.showModal(modal);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === "verification_modal") {
      await handleVerificationSubmit(interaction as ModalSubmitInteraction);
      return;
    }

    if (interaction.isButton()) {
      const validIds = ["verify_accept", "verify_deny", "verify_jail", "verify_ticket"];
      if (validIds.includes(interaction.customId)) {
        await handleVerificationAction(interaction as ButtonInteraction);
      }
    }
  });
}

async function handleVerificationSubmit(interaction: ModalSubmitInteraction) {
  const guildId = interaction.guild!.id;
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
    .where(
      and(
        eq(verificationSessionsTable.guildId, guildId),
        eq(verificationSessionsTable.memberId, user.id)
      )
    )
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
      .where(
        and(
          eq(verificationSessionsTable.guildId, guildId),
          eq(verificationSessionsTable.memberId, user.id)
        )
      );
  } else {
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

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle("Answers Submitted")
        .setDescription(
          "Your answers have been sent to the staff for review.\nPlease wait — you will be verified shortly."
        )
        .setFooter({ text: "Night Stars • Verification System" }),
    ],
    ephemeral: true,
  });

  const config = await getConfig(guildId);
  if (!config?.verificationLogsChannelId) return;

  const logsChannel = interaction.guild!.channels.cache.get(
    config.verificationLogsChannelId
  ) as TextChannel | undefined;
  if (!logsChannel) return;

  const questions = await getQuestions(guildId);
  const logEmbed = buildVerificationLogEmbed(user.id, user.username, user.createdTimestamp, answers, questions);

  await logsChannel.send({
    content: config.verificatorsRoleId ? `<@&${config.verificatorsRoleId}>` : undefined,
    embeds: [logEmbed],
    components: [buildActionButtons(false)],
  });
}

async function handleVerificationAction(interaction: ButtonInteraction) {
  const guildId = interaction.guild!.id;
  const config = await getConfig(guildId);
  if (!config) return;

  const guildMember = interaction.guild!.members.cache.get(interaction.user.id);
  if (!guildMember) return;

  const hasVerificatorRole = config.verificatorsRoleId && guildMember.roles.cache.has(config.verificatorsRoleId);
  const hasStaffRole = config.staffRoleId && guildMember.roles.cache.has(config.staffRoleId);
  if (!hasVerificatorRole && !hasStaffRole) {
    await interaction.reply({
      content: "You do not have permission to use these buttons.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferUpdate();

  const embed = interaction.message.embeds[0];
  const idField = embed?.fields?.find((f) => f.name === "ID");
  const memberId = idField?.value;
  if (!memberId) return;

  const targetMember = await interaction.guild!.members.fetch(memberId).catch(() => null);
  const disabledRow = buildActionButtons(true);
  const { customId } = interaction;
  const staffName = interaction.user.username;

  if (customId === "verify_accept") {
    if (config.verifiedRoleId && targetMember) {
      await targetMember.roles.add(config.verifiedRoleId).catch(() => {});
    }
    if (config.unverifiedRoleId && targetMember) {
      await targetMember.roles.remove(config.unverifiedRoleId).catch(() => {});
    }
    await targetMember
      ?.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle("Verification Accepted")
            .setDescription("Welcome to **Night Stars**! You now have full access to the server."),
        ],
      })
      .catch(() => {});
    await interaction.message.edit({
      embeds: [
        EmbedBuilder.from(embed)
          .setColor(0x2ecc71)
          .setFooter({ text: `Accepted by ${staffName}` }),
      ],
      components: [disabledRow],
    });
  } else if (customId === "verify_deny") {
    await targetMember
      ?.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle("Verification Denied")
            .setDescription("Your verification for **Night Stars** was denied. You may try again."),
        ],
      })
      .catch(() => {});
    await interaction.message.edit({
      embeds: [
        EmbedBuilder.from(embed)
          .setColor(0xe74c3c)
          .setFooter({ text: `Denied by ${staffName}` }),
      ],
      components: [disabledRow],
    });
  } else if (customId === "verify_jail") {
    if (config.jailRoleId && targetMember) {
      await targetMember.roles.add(config.jailRoleId).catch(() => {});
    }
    await targetMember
      ?.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle("Verification — Jailed")
            .setDescription("Your verification request was flagged. A staff member may contact you."),
        ],
      })
      .catch(() => {});
    await interaction.message.edit({
      embeds: [
        EmbedBuilder.from(embed)
          .setColor(0x95a5a6)
          .setFooter({ text: `Jailed by ${staffName}` }),
      ],
      components: [disabledRow],
    });
  } else if (customId === "verify_ticket") {
    if (!config.assistanceCategoryId) {
      await interaction.followUp({ content: "Assistance category is not configured.", ephemeral: true });
      return;
    }

    const ticketOverwrites: import("discord.js").OverwriteResolvable[] = [
      { id: interaction.guild!.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      {
        id: interaction.guild!.members.me!.id,
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
        allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
      });
    }

    if (targetMember) {
      ticketOverwrites.push({
        id: targetMember.id,
        type: OverwriteType.Member,
        allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
      });
    }

    const session = await db
      .select()
      .from(verificationSessionsTable)
      .where(
        and(
          eq(verificationSessionsTable.guildId, guildId),
          eq(verificationSessionsTable.memberId, memberId)
        )
      )
      .limit(1);

    const ticketChannel = await interaction.guild!.channels.create({
      name: `ticket-${targetMember?.user.username ?? memberId}`,
      type: ChannelType.GuildText,
      parent: config.assistanceCategoryId,
      permissionOverwrites: ticketOverwrites,
    });

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

    await ticketChannel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0xff0000)
          .setTitle("Assistance Ticket")
          .setDescription(`Ticket for <@${memberId}> — opened by <@${interaction.user.id}>`)
          .addFields({
            name: "Verification Answers",
            value: answers.length
              ? answers.map((a, i) => `**${questions[i] ?? `Q${i + 1}`}**\n${a || "_No answer_"}`).join("\n\n")
              : "_Not available_",
          })
          .setFooter({ text: "Night Stars • Ticket" })
          .setTimestamp(),
      ],
    });

    await interaction.message.edit({
      embeds: [
        EmbedBuilder.from(embed).setFooter({
          text: `Ticket opened by ${staffName} → #${ticketChannel.name}`,
        }),
      ],
      components: [disabledRow],
    });
  }

  await db
    .update(verificationSessionsTable)
    .set({ status: customId.replace("verify_", "") })
    .where(
      and(
        eq(verificationSessionsTable.guildId, guildId),
        eq(verificationSessionsTable.memberId, memberId)
      )
    );
}
