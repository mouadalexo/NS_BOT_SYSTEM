import {
  Client,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ButtonInteraction,
  ChannelSelectMenuInteraction,
  RoleSelectMenuInteraction,
  ModalSubmitInteraction,
  PermissionsBitField,
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  StringSelectMenuInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { isMainGuild } from "../utils/guildFilter.js";
import { db } from "@workspace/db";
import { botConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  openPvsPanel,
  handlePvsPanelSelect,
  handlePvsPanelSave,
  handlePvsPanelReset,
} from "./pvs.js";
import {
  openCtpPanel,
  openCtpManagePanel,
  handleCtpPanelSelect,
  handleCtpGameSelect,
  handleCtpEditGame,
  handleCtpRemoveGame,
  handleCtpBackToManage,
  openCtpDetailsModal,
  handleCtpDetailsModalSubmit,
  handleCtpPanelSave,
  handleCtpPanelReset,
} from "./ctp.js";
import {
  openCtpTagPanel,
  handleCtpTagButton,
  handleCtpTagChannelSelect,
  handleCtpTagRoleSelect,
  handleCtpTagStringSelect,
  handleCtpTagModalSubmit,
} from "./ctpTemp.js";
import {
  openStaffPanel,
  handleStaffPanelSelect,
  handleStaffPanelSave,
  handleStaffPanelReset,
} from "./staff.js";

function buildAllCommandsEmbed(pvs = "=", mgr = "+", ctp = "-", ann = "!") {
  return new EmbedBuilder()
    .setColor(0x5000ff)
    .setTitle("📋 Night Stars Bot — All Commands")
    .addFields(
      {
        name: "📣 Announcements (staff with announce role or admin)",
        value: [
          `\`${ann}ann <text>\` — Post a gold announcement embed with @everyone`,
          `\`${ann}testann <text>\` — Preview announcement without pinging anyone`,
          `\`${ann}event\` — Open the event form and post a blurple event embed with @everyone`,
          `\`${ann}testevent\` — Preview the full event flow without pinging anyone`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "⚙️ Announcement Setup (admin only)",
        value: [
          `\`${ann}setannrole @Role\` — Set which role can use announce/event commands`,
          `\`${ann}addannchannel #ch\` — Add a channel where announce commands work (up to 4)`,
          `\`${ann}removeannchannel #ch\` — Remove a channel from the list`,
          `\`${ann}annchannels\` — Show currently allowed announcement channels`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "🎙️ PVS — Private Voice System (room owners)",
        value: [
          `\`${pvs}key @user\` — Give/remove access to your room`,
          `\`${pvs}pull @user\` — Pull someone from the waiting room`,
          `\`${pvs}see keys\` — List members with access`,
          `\`${pvs}clear keys\` — Remove all access`,
          `\`${pvs}name <name>\` — Rename your room`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "🎙️ PVS — Staff (PVS Manager role)",
        value: [
          `\`${mgr}pv @member\` — Create a Premium Voice room`,
          `\`${mgr}pv delete @member\` — Remove a Premium Voice room`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "🎮 CTP — Category Game Tagging",
        value: [
          `\`${ctp}tag\` — Ping the game role for your voice channel (auto-detected by CTP category)`,
          "Each game has its own cooldown — the bot will tell you if one is active",
        ].join("\n"),
        inline: false,
      },
      {
        name: "🎮 CTP — Onetap Game Tagging",
        value: [
          `\`${ctp}<gamename>\` — Ping a game role while in the onetap temp voice category`,
          `Example: \`${ctp}amongus\` pings Among Us players`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "⚙️ Setup & Prefix",
        value: [
          "`/setup pvs` — Configure the Private Voice System",
          "`/setup ctp-category` — Configure CTP for category-based game tagging",
          "`/setup ctp-onetap` — Configure CTP onetap temp voice tagging",
          "`/setup staff` — Set the staff role",
          "`/prefix` — View and edit all system prefixes (admin only)",
        ].join("\n"),
        inline: false,
      },
    )
    .setFooter({ text: "Night Stars • NS Bot" });
}

function buildAnnouncementsHelpEmbed() {
  return new EmbedBuilder()
    .setColor(0x5000ff)
    .setTitle("📣 Announcements & Events — Commands")
    .addFields(
      {
        name: "Live Commands",
        value: [
          "`!announce <text>` — Posts a gold embed with `@everyone`. You can attach an image too.",
          "`!event` — Opens an event setup form. Fill in name, date, description, and optional image. Posts with `@everyone`.",
        ].join("\n"),
        inline: false,
      },
      {
        name: "🧪 Test Commands (same flow, no @everyone)",
        value: [
          "`!testannounce <text>` — Sends the announcement embed as a preview (no @everyone, orange color).",
          "`!testevent` — Full event form flow but posts without @everyone and shows a [TEST] label.",
        ].join("\n"),
        inline: false,
      },
      {
        name: "⚙️ Channel & Role Setup (admin only)",
        value: [
          "`!setannouncerole @Role` — Grant a role access to announce/event commands.",
          "`!addannouncechannel #ch` — Restrict announce/event to specific channels (up to 4). If none set, any channel works.",
          "`!removeannouncechannel #ch` — Remove a channel from the allowed list.",
          "`!announcechannels` — View current allowed channels.",
        ].join("\n"),
        inline: false,
      },
    )
    .setFooter({ text: "Night Stars • Announcements" });
}

function buildPvsInfoEmbed() {
  return new EmbedBuilder()
    .setColor(0x5000ff)
    .setTitle("🎙️ PVS — Private Voice System Commands")
    .setDescription("Commands for private voice room owners:")
    .addFields(
      { name: "`=key @user`", value: "Give or remove a member's access to your room.", inline: false },
      { name: "`=pull @user`", value: "Pull a member from the waiting room into your room.", inline: false },
      { name: "`=see keys`", value: "List all members who have access to your room.", inline: false },
      { name: "`=clear keys`", value: "Remove all keys — your room becomes fully private.", inline: false },
      { name: "`=name NewName`", value: "Rename your voice room.", inline: false },
      { name: "\u200B", value: "**Staff Command** (PVS Manager Role required)", inline: false },
      { name: "`+pv @member`", value: "Create a permanent private voice room for a member.", inline: false },
      { name: "`+pv delete @member`", value: "Remove a member's Premium Voice room.", inline: false },
    )
    .setFooter({ text: "Night Stars • PVS" });
}

function buildCtpInfoEmbed() {
  return new EmbedBuilder()
    .setColor(0x5000ff)
    .setTitle("🎮 CTP — Call to Play Commands")
    .setDescription("Commands for calling players to your game:")
    .addFields(
      {
        name: "`-tag`",
        value:
          "Ping the game role for your current voice channel.\n" +
          "The bot detects which game you're in automatically based on the category.\n" +
          "Just join a game voice channel and type `-tag`.",
        inline: false,
      },
      {
        name: "Cooldown",
        value: "Each game has its own cooldown. If active, the bot tells you how long to wait.",
        inline: false,
      },
    )
    .setFooter({ text: "Night Stars • CTP" });
}

export async function registerPanelCommands(client: Client) {
  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error("DISCORD_TOKEN is missing");

  const setupCommand = new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Configure Night Stars bot systems")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addSubcommand((sub) =>
      sub.setName("pvs").setDescription("Set up the Private Voice System (PVS)")
    )
    .addSubcommand((sub) =>
      sub.setName("ctp-category").setDescription("Set up CTP for games with their own category")
    )
    .addSubcommand((sub) =>
      sub.setName("ctp-onetap").setDescription("Set up CTP Onetap — temp voice game tagging")
    )
    .addSubcommand((sub) =>
      sub.setName("staff").setDescription("Set the staff role — grants access to all bot systems")
    )
    .toJSON();

  const helpCommand = new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show all Night Stars Bot commands and current prefixes")
    .toJSON();

  const pingCommand = new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check NS Bot latency")
    .toJSON();

  const prefixCommand = new SlashCommandBuilder()
    .setName("prefix")
    .setDescription("View and configure all system command prefixes")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .toJSON();

  const rest = new REST().setToken(token);

  const registerForGuild = async (guildId: string, guildName: string) => {
    try {
      await rest.put(Routes.applicationGuildCommands(client.user!.id, guildId), {
        body: [setupCommand, helpCommand, pingCommand, prefixCommand],
      });
      console.log(`Registered slash commands for guild: ${guildName}`);
    } catch (err) {
      console.error(`Failed to register commands for guild ${guildName}:`, err);
    }
  };

  for (const guild of client.guilds.cache.values()) {
    await registerForGuild(guild.id, guild.name);
  }

  client.on("guildCreate", async (guild) => {
    await registerForGuild(guild.id, guild.name);
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.guild) return;
    if (!isMainGuild(interaction.guild.id)) return;

    if (interaction.isChatInputCommand()) {
      const name = interaction.commandName;
      if (name === "setup") {
        await handleSetupCommand(interaction as ChatInputCommandInteraction);
      } else if (name === "ping") {
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x5000ff)
              .setDescription(`Latency: **${Math.round(interaction.client.ws.ping)}ms**`)
              .setFooter({ text: "Night Stars • NS Bot" }),
          ],
          ephemeral: true,
        });
      } else if (name === "prefix") {
        await openPrefixPanel(interaction as ChatInputCommandInteraction);
      } else if (name === "help") {
        const { pvs, mgr, ctp, ann } = await getGuildPrefixes(interaction.guildId!);
        await interaction.reply({ embeds: [buildAllCommandsEmbed(pvs, mgr, ctp, ann)], ephemeral: true });
      }
      return;
    }

    if (interaction.isButton()) {
      const panelIds = [
        "pp_save", "pp_reset",
        "cp_add_new", "cp_edit_game", "cp_remove_game", "cp_back_manage",
        "cp_open_details", "cp_save", "cp_reset",
        "sp_save", "sp_reset",
        "pfx_edit",
      ];
      if (panelIds.includes(interaction.customId) || interaction.customId.startsWith("ct_")) {
        await handleButtonInteraction(interaction as ButtonInteraction);
      }
      return;
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === "cp_game_select") {
        try { await handleCtpGameSelect(interaction as StringSelectMenuInteraction); } catch (err) { console.error("CTP game select error:", err); }
      } else if (interaction.customId.startsWith("ct_")) {
        try { await handleCtpTagStringSelect(interaction as StringSelectMenuInteraction); } catch (err) { console.error("CTP temp select error:", err); }
      }
      return;
    }

    if (interaction.isRoleSelectMenu()) {
      await handleRoleSelectInteraction(interaction as RoleSelectMenuInteraction);
      return;
    }

    if (interaction.isChannelSelectMenu()) {
      await handleChannelSelectInteraction(interaction as ChannelSelectMenuInteraction);
      return;
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId === "pfx_modal") {
        try { await handlePrefixModalSubmit(interaction as ModalSubmitInteraction); } catch (err) { console.error("Prefix modal error:", err); }
      } else if (interaction.customId === "cp_details_modal") {
        try { await handleCtpDetailsModalSubmit(interaction as ModalSubmitInteraction); } catch (err) { console.error("CTP modal error:", err); }
      } else if (interaction.customId.startsWith("ct_")) {
        try { await handleCtpTagModalSubmit(interaction as ModalSubmitInteraction); } catch (err) { console.error("CTP temp modal error:", err); }
      }
    }
  });
}

