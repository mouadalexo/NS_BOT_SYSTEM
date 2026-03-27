import {
  ButtonInteraction,
  ChannelSelectMenuInteraction,
  RoleSelectMenuInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelType,
} from "discord.js";
import { db } from "@workspace/db";
import { botConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";

interface PvsPanelState {
  pvsCategoryId?: string;
  pvsManagerRoleId?: string;
  pvsWaitingRoomChannelId?: string;
}

export const pvsPanelState = new Map<string, PvsPanelState>();

function buildPvsPanelEmbed(state: PvsPanelState) {
  const lines = [
    `**Category** — ${state.pvsCategoryId ? `<#${state.pvsCategoryId}>` : "not set"}`,
    `**Manager Role** — ${state.pvsManagerRoleId ? `<@&${state.pvsManagerRoleId}>` : "not set"}`,
    `**Waiting Room** — ${state.pvsWaitingRoomChannelId ? `<#${state.pvsWaitingRoomChannelId}>` : "not set"}`,
  ];

  return new EmbedBuilder()
    .setColor(0xff0000)
    .setTitle("Private Voice System")
    .setDescription(lines.join("\n"))
    .setFooter({ text: "Night Stars • PVS" });
}

function buildPvsPanelComponents(state: PvsPanelState) {
  const row1 = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("pp_pvs_category")
      .setPlaceholder(state.pvsCategoryId ? "Premium Voices Category (set)" : "Premium Voices Category (optional)...")
      .addChannelTypes(ChannelType.GuildCategory)
      .setMinValues(0)
      .setMaxValues(1)
  );

  const row2 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("pp_manager_role")
      .setPlaceholder(state.pvsManagerRoleId ? "PVS Manager Role (set)" : "PVS Manager Role (optional)...")
      .setMinValues(0)
      .setMaxValues(1)
  );

  const row3 = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("pp_waiting_room")
      .setPlaceholder(state.pvsWaitingRoomChannelId ? "Waiting Room (set)" : "Waiting Room (optional)...")
      .addChannelTypes(ChannelType.GuildVoice)
      .setMinValues(0)
      .setMaxValues(1)
  );

  const row4 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("pp_save")
      .setLabel("Save")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("pp_reset")
      .setLabel("Reset")
      .setStyle(ButtonStyle.Danger)
  );

  return [row1, row2, row3, row4];
}

export async function openPvsPanel(interaction: ButtonInteraction) {
  const userId = interaction.user.id;

  const config = await db
    .select()
    .from(botConfigTable)
    .where(eq(botConfigTable.guildId, interaction.guild!.id))
    .limit(1);

  const existing = config[0];
  const state: PvsPanelState = {
    pvsCategoryId: existing?.pvsCategoryId ?? undefined,
    pvsManagerRoleId: existing?.pvsManagerRoleId ?? undefined,
    pvsWaitingRoomChannelId: existing?.pvsWaitingRoomChannelId ?? undefined,
  };
  pvsPanelState.set(userId, state);

  const payload = {
    embeds: [buildPvsPanelEmbed(state)],
    components: buildPvsPanelComponents(state),
  };

  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload);
    return;
  }

  await interaction.reply({
    ...payload,
    ephemeral: true,
  });
}

export async function handlePvsPanelSelect(
  interaction: ChannelSelectMenuInteraction | RoleSelectMenuInteraction
) {
  const userId = interaction.user.id;
  const state = pvsPanelState.get(userId) ?? {};

  if (interaction.customId === "pp_pvs_category") {
    state.pvsCategoryId = (interaction as ChannelSelectMenuInteraction).values[0] ?? undefined;
  } else if (interaction.customId === "pp_manager_role") {
    state.pvsManagerRoleId = (interaction as RoleSelectMenuInteraction).values[0] ?? undefined;
  } else if (interaction.customId === "pp_waiting_room") {
    state.pvsWaitingRoomChannelId = (interaction as ChannelSelectMenuInteraction).values[0] ?? undefined;
  }

  pvsPanelState.set(userId, state);

  await interaction.update({
    embeds: [buildPvsPanelEmbed(state)],
    components: buildPvsPanelComponents(state),
  });
}

export async function handlePvsPanelSave(interaction: ButtonInteraction) {
  const userId = interaction.user.id;
  const state = pvsPanelState.get(userId) ?? {};
  const guildId = interaction.guild!.id;

  const existing = await db
    .select()
    .from(botConfigTable)
    .where(eq(botConfigTable.guildId, guildId))
    .limit(1);

  if (existing.length) {
    await db.update(botConfigTable).set({
      pvsCategoryId: state.pvsCategoryId ?? null,
      pvsManagerRoleId: state.pvsManagerRoleId ?? null,
      pvsWaitingRoomChannelId: state.pvsWaitingRoomChannelId ?? null,
      pvsCreateChannelId: null,
      updatedAt: new Date(),
    }).where(eq(botConfigTable.guildId, guildId));
  } else {
    await db.insert(botConfigTable).values({
      guildId,
      pvsCategoryId: state.pvsCategoryId ?? null,
      pvsManagerRoleId: state.pvsManagerRoleId ?? null,
      pvsWaitingRoomChannelId: state.pvsWaitingRoomChannelId ?? null,
    });
  }

  pvsPanelState.delete(userId);

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle("PVS Saved")
        .setDescription(
          [
            `**Category** — ${state.pvsCategoryId ? `<#${state.pvsCategoryId}>` : "not set"}`,
            `**Manager Role** — ${state.pvsManagerRoleId ? `<@&${state.pvsManagerRoleId}>` : "not set"}`,
            `**Waiting Room** — ${state.pvsWaitingRoomChannelId ? `<#${state.pvsWaitingRoomChannelId}>` : "not set"}`,
          ].join("\n")
        )
        .setFooter({ text: "Night Stars • PVS" }),
    ],
    components: [],
  });
}

export async function handlePvsPanelReset(interaction: ButtonInteraction) {
  const state: PvsPanelState = {};
  pvsPanelState.set(interaction.user.id, state);
  await interaction.update({
    embeds: [buildPvsPanelEmbed(state)],
    components: buildPvsPanelComponents(state),
  });
}
