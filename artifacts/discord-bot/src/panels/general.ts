import {
  ButtonInteraction,
  RoleSelectMenuInteraction,
  ChannelSelectMenuInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
} from "discord.js";
import { db } from "@workspace/db";
import { botConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";

interface GeneralPanelState {
  coreRoleId?: string;
  blockedChannels: string[];
  staffRoleIds: string[];
  eventHosterRoleId?: string;
}

export const generalPanelState = new Map<string, GeneralPanelState>();

function buildGeneralPanelEmbed(state: GeneralPanelState) {
  const blockedList = state.blockedChannels.length
    ? state.blockedChannels.map(id => `<#${id}>`).join(", ")
    : "none";

  const staffList = state.staffRoleIds.length
    ? state.staffRoleIds.map(id => `<@&${id}>`).join(", ")
    : "everyone (no restriction)";

  return new EmbedBuilder()
    .setColor(0x5000ff)
    .setTitle("\u2699\uFE0F General Setup")
    .setDescription(
      `**Core Role** \u2014 ${state.coreRoleId ? `<@&${state.coreRoleId}>` : "not set"}\n` +
      "\u2514 Bypasses all permission checks across PVS\n\n" +
      `**Staff Role** \u2014 ${staffList}\n` +
      "\u2514 Only these roles can use `/help` (Admins and Core Role always bypass)\n\n" +
      `**Event Hoster Role** \u2014 ${state.eventHosterRoleId ? `<@&${state.eventHosterRoleId}>` : "not set"}\n` +
      "\u2514 Can use `=stagelock` / `=stageunlock` and host event announcements\n\n" +
      `**Blocked Channels** \u2014 ${blockedList}\n` +
      "\u2514 NS Bot text commands will not work in these channels"
    )
    .setFooter({ text: "Night Stars \u2022 General Setup" });
}

function buildGeneralPanelComponents(state: GeneralPanelState) {
  const canSave = !!(state.coreRoleId || state.blockedChannels.length || state.staffRoleIds.length || state.eventHosterRoleId);

  const row1 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("gp_staff_role")
      .setPlaceholder(state.coreRoleId ? "\u2705 Core Role (set)" : "Select Core Role\u2026")
      .setMinValues(1)
      .setMaxValues(1)
  );

  const row2 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("gp_help_roles")
      .setPlaceholder(
        state.staffRoleIds.length
          ? `\u2705 ${state.staffRoleIds.length} Staff Role(s) selected`
          : "Select Staff Role (can use /help)\u2026"
      )
      .setMinValues(0)
      .setMaxValues(10)
  );

  const row3 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("gp_event_hoster")
      .setPlaceholder(
        state.eventHosterRoleId
          ? "\u2705 Event Hoster Role (set)"
          : "Select Event Hoster Role\u2026"
      )
      .setMinValues(0)
      .setMaxValues(1)
  );

  const row4 = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("gp_blocked_ch")
      .setPlaceholder(
        state.blockedChannels.length
          ? `\u2705 ${state.blockedChannels.length} channel(s) blocked`
          : "Block channels (text commands won\u2019t work here)\u2026"
      )
      .addChannelTypes(ChannelType.GuildText)
      .setMinValues(0)
      .setMaxValues(25)
  );

  const row5 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("gp_save")
      .setLabel("Save")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!canSave),
    new ButtonBuilder()
      .setCustomId("gp_reset")
      .setLabel("Reset")
      .setStyle(ButtonStyle.Danger),
  );

  return [row1, row2, row3, row4, row5];
}

export async function openGeneralSetupPanel(interaction: ButtonInteraction) {
  const userId = interaction.user.id;

  const config = await db
    .select()
    .from(botConfigTable)
    .where(eq(botConfigTable.guildId, interaction.guild!.id))
    .limit(1);

  const row = config[0];
  let blocked: string[] = [];
  if (row?.blockedChannelsJson) {
    try { blocked = JSON.parse(row.blockedChannelsJson); } catch {}
  }

  let staffRoles: string[] = [];
  if (row?.helpRoleIdsJson) {
    try { staffRoles = JSON.parse(row.helpRoleIdsJson); } catch {}
  }

  const state: GeneralPanelState = {
    coreRoleId: row?.staffRoleId ?? undefined,
    blockedChannels: blocked,
    staffRoleIds: staffRoles,
    eventHosterRoleId: row?.eventHosterRoleId ?? undefined,
  };
  generalPanelState.set(userId, state);

  const payload = {
    embeds: [buildGeneralPanelEmbed(state)],
    components: buildGeneralPanelComponents(state),
  };

  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload);
  } else {
    await interaction.reply({ ...payload, ephemeral: true });
  }
}

export async function handleGeneralStaffRoleSelect(interaction: RoleSelectMenuInteraction) {
  const userId = interaction.user.id;
  const state = generalPanelState.get(userId) ?? { blockedChannels: [], staffRoleIds: [] };
  state.coreRoleId = interaction.values[0];
  generalPanelState.set(userId, state);
  await interaction.update({
    embeds: [buildGeneralPanelEmbed(state)],
    components: buildGeneralPanelComponents(state),
  });
}

