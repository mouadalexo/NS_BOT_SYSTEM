import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionsBitField,
  RoleSelectMenuBuilder,
  RoleSelectMenuInteraction,
} from "discord.js";
import { pool } from "@workspace/db";
import { findButton, findButtonRow, registerFindHandler } from "./findHelper.js";

const TITLE_COLOR = 0x5000ff;

type ClearPanelState = {
  roles: string[];
};

const clearPanelState = new Map<string, ClearPanelState>();

function parseList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === "string");
  } catch {}
  return [];
}

async function loadClearConfig(guildId: string): Promise<ClearPanelState> {
  const result = await pool.query<{ clear_role_ids_json: string | null }>(
    "select clear_role_ids_json from bot_config where guild_id = $1 limit 1",
    [guildId],
  );
  return { roles: parseList(result.rows[0]?.clear_role_ids_json) };
}

function fmtRoles(ids: string[]): string {
  if (!ids.length) return "_none_";
  return ids.map((id) => `<@&${id}>`).join(", ");
}

function buildEmbed(state: ClearPanelState): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(TITLE_COLOR)
    .setTitle("\uD83E\uDDF9 Clear Setup")
    .setDescription(
      [
        "Configure who can use **`mse7 N`** to clear up to 99 messages at a time.",
        "",
        `**Allowed roles** \u2014 ${fmtRoles(state.roles)}`,
        "",
        "**Auto-allowed:**",
        "\u2002\u2022 **Administrators** \u2014 always allowed",
        "",
        "Pick the roles below, then click **Save**. Use **Preview Config** to see what's currently saved in the database.",
      ].join("\n"),
    )
    .setFooter({ text: "Night Stars \u2022 Clear" });
}

function buildComponents(state: ClearPanelState) {
  const rolesRow = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("cl_roles")
      .setPlaceholder(
        state.roles.length
          ? `\u2705 ${state.roles.length} role(s) selected`
          : "Select roles allowed to use mse7\u2026",
      )
      .setMinValues(0)
      .setMaxValues(10)
      .setDefaultRoles(state.roles.slice(0, 10)),
  );

  const findRow = findButtonRow(findButton("clear", "addRole", "role", "Find & Add Role"));

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("cl_save").setLabel("Save").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("cl_preview").setLabel("Preview Config").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("cl_reset").setLabel("Reset").setStyle(ButtonStyle.Danger),
  );

  return [rolesRow, findRow, actionRow];
}

registerFindHandler("clear", async (interaction, fieldKey, selectedId) => {
  const state = getOrInitState(interaction.user.id);
  if (fieldKey === "addRole") {
    if (!state.roles.includes(selectedId)) {
      if (state.roles.length >= 10) {
        await interaction.update({
          embeds: [
            new EmbedBuilder()
              .setColor(0xff5050)
              .setTitle("Limit reached")
              .setDescription("You already have 10 roles selected. Remove one in the picker above before adding more."),
          ],
          components: [],
        });
        return;
      }
      state.roles.push(selectedId);
    }
  }
  await interaction.update(render(state));
});

function render(state: ClearPanelState) {
  return { embeds: [buildEmbed(state)], components: buildComponents(state) };
}

function getOrInitState(userId: string): ClearPanelState {
  const existing = clearPanelState.get(userId);
  if (existing) return existing;
  const fresh: ClearPanelState = { roles: [] };
  clearPanelState.set(userId, fresh);
  return fresh;
}

export async function openClearPanel(interaction: ChatInputCommandInteraction | ButtonInteraction) {
  if (!interaction.guildId) return;
  if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
    const payload = {
      embeds: [new EmbedBuilder().setColor(TITLE_COLOR).setDescription("\u274C You need **Administrator** permission to use this.")],
      ephemeral: true as const,
    };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ embeds: payload.embeds });
    } else {
      await interaction.reply(payload);
    }
    return;
  }

  const cfg = await loadClearConfig(interaction.guildId);
  clearPanelState.set(interaction.user.id, cfg);

  const payload = render(cfg);
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload);
  } else {
    await interaction.reply({ ...payload, ephemeral: true });
  }
}

export async function handleClearRolesSelect(interaction: RoleSelectMenuInteraction) {
  const state = getOrInitState(interaction.user.id);
  state.roles = [...new Set(interaction.values)];
  await interaction.update(render(state));
}

export async function handleClearPanelSave(interaction: ButtonInteraction) {
  if (!interaction.guildId) return;
  const state = getOrInitState(interaction.user.id);

  await pool.query(
    `insert into bot_config (guild_id, clear_role_ids_json, updated_at)
     values ($1, $2, now())
     on conflict (guild_id) do update
       set clear_role_ids_json = excluded.clear_role_ids_json,
           updated_at = now()`,
    [interaction.guildId, JSON.stringify(state.roles)],
  );

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x00c851)
        .setTitle("\u2705 Clear Roles Saved")
        .setDescription(
          `Members with these roles can now use \`mse7 N\` (max 99):\n${fmtRoles(state.roles)}\n\nAdmins can always use it.`,
        )
        .setFooter({ text: "Night Stars \u2022 Clear" }),
    ],
    ephemeral: true,
  });
}

export async function handleClearPanelReset(interaction: ButtonInteraction) {
  const state = getOrInitState(interaction.user.id);
  state.roles = [];
  await interaction.update(render(state));
}

export async function handleClearPanelPreview(interaction: ButtonInteraction) {
  if (!interaction.guildId) return;
  const saved = await loadClearConfig(interaction.guildId);
  const state = getOrInitState(interaction.user.id);

  const matches =
    saved.roles.length === state.roles.length &&
    saved.roles.every((v) => state.roles.includes(v));

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(TITLE_COLOR)
        .setTitle("\uD83D\uDC41\uFE0F Current Saved Config")
        .setDescription(
          [
            `**Allowed roles** \u2014 ${fmtRoles(saved.roles)}`,
            "",
            matches
              ? "\u2705 Your panel matches the saved config."
              : "\u26A0\uFE0F Your panel selections differ from what's saved \u2014 click **Save** to apply them.",
          ].join("\n"),
        )
        .setFooter({ text: "Night Stars \u2022 Clear \u2022 Preview" }),
    ],
    ephemeral: true,
  });
}
