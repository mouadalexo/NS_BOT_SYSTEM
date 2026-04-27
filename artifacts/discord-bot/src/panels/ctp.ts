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

interface CtpAddState {
  categoryId?: string;
  gameRoleId?: string;
  gameName?: string;
}

interface CtpManageState {
  selectedCategoryId?: string;
}

export const ctpPanelState = new Map<string, CtpAddState>();
export const ctpManageState = new Map<string, CtpManageState>();

const DEFAULT_COOLDOWN = 600;

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
  return DEFAULT_COOLDOWN;
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
          .setTitle("Tag Category — Game Manager")
          .setDescription("No games configured yet. Add your first game below.\n\nPick a **category** and a **role** — the game name is taken from the role automatically and the cooldown defaults to **10m**. You can edit name or cooldown later.")
          .setFooter({ text: "Night Stars • Tag Category" }),
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
        ].join("\n")
      )
      .setFooter({ text: `${games.length} game(s) configured • Night Stars Tag Category` });
  }

  return new EmbedBuilder()
    .setColor(0x5000ff)
    .setTitle("Tag Category — Game Manager")
    .setDescription(
      games.map((g) => `**${g.gameName}** — <@&${g.gameRoleId}> • Cooldown: ${formatSeconds(g.cooldownSeconds)}`).join("\n")
    )
    .setFooter({ text: `${games.length} game(s) configured • Night Stars Tag Category` });
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

  const tempTagRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("ct_open")
      .setLabel("🎲 Ping One-Tap")
      .setStyle(ButtonStyle.Secondary),
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
    return [selectRow, actionRow, tempTagRow];
  }

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("cp_add_new")
      .setLabel("Add New")
      .setStyle(ButtonStyle.Success),
  );
  return [selectRow, actionRow, tempTagRow];
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
          .setTitle("Tag Category — Game Manager")
          .setDescription("Game removed. No games configured yet. Add your first game below.")
          .setFooter({ text: "Night Stars • Tag Category" }),
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
  const cooldownStr = formatSeconds(ex.cooldownSeconds);

  const modal = new ModalBuilder()
    .setCustomId("cp_edit_modal")
    .setTitle("Edit Game");

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("cp_game_name")
        .setLabel("Game Name")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(50)
        .setValue(ex.gameName)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("cp_cooldown")
        .setLabel("Cooldown (e.g. 10m, 600s, 10m30s)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(10)
        .setValue(cooldownStr)
    ),
  );

  await interaction.showModal(modal);
}

export async function handleCtpEditModalSubmit(interaction: ModalSubmitInteraction) {
  const userId = interaction.user.id;
  const guildId = interaction.guild!.id;
  const manageState = ctpManageState.get(userId);
  const selectedCategoryId = manageState?.selectedCategoryId;
  if (!selectedCategoryId) return;

  const newName = interaction.fields.getTextInputValue("cp_game_name").trim();
  const cooldownRaw = interaction.fields.getTextInputValue("cp_cooldown").trim();
  const cooldownSeconds = cooldownRaw ? parseCooldown(cooldownRaw) : DEFAULT_COOLDOWN;

  await db.update(ctpCategoriesTable).set({
    gameName: newName,
    cooldownSeconds,
  }).where(and(eq(ctpCategoriesTable.guildId, guildId), eq(ctpCategoriesTable.categoryId, selectedCategoryId)));

  const games = await getGuildGames(guildId);
  const selected = games.find((g) => g.categoryId === selectedCategoryId);

  await interaction.update({
    embeds: [selected ? buildManageEmbed(games, selected) : buildManageEmbed(games)],
    components: buildManageComponents(games, selected ? selectedCategoryId : undefined),
  });
}