export async function handleGeneralHelpRolesSelect(interaction: RoleSelectMenuInteraction) {
  const userId = interaction.user.id;
  const state = generalPanelState.get(userId) ?? { blockedChannels: [], staffRoleIds: [] };
  state.staffRoleIds = interaction.values;
  generalPanelState.set(userId, state);
  await interaction.update({
    embeds: [buildGeneralPanelEmbed(state)],
    components: buildGeneralPanelComponents(state),
  });
}

export async function handleGeneralEventHosterSelect(interaction: RoleSelectMenuInteraction) {
  const userId = interaction.user.id;
  const state = generalPanelState.get(userId) ?? { blockedChannels: [], staffRoleIds: [] };
  state.eventHosterRoleId = interaction.values[0];
  generalPanelState.set(userId, state);
  await interaction.update({
    embeds: [buildGeneralPanelEmbed(state)],
    components: buildGeneralPanelComponents(state),
  });
}

export async function handleGeneralBlockedChSelect(interaction: ChannelSelectMenuInteraction) {
  const userId = interaction.user.id;
  const state = generalPanelState.get(userId) ?? { blockedChannels: [], staffRoleIds: [] };
  state.blockedChannels = interaction.values;
  generalPanelState.set(userId, state);
  await interaction.update({
    embeds: [buildGeneralPanelEmbed(state)],
    components: buildGeneralPanelComponents(state),
  });
}

export async function handleGeneralPanelSave(interaction: ButtonInteraction) {
  const userId = interaction.user.id;
  const state = generalPanelState.get(userId) ?? { blockedChannels: [], staffRoleIds: [] };
  const guildId = interaction.guild!.id;

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (state.coreRoleId) updateData.staffRoleId = state.coreRoleId;
  updateData.blockedChannelsJson = JSON.stringify(state.blockedChannels);
  updateData.helpRoleIdsJson = JSON.stringify(state.staffRoleIds);
  updateData.eventHosterRoleId = state.eventHosterRoleId ?? null;

  const existing = await db.select().from(botConfigTable).where(eq(botConfigTable.guildId, guildId)).limit(1);
  if (existing.length) {
    await db.update(botConfigTable).set(updateData as Parameters<typeof db.update>[0]).where(eq(botConfigTable.guildId, guildId));
  } else {
    await db.insert(botConfigTable).values({
      guildId,
      staffRoleId: state.coreRoleId,
      blockedChannelsJson: JSON.stringify(state.blockedChannels),
      helpRoleIdsJson: JSON.stringify(state.staffRoleIds),
      eventHosterRoleId: state.eventHosterRoleId ?? null,
    });
  }

  generalPanelState.delete(userId);

  const blockedList = state.blockedChannels.length
    ? state.blockedChannels.map(id => `<#${id}>`).join(", ")
    : "none";

  const staffList = state.staffRoleIds.length
    ? state.staffRoleIds.map(id => `<@&${id}>`).join(", ")
    : "everyone (no restriction)";

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(0x00c851)
        .setTitle("\u2705 General Setup Saved")
        .setDescription(
          `**Core Role** \u2014 ${state.coreRoleId ? `<@&${state.coreRoleId}>` : "not set"}\n` +
          `**Staff Role** \u2014 ${staffList}\n` +
          `**Event Hoster Role** \u2014 ${state.eventHosterRoleId ? `<@&${state.eventHosterRoleId}>` : "not set"}\n` +
          `**Blocked Channels** \u2014 ${blockedList}`
        )
        .setFooter({ text: "Night Stars \u2022 General Setup" }),
    ],
    components: [],
  });
}

export async function handleGeneralPanelReset(interaction: ButtonInteraction) {
  const state: GeneralPanelState = { blockedChannels: [], staffRoleIds: [] };
  generalPanelState.set(interaction.user.id, state);
  await interaction.update({
    embeds: [buildGeneralPanelEmbed(state)],
    components: buildGeneralPanelComponents(state),
  });
}

export async function isChannelBlocked(guildId: string, channelId: string): Promise<boolean> {
  const [cfg] = await db
    .select({ blockedChannelsJson: botConfigTable.blockedChannelsJson })
    .from(botConfigTable)
    .where(eq(botConfigTable.guildId, guildId))
    .limit(1);
  if (!cfg?.blockedChannelsJson) return false;
  try {
    const list = JSON.parse(cfg.blockedChannelsJson) as string[];
    return list.includes(channelId);
  } catch { return false; }
}

export async function getHelpRoleIds(guildId: string): Promise<string[]> {
  const [cfg] = await db
    .select()
    .from(botConfigTable)
    .where(eq(botConfigTable.guildId, guildId))
    .limit(1);
  if (!cfg?.helpRoleIdsJson) return [];
  try { return JSON.parse(cfg.helpRoleIdsJson) as string[]; } catch { return []; }
}

export async function getStaffRoleId(guildId: string): Promise<string | null> {
  const [cfg] = await db
    .select({ staffRoleId: botConfigTable.staffRoleId })
    .from(botConfigTable)
    .where(eq(botConfigTable.guildId, guildId))
    .limit(1);
  return cfg?.staffRoleId ?? null;
}
