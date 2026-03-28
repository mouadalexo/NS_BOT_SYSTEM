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
import { ctpCategoriesTable, ctpCooldownsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

interface CtpPanelState {
  categoryId?: string;
  gameRoleId?: string;
  gameName?: string;
  cooldown?: string;
  pingMessage?: string;
  outputChannelId?: string;
}

export const ctpPanelState = new Map<string, CtpPanelState>();

function buildCtpPanelEmbed(state: CtpPanelState, guildId: string) {
  return new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle("🎮 Call to Play — Setup")
    .setDescription(
      "Configure a Call to Play mapping for a game category.\n\n" +
      "**How it works:**\n" +
      "• Member in a voice under the category types `-we need 1 player`\n" +
      "• Bot pings the Game Role with the message\n" +
      "• Cooldown prevents spam"
    )
    .addFields(
      {
        name: "🗂️ Game Category (required)",
        value: state.categoryId ? `<#${state.categoryId}>` : "_Not selected_",
        inline: true,
      },
      {
        name: "🏷️ Game Role (required)",
        value: state.gameRoleId ? `<@&${state.gameRoleId}>` : "_Not selected_",
        inline: true,
      },
      {
        name: "🎯 Game Name",
        value: state.gameName ?? "_Not set_",
        inline: true,
      },
      {
        name: "⏱️ Cooldown",
        value: state.cooldown ? `${state.cooldown}s` : "_60s (default)_",
        inline: true,
      },
      {
        name: "💬 Custom Ping Message",
        value: state.pingMessage ?? "_Uses member's message_",
        inline: true,
      },
      {
        name: "📢 Output Channel",
        value: state.outputChannelId ? `<#${state.outputChannelId}>` : "_Same channel as command_",
        inline: true,
      }
    )
    .setFooter({ text: "Category + Game Role + Game Name are required to save." });
}

function buildCtpPanelComponents(state: CtpPanelState) {
  const canSave = !!(state.categoryId && state.gameRoleId && state.gameName);

  const row1 = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("cp_category")
      .setPlaceholder(state.categoryId ? "✅ Category selected" : "Select Game Category")
      .addChannelTypes(ChannelType.GuildCategory)
      .setMinValues(1)
      .setMaxValues(1)
  );

  const row2 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("cp_game_role")
      .setPlaceholder(state.gameRoleId ? "✅ Game Role selected" : "Select Game Role to ping")
      .setMinValues(1)
      .setMaxValues(1)
  );

  const row3 = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("cp_output_channel")
      .setPlaceholder(state.outputChannelId ? "✅ Output Channel selected" : "Select Output Channel (optional)")
      .addChannelTypes(ChannelType.GuildText)
      .setMinValues(0)
      .setMaxValues(1)
  );

  const row4 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("cp_open_details")
      .setLabel(state.gameName ? `📝 Edit Details (${state.gameName})` : "📝 Set Game Details")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("cp_save")
      .setLabel(canSave ? "💾 Save" : "💾 Save (fill required fields first)")
      .setStyle(canSave ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(!canSave),
    new ButtonBuilder()
      .setCustomId("cp_reset")
      .setLabel("🔄 Reset")
      .setStyle(ButtonStyle.Danger)
  );

  return [row1, row2, row3, row4];
}

export async function openCtpPanel(interaction: ButtonInteraction) {
  const userId = interaction.user.id;
  ctpPanelState.set(userId, {});

  const state: CtpPanelState = {};
  ctpPanelState.set(userId, state);

  await interaction.reply({
    embeds: [buildCtpPanelEmbed(state, interaction.guild!.id)],
    components: buildCtpPanelComponents(state),
    ephemeral: true,
  });
}

export async function handleCtpPanelSelect(
  interaction: RoleSelectMenuInteraction | ChannelSelectMenuInteraction
) {
  const userId = interaction.user.id;
  const state = ctpPanelState.get(userId) ?? {};

  if (interaction.customId === "cp_category") {
    const ci = interaction as ChannelSelectMenuInteraction;
    state.categoryId = ci.values[0];
  } else if (interaction.customId === "cp_game_role") {
    const ri = interaction as RoleSelectMenuInteraction;
    state.gameRoleId = ri.values[0];
  } else if (interaction.customId === "cp_output_channel") {
    const ci = interaction as ChannelSelectMenuInteraction;
    state.outputChannelId = ci.values[0] ?? undefined;
  }

  ctpPanelState.set(userId, state);

  await interaction.update({
    embeds: [buildCtpPanelEmbed(state, interaction.guild!.id)],
    components: buildCtpPanelComponents(state),
  });
}

