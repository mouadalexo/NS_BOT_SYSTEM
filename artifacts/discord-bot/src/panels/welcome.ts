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
  ModalBuilder,
  ModalSubmitInteraction,
  PermissionsBitField,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import {
  WelcomeConfig,
  defaultWelcomeConfig,
  getWelcomeConfig,
  saveWelcomeConfig,
  sendWelcomePreview,
} from "../modules/welcome/index.js";
import { findButton, findButtonRow, registerFindHandler } from "./findHelper.js";

const TITLE_COLOR = 0x5000ff;

function summary(cfg: WelcomeConfig) {
  const ch = cfg.channelId ? `<#${cfg.channelId}>` : "_not set_";
  const dot = (on: boolean) => (on ? "\u2705" : "\u26AA");
  const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "\u2026" : s);

  return new EmbedBuilder()
    .setColor(TITLE_COLOR)
    .setTitle("\uD83D\uDC4B Welcome System")
    .setDescription(
      [
        `**Welcome channel:** ${ch}`,
        "",
        `${dot(cfg.server.enabled)} **Server welcome** \u2014 message-only (with picture)`,
        `\u2002\u2002Picture: ${cfg.server.imageUrl ? "custom URL" : "default template"}`,
        `\u2002\u2002Message: \`${truncate(cfg.server.message || "(empty)", 80)}\``,
        "",
        `${dot(cfg.dm.enabled)} **DM welcome** \u2014 mode: \`${cfg.dm.mode}\``,
        `\u2002\u2002Message: \`${truncate(cfg.dm.message || "(empty)", 80)}\``,
        "",
        "**Variables:** `{user}` `{user_mention}` `{user.tag}` `{user.name}` `{server}` `{membercount}`",
        "**Emojis:** type `;emojiname` (e.g. `;fire`) and the bot replaces it with the matching server emoji.",
      ].join("\n"),
    )
    .setFooter({ text: "Night Stars \u2022 Welcome" });
}

function rows(cfg: WelcomeConfig) {
  const channelRow = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("wc_channel")
      .setPlaceholder("Select welcome channel")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setMaxValues(1),
  );
  const variantRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("wc_edit")
      .setPlaceholder("Edit a welcome message")
      .addOptions(
        { label: "Edit Server welcome (picture + message)", value: "server" },
        { label: "Edit DM welcome (message)", value: "dm" },
      ),
  );
  const toggleRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("wc_toggle_server")
      .setStyle(cfg.server.enabled ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setLabel(`Server: ${cfg.server.enabled ? "ON" : "OFF"}`),
    new ButtonBuilder()
      .setCustomId("wc_toggle_dm")
      .setStyle(cfg.dm.enabled ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setLabel(`DM: ${cfg.dm.enabled ? "ON" : "OFF"}`),
    new ButtonBuilder()
      .setCustomId("wc_mode_dm")
      .setStyle(ButtonStyle.Secondary)
      .setLabel(`DM mode: ${cfg.dm.mode}`),
  );
  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("wc_test_server").setStyle(ButtonStyle.Primary).setLabel("Test Server"),
    new ButtonBuilder().setCustomId("wc_test_dm").setStyle(ButtonStyle.Primary).setLabel("Test DM"),
    new ButtonBuilder().setCustomId("wc_reset").setStyle(ButtonStyle.Danger).setLabel("Reset all"),
    findButton("welcome", "channel", "text", "Find Channel"),
  );
  return [channelRow, variantRow, toggleRow, actionRow];
}

registerFindHandler("welcome", async (interaction, fieldKey, selectedId) => {
  if (!interaction.guildId) return;
  const cfg = await getWelcomeConfig(interaction.guildId);
  if (fieldKey === "channel") {
    cfg.channelId = selectedId;
    await saveWelcomeConfig(interaction.guildId, cfg);
  }
  await interaction.update({ embeds: [summary(cfg)], components: rows(cfg) });
});

export async function openWelcomePanel(interaction: ChatInputCommandInteraction | ButtonInteraction) {
  if (!interaction.guildId) return;
  const cfg = await getWelcomeConfig(interaction.guildId);
  const payload = { embeds: [summary(cfg)], components: rows(cfg) };
  if (interaction.isChatInputCommand()) {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload);
    } else {
      await interaction.reply({ ...payload, ephemeral: true });
    }
  } else {
    await interaction.update(payload);
  }
}