function buildAddPanelEmbed(state: CtpAddState) {
  const lines = [
    `**Role** — ${state.gameRoleId ? `<@&${state.gameRoleId}>` : "_pick a role_"}`,
    `**Game Name** — ${state.gameName ?? "_(takes the role's name)_"}`,
    `**Category** — ${state.categoryId ? `<#${state.categoryId}>` : "_pick a category_"}`,
    `**Cooldown** — ${formatSeconds(DEFAULT_COOLDOWN)} (default — editable later)`,
  ];

  return new EmbedBuilder()
    .setColor(0x5000ff)
    .setTitle("Add a Game — Tag Category")
    .setDescription(lines.join("\n"))
    .setFooter({ text: "Night Stars • Tag Category" });
}

function buildAddPanelComponents(state: CtpAddState) {
  const canSave = !!(state.categoryId && state.gameRoleId);

  const row1 = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("cp_category")
      .setPlaceholder(state.categoryId ? "Game Category (set)" : "Pick the game's voice category...")
      .addChannelTypes(ChannelType.GuildCategory)
      .setMinValues(1)
      .setMaxValues(1)
  );

  const row2 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("cp_game_role")
      .setPlaceholder(state.gameRoleId ? "Role to ping (set)" : "Pick the game role to ping...")
      .setMinValues(1)
      .setMaxValues(1)
  );

  const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
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
  const state: CtpAddState = {};
  ctpPanelState.set(userId, state);

  await interaction.update({
    embeds: [buildAddPanelEmbed(state)],
    components: buildAddPanelComponents(state),
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
          .setTitle("Tag Category — Game Manager")
          .setDescription("No games configured yet. Add your first game below.")
          .setFooter({ text: "Night Stars • Tag Category" }),
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
    }
  } else if (interaction.customId === "cp_game_role") {
    const role = (interaction as RoleSelectMenuInteraction).roles.first();
    if (role) {
      state.gameRoleId = role.id;
      // Auto-fill game name from the role name on first pick. If the user
      // already has a name (from editing an existing entry), keep it.
      if (!state.gameName) state.gameName = role.name;
    }
  }

  ctpPanelState.set(userId, state);

  await interaction.update({
    embeds: [buildAddPanelEmbed(state)],
    components: buildAddPanelComponents(state),
  });
}

export async function handleCtpPanelSave(interaction: ButtonInteraction) {
  const userId = interaction.user.id;
  const state = ctpPanelState.get(userId) ?? {};

  if (!state.categoryId || !state.gameRoleId) {
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(0x5000ff).setDescription("Pick a category and a role first.")],
      ephemeral: true,
    });
    return;
  }

  const guildId = interaction.guild!.id;
  const cooldownSeconds = DEFAULT_COOLDOWN;

  // Resolve the game name from the role if missing — never make the user
  // type it manually.
  let gameName = state.gameName?.trim();
  if (!gameName) {
    const role = await interaction.guild!.roles.fetch(state.gameRoleId).catch(() => null);
    gameName = role?.name?.trim() || "Game";
  }

  const existing = await db
    .select()
    .from(ctpCategoriesTable)
    .where(and(eq(ctpCategoriesTable.guildId, guildId), eq(ctpCategoriesTable.categoryId, state.categoryId)))
    .limit(1);

  if (existing.length) {
    await db.update(ctpCategoriesTable).set({
      gameName,
      gameRoleId: state.gameRoleId,
      cooldownSeconds,
      pingMessage: null,
      enabled: 1,
    }).where(and(eq(ctpCategoriesTable.guildId, guildId), eq(ctpCategoriesTable.categoryId, state.categoryId)));
  } else {
    await db.insert(ctpCategoriesTable).values({
      guildId,
      categoryId: state.categoryId,
      gameName,
      gameRoleId: state.gameRoleId,
      cooldownSeconds,
      pingMessage: null,
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
  const state: CtpAddState = {};
  ctpPanelState.set(interaction.user.id, state);
  await interaction.update({
    embeds: [buildAddPanelEmbed(state)],
    components: buildAddPanelComponents(state),
  });
}
