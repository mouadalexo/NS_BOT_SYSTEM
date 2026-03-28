import {
  ButtonInteraction,
  RoleSelectMenuInteraction,
  ChannelSelectMenuInteraction,
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  StringSelectMenuBuilder,
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
  cooldownSeconds?: number;
  pingMessage?: string;
}

interface CtpManageState {
  selectedCategoryId?: string;
}

export const ctpPanelState = new Map<string, CtpPanelState>();
export const ctpManageState = new Map<string, CtpManageState>();

function parseCooldown(input: string): number {
  const s = input.trim().toLowerCase().replace(/\s+/g, "");
  const mMatch = s.match(/^(\d+)m(\d+)?s?$/);
  if (mMatch) {
    const mins = parseInt(mMatch[1] ?? "0");
    const secs = parseInt(mMatch[2] ?? "0");
    return mins * 60 + secs;
  }
  const sOnlyMatch = s.match(/^(\d+)s$/);
  if (sOnlyMatch) return parseInt(sOnlyMatch[1]);
  const mOnlyMatch = s.match(/^(\d+)m$/);
  if (mOnlyMatch) return parseInt(mOnlyMatch[1]) * 60;
  const plain = parseInt(s);
  if (!isNaN(plain) && plain > 0) return plain * 60;
  return 600;
}

function formatSeconds(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m > 0 && s > 0) return `${m}m ${s}s`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

async function getGuildGames(guildId: string) {
  return db
    .select()
    .from(ctpCategoriesTable)
    .where(eq(ctpCategoriesTable.guildId, guildId));
}

export async function openCtpManagePanel(interaction: ButtonInteraction) {
  const guildId = interaction.guild!.id;
  const games = await getGuildGames(guildId);

  ctpManageState.set(interaction.user.id, {});

  const alreadyAcknowledged = interaction.deferred || interaction.replied;

  if (!games.length) {
    const payload = {
      embeds: [
        new EmbedBuilder()
          .setColor(0x5000ff)
          .setTitle("Call to Play — Game Manager")
          .setDescription("No games configured yet. Add your first game below.")
          .setFooter({ text: "Night Stars • CTP" }),
      ],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("cp_add_new")
            .setLabel("Add Game")
            .setStyle(ButtonStyle.Success)
        ),
      ],
    };
    if (alreadyAcknowledged) {
      await interaction.editReply(payload);
    } else {
      await interaction.reply({ ...payload, ephemeral: true });
    }
    return;
  }

  const payload = {
    embeds: [buildManageEmbed(games)],
    components: buildManageComponents(games),
  };

  if (alreadyAcknowledged) {
    await interaction.editReply(payload);
  } else {
    await interaction.reply({ ...payload, ephemeral: true });
  }
}

function buildManageEmbed(games: Awaited<ReturnType<typeof getGuildGames>>, selected?: typeof games[0]) {
  if (selected) {
    return new EmbedBuilder()
      .setColor(0x5000ff)
      .setTitle(`${selected.gameName}`)
      .setDescription(
        [
          `**Role** — <@&${selected.gameRoleId}>`,
          `**Category** — <#${selected.categoryId}>`,
          `**Cooldown** — ${formatSeconds(selected.cooldownSeconds)}`,
          `**Ping Message** — ${selected.pingMessage ?? "_default_"}`,
        ].join("\n")
      )
      .setFooter({ text: `${games.length} game(s) configured • Night Stars CTP` });
  }

  return new EmbedBuilder()
    .setColor(0x5000ff)
    .setTitle("Call to Play — Game Manager")
    .setDescription(
      games.map((g) => `**${g.gameName}** — <@&${g.gameRoleId}> • Cooldown: ${formatSeconds(g.cooldownSeconds)}`).join("\n")
    )
    .setFooter({ text: `${games.length} game(s) configured • Night Stars CTP` });
}

function buildManageComponents(games: Awaited<ReturnType<typeof getGuildGames>>, selectedCategoryId?: string) {
  const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("cp_game_select")
      .setPlaceholder("Select a game to edit or remove...")
      .addOptions(
        games.map((g) => ({
          label: g.gameName,
          value: g.categoryId,
          description: `Cooldown: ${formatSeconds(g.cooldownSeconds)}`,
          default: g.categoryId === selectedCategoryId,
        }))
      )
  );

  if (selectedCategoryId) {
    const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("cp_edit_game")
        .setLabel("Edit")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("cp_remove_game")
        .setLabel("Remove")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("cp_add_new")
        .setLabel("Add New")
        .setStyle(ButtonStyle.Success),
    );
    return [selectRow, actionRow];
  }

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("cp_add_new")
      .setLabel("Add New")
      .setStyle(ButtonStyle.Success),
  );
  return [selectRow, actionRow];
}