async function handleSetupCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(0x5000ff).setDescription("❌ You need **Administrator** permission to use this.")],
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const sub = interaction.options.getSubcommand();

  if (sub === "pvs") {
    await openPvsPanel(interaction as unknown as ButtonInteraction);
  } else if (sub === "ctp-category") {
    await openCtpManagePanel(interaction as unknown as ButtonInteraction);
  } else if (sub === "ctp-onetap") {
    await openCtpTagPanel(interaction as unknown as ButtonInteraction);
  } else if (sub === "staff") {
    await openStaffPanel(interaction as unknown as ButtonInteraction);
  }
}

async function handleButtonInteraction(interaction: ButtonInteraction) {
  const { customId } = interaction;
  try {
    if (customId === "pp_save") {
      await handlePvsPanelSave(interaction);
    } else if (customId === "pp_reset") {
      await handlePvsPanelReset(interaction);
    } else if (customId === "cp_add_new") {
      await openCtpPanel(interaction);
    } else if (customId === "cp_edit_game") {
      await handleCtpEditGame(interaction);
    } else if (customId === "cp_remove_game") {
      await handleCtpRemoveGame(interaction);
    } else if (customId === "cp_back_manage") {
      await handleCtpBackToManage(interaction);
    } else if (customId === "ct_open") {
      await openCtpTagPanel(interaction);
    } else if (customId.startsWith("ct_")) {
      await handleCtpTagButton(interaction);
    } else if (customId === "cp_open_details") {
      await openCtpDetailsModal(interaction);
    } else if (customId === "cp_save") {
      await handleCtpPanelSave(interaction);
    } else if (customId === "cp_reset") {
      await handleCtpPanelReset(interaction);
    } else if (customId === "sp_save") {
      await handleStaffPanelSave(interaction);
    } else if (customId === "sp_reset") {
      await handleStaffPanelReset(interaction);
    } else if (customId === "pfx_edit") {
      await handlePrefixEditButton(interaction);
    }
  } catch (err) {
    console.error("Panel button error:", err);
  }
}

