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
  previewWelcome,
  saveWelcomeConfig,
} from "../modules/welcome/index.js";

const TITLE_COLOR = 0x5000ff;

function summary(cfg: WelcomeConfig) {
  const ch = cfg.channelId ? `<#${cfg.channelId}>` : "_not set_";
  const fmt = (label: string, on: boolean) => `${on ? "\u2705" : "\u26AA"} **${label}**`;
  return new EmbedBuilder()
    .setColor(TITLE_COLOR)
    .setTitle("\uD83D\uDC4B Welcome System")
    .setDescription(
      [
        `**Welcome channel:** ${ch}`,
        "",
        fmt("Server welcome", cfg.server.enabled),
        `\u2002\u2002Mode: \`${cfg.server.mode}\` \u2014 Title: ${cfg.server.title ? "\u2705" : "\u274C"} \u2014 Image: ${cfg.server.imageUrl ? "\u2705" : "\u274C"}`,
        "",
        fmt("DM welcome", cfg.dm.enabled),
        `\u2002\u2002Mode: \`${cfg.dm.mode}\` \u2014 Title: ${cfg.dm.title ? "\u2705" : "\u274C"} \u2014 Image: ${cfg.dm.imageUrl ? "\u2705" : "\u274C"}`,
        "",
        "**Variables you can use in any text field:**",
        "`{user}` `{user_mention}` `{user.tag}` `{user.name}` `{server}` `{membercount}`",
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
        { label: "Edit Server welcome", value: "server", description: "Embed/text shown in the welcome channel" },
        { label: "Edit DM welcome", value: "dm", description: "Embed/text sent to the new member's DMs" },
      ),
  );
  const toggleRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("wc_toggle_server").setStyle(cfg.server.enabled ? ButtonStyle.Success : ButtonStyle.Secondary).setLabel(`Server: ${cfg.server.enabled ? "ON" : "OFF"}`),
    new ButtonBuilder().setCustomId("wc_toggle_dm").setStyle(cfg.dm.enabled ? ButtonStyle.Success : ButtonStyle.Secondary).setLabel(`DM: ${cfg.dm.enabled ? "ON" : "OFF"}`),
    new ButtonBuilder().setCustomId("wc_mode_server").setStyle(ButtonStyle.Secondary).setLabel(`Server mode: ${cfg.server.mode}`),
    new ButtonBuilder().setCustomId("wc_mode_dm").setStyle(ButtonStyle.Secondary).setLabel(`DM mode: ${cfg.dm.mode}`),
  );
  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("wc_test_server").setStyle(ButtonStyle.Primary).setLabel("Test Server"),
    new ButtonBuilder().setCustomId("wc_test_dm").setStyle(ButtonStyle.Primary).setLabel("Test DM"),
    new ButtonBuilder().setCustomId("wc_reset").setStyle(ButtonStyle.Danger).setLabel("Reset all"),
  );
  return [channelRow, variantRow, toggleRow, actionRow];
}

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

