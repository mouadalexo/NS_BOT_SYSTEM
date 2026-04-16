import {
  ButtonInteraction,
  RoleSelectMenuInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  RoleSelectMenuBuilder,
} from "discord.js";
import { db } from "@workspace/db";
import { botConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";

interface StaffPanelState {
  coreRoleId?: string;
}

export const staffPanelState = new Map<string, StaffPanelState>();

function buildStaffPanelEmbed(state: StaffPanelState) {
  return new EmbedBuilder()
    .setColor(0x5000ff)
    .setTitle("Core Role")
    .setDescription(
      `**Core Role** — ${state.coreRoleId ? `<@&${state.coreRoleId}>` : "not set"}\n\n` +
      "Members with the core role bypass all permission checks:\n" +
      "- PVS: Can create and delete premium voice rooms"
    )
    .setFooter({ text: "Night Stars \u2022 Core" });
}

function buildStaffPanelComponents(state: StaffPanelState) {
  const canSave = !!state.coreRoleId;

  const row1 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("sp_staff_role")
      .setPlaceholder(state.coreRoleId ? "Core Role (set)" : "Core Role...")
      .setMinValues(1)
      .setMaxValues(1)
  );

  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("sp_save")
      .setLabel("Save")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!canSave),
    new ButtonBuilder()
      .setCustomId("sp_reset")
      .setLabel("Reset")
      .setStyle(ButtonStyle.Danger)
  );

  return [row1, row2];
}

export async function openStaffPanel(interaction: ButtonInteraction) {
  const userId = interaction.user.id;

  const config = await db
    .select()
    .from(botConfigTable)
    .where(eq(botConfigTable.guildId, interaction.guild!.id))
    .limit(1);

  const state: StaffPanelState = {
    coreRoleId: config[0]?.staffRoleId ?? undefined,
  };
  staffPanelState.set(userId, state);

  const payload = {
    embeds: [buildStaffPanelEmbed(state)],
    components: buildStaffPanelComponents(state),
  };

  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload);
  } else {
    await interaction.reply({ ...payload, ephemeral: true });
  }
}

export async function handleStaffPanelSelect(interaction: RoleSelectMenuInteraction) {
  const userId = interaction.user.id;
  const state = staffPanelState.get(userId) ?? {};

  state.coreRoleId = interaction.values[0];
  staffPanelState.set(userId, state);

  await interaction.update({
    embeds: [buildStaffPanelEmbed(state)],
    components: buildStaffPanelComponents(state),
  });
}

export async function handleStaffPanelSave(interaction: ButtonInteraction) {
  const userId = interaction.user.id;
  const state = staffPanelState.get(userId) ?? {};

  if (!state.coreRoleId) {
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(0x5000ff).setDescription("Please select a core role first.")],
      ephemeral: true,
    });
    return;
  }

  const guildId = interaction.guild!.id;
  const existing = await db.select().from(botConfigTable).where(eq(botConfigTable.guildId, guildId)).limit(1);

  if (existing.length) {
    await db.update(botConfigTable).set({
      staffRoleId: state.coreRoleId,
      updatedAt: new Date(),
    }).where(eq(botConfigTable.guildId, guildId));
  } else {
    await db.insert(botConfigTable).values({
      guildId,
      staffRoleId: state.coreRoleId,
    });
  }

  staffPanelState.delete(userId);

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(0x5000ff)
        .setTitle("Core Role Saved")
        .setDescription(`**Core Role** — <@&${state.coreRoleId}>`)
        .setFooter({ text: "Night Stars \u2022 Core" }),
    ],
    components: [],
  });
}

export async function handleStaffPanelReset(interaction: ButtonInteraction) {
  const state: StaffPanelState = {};
  staffPanelState.set(interaction.user.id, state);
  await interaction.update({
    embeds: [buildStaffPanelEmbed(state)],
    components: buildStaffPanelComponents(state),
  });
}
