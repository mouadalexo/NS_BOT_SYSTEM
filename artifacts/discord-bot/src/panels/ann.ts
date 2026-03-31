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
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { db } from "@workspace/db";
import { botConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";

interface AnnPanelState {
  announcementsRoleId?: string;
  eventHosterRoleId?: string;
  annLogsChannelId?: string;
}

export const annPanelState = new Map<string, AnnPanelState>();

function buildAnnPanelEmbed(state: AnnPanelState) {
  return new EmbedBuilder()
    .setColor(0x5000ff)
    .setTitle("\uD83D\uDCE3 Announcements Setup")
    .setDescription(
      `**Ann Role** \u2014 ${state.announcementsRoleId ? `<@&${state.announcementsRoleId}>` : "not set"}\n` +
      "\u2514 Can post announcements and events\n\n" +
      `**Event Hoster Role** \u2014 ${state.eventHosterRoleId ? `<@&${state.eventHosterRoleId}>` : "not set"}\n` +
      "\u2514 Can post in event mode only\n\n" +
      `**Logs Channel** \u2014 ${state.annLogsChannelId ? `<#${state.annLogsChannelId}>` : "not set"}\n` +
      "\u2514 Receives a log for every announcement/event posted"
    )
    .setFooter({ text: "Night Stars \u2022 Announcements" });
}

function buildAnnPanelComponents(state: AnnPanelState) {
  const canSave = !!(state.announcementsRoleId || state.eventHosterRoleId || state.annLogsChannelId);

  const row1 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("ap_ann_role")
      .setPlaceholder(state.announcementsRoleId ? "\u2705 Ann Role (set)" : "Select Ann Role\u2026")
      .setMinValues(1)
      .setMaxValues(1)
  );

  const row2 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("ap_event_role")
      .setPlaceholder(state.eventHosterRoleId ? "\u2705 Event Hoster Role (set)" : "Select Event Hoster Role\u2026")
      .setMinValues(1)
      .setMaxValues(1)
  );

  const row3 = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("ap_logs_channel")
      .setPlaceholder(state.annLogsChannelId ? "\u2705 Logs Channel (set)" : "Select Logs Channel\u2026")
      .addChannelTypes(ChannelType.GuildText)
      .setMinValues(1)
      .setMaxValues(1)
  );

  const row4 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("ap_save").setLabel("Save").setStyle(ButtonStyle.Success).setDisabled(!canSave),
    new ButtonBuilder().setCustomId("ap_reset").setLabel("Reset").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("ap_color_open").setLabel("\uD83C\uDFA8 Color").setStyle(ButtonStyle.Secondary),
  );

  return [row1, row2, row3, row4];
}

function buildColorPanelEmbed() {
  return new EmbedBuilder()
    .setColor(0x5000ff)
    .setTitle("\uD83C\uDFA8 Announcement Colors")
    .setDescription(
      "Set embed color per section. Click a button and type a hex code (e.g. `FFE500`).\n\n" +
      "**Announcement Embeds**\n" +
      "\u2022 Title embed \u2014 default `FFE500` (gold)\n" +
      "\u2022 Description embed \u2014 default `FFE500` (gold)\n" +
      "\u2022 Additional embed \u2014 default `FFE500` (gold)\n\n" +
      "**Event**\n" +
      "\u2022 Event color \u2014 default `5865F2` (blurple)\n" +
      "\u2514 All event embeds use this single color"
    )
    .setFooter({ text: "Night Stars \u2022 Announcements" });
}

function buildColorPanelComponents() {
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("ap_color_ann_title").setLabel("Ann \u2014 Title").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("ap_color_ann_desc").setLabel("Ann \u2014 Desc").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("ap_color_ann_add").setLabel("Ann \u2014 Add").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("ap_color_event").setLabel("Event Color").setStyle(ButtonStyle.Secondary),
  );
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("ap_back").setLabel("\u2190 Back").setStyle(ButtonStyle.Secondary),
  );
  return [row1, row2];
}

