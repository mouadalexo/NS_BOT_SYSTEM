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
import {
  ctpTempVoiceConfigTable,
  ctpTempVoiceGamesTable,
  ctpTempVoiceCooldownsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";

interface CtpTagState {
  mode?: "set_category" | "add_game" | "remove_game" | null;
}

export const ctpTagState = new Map<string, CtpTagState>();

function parseCooldown(input: string): number {
  const s = input.trim().toLowerCase().replace(/\s+/g, "");
  const mMatch = s.match(/^(\d+)m(\d+)?s?$/);
  if (mMatch) {
    const mins = parseInt(mMatch[1] ?? "0");
    const secs = parseInt(mMatch[2] ?? "0");
    return mins * 60 + secs;
  }
  const sOnly = s.match(/^(\d+)s$/);
  if (sOnly) return parseInt(sOnly[1]);
  const mOnly = s.match(/^(\d+)m$/);
  if (mOnly) return parseInt(mOnly[1]) * 60;
  const plain = parseInt(s);
  if (!isNaN(plain) && plain > 0) return plain * 60;
  return 300;
}

function formatSeconds(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m > 0 && s > 0) return `${m}m ${s}s`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

async function getConfig(guildId: string) {
  const [cfg] = await db
    .select()
    .from(ctpTempVoiceConfigTable)
    .where(eq(ctpTempVoiceConfigTable.guildId, guildId))
    .limit(1);
  return cfg ?? null;
}

async function getGames(guildId: string) {
  return db
    .select()
    .from(ctpTempVoiceGamesTable)
    .where(eq(ctpTempVoiceGamesTable.guildId, guildId));
}

type Config = Awaited<ReturnType<typeof getConfig>>;
type Games = Awaited<ReturnType<typeof getGames>>;

function buildEmbed(cfg: Config, games: Games, state: CtpTagState): EmbedBuilder {
  const enabled = !!(cfg?.enabled ?? 1);
  return new EmbedBuilder()
    .setColor(0x5000ff)
    .setTitle("🎲 CTP — Temp Voice Tags")
    .addFields(
      {
        name: "Category",
        value: cfg?.categoryId ? `<#${cfg.categoryId}>` : "_not set_",
        inline: true,
      },
      {
        name: "Cooldown",
        value: formatSeconds(cfg?.cooldownSeconds ?? 300),
        inline: true,
      },
      {
        name: "Status",
        value: enabled ? "✅ Enabled" : "❌ Disabled",
        inline: true,
      },
      {
        name: "Games",
        value: games.length
          ? games.map((g) => `<@&${g.roleId}> — ${g.gameName}`).join("\n")
          : "_none configured_",
        inline: false,
      }
    )
    .setFooter({ text: "Night Stars • CTP Temp Tags" });
}

function buildComponents(cfg: Config, games: Games, state: CtpTagState) {
  const enabled = !!(cfg?.enabled ?? 1);
  const rows: ActionRowBuilder<any>[] = [];

  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("ct_set_category")
        .setLabel("Set Category")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("ct_set_cooldown")
        .setLabel("Set Cooldown")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("ct_toggle")
        .setLabel(enabled ? "✅ Enabled" : "❌ Disabled")
        .setStyle(enabled ? ButtonStyle.Success : ButtonStyle.Danger),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("ct_add_game")
        .setLabel("Add Game")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("ct_remove_game")
        .setLabel("Remove Game")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(games.length === 0),
      new ButtonBuilder()
        .setCustomId("ct_back")
        .setLabel("← Back")
        .setStyle(ButtonStyle.Secondary),
    )
  );

  if (state.mode === "set_category") {
    rows.push(
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId("ct_category")
          .setPlaceholder("Select the temp voices category")
          .setChannelTypes(ChannelType.GuildCategory)
      )
    );
  } else if (state.mode === "add_game") {
    rows.push(
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId("ct_game_role")
          .setPlaceholder("Select game role to add")
      )
    );
  } else if (state.mode === "remove_game" && games.length > 0) {
    rows.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("ct_remove_select")
          .setPlaceholder("Select game to remove")
          .addOptions(games.map((g) => ({ label: g.gameName, value: g.roleId })))
      )
    );
  }

  return rows;
}

export async function openCtpTagPanel(interaction: ButtonInteraction) {
  const guildId = interaction.guild!.id;
  const cfg = await getConfig(guildId);
  const games = await getGames(guildId);
  const state: CtpTagState = {};
  ctpTagState.set(interaction.user.id, state);

  const payload = {
    embeds: [buildEmbed(cfg, games, state)],
    components: buildComponents(cfg, games, state),
  };

  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload);
  } else {
    await interaction.reply({ ...payload, ephemeral: true });
  }
}