export async function openCtpDetailsModal(interaction: ButtonInteraction) {
  const userId = interaction.user.id;
  const state = ctpPanelState.get(userId) ?? {};

  const modal = new ModalBuilder()
    .setCustomId("cp_details_modal")
    .setTitle("Game Details");

  const gameNameInput = new TextInputBuilder()
    .setCustomId("cp_game_name")
    .setLabel("Game Name (e.g. Valorant, CSGO, eFootball)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(50)
    .setValue(state.gameName ?? "");

  const cooldownInput = new TextInputBuilder()
    .setCustomId("cp_cooldown")
    .setLabel("Cooldown in seconds (default: 60)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(6)
    .setValue(state.cooldown ?? "60");

  const pingMsgInput = new TextInputBuilder()
    .setCustomId("cp_ping_msg")
    .setLabel("Custom Ping Message (leave empty = member's text)")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(200)
    .setValue(state.pingMessage ?? "");

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(gameNameInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(cooldownInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(pingMsgInput)
  );

  await interaction.showModal(modal);
}

export async function handleCtpDetailsModalSubmit(interaction: ModalSubmitInteraction) {
  const userId = interaction.user.id;
  const state = ctpPanelState.get(userId) ?? {};

  state.gameName = interaction.fields.getTextInputValue("cp_game_name").trim();
  const cooldownRaw = interaction.fields.getTextInputValue("cp_cooldown").trim();
  state.cooldown = cooldownRaw || "60";
  const pingMsg = interaction.fields.getTextInputValue("cp_ping_msg").trim();
  state.pingMessage = pingMsg || undefined;

  ctpPanelState.set(userId, state);

  await interaction.update({
    embeds: [buildCtpPanelEmbed(state, interaction.guild!.id)],
    components: buildCtpPanelComponents(state),
  });
}

export async function handleCtpPanelSave(interaction: ButtonInteraction) {
  const userId = interaction.user.id;
  const state = ctpPanelState.get(userId) ?? {};

  if (!state.categoryId || !state.gameRoleId || !state.gameName) {
    await interaction.reply({ content: "Please fill all required fields first.", ephemeral: true });
    return;
  }

  const guildId = interaction.guild!.id;
  const cooldown = parseInt(state.cooldown ?? "60", 10);

  const existing = await db
    .select()
    .from(ctpCategoriesTable)
    .where(and(eq(ctpCategoriesTable.guildId, guildId), eq(ctpCategoriesTable.categoryId, state.categoryId)))
    .limit(1);

  if (existing.length) {
    await db.update(ctpCategoriesTable).set({
      gameName: state.gameName,
      gameRoleId: state.gameRoleId,
      cooldownSeconds: cooldown,
      pingMessage: state.pingMessage ?? null,
      outputChannelId: state.outputChannelId ?? null,
      enabled: 1,
    }).where(and(eq(ctpCategoriesTable.guildId, guildId), eq(ctpCategoriesTable.categoryId, state.categoryId)));
  } else {
    await db.insert(ctpCategoriesTable).values({
      guildId,
      categoryId: state.categoryId,
      gameName: state.gameName,
      gameRoleId: state.gameRoleId,
      cooldownSeconds: cooldown,
      pingMessage: state.pingMessage ?? null,
      outputChannelId: state.outputChannelId ?? null,
    });
  }

  await db.delete(ctpCooldownsTable).where(
    and(eq(ctpCooldownsTable.guildId, guildId), eq(ctpCooldownsTable.categoryId, state.categoryId))
  );

  ctpPanelState.delete(userId);

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle("✅ Call to Play Saved!")
        .addFields(
          { name: "Category", value: `<#${state.categoryId}>`, inline: true },
          { name: "Game", value: state.gameName, inline: true },
          { name: "Game Role", value: `<@&${state.gameRoleId}>`, inline: true },
          { name: "Cooldown", value: `${cooldown}s`, inline: true },
          { name: "Custom Ping", value: state.pingMessage ?? "Uses member's message", inline: true },
          { name: "Output Channel", value: state.outputChannelId ? `<#${state.outputChannelId}>` : "Same channel", inline: true }
        )
        .setFooter({ text: "Configuration saved successfully." }),
    ],
    components: [],
  });
}

export async function handleCtpPanelReset(interaction: ButtonInteraction) {
  const userId = interaction.user.id;
  const state: CtpPanelState = {};
  ctpPanelState.set(userId, state);

  await interaction.update({
    embeds: [buildCtpPanelEmbed(state, interaction.guild!.id)],
    components: buildCtpPanelComponents(state),
  });
}
