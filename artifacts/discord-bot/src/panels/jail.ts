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

// ── Per-user editing state ───────────────────────────────────────────────────
interface JailPanelState {
  hammerRoleIds: string[];
  jailRoleIds: string[];
  memberRoleId?: string;
  logsChannelId?: string;
}

export const jailPanelState = new Map<string, JailPanelState>();

const BRAND = 0x5000ff;

function fmtRoles(ids: string[]): string {
  if (!ids.length) return "_not set_";
  return ids.map((id) => `<@&${id}>`).join(" ");
}
function fmtRole(id?: string): string {
  return id ? `<@&${id}>` : "_not set_";
}
function fmtChan(id?: string): string {
  return id ? `<#${id}>` : "_not set_";
}

function buildJailPanelEmbed(state: JailPanelState): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(BRAND)
    .setTitle("🔒 Jail System — Setup")
    .setDescription(
      [
        "Pick or change any item below — your choices update live. Click **Save** when you're done.",
        "",
        `**Hammer Roles** — ${fmtRoles(state.hammerRoleIds)}`,
        "_Members with any of these roles can use_ `=jail` _and_ `=unjail`_._",
        "",
        `**Jailed Roles** — ${fmtRoles(state.jailRoleIds)}`,
        "_Roles applied to a member when they get jailed (all of them are added)._",
        "",
        `**Member Role** — ${fmtRole(state.memberRoleId)}`,
        "_The role restored when a member is unjailed._",
        "",
        `**Jail Logs** — ${fmtChan(state.logsChannelId)}`,
        "_Channel where jail / unjail events are posted._",
      ].join("\n"),
    )
    .setFooter({ text: "Night Stars • Jail" });
}

function buildJailPanelComponents(state: JailPanelState) {
  const row1 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("jp_hammer_roles")
      .setPlaceholder(
        state.hammerRoleIds.length
          ? `Hammer Roles (${state.hammerRoleIds.length} selected) — pick again to replace`
          : "Pick Hammer Roles (one or many)…",
      )
      .setMinValues(0)
      .setMaxValues(10),
  );

  const row2 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("jp_jail_roles")
      .setPlaceholder(
        state.jailRoleIds.length
          ? `Jailed Roles (${state.jailRoleIds.length} selected) — pick again to replace`
          : "Pick Jailed Roles (one or many)…",
      )
      .setMinValues(0)
      .setMaxValues(10),
  );

  const row3 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("jp_member_role")
      .setPlaceholder(state.memberRoleId ? "Member Role (set) — pick to change" : "Pick the Member Role…")
      .setMinValues(0)
      .setMaxValues(1),
  );

  const row4 = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("jp_logs_channel")
      .setPlaceholder(state.logsChannelId ? "Jail Logs Channel (set) — pick to change" : "Pick the Jail Logs channel…")
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

  const hammerRoleIds = parseJailRoleIdsJson(cfg?.jailHammerRoleIdsJson)
    .concat(cfg?.jailHammerRoleId && !parseJailRoleIdsJson(cfg.jailHammerRoleIdsJson).length ? [cfg.jailHammerRoleId] : []);
  const jailRoleIds = parseJailRoleIdsJson(cfg?.jailRoleIdsJson)
    .concat(cfg?.jailRoleId && !parseJailRoleIdsJson(cfg.jailRoleIdsJson).length ? [cfg.jailRoleId] : []);

  const state: JailPanelState = {
    hammerRoleIds: [...new Set(hammerRoleIds)],
    jailRoleIds:   [...new Set(jailRoleIds)],
    memberRoleId:  cfg?.memberRoleId ?? undefined,
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
  const state = jailPanelState.get(userId) ?? { hammerRoleIds: [], jailRoleIds: [] };

  if (interaction.customId === "jp_hammer_roles") {
    state.hammerRoleIds = [...interaction.values];
  } else if (interaction.customId === "jp_jail_roles") {
    state.jailRoleIds = [...interaction.values];
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
  const state = jailPanelState.get(userId) ?? { hammerRoleIds: [], jailRoleIds: [] };

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
  const state = jailPanelState.get(userId) ?? { hammerRoleIds: [], jailRoleIds: [] };
  const guildId = interaction.guild!.id;

  if (!state.hammerRoleIds.length || !state.jailRoleIds.length || !state.memberRoleId) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xff4d4d)
          .setDescription(
            "❌ You still need to set:\n" +
            (state.hammerRoleIds.length ? "" : "• at least one **Hammer Role**\n") +
            (state.jailRoleIds.length ? "" : "• at least one **Jailed Role**\n") +
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
    jailRoleId: state.jailRoleIds[0],
    jailRoleIdsJson: JSON.stringify(state.jailRoleIds),
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
        .setTitle("✅ Jail System Saved")
        .setDescription(
          [
            `**Hammer Roles** — ${fmtRoles(state.hammerRoleIds)}`,
            `**Jailed Roles** — ${fmtRoles(state.jailRoleIds)}`,
            `**Member Role** — ${fmtRole(state.memberRoleId)}`,
            `**Jail Logs** — ${fmtChan(state.logsChannelId)}`,
            "",
            "Hammers can now use `=jail @user reason` and `=unjail @user`.",
          ].join("\n"),
        )
        .setFooter({ text: "Night Stars • Jail" }),
    ],
    components: [],
  });
}

export async function handleJailPanelReset(interaction: ButtonInteraction): Promise<void> {
  const state: JailPanelState = { hammerRoleIds: [], jailRoleIds: [] };
  jailPanelState.set(interaction.user.id, state);
  await interaction.update({
    embeds: [buildJailPanelEmbed(state)],
    components: buildJailPanelComponents(state),
  });
}