async function handleRoleSelectInteraction(interaction: RoleSelectMenuInteraction) {
  const { customId } = interaction;
  try {
    if (customId.startsWith("pp_")) {
      await handlePvsPanelSelect(interaction);
    } else if (customId.startsWith("cp_")) {
      await handleCtpPanelSelect(interaction);
    } else if (customId.startsWith("sp_")) {
      await handleStaffPanelSelect(interaction);
    } else if (customId.startsWith("ct_")) {
      await handleCtpTagRoleSelect(interaction);
    }
  } catch (err) {
    console.error("Panel role select error:", err);
  }
}

async function handleChannelSelectInteraction(interaction: ChannelSelectMenuInteraction) {
  const { customId } = interaction;
  try {
    if (customId.startsWith("pp_")) {
      await handlePvsPanelSelect(interaction);
    } else if (customId.startsWith("cp_")) {
      await handleCtpPanelSelect(interaction);
    } else if (customId.startsWith("ct_")) {
      await handleCtpTagChannelSelect(interaction);
    }
  } catch (err) {
    console.error("Panel channel select error:", err);
  }
}

async function getGuildPrefixes(guildId: string) {
  const rows = await db.select().from(botConfigTable).where(eq(botConfigTable.guildId, guildId)).limit(1);
  const row = rows[0];
  return {
    pvs: row?.pvsPrefix ?? "=",
    mgr: row?.managerPrefix ?? "+",
    ctp: row?.ctpPrefix ?? "-",
    ann: row?.annPrefix ?? "!",
  };
}

