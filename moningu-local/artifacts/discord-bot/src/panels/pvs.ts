import {
  ButtonInteraction,
  ChannelSelectMenuInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
} from "discord.js";
import { db } from "@workspace/db";
import { botConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";

interface PvsPanelState {
  createChannelId?: string;
  pvsCategoryId?: string;
}

export const pvsPanelState = new Map<string, PvsPanelState>();

function buildPvsPanelEmbed(state: PvsPanelState) {
  return new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle("🎙️ Private Voice System — Setup")
    .setDescription(
      "Configure the Private Voice System.\n\n" +
      "**How it works:**\n" +
      "• Members join the **Create Channel** → bot creates a private room for them\n" +
      "• The room appears in the **PVS Category**\n" +
      "• Owner manages the room with `=key`, `=rename`, etc.\n" +
      "• Room is deleted automatically when empty."
    )
    .addFields(
      {
        name: "🔊 Create Channel (required)",
        value: state.createChannelId ? `<#${state.createChannelId}>` : "_Not selected_",
        inline: true,
      },
      {
        name: "🗂️ PVS Category (optional)",
        value: state.pvsCategoryId ? `<#${state.pvsCategoryId}>` : "_Not selected_",
        inline: true,
      }
    )
    .setFooter({ text: "The Create Channel is required to enable PVS." });
}

function buildPvsPanelComponents(state: PvsPanelState) {
  const canSave = !!state.createChannelId;

  const row1 = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("pp_create_channel")
      .setPlaceholder(state.createChannelId ? "✅ Create Channel selected" : "Select the Create Channel (voice)")
      .addChannelTypes(ChannelType.GuildVoice)
      .setMinValues(1)
      .setMaxValues(1)
  );

  const row2 = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("pp_pvs_category")
      .setPlaceholder(state.pvsCategoryId ? "✅ PVS Category selected" : "Select PVS Category (optional)")
      .addChannelTypes(ChannelType.GuildCategory)
      .setMinValues(0)
      .setMaxValues(1)
  );

  const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("pp_save")
      .setLabel(canSave ? "💾 Save Configuration" : "💾 Save (select Create Channel first)")
      .setStyle(canSave ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(!canSave),
    new ButtonBuilder()
      .setCustomId("pp_reset")
      .setLabel("🔄 Reset")
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
    createChannelId: existing?.pvsCreateChannelId ?? undefined,
    pvsCategoryId: existing?.pvsCategoryId ?? undefined,
  };
  pvsPanelState.set(userId, state);

  await interaction.reply({
    embeds: [buildPvsPanelEmbed(state)],
    components: buildPvsPanelComponents(state),
    ephemeral: true,
  });
}

export async function handlePvsPanelSelect(interaction: ChannelSelectMenuInteraction) {
  const userId = interaction.user.id;
  const state = pvsPanelState.get(userId) ?? {};

  if (interaction.customId === "pp_create_channel") {
    state.createChannelId = interaction.values[0];
  } else if (interaction.customId === "pp_pvs_category") {
    state.pvsCategoryId = interaction.values[0] ?? undefined;
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

  if (!state.createChannelId) {
    await interaction.reply({ content: "Please select the Create Channel first.", ephemeral: true });
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
      pvsCreateChannelId: state.createChannelId,
      pvsCategoryId: state.pvsCategoryId ?? null,
      updatedAt: new Date(),
    }).where(eq(botConfigTable.guildId, guildId));
  } else {
    await db.insert(botConfigTable).values({
      guildId,
      pvsCreateChannelId: state.createChannelId,
      pvsCategoryId: state.pvsCategoryId ?? null,
    });
  }

  pvsPanelState.delete(userId);

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle("✅ Private Voice System Saved!")
        .addFields(
          { name: "Create Channel", value: `<#${state.createChannelId}>`, inline: true },
          { name: "PVS Category", value: state.pvsCategoryId ? `<#${state.pvsCategoryId}>` : "None", inline: true }
        )
        .setDescription("Members can now join the Create Channel to get a private voice room.")
        .setFooter({ text: "Configuration saved successfully." }),
    ],
    components: [],
  });
}

export async function handlePvsPanelReset(interaction: ButtonInteraction) {
  const userId = interaction.user.id;
  const state: PvsPanelState = {};
  pvsPanelState.set(userId, state);

  await interaction.update({
    embeds: [buildPvsPanelEmbed(state)],
    components: buildPvsPanelComponents(state),
  });
}
