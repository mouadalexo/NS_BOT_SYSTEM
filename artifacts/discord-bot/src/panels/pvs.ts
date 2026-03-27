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
}

export const pvsPanelState = new Map<string, PvsPanelState>();

function buildPvsPanelEmbed(state: PvsPanelState) {
  return new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle("🎙️ PVS — Private Voice System Setup")
    .setDescription(
      "Staff with the **PVS Manager Role** can use `+pv @member` to create a private voice room for any member."
    )
    .addFields(
      {
        name: "Premium Voices Category `optional`",
        value: state.pvsCategoryId
          ? `<#${state.pvsCategoryId}>`
          : "The category where private rooms are created.",
        inline: false,
      },
      {
        name: "PVS Manager Role `optional`",
        value: state.pvsManagerRoleId
          ? `<@&${state.pvsManagerRoleId}>`
          : "Role that can use `+pv @member` to create rooms.",
        inline: false,
      }
    )
    .setFooter({ text: "Night Stars • PVS" });
}

function buildPvsPanelComponents(state: PvsPanelState) {
  const row1 = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("pp_pvs_category")
      .setPlaceholder(state.pvsCategoryId ? "✅ Premium Voices Category — click to change" : "Premium Voices Category (optional)...")
      .addChannelTypes(ChannelType.GuildCategory)
      .setMinValues(0)
      .setMaxValues(1)
  );

  const row2 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("pp_manager_role")
      .setPlaceholder(state.pvsManagerRoleId ? "✅ PVS Manager Role — click to change" : "PVS Manager Role (optional)...")
      .setMinValues(0)
      .setMaxValues(1)
  );

  const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("pp_save")
      .setLabel("Save")
      .setEmoji("💾")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("pp_reset")
      .setLabel("Reset")
      .setEmoji("🔄")
      .setStyle(ButtonStyle.Danger)
  );

  return [row1, row2, row3];
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
  };
  pvsPanelState.set(userId, state);

  await interaction.reply({
    embeds: [buildPvsPanelEmbed(state)],
    components: buildPvsPanelComponents(state),
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
      pvsCreateChannelId: null,
      updatedAt: new Date(),
    }).where(eq(botConfigTable.guildId, guildId));
  } else {
    await db.insert(botConfigTable).values({
      guildId,
      pvsCategoryId: state.pvsCategoryId ?? null,
      pvsManagerRoleId: state.pvsManagerRoleId ?? null,
    });
  }

  pvsPanelState.delete(userId);

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle("✅ PVS Saved")
        .addFields(
          {
            name: "Premium Voices Category",
            value: state.pvsCategoryId ? `<#${state.pvsCategoryId}>` : "Not set",
            inline: true,
          },
          {
            name: "PVS Manager Role",
            value: state.pvsManagerRoleId ? `<@&${state.pvsManagerRoleId}>` : "Not set",
            inline: true,
          }
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
