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

function buildCtpPanelEmbed(state: CtpPanelState) {
  const lines = [
    `**Game Name** — ${state.gameName ?? "not set"}`,
    `**Role** — ${state.gameRoleId ? `<@&${state.gameRoleId}>` : "not set"}`,
    `**Category** — ${state.categoryId ? `<#${state.categoryId}>` : "not set"}`,
    `**Cooldown** — ${state.cooldown ? `${state.cooldown}s` : "60s (default)"}`,
    `**Output Channel** — ${state.outputChannelId ? `<#${state.outputChannelId}>` : "same channel as command"}`,
  ];

  return new EmbedBuilder()
    .setColor(0xff0000)
    .setTitle("🎮 Call to Play")
    .setDescription(lines.join("\n"))
    .setFooter({ text: "Night Stars • CTP" });
}

function buildCtpPanelComponents(state: CtpPanelState) {
  const canSave = !!(state.categoryId && state.gameRoleId && state.gameName);

  const row1 = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("cp_category")
      .setPlaceholder(state.categoryId ? "✅ Game Category" : "Game Category...")
      .addChannelTypes(ChannelType.GuildCategory)
      .setMinValues(1)
      .setMaxValues(1)
  );

  const row2 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("cp_game_role")
      .setPlaceholder(state.gameRoleId ? "✅ Role to ping" : "Role to ping...")
      .setMinValues(1)
      .setMaxValues(1)
  );

  const row3 = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("cp_output_channel")
      .setPlaceholder(state.outputChannelId ? "✅ Output Channel" : "Output Channel (optional)...")
      .addChannelTypes(ChannelType.GuildText)
      .setMinValues(0)
      .setMaxValues(1)
  );

  const row4 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("cp_open_details")
      .setLabel(state.gameName ? `Game: ${state.gameName}` : "Set Game Name & Cooldown")
      .setEmoji("📝")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("cp_save")
      .setLabel("Save")
      .setEmoji("💾")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!canSave),
    new ButtonBuilder()
      .setCustomId("cp_reset")
      .setLabel("Reset")
      .setEmoji("🔄")
      .setStyle(ButtonStyle.Danger)
  );

  return [row1, row2, row3, row4];
}

export async function openCtpPanel(interaction: ButtonInteraction) {
  const userId = interaction.user.id;
  const state: CtpPanelState = {};
  ctpPanelState.set(userId, state);

  await interaction.reply({
    embeds: [buildCtpPanelEmbed(state)],
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
    state.categoryId = (interaction as ChannelSelectMenuInteraction).values[0];
  } else if (interaction.customId === "cp_game_role") {
    state.gameRoleId = (interaction as RoleSelectMenuInteraction).values[0];
  } else if (interaction.customId === "cp_output_channel") {
    state.outputChannelId = (interaction as ChannelSelectMenuInteraction).values[0] ?? undefined;
  }

  ctpPanelState.set(userId, state);

  await interaction.update({
    embeds: [buildCtpPanelEmbed(state)],
    components: buildCtpPanelComponents(state),
  });
}

export async function openCtpDetailsModal(interaction: ButtonInteraction) {
  const state = ctpPanelState.get(interaction.user.id) ?? {};

  const modal = new ModalBuilder()
    .setCustomId("cp_details_modal")
    .setTitle("Game Details");

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("cp_game_name")
        .setLabel("Game Name (e.g. Valorant, CSGO, eFootball)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(50)
        .setValue(state.gameName ?? "")
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("cp_cooldown")
        .setLabel("Cooldown in seconds (default: 60)")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(6)
        .setValue(state.cooldown ?? "60")
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("cp_ping_msg")
        .setLabel("Custom Ping Message (optional)")
        .setPlaceholder("Leave empty to use the member's own message")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(200)
        .setValue(state.pingMessage ?? "")
    )
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
    embeds: [buildCtpPanelEmbed(state)],
    components: buildCtpPanelComponents(state),
  });
}

export async function handleCtpPanelSave(interaction: ButtonInteraction) {
  const userId = interaction.user.id;
  const state = ctpPanelState.get(userId) ?? {};

  if (!state.categoryId || !state.gameRoleId || !state.gameName) {
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(0xff0000).setDescription("❌ Game Name, Role, and Category are required.")],
      ephemeral: true,
    });
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
        .setColor(0xff0000)
        .setTitle("✅ CTP Saved")
        .setDescription(
          [
            `**Game** — ${state.gameName}`,
            `**Role** — <@&${state.gameRoleId}>`,
            `**Category** — <#${state.categoryId}>`,
            `**Cooldown** — ${cooldown}s`,
            `**Output Channel** — ${state.outputChannelId ? `<#${state.outputChannelId}>` : "same channel"}`,
          ].join("\n")
        )
        .setFooter({ text: "Night Stars • CTP" }),
    ],
    components: [],
  });
}

export async function handleCtpPanelReset(interaction: ButtonInteraction) {
  const state: CtpPanelState = {};
  ctpPanelState.set(interaction.user.id, state);
  await interaction.update({
    embeds: [buildCtpPanelEmbed(state)],
    components: buildCtpPanelComponents(state),
  });
}
