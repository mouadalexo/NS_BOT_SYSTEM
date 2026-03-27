import {
  ButtonInteraction,
  RoleSelectMenuInteraction,
  ChannelSelectMenuInteraction,
  ModalSubmitInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
} from "discord.js";
import { db } from "@workspace/db";
import { botConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";

interface VerifyPanelState {
  verificatorsRoleId?: string;
  logsChannelId?: string;
  verifyCategoryId?: string;
  assistCategoryId?: string;
  verifiedRoleId?: string;
  unverifiedRoleId?: string;
  jailRoleId?: string;
  embedTitle?: string;
  embedDescription?: string;
}

export const verifyPanelState = new Map<string, VerifyPanelState>();

const DEFAULT_QUESTIONS = [
  "Wach nta mghribi ?",
  "Mnin dkhlti l server ?",
  "3lach dkhlti l server ?",
  "Ch7al f3mrk ?",
  "Chno lhaja libghiti tl9aha f server ?",
];

function buildVerifyPanelEmbed(state: VerifyPanelState) {
  const lines = [
    `**Verificators Role** — ${state.verificatorsRoleId ? `<@&${state.verificatorsRoleId}>` : "not set"}`,
    `**Logs Channel** — ${state.logsChannelId ? `<#${state.logsChannelId}>` : "not set"}`,
    `**Verified Role** — ${state.verifiedRoleId ? `<@&${state.verifiedRoleId}>` : "not set"}`,
    `**Unverified Role** — ${state.unverifiedRoleId ? `<@&${state.unverifiedRoleId}>` : "not set"}`,
    `**Jail Role** — ${state.jailRoleId ? `<@&${state.jailRoleId}>` : "not set"}`,
    `**Verify Category** — ${state.verifyCategoryId ? `<#${state.verifyCategoryId}>` : "not set"}`,
  ];

  return new EmbedBuilder()
    .setColor(0xff0000)
    .setTitle("Night Stars Verification")
    .setDescription(lines.join("\n"))
    .setFooter({ text: "Night Stars • NSV" });
}

function buildVerifyPanelComponents(state: VerifyPanelState) {
  const canSave = !!(state.verificatorsRoleId && state.logsChannelId);

  const row1 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("vp_verificators_role")
      .setPlaceholder(state.verificatorsRoleId ? "Verificators Role (set)" : "Verificators Role...")
      .setMinValues(1).setMaxValues(1)
  );

  const row2 = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("vp_logs_channel")
      .setPlaceholder(state.logsChannelId ? "Logs Channel (set)" : "Logs Channel...")
      .addChannelTypes(ChannelType.GuildText)
      .setMinValues(1).setMaxValues(1)
  );

  const row3 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("vp_roles_group")
      .setPlaceholder(
        [state.verifiedRoleId && "Verified", state.unverifiedRoleId && "Unverified", state.jailRoleId && "Jail"]
          .filter(Boolean).join(", ") + (state.verifiedRoleId || state.unverifiedRoleId || state.jailRoleId ? " (set)" : "")
        || "Verified / Unverified / Jail Roles..."
      )
      .setMinValues(1).setMaxValues(3)
  );

  const row4 = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("vp_verify_category")
      .setPlaceholder(state.verifyCategoryId ? "Verify Category (set)" : "Verify Category (optional)...")
      .addChannelTypes(ChannelType.GuildCategory)
      .setMinValues(0).setMaxValues(1)
  );

  const row5 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("vp_save")
      .setLabel("Save")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!canSave),
    new ButtonBuilder()
      .setCustomId("vp_edit_questions")
      .setLabel("Questions")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("vp_edit_embed")
      .setLabel(state.embedTitle ? "Embed (set)" : "Embed")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("panel_deploy_verify")
      .setLabel("Post Panel")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("vp_reset")
      .setLabel("Reset")
      .setStyle(ButtonStyle.Danger)
  );

  return [row1, row2, row3, row4, row5];
}

export async function openVerifyPanel(interaction: ButtonInteraction) {
  const userId = interaction.user.id;

  const config = await db
    .select()
    .from(botConfigTable)
    .where(eq(botConfigTable.guildId, interaction.guild!.id))
    .limit(1);

  const existing = config[0];
  const state: VerifyPanelState = {
    verificatorsRoleId: existing?.verificatorsRoleId ?? undefined,
    logsChannelId: existing?.verificationLogsChannelId ?? undefined,
    verifyCategoryId: existing?.verificationCategoryId ?? undefined,
    assistCategoryId: existing?.assistanceCategoryId ?? undefined,
    verifiedRoleId: existing?.verifiedRoleId ?? undefined,
    unverifiedRoleId: existing?.unverifiedRoleId ?? undefined,
    jailRoleId: existing?.jailRoleId ?? undefined,
    embedTitle: existing?.panelEmbedTitle ?? undefined,
    embedDescription: existing?.panelEmbedDescription ?? undefined,
  };
  verifyPanelState.set(userId, state);

  await interaction.reply({
    embeds: [buildVerifyPanelEmbed(state)],
    components: buildVerifyPanelComponents(state),
    ephemeral: true,
  });
}