export async function handleCtpGameSelect(interaction: StringSelectMenuInteraction) {
  const userId = interaction.user.id;
  const selectedCategoryId = interaction.values[0];
  const guildId = interaction.guild!.id;

  ctpManageState.set(userId, { selectedCategoryId });

  const games = await getGuildGames(guildId);
  const selected = games.find((g) => g.categoryId === selectedCategoryId);
  if (!selected) return;

  await interaction.update({
    embeds: [buildManageEmbed(games, selected)],
    components: buildManageComponents(games, selectedCategoryId),
  });
}

export async function handleCtpRemoveGame(interaction: ButtonInteraction) {
  const userId = interaction.user.id;
  const manageState = ctpManageState.get(userId);
  const selectedCategoryId = manageState?.selectedCategoryId;
  const guildId = interaction.guild!.id;

  if (!selectedCategoryId) return;

  await db.delete(ctpCooldownsTable).where(
    and(eq(ctpCooldownsTable.guildId, guildId), eq(ctpCooldownsTable.categoryId, selectedCategoryId))
  );
  await db.delete(ctpCategoriesTable).where(
    and(eq(ctpCategoriesTable.guildId, guildId), eq(ctpCategoriesTable.categoryId, selectedCategoryId))
  );

  ctpManageState.set(userId, {});

  const remaining = await getGuildGames(guildId);

  if (!remaining.length) {
    await interaction.update({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5000ff)
          .setTitle("Call to Play — Game Manager")
          .setDescription("Game removed. No games configured yet. Add your first game below.")
          .setFooter({ text: "Night Stars • CTP" }),
      ],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("cp_add_new")
            .setLabel("Add Game")
            .setStyle(ButtonStyle.Success)
        ),
      ],
    });
    return;
  }

  await interaction.update({
    embeds: [buildManageEmbed(remaining)],
    components: buildManageComponents(remaining),
  });
}

export async function handleCtpEditGame(interaction: ButtonInteraction) {
  const userId = interaction.user.id;
  const manageState = ctpManageState.get(userId);
  const selectedCategoryId = manageState?.selectedCategoryId;
  const guildId = interaction.guild!.id;

  if (!selectedCategoryId) return;

  const existing = await db
    .select()
    .from(ctpCategoriesTable)
    .where(and(eq(ctpCategoriesTable.guildId, guildId), eq(ctpCategoriesTable.categoryId, selectedCategoryId)))
    .limit(1);

  if (!existing.length) return;

  const ex = existing[0];
  const state: CtpPanelState = {
    categoryId: ex.categoryId,
    gameName: ex.gameName,
    gameRoleId: ex.gameRoleId,
    cooldownSeconds: ex.cooldownSeconds,
    pingMessage: ex.pingMessage ?? undefined,
  };
  ctpPanelState.set(userId, state);

  await interaction.update({
    embeds: [buildCtpPanelEmbed(state)],
    components: buildCtpPanelComponents(state),
  });
}

function buildCtpPanelEmbed(state: CtpPanelState) {
  const cooldownStr = state.cooldownSeconds != null
    ? formatSeconds(state.cooldownSeconds)
    : "10m (default)";

  const lines = [
    `**Game Name** — ${state.gameName ?? "not set"}`,
    `**Role** — ${state.gameRoleId ? `<@&${state.gameRoleId}>` : "not set"}`,
    `**Category** — ${state.categoryId ? `<#${state.categoryId}>` : "not set"}`,
    `**Cooldown** — ${cooldownStr}`,
  ];

  return new EmbedBuilder()
    .setColor(0x5000ff)
    .setTitle("Call to Play")
    .setDescription(lines.join("\n"))
    .setFooter({ text: "Night Stars • CTP" });
}

function buildCtpPanelComponents(state: CtpPanelState) {
  const canSave = !!(state.categoryId && state.gameRoleId && state.gameName);

  const cooldownStr = state.cooldownSeconds != null
    ? formatSeconds(state.cooldownSeconds)
    : "10m";

  const row1 = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("cp_category")
      .setPlaceholder(state.categoryId ? "Game Category (set)" : "Game Category...")
      .addChannelTypes(ChannelType.GuildCategory)
      .setMinValues(1)
      .setMaxValues(1)
  );

  const row2 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("cp_game_role")
      .setPlaceholder(state.gameRoleId ? "Role to ping (set)" : "Role to ping...")
      .setMinValues(1)
      .setMaxValues(1)
  );

  const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("cp_open_details")
      .setLabel(state.gameName ? `${state.gameName} | ${cooldownStr}` : "Game Name & Cooldown")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("cp_save")
      .setLabel("Save")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!canSave),
    new ButtonBuilder()
      .setCustomId("cp_back_manage")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary),
  );

  return [row1, row2, row3];
}

