import {
  ButtonInteraction,
  StringSelectMenuInteraction,
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

function val(v?: string) {
  return v ? `<#${v}> / <@&${v}>` : "_Not selected_";
}

function buildVerifyPanelEmbed(state: VerifyPanelState) {
  return new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle("🛡️ Verification System — Setup")
    .setDescription(
      "Use the menus below to configure the Verification system.\nWhen all required fields are set, click **Save**."
    )
    .addFields(
      {
        name: "✅ Verificators Role (required)",
        value: state.verificatorsRoleId ? `<@&${state.verificatorsRoleId}>` : "_Not selected_",
        inline: true,
      },
      {
        name: "📋 Logs Channel (required)",
        value: state.logsChannelId ? `<#${state.logsChannelId}>` : "_Not selected_",
        inline: true,
      },
      {
        name: "🗂️ Verification Category (optional)",
        value: state.verifyCategoryId ? `<#${state.verifyCategoryId}>` : "_Not selected_",
        inline: true,
      },
      {
        name: "🎫 Assistance Category (optional)",
        value: state.assistCategoryId ? `<#${state.assistCategoryId}>` : "_Not selected_",
        inline: true,
      }
    )
    .setFooter({ text: "Required fields must be set before saving." });
}

function buildVerifyPanelComponents(state: VerifyPanelState) {
  const canSave = !!(state.verificatorsRoleId && state.logsChannelId);

  const row1 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("vp_verificators_role")
      .setPlaceholder(state.verificatorsRoleId ? "✅ Verificators Role selected" : "Select Verificators Role")
      .setMinValues(1)
      .setMaxValues(1)
  );

  const row2 = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("vp_logs_channel")
      .setPlaceholder(state.logsChannelId ? "✅ Logs Channel selected" : "Select Logs Channel")
      .addChannelTypes(ChannelType.GuildText)
      .setMinValues(1)
      .setMaxValues(1)
  );

  const row3 = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("vp_verify_category")
      .setPlaceholder(state.verifyCategoryId ? "✅ Verification Category selected" : "Select Verification Category (optional)")
      .addChannelTypes(ChannelType.GuildCategory)
      .setMinValues(0)
      .setMaxValues(1)
  );

  const row4 = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("vp_assist_category")
      .setPlaceholder(state.assistCategoryId ? "✅ Assistance Category selected" : "Select Assistance Category (optional)")
      .addChannelTypes(ChannelType.GuildCategory)
      .setMinValues(0)
      .setMaxValues(1)
  );

  const row5 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("vp_save")
      .setLabel(canSave ? "💾 Save Configuration" : "💾 Save (fill required fields first)")
      .setStyle(canSave ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(!canSave),
    new ButtonBuilder()
      .setCustomId("vp_reset")
      .setLabel("🔄 Reset")
      .setStyle(ButtonStyle.Danger)
  );

  return [row1, row2, row3, row4, row5];
}

export async function openVerifyPanel(interaction: ButtonInteraction) {
  const userId = interaction.user.id;
  verifyPanelState.set(userId, {});

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
    const ri = interaction as RoleSelectMenuInteraction;
    state.verificatorsRoleId = ri.values[0];
  } else if (interaction.customId === "vp_logs_channel") {
    const ci = interaction as ChannelSelectMenuInteraction;
    state.logsChannelId = ci.values[0];
  } else if (interaction.customId === "vp_verify_category") {
    const ci = interaction as ChannelSelectMenuInteraction;
    state.verifyCategoryId = ci.values[0] ?? undefined;
  } else if (interaction.customId === "vp_assist_category") {
    const ci = interaction as ChannelSelectMenuInteraction;
    state.assistCategoryId = ci.values[0] ?? undefined;
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
    await interaction.reply({ content: "Please fill all required fields first.", ephemeral: true });
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
        .setTitle("✅ Verification System Saved!")
        .addFields(
          { name: "Verificators Role", value: `<@&${state.verificatorsRoleId}>`, inline: true },
          { name: "Logs Channel", value: `<#${state.logsChannelId}>`, inline: true },
          { name: "Verification Category", value: state.verifyCategoryId ? `<#${state.verifyCategoryId}>` : "None", inline: true },
          { name: "Assistance Category", value: state.assistCategoryId ? `<#${state.assistCategoryId}>` : "None", inline: true }
        )
        .setFooter({ text: "Configuration saved successfully." }),
    ],
    components: [],
  });
}

export async function handleVerifyPanelReset(interaction: ButtonInteraction) {
  const userId = interaction.user.id;
  const state: VerifyPanelState = {};
  verifyPanelState.set(userId, state);

  await interaction.update({
    embeds: [buildVerifyPanelEmbed(state)],
    components: buildVerifyPanelComponents(state),
  });
}