export async function openEditQuestionsModal(interaction: ButtonInteraction) {
  const guildId = interaction.guild!.id;
  const config = await db.select().from(botConfigTable).where(eq(botConfigTable.guildId, guildId)).limit(1);
  let questions = DEFAULT_QUESTIONS;
  try {
    if (config[0]?.verificationQuestions) {
      questions = JSON.parse(config[0].verificationQuestions);
    }
  } catch {}

  const modal = new ModalBuilder()
    .setCustomId("vp_questions_modal")
    .setTitle("Edit Verification Questions");

  for (let i = 0; i < 5; i++) {
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(`vq${i + 1}`)
          .setLabel(`Question ${i + 1}`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100)
          .setValue(questions[i] ?? "")
      )
    );
  }

  await interaction.showModal(modal);
}

export async function handleEditQuestionsSubmit(interaction: ModalSubmitInteraction) {
  const guildId = interaction.guild!.id;

  const questions = [
    interaction.fields.getTextInputValue("vq1").trim(),
    interaction.fields.getTextInputValue("vq2").trim(),
    interaction.fields.getTextInputValue("vq3").trim(),
    interaction.fields.getTextInputValue("vq4").trim(),
    interaction.fields.getTextInputValue("vq5").trim(),
  ];

  const existing = await db.select().from(botConfigTable).where(eq(botConfigTable.guildId, guildId)).limit(1);

  if (existing.length) {
    await db.update(botConfigTable).set({
      verificationQuestions: JSON.stringify(questions),
      updatedAt: new Date(),
    }).where(eq(botConfigTable.guildId, guildId));
  } else {
    await db.insert(botConfigTable).values({
      guildId,
      verificationQuestions: JSON.stringify(questions),
    });
  }

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle("Questions Updated")
        .setDescription(questions.map((q, i) => `**Q${i + 1}** — ${q}`).join("\n"))
        .setFooter({ text: "Night Stars • NSV" }),
    ],
    ephemeral: true,
  });
}

export async function openEmbedCustomizeModal(interaction: ButtonInteraction) {
  const state = verifyPanelState.get(interaction.user.id) ?? {};

  const modal = new ModalBuilder()
    .setCustomId("vp_embed_modal")
    .setTitle("Customize Verification Panel Embed");

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("vp_embed_title")
        .setLabel("Title (no emojis — text only)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100)
        .setValue(state.embedTitle ?? "Night Stars — Verification")
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("vp_embed_desc")
        .setLabel("Description (use <:name:id> for emojis)")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(2000)
        .setPlaceholder("<:name:id> static | <a:name:id> animated\nType \\:emoji_name: in chat to get the full ID")
        .setValue(
          state.embedDescription ??
          "Welcome to **Night Stars**!\n\nClick the button below and answer the questions.\nA staff member will review your answers and verify you shortly."
        )
    )
  );

  await interaction.showModal(modal);
}

export async function handleEmbedCustomizeSubmit(interaction: ModalSubmitInteraction) {
  await interaction.deferUpdate();

  const userId = interaction.user.id;
  const state = verifyPanelState.get(userId) ?? {};

  state.embedTitle = interaction.fields.getTextInputValue("vp_embed_title").trim();
  state.embedDescription = interaction.fields.getTextInputValue("vp_embed_desc").trim();

  verifyPanelState.set(userId, state);

  console.log(`[NSV Embed] Saving — title: "${state.embedTitle}", desc: "${state.embedDescription?.slice(0, 80)}"`);

  const guildId = interaction.guild!.id;
  const existing = await db.select().from(botConfigTable).where(eq(botConfigTable.guildId, guildId)).limit(1);

  if (existing.length) {
    await db.update(botConfigTable).set({
      panelEmbedTitle: state.embedTitle,
      panelEmbedDescription: state.embedDescription,
      updatedAt: new Date(),
    }).where(eq(botConfigTable.guildId, guildId));
  } else {
    await db.insert(botConfigTable).values({
      guildId,
      panelEmbedTitle: state.embedTitle,
      panelEmbedDescription: state.embedDescription,
    });
  }

  const previewEmbed = new EmbedBuilder()
    .setColor(0xff0000)
    .setTitle(state.embedTitle || "Night Stars — Verification")
    .setDescription(state.embedDescription ||
      "Welcome to **Night Stars**!\n\nClick the button below and answer the questions.\nA staff member will review your answers and verify you shortly."
    )
    .setFooter({ text: "Night Stars • Verification System" });

  const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("vp_embed_back")
      .setLabel("Back to Setup")
      .setStyle(ButtonStyle.Secondary)
  );

  await interaction.editReply({
    embeds: [previewEmbed],
    components: [backRow],
  });
}