async function openPrefixPanel(interaction: ChatInputCommandInteraction) {
  const { pvs, mgr, ctp, ann } = await getGuildPrefixes(interaction.guildId!);
  const embed = new EmbedBuilder()
    .setColor(0x5000ff)
    .setTitle("⚙️ System Prefixes")
    .setDescription("These prefixes define how members trigger each bot system. Click **Edit Prefixes** to change them.")
    .addFields(
      { name: "🎙️ PVS Prefix", value: `\`${pvs}\``, inline: true },
      { name: "🎙️ Manager Prefix", value: `\`${mgr}\``, inline: true },
      { name: "🎮 CTP Prefix", value: `\`${ctp}\``, inline: true },
      { name: "📣 Announcements Prefix", value: `\`${ann}\``, inline: true },
    )
    .setFooter({ text: "Night Stars • NS Bot" });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("pfx_edit").setLabel("Edit Prefixes").setStyle(ButtonStyle.Primary),
  );
  await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
}

async function handlePrefixEditButton(interaction: ButtonInteraction) {
  const { pvs, mgr, ctp, ann } = await getGuildPrefixes(interaction.guildId!);
  const modal = new ModalBuilder().setCustomId("pfx_modal").setTitle("Edit System Prefixes");
  const pvsInput = new TextInputBuilder()
    .setCustomId("pfx_pvs").setLabel("PVS Prefix (room owner commands)").setStyle(TextInputStyle.Short)
    .setValue(pvs).setMinLength(1).setMaxLength(5).setRequired(true);
  const mgrInput = new TextInputBuilder()
    .setCustomId("pfx_mgr").setLabel("Manager Prefix (staff PV commands)").setStyle(TextInputStyle.Short)
    .setValue(mgr).setMinLength(1).setMaxLength(5).setRequired(true);
  const ctpInput = new TextInputBuilder()
    .setCustomId("pfx_ctp").setLabel("CTP Prefix (call-to-play commands)").setStyle(TextInputStyle.Short)
    .setValue(ctp).setMinLength(1).setMaxLength(5).setRequired(true);
  const annInput = new TextInputBuilder()
    .setCustomId("pfx_ann").setLabel("Announcements Prefix (ann commands)").setStyle(TextInputStyle.Short)
    .setValue(ann).setMinLength(1).setMaxLength(5).setRequired(true);
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(pvsInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(mgrInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(ctpInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(annInput),
  );
  await interaction.showModal(modal);
}

async function handlePrefixModalSubmit(interaction: ModalSubmitInteraction) {
  const guildId = interaction.guildId!;
  const pvs = interaction.fields.getTextInputValue("pfx_pvs").trim();
  const mgr = interaction.fields.getTextInputValue("pfx_mgr").trim();
  const ctp = interaction.fields.getTextInputValue("pfx_ctp").trim();
  const ann = interaction.fields.getTextInputValue("pfx_ann").trim();

  await db
    .update(botConfigTable)
    .set({ pvsPrefix: pvs, managerPrefix: mgr, ctpPrefix: ctp, annPrefix: ann })
    .where(eq(botConfigTable.guildId, guildId));

  const embed = new EmbedBuilder()
    .setColor(0x00c851)
    .setTitle("✅ Prefixes Updated")
    .addFields(
      { name: "🎙️ PVS Prefix", value: `\`${pvs}\``, inline: true },
      { name: "🎙️ Manager Prefix", value: `\`${mgr}\``, inline: true },
      { name: "🎮 CTP Prefix", value: `\`${ctp}\``, inline: true },
      { name: "📣 Announcements Prefix", value: `\`${ann}\``, inline: true },
    )
    .setFooter({ text: "Night Stars • NS Bot" });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("pfx_edit").setLabel("Edit Again").setStyle(ButtonStyle.Secondary),
  );
  await interaction.update({ embeds: [embed], components: [row] });
}
