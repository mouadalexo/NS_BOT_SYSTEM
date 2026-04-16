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

interface JailPanelState {
  jailRoleId?: string;
  memberRoleId?: string;
}

export const jailPanelState = new Map<string, JailPanelState>();

function buildJailPanelEmbed(state: JailPanelState) {
  return new EmbedBuilder()
    .setColor(0x5000ff)
    .setTitle("🔒 Jail System Setup")
    .setDescription(
      "Configure the roles used by the moderation jail system.\n\n" +
      `**Jail Role** — ${state.jailRoleId ? `<@&${state.jailRoleId}>` : "not set"}\n` +
      "└ Given when staff uses `=jail @user reason`\n\n" +
      `**Member Role** — ${state.memberRoleId ? `<@&${state.memberRoleId}>` : "not set"}\n` +
      "└ Restored when staff uses `=unjail @user`\n\n" +
      "**Commands**\n" +
      "`=jail @user reason` — clear roles, add jail role, delete last 7 days of messages\n" +
      "`=unjail @user` — remove jail role and restore member role"
    )
    .setFooter({ text: "Night Stars • Jail System" })
    .setTimestamp();
}

function buildJailPanelComponents(state: JailPanelState) {
  const canSave = !!(state.jailRoleId && state.memberRoleId);

  const row1 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("jp_jail_role")
      .setPlaceholder(state.jailRoleId ? "✅ Jail Role selected" : "Select Jail Role…")
      .setMinValues(1)
      .setMaxValues(1),
  );

  const row2 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("jp_member_role")
      .setPlaceholder(state.memberRoleId ? "✅ Member Role selected" : "Select Member Role…")
      .setMinValues(1)
      .setMaxValues(1),
  );

  const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("jp_save")
      .setLabel("Save Jail Setup")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!canSave),
    new ButtonBuilder()
      .setCustomId("jp_reset")
      .setLabel("Reset")
      .setStyle(ButtonStyle.Danger),
  );

  return [row1, row2, row3];
}

export async function openJailPanel(interaction: ButtonInteraction) {
  const userId = interaction.user.id;
  const rows = await db
    .select()
    .from(botConfigTable)
    .where(eq(botConfigTable.guildId, interaction.guild!.id))
    .limit(1);

  const state: JailPanelState = {
    jailRoleId: rows[0]?.jailRoleId ?? undefined,
    memberRoleId: rows[0]?.memberRoleId ?? undefined,
  };
  jailPanelState.set(userId, state);

  const payload = {
    embeds: [buildJailPanelEmbed(state)],
    components: buildJailPanelComponents(state),
  };

  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload);
  } else {
    await interaction.reply({ ...payload, ephemeral: true });
  }
}

export async function handleJailRoleSelect(interaction: RoleSelectMenuInteraction) {
  const state = jailPanelState.get(interaction.user.id) ?? {};
  state.jailRoleId = interaction.values[0];
  jailPanelState.set(interaction.user.id, state);
  await interaction.update({
    embeds: [buildJailPanelEmbed(state)],
    components: buildJailPanelComponents(state),
  });
}

export async function handleJailMemberRoleSelect(interaction: RoleSelectMenuInteraction) {
  const state = jailPanelState.get(interaction.user.id) ?? {};
  state.memberRoleId = interaction.values[0];
  jailPanelState.set(interaction.user.id, state);
  await interaction.update({
    embeds: [buildJailPanelEmbed(state)],
    components: buildJailPanelComponents(state),
  });
}

export async function handleJailPanelSave(interaction: ButtonInteraction) {
  const state = jailPanelState.get(interaction.user.id) ?? {};
  const guildId = interaction.guild!.id;

  if (!state.jailRoleId || !state.memberRoleId) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xff4d4d)
          .setTitle("Setup incomplete")
          .setDescription("Please select both the **Jail Role** and the **Member Role** before saving."),
      ],
      ephemeral: true,
    });
    return;
  }

  const existing = await db.select().from(botConfigTable).where(eq(botConfigTable.guildId, guildId)).limit(1);
  if (existing.length) {
    await db
      .update(botConfigTable)
      .set({
        jailRoleId: state.jailRoleId,
        memberRoleId: state.memberRoleId,
        updatedAt: new Date(),
      })
      .where(eq(botConfigTable.guildId, guildId));
  } else {
    await db.insert(botConfigTable).values({
      guildId,
      jailRoleId: state.jailRoleId,
      memberRoleId: state.memberRoleId,
    });
  }

  jailPanelState.delete(interaction.user.id);

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(0x00c851)
        .setTitle("✅ Jail System Saved")
        .setDescription(
          `**Jail Role** — <@&${state.jailRoleId}>\n` +
          `**Member Role** — <@&${state.memberRoleId}>\n\n` +
          "Staff can now use `=jail @user reason` and `=unjail @user`."
        )
        .setFooter({ text: "Night Stars • Jail System" })
        .setTimestamp(),
    ],
    components: [],
  });
}

export async function handleJailPanelReset(interaction: ButtonInteraction) {
  const state: JailPanelState = {};
  jailPanelState.set(interaction.user.id, state);
  await interaction.update({
    embeds: [buildJailPanelEmbed(state)],
    components: buildJailPanelComponents(state),
  });
}