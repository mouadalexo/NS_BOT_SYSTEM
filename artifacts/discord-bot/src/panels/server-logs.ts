import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelSelectMenuInteraction,
  ChannelType,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionsBitField,
} from "discord.js";

import {
  ensureLogChannel,
  getServerLogsConfig,
  invalidateServerLogsCache,
  LOG_EVENT_KEYS,
  LOG_EVENT_META,
  LogEventKey,
  setEventEnabled,
  setLogCategory,
} from "../modules/server-logs/index.js";
import { findButton, findButtonRow, registerFindHandler } from "./findHelper.js";

const COLOR = 0x5000ff;

// ---------------------------------------------------------------------------
// Embed + rows
// ---------------------------------------------------------------------------

function badge(on: boolean): string {
  return on ? "🟢" : "⚪";
}

async function buildLogsEmbed(guildId: string): Promise<EmbedBuilder> {
  const cfg = await getServerLogsConfig(guildId);

  const lines = LOG_EVENT_KEYS.map((key) => {
    const meta = LOG_EVENT_META[key];
    const ev = cfg.events[key];
    const status = badge(!!ev?.enabled);
    const channel = ev?.channelId ? `<#${ev.channelId}>` : "_no channel_";
    return `${status}  ${meta.emoji}  **${meta.label}** — ${channel}`;
  }).join("\n");

  const categoryLine = cfg.logCategoryId
    ? `<#${cfg.logCategoryId}>`
    : "_not set — pick a category below before enabling events_";

  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle("📜  Server Logs")
    .setDescription(
      "Configure which moderation events are logged to the server.\n" +
        "Each event gets its own channel, auto-created inside the chosen **log category** " +
        "and inheriting that category's permissions.\n\n" +
        `**Log category** — ${categoryLine}\n\n${lines}`,
    )
    .setFooter({ text: "Night Stars  •  Logs" });
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function buildLogsRows(guildId: string) {
  const cfg = await getServerLogsConfig(guildId);

  const categoryRow = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("sl_category")
      .setPlaceholder(cfg.logCategoryId ? "Change log category" : "Select a category for log channels…")
      .addChannelTypes(ChannelType.GuildCategory)
      .setMinValues(0)
      .setMaxValues(1),
  );

  const eventButtons = LOG_EVENT_KEYS.map((key) => {
    const meta = LOG_EVENT_META[key];
    const on = !!cfg.events[key]?.enabled;
    return new ButtonBuilder()
      .setCustomId(`sl_toggle_${key}`)
      .setLabel(meta.label)
      .setEmoji(meta.emoji)
      .setStyle(on ? ButtonStyle.Success : ButtonStyle.Secondary);
  });

  const buttonRows = chunk(eventButtons, 5).map((group) =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(...group),
  );

  const findRow = findButtonRow(findButton("server-logs", "category", "category", "Find Log Category"));

  const navRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("sl_refresh").setLabel("Refresh").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("sl_back_master").setLabel("← Back").setStyle(ButtonStyle.Secondary),
  );

  // Discord allows max 5 action rows. Drop event-button rows beyond what fits.
  const allRows = [categoryRow, findRow, ...buttonRows, navRow];
  return allRows.slice(0, 5);
}

registerFindHandler("server-logs", async (interaction, fieldKey, selectedId) => {
  const guildId = interaction.guild!.id;
  if (fieldKey === "category") {
    await setLogCategory(guildId, selectedId);
    invalidateServerLogsCache(guildId);
  }
  const embed = await buildLogsEmbed(guildId);
  const components = await buildLogsRows(guildId);
  await interaction.update({ embeds: [embed], components });
});

// ---------------------------------------------------------------------------
// Public open
// ---------------------------------------------------------------------------

export async function openServerLogsPanel(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
): Promise<void> {
  const guildId = interaction.guild!.id;
  const embed = await buildLogsEmbed(guildId);
  const components = await buildLogsRows(guildId);

  if (interaction.isButton()) {
    await interaction.update({ embeds: [embed], components });
  } else {
    await interaction.reply({ embeds: [embed], components, ephemeral: true });
  }
}

// ---------------------------------------------------------------------------
// Button handler
// ---------------------------------------------------------------------------

export async function handleServerLogsButton(interaction: ButtonInteraction): Promise<void> {
  const id = interaction.customId;
  const guildId = interaction.guild!.id;

  if (id === "sl_refresh") {
    return openServerLogsPanel(interaction);
  }

  if (id === "sl_back_master") {
    const { buildMasterSetupEmbed, buildMasterSetupRows } = await import("./master.js");
    await interaction.update({ embeds: [buildMasterSetupEmbed()], components: buildMasterSetupRows() });
    return;
  }

  if (id.startsWith("sl_toggle_")) {
    const key = id.slice("sl_toggle_".length) as LogEventKey;
    if (!LOG_EVENT_KEYS.includes(key)) return;

    const cfg = await getServerLogsConfig(guildId);
    const wasEnabled = !!cfg.events[key]?.enabled;

    if (!wasEnabled) {
      // Enabling — ensure category is set and create channel
      if (!cfg.logCategoryId) {
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xff4d4d)
              .setDescription("⚠️ Set a **log category** first using the dropdown at the top."),
          ],
          ephemeral: true,
        });
        return;
      }

      const me = interaction.guild!.members.me;
      if (!me?.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xff4d4d)
              .setDescription("⚠️ I'm missing **Manage Channels** permission. Grant it and try again."),
          ],
          ephemeral: true,
        });
        return;
      }

      try {
        const channel = await ensureLogChannel(interaction.guild!, key);
        if (!channel) {
          await interaction.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(0xff4d4d)
                .setDescription("⚠️ Could not create the log channel. Check the configured category still exists."),
            ],
            ephemeral: true,
          });
          return;
        }
        await setEventEnabled(guildId, key, true);
        invalidateServerLogsCache(guildId);
      } catch (err) {
        console.error("[ServerLogs] enable error:", err);
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xff4d4d)
              .setDescription("⚠️ Failed to create the log channel — see bot logs."),
          ],
          ephemeral: true,
        });
        return;
      }
    } else {
      await setEventEnabled(guildId, key, false);
      invalidateServerLogsCache(guildId);
    }

    return openServerLogsPanel(interaction);
  }
}

// ---------------------------------------------------------------------------
// Channel select handler
// ---------------------------------------------------------------------------

export async function handleServerLogsChannelSelect(
  interaction: ChannelSelectMenuInteraction,
): Promise<void> {
  const id = interaction.customId;
  const guildId = interaction.guild!.id;
  const values = [...interaction.values];

  if (id === "sl_category") {
    const newCat = values[0] ?? null;
    await setLogCategory(guildId, newCat);
    invalidateServerLogsCache(guildId);
    return openServerLogsPanel(interaction as unknown as ButtonInteraction);
  }
}
