import {
  ButtonInteraction,
  RoleSelectMenuInteraction,
  ChannelSelectMenuInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
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
}

export const verifyPanelState = new Map<string, VerifyPanelState>();

function status(value?: string, label?: string) {
  if (value) return `✅ ${label ?? "Selected"}`;
  return `⬜ Not set`;
}

function buildVerifyPanelEmbed(state: VerifyPanelState) {
  const allRequired = !!(state.verificatorsRoleId && state.logsChannelId);

  return new EmbedBuilder()
    .setColor(allRequired ? 0x2ecc71 : 0x5865f2)
    .setTitle("🛡️ NSV — Night Stars Verification Setup")
    .setDescription(
      "Configure who reviews new members and where the logs appear.\n" +
      "Once saved, use **Post Verification Panel** from the main panel to deploy the join button."
    )
    .addFields(
      {
        name: "Verificators Role `required`",
        value: state.verificatorsRoleId
          ? `<@&${state.verificatorsRoleId}>`
          : "The role that can accept, deny or jail members.",
        inline: true,
      },
      {
        name: "Logs Channel `required`",
        value: state.logsChannelId
          ? `<#${state.logsChannelId}>`
          : "Where verification requests will be sent.",
        inline: true,
      },
      { name: "\u200B", value: "\u200B", inline: false },
      {
        name: "Verification Category `optional`",
        value: state.verifyCategoryId
          ? `<#${state.verifyCategoryId}>`
          : "Category for verification channels (if used).",
        inline: true,
      },
      {
        name: "Assistance Category `optional`",
        value: state.assistCategoryId
          ? `<#${state.assistCategoryId}>`
          : "Category where ticket channels are created.",
        inline: true,
      }
    )
    .setFooter({
      text: allRequired
        ? "Ready to save — click Save Configuration."
        : "Fill in the required fields to enable saving.",
    });
}

function buildVerifyPanelComponents(state: VerifyPanelState) {
  const canSave = !!(state.verificatorsRoleId && state.logsChannelId);

  const row1 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("vp_verificators_role")
      .setPlaceholder(
        state.verificatorsRoleId ? "✅ Verificators Role — click to change" : "Select Verificators Role..."
      )
      .setMinValues(1)
      .setMaxValues(1)
  );

  const row2 = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("vp_logs_channel")
      .setPlaceholder(
        state.logsChannelId ? "✅ Logs Channel — click to change" : "Select Logs Channel..."
      )
      .addChannelTypes(ChannelType.GuildText)
      .setMinValues(1)
      .setMaxValues(1)
  );

  const row3 = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("vp_verify_category")
      .setPlaceholder(
        state.verifyCategoryId ? "✅ Verification Category — click to change" : "Verification Category (optional)..."
      )
      .addChannelTypes(ChannelType.GuildCategory)
      .setMinValues(0)
      .setMaxValues(1)
  );

  const row4 = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("vp_assist_category")
      .setPlaceholder(
        state.assistCategoryId ? "✅ Assistance Category — click to change" : "Assistance Category (optional)..."
      )
      .addChannelTypes(ChannelType.GuildCategory)
      .setMinValues(0)
      .setMaxValues(1)
  );

  const row5 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("vp_save")
      .setLabel(canSave ? "Save Configuration" : "Save (fill required fields first)")
      .setEmoji(canSave ? "💾" : "🔒")
      .setStyle(canSave ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(!canSave),
    new ButtonBuilder()
      .setCustomId("vp_reset")
      .setLabel("Reset")
      .setEmoji("🔄")
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
  };
  verifyPanelState.set(userId, state);

  await interaction.reply({
    embeds: [buildVerifyPanelEmbed(state)],
    components: buildVerifyPanelComponents(state),
    ephemeral: true,
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
  } else if (interaction.customId === "vp_assist_category") {
    state.assistCategoryId = (interaction as ChannelSelectMenuInteraction).values[0] ?? undefined;
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
      embeds: [
        new EmbedBuilder()
          .setColor(0xe74c3c)
          .setDescription("❌ Please fill in all required fields before saving."),
      ],
      ephemeral: true,
    });
    return;
  }

  const guildId = interaction.guild!.id;
  const existing = await db
    .select()
    .from(botConfigTable)
    .where(eq(botConfigTable.guildId, guildId))
    .limit(1);

  if (existing.length) {
    await db.update(botConfigTable).set({
      verificatorsRoleId: state.verificatorsRoleId,
      verificationLogsChannelId: state.logsChannelId,
      verificationCategoryId: state.verifyCategoryId ?? null,
      assistanceCategoryId: state.assistCategoryId ?? null,
      updatedAt: new Date(),
    }).where(eq(botConfigTable.guildId, guildId));
  } else {
    await db.insert(botConfigTable).values({
      guildId,
      verificatorsRoleId: state.verificatorsRoleId,
      verificationLogsChannelId: state.logsChannelId,
      verificationCategoryId: state.verifyCategoryId ?? null,
      assistanceCategoryId: state.assistCategoryId ?? null,
    });
  }

  verifyPanelState.delete(userId);

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle("✅ Verification Saved")
        .addFields(
          { name: "Verificators Role", value: `<@&${state.verificatorsRoleId}>`, inline: true },
          { name: "Logs Channel", value: `<#${state.logsChannelId}>`, inline: true },
          {
            name: "Verification Category",
            value: state.verifyCategoryId ? `<#${state.verifyCategoryId}>` : "Not set",
            inline: true,
          },
          {
            name: "Assistance Category",
            value: state.assistCategoryId ? `<#${state.assistCategoryId}>` : "Not set",
            inline: true,
          }
        )
        .setDescription(
          "Configuration saved. Use **Post Verification Panel** from the main panel to deploy the join button in a channel."
        )
        .setFooter({ text: "Night Stars • Verification System" }),
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
