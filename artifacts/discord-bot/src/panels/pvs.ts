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
  const canSave = !!state.createChannelId;

  return new EmbedBuilder()
    .setColor(canSave ? 0x2ecc71 : 0x9b59b6)
    .setTitle("🎙️ PVS — Private Voice System Setup")
    .setDescription(
      "When a member joins the **Create Channel**, the bot instantly creates a private voice room for them.\n\n" +
      "The room owner can:\n" +
      "— `=key @user` — give or remove access\n" +
      "— `=see keys` — list who has access\n" +
      "— `=clear keys` — remove all access\n" +
      "— `=rename Name` — rename their room\n\n" +
      "The room is automatically deleted when everyone leaves."
    )
    .addFields(
      {
        name: "Create Channel `required`",
        value: state.createChannelId
          ? `<#${state.createChannelId}>`
          : "The voice channel members join to get a private room.",
        inline: true,
      },
      {
        name: "Rooms Category `optional`",
        value: state.pvsCategoryId
          ? `<#${state.pvsCategoryId}>`
          : "Where private rooms will appear. Defaults to same as Create Channel.",
        inline: true,
      }
    )
    .setFooter({
      text: canSave
        ? "Ready to save — click Save Configuration."
        : "Select the Create Channel to continue.",
    });
}

function buildPvsPanelComponents(state: PvsPanelState) {
  const canSave = !!state.createChannelId;

  const row1 = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("pp_create_channel")
      .setPlaceholder(
        state.createChannelId ? "✅ Create Channel — click to change" : "Select the Create Channel (voice)..."
      )
      .addChannelTypes(ChannelType.GuildVoice)
      .setMinValues(1)
      .setMaxValues(1)
  );

  const row2 = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("pp_pvs_category")
      .setPlaceholder(
        state.pvsCategoryId ? "✅ Rooms Category — click to change" : "Rooms Category (optional)..."
      )
      .addChannelTypes(ChannelType.GuildCategory)
      .setMinValues(0)
      .setMaxValues(1)
  );

  const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("pp_save")
      .setLabel(canSave ? "Save Configuration" : "Save (select Create Channel first)")
      .setEmoji(canSave ? "💾" : "🔒")
      .setStyle(canSave ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(!canSave),
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
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xe74c3c)
          .setDescription("❌ Please select the Create Channel first."),
      ],
      ephemeral: true,
    });
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
        .setTitle("✅ Premium Voices Saved")
        .addFields(
          { name: "Create Channel", value: `<#${state.createChannelId}>`, inline: true },
          {
            name: "Rooms Category",
            value: state.pvsCategoryId ? `<#${state.pvsCategoryId}>` : "Same as Create Channel",
            inline: true,
          }
        )
        .setDescription(
          "Members can now join the Create Channel to get their own private voice room."
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
