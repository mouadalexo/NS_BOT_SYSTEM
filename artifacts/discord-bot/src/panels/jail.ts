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

interface JailPanelState {
  hammerRoleIds: string[];
  jailRoleId?: string;
  memberRoleId?: string;
  logsChannelId?: string;
}

export const jailPanelState = new Map<string, JailPanelState>();

const BRAND = 0x5000ff;

function fmtRoles(ids: string[]): string {
  if (!ids.length) return "`—`";
  return ids.map((id) => `<@&${id}>`).join(" ");
}
function fmtRole(id?: string): string {
  return id ? `<@&${id}>` : "`—`";
}
function fmtChan(id?: string): string {
  return id ? `<#${id}>` : "`—`";
}

function buildJailPanelEmbed(state: JailPanelState): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(BRAND)
    .setTitle("🔒 Jail — Setup")
    .setDescription(
      [
        `**Hammers** ${fmtRoles(state.hammerRoleIds)}`,
        `**Jail Role** ${fmtRole(state.jailRoleId)}`,
        `**Member Role** ${fmtRole(state.memberRoleId)}`,
        `**Logs** ${fmtChan(state.logsChannelId)}`,
      ].join("\n"),
    )
    .setFooter({ text: "Hammers add up • Reset clears all" });
}

function buildJailPanelComponents(state: JailPanelState) {
  const row1 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("jp_hammer_roles")
      .setPlaceholder("Hammer roles")
      .setMinValues(0)
      .setMaxValues(10),
  );

  const row2 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("jp_jail_role")
      .setPlaceholder("Jail role")
      .setMinValues(0)
      .setMaxValues(1),
  );

  const row3 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("jp_member_role")
      .setPlaceholder("Member role")
      .setMinValues(0)
      .setMaxValues(1),
  );

  const row4 = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("jp_logs_channel")
      .setPlaceholder("Logs channel")
      .addChannelTypes(ChannelType.GuildText)
      .setMinValues(0)
      .setMaxValues(1),
  );

  const row5 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("jp_save").setLabel("Save").setEmoji("💾").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("jp_reset").setLabel("Reset").setEmoji("🧹").setStyle(ButtonStyle.Danger),
  );

  return [row1, row2, row3, row4, row5];
}

function parseJailRoleIdsJson(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === "string");
  } catch {}
  return [];
}

export async function openJailPanel(interaction: ButtonInteraction): Promise<void> {
  const userId = interaction.user.id;
  const guildId = interaction.guild!.id;

  const [cfg] = await db
    .select()
    .from(botConfigTable)
    .where(eq(botConfigTable.guildId, guildId))
    .limit(1);

  const hammerJson = parseJailRoleIdsJson(cfg?.jailHammerRoleIdsJson);
  const hammerRoleIds = hammerJson.length
    ? hammerJson
    : cfg?.jailHammerRoleId
      ? [cfg.jailHammerRoleId]
      : [];

  const jailJson = parseJailRoleIdsJson(cfg?.jailRoleIdsJson);
  const jailRoleId = jailJson[0] ?? cfg?.jailRoleId ?? undefined;

  const state: JailPanelState = {
    hammerRoleIds: [...new Set(hammerRoleIds)],
    jailRoleId,
    memberRoleId: cfg?.memberRoleId ?? undefined,
    logsChannelId: cfg?.jailLogsChannelId ?? undefined,
  };
  jailPanelState.set(userId, state);

  const payload = {
    embeds: [buildJailPanelEmbed(state)],
    components: buildJailPanelComponents(state),
  };

  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload);
    return;
  }
  await interaction.reply({ ...payload, ephemeral: true });
}

export async function handleJailPanelRoleSelect(interaction: RoleSelectMenuInteraction): Promise<void> {
  const userId = interaction.user.id;
  const state = jailPanelState.get(userId) ?? { hammerRoleIds: [] };

  if (interaction.customId === "jp_hammer_roles") {
    state.hammerRoleIds = [...new Set([...state.hammerRoleIds, ...interaction.values])];
  } else if (interaction.customId === "jp_jail_role") {
    state.jailRoleId = interaction.values[0] ?? undefined;
  } else if (interaction.customId === "jp_member_role") {
    state.memberRoleId = interaction.values[0] ?? undefined;
  }
  jailPanelState.set(userId, state);

  await interaction.update({
    embeds: [buildJailPanelEmbed(state)],
    components: buildJailPanelComponents(state),
  });
}

export async function handleJailPanelChannelSelect(interaction: ChannelSelectMenuInteraction): Promise<void> {
  const userId = interaction.user.id;
  const state = jailPanelState.get(userId) ?? { hammerRoleIds: [] };

  if (interaction.customId === "jp_logs_channel") {
    state.logsChannelId = interaction.values[0] ?? undefined;
  }
  jailPanelState.set(userId, state);

  await interaction.update({
    embeds: [buildJailPanelEmbed(state)],
    components: buildJailPanelComponents(state),
  });
}

export async function handleJailPanelSave(interaction: ButtonInteraction): Promise<void> {
  const userId = interaction.user.id;
  const state = jailPanelState.get(userId) ?? { hammerRoleIds: [] };
  const guildId = interaction.guild!.id;

  if (!state.hammerRoleIds.length || !state.jailRoleId || !state.memberRoleId) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xff4d4d)
          .setDescription(
            "❌ Still missing:\n" +
            (state.hammerRoleIds.length ? "" : "• at least one **Hammer**\n") +
            (state.jailRoleId ? "" : "• the **Jail Role**\n") +
            (state.memberRoleId ? "" : "• the **Member Role**"),
          ),
      ],
      ephemeral: true,
    });
    return;
  }

  const values = {
    jailHammerRoleId: state.hammerRoleIds[0],
    jailHammerRoleIdsJson: JSON.stringify(state.hammerRoleIds),
    jailRoleId: state.jailRoleId,
    jailRoleIdsJson: JSON.stringify([state.jailRoleId]),
    memberRoleId: state.memberRoleId,
    jailLogsChannelId: state.logsChannelId ?? null,
    updatedAt: new Date(),
  };

  const existing = await db
    .select({ id: botConfigTable.id })
    .from(botConfigTable)
    .where(eq(botConfigTable.guildId, guildId))
    .limit(1);

  if (existing.length) {
    await db.update(botConfigTable).set(values).where(eq(botConfigTable.guildId, guildId));
  } else {
    await db.insert(botConfigTable).values({ guildId, ...values });
  }

  jailPanelState.delete(userId);

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(0x00c851)
        .setTitle("✅ Jail Saved")
        .setDescription(
          [
            `**Hammers** ${fmtRoles(state.hammerRoleIds)}`,
            `**Jail Role** ${fmtRole(state.jailRoleId)}`,
            `**Member Role** ${fmtRole(state.memberRoleId)}`,
            `**Logs** ${fmtChan(state.logsChannelId)}`,
          ].join("\n"),
        )
        .setFooter({ text: "Night Stars • Jail" }),
    ],
    components: [],
  });
}

export async function handleJailPanelReset(interaction: ButtonInteraction): Promise<void> {
  const state: JailPanelState = { hammerRoleIds: [] };
  jailPanelState.set(interaction.user.id, state);
  await interaction.update({
    embeds: [buildJailPanelEmbed(state)],
    components: buildJailPanelComponents(state),
  });
}