async function refresh(
  interaction: ButtonInteraction | ChannelSelectMenuInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
) {
  const cfg = await getWelcomeConfig(interaction.guildId!);
  const payload = { embeds: [summary(cfg)], components: rows(cfg) };
  if (interaction.isModalSubmit()) {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload);
    } else {
      await interaction.reply({ ...payload, ephemeral: true });
    }
  } else {
    await interaction.update(payload);
  }
}

export async function handleWelcomeChannelSelect(interaction: ChannelSelectMenuInteraction) {
  if (!interaction.guildId) return;
  const channelId = interaction.values[0]!;
  const cfg = await getWelcomeConfig(interaction.guildId);
  cfg.channelId = channelId;
  await saveWelcomeConfig(interaction.guildId, cfg);
  await refresh(interaction);
}

export async function handleWelcomeButton(interaction: ButtonInteraction) {
  if (!interaction.guildId) return;
  const id = interaction.customId;
  const cfg = await getWelcomeConfig(interaction.guildId);

  if (id === "wc_toggle_server") {
    cfg.server.enabled = !cfg.server.enabled;
    await saveWelcomeConfig(interaction.guildId, cfg);
    await refresh(interaction);
    return;
  }
  if (id === "wc_toggle_dm") {
    cfg.dm.enabled = !cfg.dm.enabled;
    await saveWelcomeConfig(interaction.guildId, cfg);
    await refresh(interaction);
    return;
  }
  if (id === "wc_mode_dm") {
    cfg.dm.mode = cfg.dm.mode === "embed" ? "text" : "embed";
    await saveWelcomeConfig(interaction.guildId, cfg);
    await refresh(interaction);
    return;
  }
  if (id === "wc_reset") {
    await saveWelcomeConfig(interaction.guildId, defaultWelcomeConfig());
    await refresh(interaction);
    return;
  }
  if (id === "wc_test_server" || id === "wc_test_dm") {
    const variant = id === "wc_test_server" ? "server" : "dm";
    const member = await interaction.guild!.members.fetch(interaction.user.id);
    const result = await sendWelcomePreview(member, variant);
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(result.ok ? 0x00c851 : 0xff4d4d)
          .setDescription(result.ok ? `\u2705 Test ${variant} welcome sent.` : `\u274C ${result.reason}`),
      ],
      ephemeral: true,
    });
    return;
  }
}

export async function handleWelcomeStringSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.guildId) return;
  if (interaction.customId !== "wc_edit") return;
  const variant = interaction.values[0] === "dm" ? "dm" : "server";
  const cfg = await getWelcomeConfig(interaction.guildId);

  if (variant === "server") {
    const v = cfg.server;
    const modal = new ModalBuilder()
      .setCustomId("wc_modal_server")
      .setTitle("Edit Server Welcome")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("message")
            .setLabel("Message under the picture")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(500)
            .setValue(v.message ?? ""),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("imageUrl")
            .setLabel("Picture URL (blank = use default template)")
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setValue(v.imageUrl ?? ""),
        ),
      );
    await interaction.showModal(modal);
    return;
  }

  const v = cfg.dm;
  const modal = new ModalBuilder()
    .setCustomId("wc_modal_dm")
    .setTitle("Edit DM Welcome")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("message")
          .setLabel("DM message (a bit longer is OK)")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(2000)
          .setValue(v.message ?? ""),
      ),
    );
  await interaction.showModal(modal);
}

export async function handleWelcomeModalSubmit(interaction: ModalSubmitInteraction) {
  if (!interaction.guildId) return;
  const cfg = await getWelcomeConfig(interaction.guildId);

  if (interaction.customId === "wc_modal_server") {
    const message = interaction.fields.getTextInputValue("message").trim();
    const imageUrl = interaction.fields.getTextInputValue("imageUrl").trim();
    cfg.server.message = message;
    cfg.server.imageUrl = imageUrl || null;
    await saveWelcomeConfig(interaction.guildId, cfg);
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(0x00c851).setDescription("\u2705 Server welcome updated.")],
      ephemeral: true,
    });
    return;
  }
  if (interaction.customId === "wc_modal_dm") {
    const message = interaction.fields.getTextInputValue("message").trim();
    cfg.dm.message = message;
    await saveWelcomeConfig(interaction.guildId, cfg);
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(0x00c851).setDescription("\u2705 DM welcome updated.")],
      ephemeral: true,
    });
    return;
  }
}

