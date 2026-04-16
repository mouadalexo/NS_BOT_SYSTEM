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
  staffRoleId?: string;
  blockedChannels: string[];
  helpRoleIds: string[];
}

export const generalPanelState = new Map<string, GeneralPanelState>();

function buildGeneralPanelEmbed(state: GeneralPanelState) {
  const blockedList = state.blockedChannels.length
    ? state.blockedChannels.map(id => `<#${id}>`).join(", ")
    : "none";

  const helpList = state.helpRoleIds.length
    ? state.helpRoleIds.map(id => `<@&${id}>`).join(", ")
    : "everyone (no restriction)";

  return new EmbedBuilder()
    .setColor(0x5000ff)
    .setTitle("\u2699\uFE0F General Setup")
    .setDescription(
      `**Staff Role** \u2014 ${state.staffRoleId ? `<@&${state.staffRoleId}>` : "not set"}\n` +
      "\u2514 Bypasses all permission checks across PVS and CTP\n\n" +
      `**Help Roles** \u2014 ${helpList}\n` +
      "\u2514 Only these roles can use \`/help\` (Admins always bypass)\n\n" +
      `**Blocked Channels** \u2014 ${blockedList}\n` +
      "\u2514 NS Bot text commands will not work in these channels"
    )
    .setFooter({ text: "Night Stars \u2022 General Setup" });
}

function buildGeneralPanelComponents(state: GeneralPanelState) {
  const canSave = !!(state.staffRoleId || state.blockedChannels.length || state.helpRoleIds.length);

  const row1 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("gp_staff_role")
      .setPlaceholder(state.staffRoleId ? "\u2705 Staff Role (set)" : "Select Staff Role\u2026")
      .setMinValues(1)
      .setMaxValues(1)
  );

  const row2 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("gp_help_roles")
      .setPlaceholder(
        state.helpRoleIds.length
          ? `\u2705 ${state.helpRoleIds.length} Help Role(s) selected`
          : "Select Help Roles (can use /help)\u2026"
      )
      .setMinValues(0)
      .setMaxValues(10)
  );

  const row3 = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
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

  const row4 = new ActionRowBuilder<ButtonBuilder>().addComponents(
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

  return [row1, row2, row3, row4];
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

  let helpRoles: string[] = [];
  if ((row as any)?.helpRoleIdsJson) {
    try { helpRoles = JSON.parse((row as any).helpRoleIdsJson); } catch {}
  }

  const state: GeneralPanelState = {
    staffRoleId: row?.staffRoleId ?? undefined,
    blockedChannels: blocked,
    helpRoleIds: helpRoles,
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
  const state = generalPanelState.get(userId) ?? { blockedChannels: [], helpRoleIds: [] };
  state.staffRoleId = interaction.values[0];
  generalPanelState.set(userId, state);
  await interaction.update({
    embeds: [buildGeneralPanelEmbed(state)],
    components: buildGeneralPanelComponents(state),
  });
}

export async function handleGeneralHelpRolesSelect(interaction: RoleSelectMenuInteraction) {
  const userId = interaction.user.id;
  const state = generalPanelState.get(userId) ?? { blockedChannels: [], helpRoleIds: [] };
  state.helpRoleIds = interaction.values;
  generalPanelState.set(userId, state);
  await interaction.update({
    embeds: [buildGeneralPanelEmbed(state)],
    components: buildGeneralPanelComponents(state),
  });
}

export async function handleGeneralBlockedChSelect(interaction: ChannelSelectMenuInteraction) {
  const userId = interaction.user.id;
  const state = generalPanelState.get(userId) ?? { blockedChannels: [], helpRoleIds: [] };
  state.blockedChannels = interaction.values;
  generalPanelState.set(userId, state);
  await interaction.update({
    embeds: [buildGeneralPanelEmbed(state)],
    components: buildGeneralPanelComponents(state),
  });
}

export async function handleGeneralPanelSave(interaction: ButtonInteraction) {
  const userId = interaction.user.id;
  const state = generalPanelState.get(userId) ?? { blockedChannels: [], helpRoleIds: [] };
  const guildId = interaction.guild!.id;

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (state.staffRoleId) updateData.staffRoleId = state.staffRoleId;
  updateData.blockedChannelsJson = JSON.stringify(state.blockedChannels);
  (updateData as any).helpRoleIdsJson = JSON.stringify(state.helpRoleIds);

  const existing = await db.select().from(botConfigTable).where(eq(botConfigTable.guildId, guildId)).limit(1);
  if (existing.length) {
    await db.update(botConfigTable).set(updateData as Parameters<typeof db.update>[0]).where(eq(botConfigTable.guildId, guildId));
  } else {
    await db.insert(botConfigTable).values({
      guildId,
      staffRoleId: state.staffRoleId,
      blockedChannelsJson: JSON.stringify(state.blockedChannels),
    });
  }

  generalPanelState.delete(userId);

  const blockedList = state.blockedChannels.length
    ? state.blockedChannels.map(id => `<#${id}>`).join(", ")
    : "none";

  const helpList = state.helpRoleIds.length
    ? state.helpRoleIds.map(id => `<@&${id}>`).join(", ")
    : "everyone (no restriction)";

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(0x00c851)
        .setTitle("\u2705 General Setup Saved")
        .setDescription(
          `**Staff Role** \u2014 ${state.staffRoleId ? `<@&${state.staffRoleId}>` : "not set"}\n` +
          `**Help Roles** \u2014 ${helpList}\n` +
          `**Blocked Channels** \u2014 ${blockedList}`
        )
        .setFooter({ text: "Night Stars \u2022 General Setup" }),
    ],
    components: [],
  });
}

export async function handleGeneralPanelReset(interaction: ButtonInteraction) {
  const state: GeneralPanelState = { blockedChannels: [], helpRoleIds: [] };
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
  if (!(cfg as any)?.helpRoleIdsJson) return [];
  try { return JSON.parse((cfg as any).helpRoleIdsJson) as string[]; } catch { return []; }
}