export async function openAnnPanel(interaction: ButtonInteraction | any) {
  const userId = interaction.user.id;
  const config = await db.select().from(botConfigTable).where(eq(botConfigTable.guildId, interaction.guild!.id)).limit(1);
  const row = config[0];
  const state: AnnPanelState = {
    announcementsRoleId: row?.announcementsRoleId ?? undefined,
    eventHosterRoleId:   row?.eventHosterRoleId   ?? undefined,
    annLogsChannelId:    row?.annLogsChannelId     ?? undefined,
  };
  annPanelState.set(userId, state);
  if (typeof interaction.update === "function") {
    await interaction.update({ embeds: [buildAnnPanelEmbed(state)], components: buildAnnPanelComponents(state) });
  } else {
    await interaction.editReply({ embeds: [buildAnnPanelEmbed(state)], components: buildAnnPanelComponents(state) });
  }
}

export async function handleAnnAnnRoleSelect(interaction: RoleSelectMenuInteraction) {
  const userId = interaction.user.id;
  const state = annPanelState.get(userId) ?? {};
  state.announcementsRoleId = interaction.values[0];
  annPanelState.set(userId, state);
  if (typeof interaction.update === "function") {
    await interaction.update({ embeds: [buildAnnPanelEmbed(state)], components: buildAnnPanelComponents(state) });
  } else {
    await interaction.editReply({ embeds: [buildAnnPanelEmbed(state)], components: buildAnnPanelComponents(state) });
  }
}

export async function handleAnnEventRoleSelect(interaction: RoleSelectMenuInteraction) {
  const userId = interaction.user.id;
  const state = annPanelState.get(userId) ?? {};
  state.eventHosterRoleId = interaction.values[0];
  annPanelState.set(userId, state);
  if (typeof interaction.update === "function") {
    await interaction.update({ embeds: [buildAnnPanelEmbed(state)], components: buildAnnPanelComponents(state) });
  } else {
    await interaction.editReply({ embeds: [buildAnnPanelEmbed(state)], components: buildAnnPanelComponents(state) });
  }
}

export async function handleAnnLogsChannelSelect(interaction: ChannelSelectMenuInteraction) {
  const userId = interaction.user.id;
  const state = annPanelState.get(userId) ?? {};
  state.annLogsChannelId = interaction.values[0];
  annPanelState.set(userId, state);
  if (typeof interaction.update === "function") {
    await interaction.update({ embeds: [buildAnnPanelEmbed(state)], components: buildAnnPanelComponents(state) });
  } else {
    await interaction.editReply({ embeds: [buildAnnPanelEmbed(state)], components: buildAnnPanelComponents(state) });
  }
}

export async function handleAnnPanelSave(interaction: ButtonInteraction) {
  const userId = interaction.user.id;
  const state = annPanelState.get(userId);
  if (!state) { await interaction.reply({ content: "\u274C No changes to save.", ephemeral: true }); return; }

  const guildId = interaction.guild!.id;
  const existing = await db.select().from(botConfigTable).where(eq(botConfigTable.guildId, guildId)).limit(1);

  const updateData = {
    announcementsRoleId: state.announcementsRoleId ?? null,
    eventHosterRoleId:   state.eventHosterRoleId   ?? null,
    annLogsChannelId:    state.annLogsChannelId     ?? null,
    updatedAt: new Date(),
  };

  if (existing.length) {
    await db.update(botConfigTable).set(updateData).where(eq(botConfigTable.guildId, guildId));
  } else {
    await db.insert(botConfigTable).values({ guildId, ...updateData });
  }

  await interaction.update({
    embeds: [buildAnnPanelEmbed(state).setFooter({ text: "\u2705 Saved \u2014 Night Stars \u2022 Announcements" })],
    components: buildAnnPanelComponents(state),
  });
}