export async function openCtpPanel(interaction: ButtonInteraction) {
  const userId = interaction.user.id;
  const state: CtpPanelState = {};
  ctpPanelState.set(userId, state);

  await interaction.update({
    embeds: [buildCtpPanelEmbed(state)],
    components: buildCtpPanelComponents(state),
  });
}

export async function handleCtpBackToManage(interaction: ButtonInteraction) {
  const guildId = interaction.guild!.id;
  const userId = interaction.user.id;
  ctpManageState.set(userId, {});

  const games = await getGuildGames(guildId);

  if (!games.length) {
    await interaction.update({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5000ff)
          .setTitle("Call to Play — Game Manager")
          .setDescription("No games configured yet. Add your first game below.")
          .setFooter({ text: "Night Stars • CTP" }),
      ],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("cp_add_new")
            .setLabel("Add Game")
            .setStyle(ButtonStyle.Success)
        ),
      ],
    });
    return;
  }

  await interaction.update({
    embeds: [buildManageEmbed(games)],
    components: buildManageComponents(games),
  });
}

export async function handleCtpPanelSelect(
  interaction: RoleSelectMenuInteraction | ChannelSelectMenuInteraction
) {
  const userId = interaction.user.id;
  const state = ctpPanelState.get(userId) ?? {};

  if (interaction.customId === "cp_category") {
    const selectedCategoryId = (interaction as ChannelSelectMenuInteraction).values[0];
    state.categoryId = selectedCategoryId;

    const existing = await db
      .select()
      .from(ctpCategoriesTable)
      .where(
        and(
          eq(ctpCategoriesTable.guildId, interaction.guild!.id),
          eq(ctpCategoriesTable.categoryId, selectedCategoryId)
        )
      )
      .limit(1);

    if (existing.length) {
      const ex = existing[0];
      state.gameName = ex.gameName;
      state.gameRoleId = ex.gameRoleId;
      state.cooldownSeconds = ex.cooldownSeconds;
      state.pingMessage = ex.pingMessage ?? undefined;
    }
  } else if (interaction.customId === "cp_game_role") {
    state.gameRoleId = (interaction as RoleSelectMenuInteraction).values[0];
  }

  ctpPanelState.set(userId, state);

  await interaction.update({
    embeds: [buildCtpPanelEmbed(state)],
    components: buildCtpPanelComponents(state),
  });
}

export async function openCtpDetailsModal(interaction: ButtonInteraction) {
  const state = ctpPanelState.get(interaction.user.id) ?? {};

  const currentCooldown = state.cooldownSeconds != null
    ? formatSeconds(state.cooldownSeconds)
    : "10m";

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
        .setLabel("Cooldown (e.g. 10m, 600s, 10m30s)")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(10)
        .setValue(currentCooldown)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("cp_ping_msg")
        .setLabel("Ping Message (optional)")
        .setPlaceholder("Leave empty to use default: Looking for players!")
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
  state.cooldownSeconds = cooldownRaw ? parseCooldown(cooldownRaw) : 600;
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
      embeds: [new EmbedBuilder().setColor(0x5000ff).setDescription("Game Name, Role and Category are required.")],
      ephemeral: true,
    });
    return;
  }

  const guildId = interaction.guild!.id;
  const cooldownSeconds = state.cooldownSeconds ?? 600;

  const existing = await db
    .select()
    .from(ctpCategoriesTable)
    .where(and(eq(ctpCategoriesTable.guildId, guildId), eq(ctpCategoriesTable.categoryId, state.categoryId)))
    .limit(1);

  if (existing.length) {
    await db.update(ctpCategoriesTable).set({
      gameName: state.gameName,
      gameRoleId: state.gameRoleId,
      cooldownSeconds,
      pingMessage: state.pingMessage ?? null,
      enabled: 1,
    }).where(and(eq(ctpCategoriesTable.guildId, guildId), eq(ctpCategoriesTable.categoryId, state.categoryId)));
  } else {
    await db.insert(ctpCategoriesTable).values({
      guildId,
      categoryId: state.categoryId,
      gameName: state.gameName,
      gameRoleId: state.gameRoleId,
      cooldownSeconds,
      pingMessage: state.pingMessage ?? null,
    });
  }

  await db.delete(ctpCooldownsTable).where(
    and(eq(ctpCooldownsTable.guildId, guildId), eq(ctpCooldownsTable.categoryId, state.categoryId))
  );

  ctpPanelState.delete(userId);
  ctpManageState.set(userId, {});

  const allGames = await getGuildGames(guildId);

  await interaction.update({
    embeds: [buildManageEmbed(allGames)],
    components: buildManageComponents(allGames),
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