async function refresh(interaction: ButtonInteraction | ChannelSelectMenuInteraction | StringSelectMenuInteraction | ModalSubmitInteraction) {
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
  if (id === "wc_mode_server") {
    cfg.server.mode = cfg.server.mode === "embed" ? "text" : "embed";
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
    const result = await previewWelcome(member, variant);
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
  const v = cfg[variant];
  const modal = new ModalBuilder()
    .setCustomId(`wc_modal_${variant}`)
    .setTitle(`Edit ${variant === "dm" ? "DM" : "Server"} Welcome`)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("title")
          .setLabel("Title (embed only)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(256)
          .setValue(v.title ?? ""),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("description")
          .setLabel("Body / message")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(2000)
          .setValue(v.description ?? ""),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("color")
          .setLabel("Embed color hex (e.g. #5000ff)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(7)
          .setValue(v.color ?? ""),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("imageUrl")
          .setLabel("Big image URL (optional)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue(v.imageUrl ?? ""),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("thumbnailUrl")
          .setLabel("Thumbnail URL (blank = user avatar)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue(v.thumbnailUrl ?? ""),
      ),
    );
  await interaction.showModal(modal);
}

export async function handleWelcomeModalSubmit(interaction: ModalSubmitInteraction) {
  if (!interaction.guildId) return;
  const variant = interaction.customId === "wc_modal_dm" ? "dm" : "server";
  const cfg = await getWelcomeConfig(interaction.guildId);
  const v = cfg[variant];
  v.title = interaction.fields.getTextInputValue("title").trim() || null;
  v.description = interaction.fields.getTextInputValue("description").trim() || null;
  const color = interaction.fields.getTextInputValue("color").trim();
  v.color = color || null;
  const img = interaction.fields.getTextInputValue("imageUrl").trim();
  v.imageUrl = img || null;
  const thumb = interaction.fields.getTextInputValue("thumbnailUrl").trim();
  v.thumbnailUrl = thumb || null;
  v.text = v.description; // for text mode, description doubles as the message
  await saveWelcomeConfig(interaction.guildId, cfg);
  await interaction.reply({
    embeds: [new EmbedBuilder().setColor(0x00c851).setDescription(`\u2705 ${variant === "dm" ? "DM" : "Server"} welcome updated.`)],
    ephemeral: true,
  });
}

export async function handleSetupMoveCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(0x5000ff).setDescription("\u274C You need **Administrator**.")],
      ephemeral: true,
    });
    return;
  }
  const roles = [
    interaction.options.getRole("role-1", true),
    interaction.options.getRole("role-2"),
    interaction.options.getRole("role-3"),
    interaction.options.getRole("role-4"),
    interaction.options.getRole("role-5"),
  ].filter((r): r is NonNullable<typeof r> => !!r);
  const ids = [...new Set(roles.map((r) => r.id))];
  const { pool } = await import("@workspace/db");
  await pool.query(
    `insert into bot_config (guild_id, move_role_ids_json, updated_at)
     values ($1, $2, now())
     on conflict (guild_id) do update set move_role_ids_json = excluded.move_role_ids_json, updated_at = now()`,
    [interaction.guildId!, JSON.stringify(ids)],
  );
  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x00c851)
        .setTitle("\u2705 Move Roles Saved")
        .setDescription(
          `Members with these roles can now use \`aji @user\`:\n${ids.map((id) => `<@&${id}>`).join(", ")}\n\nAdmins can always use it.`,
        )
        .setFooter({ text: "Night Stars \u2022 Move" }),
    ],
    ephemeral: true,
  });
}

export async function handleSetupClearCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(0x5000ff).setDescription("\u274C You need **Administrator**.")],
      ephemeral: true,
    });
    return;
  }
  const roles = [
    interaction.options.getRole("role-1", true),
    interaction.options.getRole("role-2"),
    interaction.options.getRole("role-3"),
    interaction.options.getRole("role-4"),
    interaction.options.getRole("role-5"),
  ].filter((r): r is NonNullable<typeof r> => !!r);
  const ids = [...new Set(roles.map((r) => r.id))];
  const { pool } = await import("@workspace/db");
  await pool.query(
    `insert into bot_config (guild_id, clear_role_ids_json, updated_at)
     values ($1, $2, now())
     on conflict (guild_id) do update set clear_role_ids_json = excluded.clear_role_ids_json, updated_at = now()`,
    [interaction.guildId!, JSON.stringify(ids)],
  );
  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x00c851)
        .setTitle("\u2705 Clear Roles Saved")
        .setDescription(
          `Members with these roles can now use \`mse7 N\` (max 99):\n${ids.map((id) => `<@&${id}>`).join(", ")}\n\nAdmins can always use it.`,
        )
        .setFooter({ text: "Night Stars \u2022 Clear" }),
    ],
    ephemeral: true,
  });
}