export async function handleAnnPanelReset(interaction: ButtonInteraction) {
  const userId = interaction.user.id;
  const guildId = interaction.guild!.id;
  const existing = await db.select().from(botConfigTable).where(eq(botConfigTable.guildId, guildId)).limit(1);
  if (existing.length) {
    await db.update(botConfigTable).set({
      announcementsRoleId: null,
      eventHosterRoleId:   null,
      annLogsChannelId:    null,
      updatedAt: new Date(),
    }).where(eq(botConfigTable.guildId, guildId));
  }
  const state: AnnPanelState = {};
  annPanelState.set(userId, state);
  if (typeof interaction.update === "function") {
    await interaction.update({ embeds: [buildAnnPanelEmbed(state)], components: buildAnnPanelComponents(state) });
  } else {
    await interaction.editReply({ embeds: [buildAnnPanelEmbed(state)], components: buildAnnPanelComponents(state) });
  }
}

export async function openAnnColorPanel(interaction: ButtonInteraction) {
  await interaction.update({ embeds: [buildColorPanelEmbed()], components: buildColorPanelComponents() });
}

export async function openAnnColorModal(interaction: ButtonInteraction, type: string) {
  const labels: Record<string, string> = {
    ann_title: "Ann \u2014 Title hex color",
    ann_desc:  "Ann \u2014 Description hex color",
    ann_add:   "Ann \u2014 Additional hex color",
    event:     "Event hex color",
  };
  const modal = new ModalBuilder()
    .setCustomId(`ap_modal_color:${type}`)
    .setTitle(labels[type] ?? "Set Color");
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("hex_color")
        .setLabel("Hex color (e.g. FFE500)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(7)
        .setPlaceholder("FFE500")
    )
  );
  await interaction.showModal(modal);
}

export async function handleAnnColorModalSubmit(interaction: ModalSubmitInteraction, type: string) {
  const raw = interaction.fields.getTextInputValue("hex_color").replace("#", "").trim().toUpperCase();
  const num = parseInt(raw, 16);
  if (isNaN(num) || raw.length < 3 || raw.length > 6) {
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(0x5000ff).setDescription("\u274C Invalid hex color. Use something like `FFE500` or `#FFE500`.")],
      ephemeral: true,
    });
    return;
  }
  const guildId = interaction.guild!.id;
  const updateData =
    type === "ann_title" ? { annTitleColor: raw, updatedAt: new Date() } :
    type === "ann_desc"  ? { annDescColor:  raw, updatedAt: new Date() } :
    type === "ann_add"   ? { annAddColor:   raw, updatedAt: new Date() } :
                           { eventColor:    raw, updatedAt: new Date() };
  const insertData =
    type === "ann_title" ? { guildId, annTitleColor: raw } :
    type === "ann_desc"  ? { guildId, annDescColor:  raw } :
    type === "ann_add"   ? { guildId, annAddColor:   raw } :
                           { guildId, eventColor:    raw };
  const existing = await db.select().from(botConfigTable).where(eq(botConfigTable.guildId, guildId)).limit(1);
  if (existing.length) {
    await db.update(botConfigTable).set(updateData).where(eq(botConfigTable.guildId, guildId));
  } else {
    await db.insert(botConfigTable).values(insertData);
  }
  const labels: Record<string, string> = {
    ann_title: "Ann \u2014 Title",
    ann_desc:  "Ann \u2014 Description",
    ann_add:   "Ann \u2014 Additional",
    event:     "Event",
  };
  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(num)
        .setDescription(`\u2705 **${labels[type] ?? type}** color set to \`#${raw}\``)
        .setFooter({ text: "Night Stars \u2022 Announcements" }),
    ],
    ephemeral: true,
  });
}

export async function handleAnnColorBack(interaction: ButtonInteraction) {
  const state = annPanelState.get(interaction.user.id) ?? {};
  if (typeof interaction.update === "function") {
    await interaction.update({ embeds: [buildAnnPanelEmbed(state)], components: buildAnnPanelComponents(state) });
  } else {
    await interaction.editReply({ embeds: [buildAnnPanelEmbed(state)], components: buildAnnPanelComponents(state) });
  }
}