export async function handleEmbedPreviewBack(interaction: ButtonInteraction) {
  const state = verifyPanelState.get(interaction.user.id) ?? {};
  await interaction.update({
    embeds: [buildVerifyPanelEmbed(state)],
    components: buildVerifyPanelComponents(state),
  });
}

export async function handleVerifyPanelSelect(
  interaction: RoleSelectMenuInteraction | ChannelSelectMenuInteraction
) {
  const userId = interaction.user.id;
  const state = verifyPanelState.get(userId) ?? {};

  if (interaction.customId === "vp_verificators_role") {
    state.verificatorsRoleId = (interaction as RoleSelectMenuInteraction).values[0];
  } else if (interaction.customId === "vp_logs_channel") {
    state.logsChannelId = (interaction as ChannelSelectMenuInteraction).values[0];
  } else if (interaction.customId === "vp_verify_category") {
    state.verifyCategoryId = (interaction as ChannelSelectMenuInteraction).values[0] ?? undefined;
    state.assistCategoryId = (interaction as ChannelSelectMenuInteraction).values[0] ?? undefined;
  } else if (interaction.customId === "vp_roles_group") {
    const values = (interaction as RoleSelectMenuInteraction).values;
    if (values.length >= 1) state.verifiedRoleId = values[0];
    if (values.length >= 2) state.unverifiedRoleId = values[1];
    if (values.length >= 3) state.jailRoleId = values[2];
  }

  verifyPanelState.set(userId, state);

  await interaction.update({
    embeds: [buildVerifyPanelEmbed(state)],
    components: buildVerifyPanelComponents(state),
  });
}

export async function handleVerifyPanelSave(interaction: ButtonInteraction) {
  const userId = interaction.user.id;
  const state = verifyPanelState.get(userId) ?? {};

  if (!state.verificatorsRoleId || !state.logsChannelId) {
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(0xff0000).setDescription("Verificators Role and Logs Channel are required.")],
      ephemeral: true,
    });
    return;
  }

  const guildId = interaction.guild!.id;
  const existing = await db.select().from(botConfigTable).where(eq(botConfigTable.guildId, guildId)).limit(1);

  if (existing.length) {
    await db.update(botConfigTable).set({
      verificatorsRoleId: state.verificatorsRoleId,
      verificationLogsChannelId: state.logsChannelId,
      verificationCategoryId: state.verifyCategoryId ?? null,
      assistanceCategoryId: state.assistCategoryId ?? null,
      verifiedRoleId: state.verifiedRoleId ?? null,
      unverifiedRoleId: state.unverifiedRoleId ?? null,
      jailRoleId: state.jailRoleId ?? null,
      updatedAt: new Date(),
    }).where(eq(botConfigTable.guildId, guildId));
  } else {
    await db.insert(botConfigTable).values({
      guildId,
      verificatorsRoleId: state.verificatorsRoleId,
      verificationLogsChannelId: state.logsChannelId,
      verificationCategoryId: state.verifyCategoryId ?? null,
      assistanceCategoryId: state.assistCategoryId ?? null,
      verifiedRoleId: state.verifiedRoleId ?? null,
      unverifiedRoleId: state.unverifiedRoleId ?? null,
      jailRoleId: state.jailRoleId ?? null,
    });
  }

  verifyPanelState.delete(userId);

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle("NSV Saved")
        .setDescription(
          [
            `**Verificators Role** — <@&${state.verificatorsRoleId}>`,
            `**Logs Channel** — <#${state.logsChannelId}>`,
            `**Verified Role** — ${state.verifiedRoleId ? `<@&${state.verifiedRoleId}>` : "not set"}`,
            `**Unverified Role** — ${state.unverifiedRoleId ? `<@&${state.unverifiedRoleId}>` : "not set"}`,
            `**Jail Role** — ${state.jailRoleId ? `<@&${state.jailRoleId}>` : "not set"}`,
          ].join("\n")
        )
        .setFooter({ text: "Night Stars • NSV" }),
    ],
    components: [],
  });
}

export async function handleVerifyPanelReset(interaction: ButtonInteraction) {
  const state: VerifyPanelState = {};
  verifyPanelState.set(interaction.user.id, state);
  await interaction.update({
    embeds: [buildVerifyPanelEmbed(state)],
    components: buildVerifyPanelComponents(state),
  });
}
