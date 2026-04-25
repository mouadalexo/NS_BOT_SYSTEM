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

const TITLE_COLOR = 0x5000ff;

type MovePanelState = {
  powerful: string[];
  confirmation: string[];
};

const movePanelState = new Map<string, MovePanelState>();

function parseList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === "string");
  } catch {}
  return [];
}

async function loadMoveConfig(guildId: string): Promise<MovePanelState> {
  const result = await pool.query<{
    move_role_ids_json: string | null;
    move_request_role_ids_json: string | null;
  }>(
    "select move_role_ids_json, move_request_role_ids_json from bot_config where guild_id = $1 limit 1",
    [guildId],
  );
  const row = result.rows[0];
  return {
    powerful: parseList(row?.move_role_ids_json),
    confirmation: parseList(row?.move_request_role_ids_json),
  };
}

function fmtRoles(ids: string[]): string {
  if (!ids.length) return "_none_";
  return ids.map((id) => `<@&${id}>`).join(", ");
}

function buildEmbed(state: MovePanelState): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(TITLE_COLOR)
    .setTitle("\uD83D\uDD04 Move Setup")
    .setDescription(
      [
        "Configure who can use **`aji @user`** to move members between voice channels.",
        "",
        `**\u26A1 Powerful (instant move)** \u2014 ${fmtRoles(state.powerful)}`,
        "\u2002\u2002Members with these roles move targets immediately, no confirmation.",
        "",
        `**\u2705 Confirmation (target accepts)** \u2014 ${fmtRoles(state.confirmation)}`,
        "\u2002\u2002Target gets accept/reject buttons before being moved.",
        "",
        "**Auto-allowed:**",
        "\u2002\u2022 **Administrators** \u2014 always treated as powerful",
        "\u2002\u2022 Members with the **Move Members** permission \u2014 auto-allowed for confirmation flow",
        "\u2002\u2022 **Couples** in the social system \u2014 can powerful-move each other instantly",
        "",
        "Pick roles in the menus below, then click **Save**. Use **Preview Config** to see what's currently saved in the database.",
      ].join("\n"),
    )
    .setFooter({ text: "Night Stars \u2022 Move" });
}

function buildComponents(state: MovePanelState) {
  const powerfulRow = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("mv_powerful_roles")
      .setPlaceholder(
        state.powerful.length
          ? `\u26A1 ${state.powerful.length} Powerful role(s) selected`
          : "Select Powerful roles (instant move)\u2026",
      )
      .setMinValues(0)
      .setMaxValues(10)
      .setDefaultRoles(state.powerful.slice(0, 10)),
  );

  const confirmationRow = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("mv_confirmation_roles")
      .setPlaceholder(
        state.confirmation.length
          ? `\u2705 ${state.confirmation.length} Confirmation role(s) selected`
          : "Select Confirmation roles (target accepts)\u2026",
      )
      .setMinValues(0)
      .setMaxValues(10)
      .setDefaultRoles(state.confirmation.slice(0, 10)),
  );

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("mv_save").setLabel("Save").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("mv_preview").setLabel("Preview Config").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("mv_reset").setLabel("Reset").setStyle(ButtonStyle.Danger),
  );

  return [powerfulRow, confirmationRow, actionRow];
}

function render(state: MovePanelState) {
  return { embeds: [buildEmbed(state)], components: buildComponents(state) };
}

function getOrInitState(userId: string): MovePanelState {
  const existing = movePanelState.get(userId);
  if (existing) return existing;
  const fresh: MovePanelState = { powerful: [], confirmation: [] };
  movePanelState.set(userId, fresh);
  return fresh;
}

export async function openMovePanel(interaction: ChatInputCommandInteraction | ButtonInteraction) {
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

  const cfg = await loadMoveConfig(interaction.guildId);
  movePanelState.set(interaction.user.id, cfg);

  const payload = render(cfg);
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload);
  } else {
    await interaction.reply({ ...payload, ephemeral: true });
  }
}

export async function handleMovePowerfulSelect(interaction: RoleSelectMenuInteraction) {
  const state = getOrInitState(interaction.user.id);
  state.powerful = [...new Set(interaction.values)];
  await interaction.update(render(state));
}

export async function handleMoveConfirmationSelect(interaction: RoleSelectMenuInteraction) {
  const state = getOrInitState(interaction.user.id);
  state.confirmation = [...new Set(interaction.values)];
  await interaction.update(render(state));
}

export async function handleMovePanelSave(interaction: ButtonInteraction) {
  if (!interaction.guildId) return;
  const state = getOrInitState(interaction.user.id);

  await pool.query(
    `insert into bot_config (guild_id, move_role_ids_json, move_request_role_ids_json, updated_at)
     values ($1, $2, $3, now())
     on conflict (guild_id) do update
       set move_role_ids_json = excluded.move_role_ids_json,
           move_request_role_ids_json = excluded.move_request_role_ids_json,
           updated_at = now()`,
    [interaction.guildId, JSON.stringify(state.powerful), JSON.stringify(state.confirmation)],
  );

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x00c851)
        .setTitle("\u2705 Move Roles Saved")
        .setDescription(
          `**\u26A1 Powerful (instant)** \u2014 ${fmtRoles(state.powerful)}\n` +
          `**\u2705 Confirmation (target accepts)** \u2014 ${fmtRoles(state.confirmation)}`,
        )
        .setFooter({ text: "Night Stars \u2022 Move" }),
    ],
    ephemeral: true,
  });
}

export async function handleMovePanelReset(interaction: ButtonInteraction) {
  const state = getOrInitState(interaction.user.id);
  state.powerful = [];
  state.confirmation = [];
  await interaction.update(render(state));
}

export async function handleMovePanelPreview(interaction: ButtonInteraction) {
  if (!interaction.guildId) return;
  const saved = await loadMoveConfig(interaction.guildId);
  const state = getOrInitState(interaction.user.id);

  const diff = (a: string[], b: string[]) =>
    a.length === b.length && a.every((v) => b.includes(v));
  const powerfulMatches = diff(state.powerful, saved.powerful);
  const confirmationMatches = diff(state.confirmation, saved.confirmation);
  const dirty = !powerfulMatches || !confirmationMatches;

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(TITLE_COLOR)
        .setTitle("\uD83D\uDC41\uFE0F Current Saved Config")
        .setDescription(
          [
            `**\u26A1 Powerful (instant)** \u2014 ${fmtRoles(saved.powerful)}`,
            `**\u2705 Confirmation (target accepts)** \u2014 ${fmtRoles(saved.confirmation)}`,
            "",
            dirty
              ? "\u26A0\uFE0F Your panel selections differ from what's saved \u2014 click **Save** to apply them."
              : "\u2705 Your panel matches the saved config.",
          ].join("\n"),
        )
        .setFooter({ text: "Night Stars \u2022 Move \u2022 Preview" }),
    ],
    ephemeral: true,
  });
}
