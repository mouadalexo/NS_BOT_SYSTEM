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

export function buildVerificationPanelEmbed() {
  return new EmbedBuilder()
    .setColor(0x1a1a2e)
    .setTitle("⭐ Night Stars — Verification")
    .setDescription(
      "Welcome to **Night Stars**!\n\n" +
      "To gain access to the server, you need to complete a quick verification.\n" +
      "Click the button below and answer the 5 questions in the form that appears.\n\n" +
      "**Questions:**\n" +
      "1. Wach nta mghribi ?\n" +
      "2. Mnin dkhlti l server ?\n" +
      "3. 3lach dkhlti l server ?\n" +
      "4. Ch7al f3mrk ?\n" +
      "5. Chno lhaja libghiti tl9aha f server ?\n\n" +
      "*Answer honestly — a staff member will review your answers.*"
    )
    .setFooter({ text: "Night Stars • Verification System" })
    .setTimestamp();
}

function buildStartButton() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("verification_start")
      .setLabel("🚀 Start Verification")
      .setStyle(ButtonStyle.Primary)
  );
}

function buildVerificationModal() {
  const modal = new ModalBuilder()
    .setCustomId("verification_modal")
    .setTitle("Night Stars — Verification");

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("q1")
        .setLabel("Wach nta mghribi ?")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("q2")
        .setLabel("Mnin dkhlti l server ?")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(200)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("q3")
        .setLabel("3lach dkhlti l server ?")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(300)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("q4")
        .setLabel("Ch7al f3mrk ?")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(50)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("q5")
        .setLabel("Chno lhaja libghiti tl9aha f server ?")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(300)
    )
  );

  return modal;
}

function buildVerificationLogEmbed(
  memberId: string,
  memberTag: string,
  createdAt: number,
  answers: string[]
) {
  return new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle("New Verification Request")
    .addFields(
      { name: "Member", value: `<@${memberId}> (${memberTag})`, inline: true },
      { name: "ID", value: memberId, inline: true },
      {
        name: "Account Created",
        value: `<t:${Math.floor(createdAt / 1000)}:R>`,
        inline: true,
      },
      { name: "\u200B", value: "**Answers**" },
      { name: "1. Wach nta mghribi ?", value: answers[0] || "_No answer_" },
      { name: "2. Mnin dkhlti l server ?", value: answers[1] || "_No answer_" },
      { name: "3. 3lach dkhlti l server ?", value: answers[2] || "_No answer_" },
      { name: "4. Ch7al f3mrk ?", value: answers[3] || "_No answer_" },
      { name: "5. Chno lhaja libghiti tl9aha f server ?", value: answers[4] || "_No answer_" }
    )
    .setFooter({ text: "Verificators: choose an action" })
    .setTimestamp();
}

function buildActionButtons(disabled = false) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("verify_accept")
      .setLabel("✅ Accept")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId("verify_deny")
      .setLabel("❌ Deny")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId("verify_jail")
      .setLabel("⛓ Jail")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId("verify_ticket")
      .setLabel("🎫 Open Ticket")
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
      await interaction.showModal(buildVerificationModal());
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
  const member = interaction.member;
  const user = interaction.user;

  const answers = [
    interaction.fields.getTextInputValue("q1"),
    interaction.fields.getTextInputValue("q2"),
    interaction.fields.getTextInputValue("q3"),
    interaction.fields.getTextInputValue("q4"),
    interaction.fields.getTextInputValue("q5"),
  ];

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

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle("✅ Answers Submitted!")
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

  const logEmbed = buildVerificationLogEmbed(
    user.id,
    user.tag,
    user.createdTimestamp,
    answers
  );

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

  if (
    config.verificatorsRoleId &&
    !guildMember.roles.cache.has(config.verificatorsRoleId)
  ) {
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

  if (customId === "verify_accept") {
    await interaction.message.edit({
      embeds: [
        EmbedBuilder.from(embed)
          .setColor(0x2ecc71)
          .setFooter({ text: `✅ Accepted by ${interaction.user.tag}` }),
      ],
      components: [disabledRow],
    });
  } else if (customId === "verify_deny") {
    await targetMember
      ?.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle("Verification Denied")
            .setDescription(
              "Your verification for Night Stars was denied. You may try again."
            ),
        ],
      })
      .catch(() => {});

    await interaction.message.edit({
      embeds: [
        EmbedBuilder.from(embed)
          .setColor(0xe74c3c)
          .setFooter({ text: `❌ Denied by ${interaction.user.tag}` }),
      ],
      components: [disabledRow],
    });
  } else if (customId === "verify_jail") {
    await interaction.message.edit({
      embeds: [
        EmbedBuilder.from(embed)
          .setColor(0x95a5a6)
          .setFooter({ text: `⛓ Jailed by ${interaction.user.tag}` }),
      ],
      components: [disabledRow],
    });
  } else if (customId === "verify_ticket") {
    if (!config.assistanceCategoryId) {
      await interaction.followUp({
        content: "Assistance category is not configured.",
        ephemeral: true,
      });
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

    await ticketChannel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x3498db)
          .setTitle("Assistance Ticket")
          .setDescription(`Ticket for <@${memberId}> — opened by <@${interaction.user.id}>`)
          .addFields({
            name: "Verification Answers",
            value: answers.length
              ? answers.map((a, i) => `**Q${i + 1}:** ${a || "_No answer_"}`).join("\n")
              : "_Not available_",
          })
          .setFooter({ text: "Ticket from verification" })
          .setTimestamp(),
      ],
    });

    await interaction.message.edit({
      embeds: [
        EmbedBuilder.from(embed).setFooter({
          text: `🎫 Ticket opened by ${interaction.user.tag} → #${ticketChannel.name}`,
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