export async function handleCtpTagButton(interaction: ButtonInteraction) {
  const guildId = interaction.guild!.id;
  const userId = interaction.user.id;
  const state = ctpTagState.get(userId) ?? {};

  if (interaction.customId === "ct_set_category") {
    state.mode = "set_category";
    ctpTagState.set(userId, state);
    const cfg = await getConfig(guildId);
    const games = await getGames(guildId);
    await interaction.update({ embeds: [buildEmbed(cfg, games, state)], components: buildComponents(cfg, games, state) });
    return;
  }

  if (interaction.customId === "ct_set_cooldown") {
    const modal = new ModalBuilder()
      .setCustomId("ct_cooldown_modal")
      .setTitle("Set Temp Voice Cooldown");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("ct_cooldown_input")
          .setLabel("Cooldown (e.g. 5m, 30s, 2m30s)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(10)
      )
    );
    await interaction.showModal(modal);
    return;
  }

  if (interaction.customId === "ct_toggle") {
    const cfg = await getConfig(guildId);
    const currentEnabled = !!(cfg?.enabled ?? 1);
    const newEnabled = currentEnabled ? 0 : 1;
    if (cfg) {
      await db.update(ctpTempVoiceConfigTable).set({ enabled: newEnabled }).where(eq(ctpTempVoiceConfigTable.guildId, guildId));
    } else {
      await db.insert(ctpTempVoiceConfigTable).values({ guildId, enabled: newEnabled, cooldownSeconds: 300 });
    }
    const freshCfg = await getConfig(guildId);
    const games = await getGames(guildId);
    state.mode = null;
    ctpTagState.set(userId, state);
    await interaction.update({ embeds: [buildEmbed(freshCfg, games, state)], components: buildComponents(freshCfg, games, state) });
    return;
  }

  if (interaction.customId === "ct_add_game") {
    state.mode = "add_game";
    ctpTagState.set(userId, state);
    const cfg = await getConfig(guildId);
    const games = await getGames(guildId);
    await interaction.update({ embeds: [buildEmbed(cfg, games, state)], components: buildComponents(cfg, games, state) });
    return;
  }

  if (interaction.customId === "ct_remove_game") {
    state.mode = "remove_game";
    ctpTagState.set(userId, state);
    const cfg = await getConfig(guildId);
    const games = await getGames(guildId);
    await interaction.update({ embeds: [buildEmbed(cfg, games, state)], components: buildComponents(cfg, games, state) });
    return;
  }

  if (interaction.customId === "ct_back") {
    ctpTagState.delete(userId);
    const { openCtpManagePanel } = await import("./ctp.js");
    await openCtpManagePanel(interaction);
    return;
  }
}

export async function handleCtpTagChannelSelect(interaction: ChannelSelectMenuInteraction) {
  const guildId = interaction.guild!.id;
  const userId = interaction.user.id;
  const state = ctpTagState.get(userId) ?? {};
  const categoryId = interaction.values[0];
  state.mode = null;
  ctpTagState.set(userId, state);

  const cfg = await getConfig(guildId);
  if (cfg) {
    await db.update(ctpTempVoiceConfigTable).set({ categoryId }).where(eq(ctpTempVoiceConfigTable.guildId, guildId));
  } else {
    await db.insert(ctpTempVoiceConfigTable).values({ guildId, categoryId, cooldownSeconds: 300, enabled: 1 });
  }

  const freshCfg = await getConfig(guildId);
  const games = await getGames(guildId);
  await interaction.update({ embeds: [buildEmbed(freshCfg, games, state)], components: buildComponents(freshCfg, games, state) });
}

export async function handleCtpTagRoleSelect(interaction: RoleSelectMenuInteraction) {
  const guildId = interaction.guild!.id;
  const userId = interaction.user.id;
  const state = ctpTagState.get(userId) ?? {};
  const role = interaction.roles.first();
  if (!role) return;

  state.mode = null;
  ctpTagState.set(userId, state);

  const existing = await db
    .select()
    .from(ctpTempVoiceGamesTable)
    .where(and(eq(ctpTempVoiceGamesTable.guildId, guildId), eq(ctpTempVoiceGamesTable.roleId, role.id)))
    .limit(1);

  if (!existing.length) {
    await db.insert(ctpTempVoiceGamesTable).values({ guildId, roleId: role.id, gameName: role.name });
  }

  const cfg = await getConfig(guildId);
  const games = await getGames(guildId);
  await interaction.update({ embeds: [buildEmbed(cfg, games, state)], components: buildComponents(cfg, games, state) });
}

export async function handleCtpTagStringSelect(interaction: StringSelectMenuInteraction) {
  const guildId = interaction.guild!.id;
  const userId = interaction.user.id;
  const state = ctpTagState.get(userId) ?? {};
  const roleId = interaction.values[0];
  state.mode = null;
  ctpTagState.set(userId, state);

  await db.delete(ctpTempVoiceGamesTable).where(and(eq(ctpTempVoiceGamesTable.guildId, guildId), eq(ctpTempVoiceGamesTable.roleId, roleId)));
  await db.delete(ctpTempVoiceCooldownsTable).where(and(eq(ctpTempVoiceCooldownsTable.guildId, guildId), eq(ctpTempVoiceCooldownsTable.roleId, roleId)));

  const cfg = await getConfig(guildId);
  const games = await getGames(guildId);
  await interaction.update({ embeds: [buildEmbed(cfg, games, state)], components: buildComponents(cfg, games, state) });
}

export async function handleCtpTagModalSubmit(interaction: ModalSubmitInteraction) {
  const guildId = interaction.guild!.id;
  const userId = interaction.user.id;
  const state = ctpTagState.get(userId) ?? {};
  const cooldownSeconds = parseCooldown(interaction.fields.getTextInputValue("ct_cooldown_input"));
  state.mode = null;
  ctpTagState.set(userId, state);

  const cfg = await getConfig(guildId);
  if (cfg) {
    await db.update(ctpTempVoiceConfigTable).set({ cooldownSeconds }).where(eq(ctpTempVoiceConfigTable.guildId, guildId));
  } else {
    await db.insert(ctpTempVoiceConfigTable).values({ guildId, cooldownSeconds, enabled: 1 });
  }

  const freshCfg = await getConfig(guildId);
  const games = await getGames(guildId);
  await interaction.reply({ embeds: [buildEmbed(freshCfg, games, state)], components: buildComponents(freshCfg, games, state), ephemeral: true });
}
