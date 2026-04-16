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
  ChannelType,
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
  openGeneralSetupPanel,
  handleGeneralStaffRoleSelect,
  handleGeneralHelpRolesSelect,
  handleGeneralBlockedChSelect,
  handleGeneralPanelSave,
  handleGeneralPanelReset,
  getHelpRoleIds,
  getStaffRoleId,
} from "./general.js";
import {
  openAnnPanel,
  handleAnnAnnRoleSelect,
  handleAnnEventRoleSelect,
  handleAnnLogsChannelSelect,
  handleAnnPanelSave,
  handleAnnPanelReset,
  openAnnColorPanel,
  openAnnColorModal,
  handleAnnColorModalSubmit,
  handleAnnColorBack,
} from "./ann.js";

function buildAllCommandsEmbed(pvs = "=", mgr = "+", ctp = "-", ann = "!") {
  return new EmbedBuilder()
    .setColor(0x5000ff)
    .setTitle("\uD83D\uDCCB Night Stars Bot \u2014 All Commands")
    .addFields(
      {
        name: "\uD83D\uDCE3 Announcements (Ann Role or Admin)",
        value: [
          `\`${ann}ann\`` + " \u2014 Post an announcement",
          `\`${ann}event\`` + " \u2014 Post an event",
          `\`${ann}an <message>\`` + " \u2014 Quick inline announcement \u2014 deletes your message and posts it clean",
          "\uD83D\uDCA1 In `=an`: use `[RoleName]` to ping a role, `[username]` to mention a member, `[everyone]` for @everyone",
          "\uD83D\uDCA1 Use `## Title` for a heading embed",
          "\uD83D\uDCA1 Use `;emoji_name` to insert a server emoji",
        ].join("\n"),
        inline: false,
      },
      { name: "\u200B", value: "** **", inline: false },
      {
        name: "\uD83C\uDFA7 PVS \u2014 Private Voice (premium members)",
        value: [
          `\`${pvs}key @user\`` + " \u2014 Give or remove room access",
          `\`${pvs}pull @user\`` + " \u2014 Pull from waiting room",
          `\`${pvs}see keys\`` + " \u2014 List who has access",
          `\`${pvs}clear keys\`` + " \u2014 Remove all access keys",
          `\`${pvs}name NewName\`` + " \u2014 Rename your room",
        ].join("\n"),
        inline: false,
      },
      { name: "\u200B", value: "** **", inline: false },
      {
        name: "\uD83D\uDD27 Staff \u2014 PVS Manager (Manager Role required)",
        value: [
          `\`${mgr}pv @member\`` + " \u2014 Create a premium voice room",
          `\`${mgr}pv delete @member\`` + " \u2014 Remove a premium voice room",
        ].join("\n"),
        inline: false,
      },
      { name: "\u200B", value: "** **", inline: false },
      {
        name: "\u2699\uFE0F Slash Commands (Admin only)",
        value: [
          "`/setup pvs` \u2014 Configure the Private Voice System",
          "`/setup ctp-category` \u2014 Configure CTP games",
          "`/setup ctp-onetap` \u2014 Configure CTP Onetap",
          "`/general setup` \u2014 Set staff role & blocked channels",
          "`/setup-reject` \u2014 Configure hammer, rejected, member, and logs channel",
          "`/ann setup` \u2014 Configure announcements (roles, event colors)",
          "`/prefix` \u2014 View and edit command prefixes",
          "`/ping` \u2014 Check bot latency",
        ].join("\n"),
        inline: false,
      },
      { name: "\u200B", value: "** **", inline: false },
            { name: "\u200B", value: "** **", inline: false },
      {
        name: "\uD83D\uDD12 Rejection System (Hammer Role required)",
        value: [
          "`=reject @user reason`" + " \u2014 Reject a member (removes their roles and applies the rejected role)",
          "`=unreject @user`" + " \u2014 Remove rejection and restore the member role",
          "`=case @user`" + " \u2014 Check the rejection reason of a currently rejected member",
        ].join("\n"),
        inline: false,
      },
      {
        name: "\uD83C\uDFAE CTP \u2014 Call to Play (all members)",
        value: [
          "**System 1 \u2014 Category**",
          `\`${ctp}tag\`` + " \u2014 Join a game voice channel \u2192 type the command",
          "",
          "**System 2 \u2014 Onetap (Temp Voice)**",
          `\`${ctp}gamename\`` + " \u2014 Join a temp voice channel \u2192 type the game name",
          "\uD83D\uDCA1 Example: `" + ctp + "valorant` or `" + ctp + "fortnite`",
        ].join("\n"),
        inline: false,
      },
    )
    .setFooter({ text: "Night Stars \u2022 NS Bot" });
}

function buildPvsInfoEmbed() {
  return new EmbedBuilder()
    .setColor(0x5000ff)
    .setTitle("\uD83C\uDFA7 PVS \u2014 Private Voice System Commands")
    .setDescription("Commands for private voice room owners:")
    .addFields(
      { name: "`=key @user`", value: "Give or remove a member\u2019s access to your room.", inline: false },
      { name: "`=pull @user`", value: "Pull a member from the waiting room into your room.", inline: false },
      { name: "`=see keys`", value: "List all members who have access to your room.", inline: false },
      { name: "`=clear keys`", value: "Remove all keys \u2014 your room becomes fully private.", inline: false },
      { name: "`=name NewName`", value: "Rename your voice room.", inline: false },
      { name: "\u200B", value: "**Staff Command** (PVS Manager Role required)", inline: false },
      { name: "`+pv @member`", value: "Create a permanent private voice room for a member.", inline: false },
      { name: "`+pv delete @member`", value: "Remove a member\u2019s Premium Voice room.", inline: false },
    )
    .setFooter({ text: "Night Stars \u2022 PVS" });
}

function buildCtpInfoEmbed() {
  return new EmbedBuilder()
    .setColor(0x5000ff)
    .setTitle("\uD83C\uDFAE CTP \u2014 Call to Play Commands")
    .setDescription("Commands for calling players to your game:")
    .addFields(
      {
        name: "`-tag`",
        value:
          "Ping the game role for your current voice channel.\n" +
          "The bot detects which game you\u2019re in automatically based on the category.\n" +
          "Just join a game voice channel and type `-tag`.",
        inline: false,
      },
      {
        name: "Cooldown",
        value: "Each game has its own cooldown. If active, the bot tells you how long to wait.",
        inline: false,
      },
    )
    .setFooter({ text: "Night Stars \u2022 CTP" });
}

export async function registerPanelCommands(client: Client) {
  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error("DISCORD_TOKEN is missing");

  const setupCommand = new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Configure Night Stars bot systems")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addSubcommand((sub) => sub.setName("pvs").setDescription("Set up the Private Voice System (PVS)"))
    .addSubcommand((sub) => sub.setName("ctp-category").setDescription("Set up CTP for games with their own category"))
    .addSubcommand((sub) => sub.setName("ctp-onetap").setDescription("Set up CTP Onetap \u2014 temp voice game tagging"))
    .toJSON();

  const setupJailCommand = new SlashCommandBuilder()
    .setName("setup-reject")
    .setDescription("Configure the rejection system")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addRoleOption((option) =>
      option.setName("role-hammer").setDescription("Role allowed to use =reject and =unreject").setRequired(true),
    )
    .addRoleOption((option) =>
      option.setName("role-rejected").setDescription("Role given to rejected members").setRequired(true),
    )
    .addRoleOption((option) =>
      option.setName("role-member").setDescription("Member role restored after unreject").setRequired(true),
    )
    .addChannelOption((option) =>
      option
        .setName("logs-channel")
        .setDescription("Channel for rejection logs")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true),
    )
    .addRoleOption((option) =>
      option.setName("role-hammer-2").setDescription("Additional hammer role").setRequired(false),
    )
    .addRoleOption((option) =>
      option.setName("role-hammer-3").setDescription("Additional hammer role").setRequired(false),
    )
    .addRoleOption((option) =>
      option.setName("role-hammer-4").setDescription("Additional hammer role").setRequired(false),
    )
    .addRoleOption((option) =>
      option.setName("role-hammer-5").setDescription("Additional hammer role").setRequired(false),
    )
    .toJSON();

  const annCommand = new SlashCommandBuilder()
    .setName("ann")
    .setDescription("Announcement system")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addSubcommand((sub) => sub.setName("setup").setDescription("Configure the announcements system (tag role, embed colors)"))
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

  const generalCommand = new SlashCommandBuilder()
    .setName("general")
    .setDescription("General bot settings")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addSubcommand((sub) => sub.setName("setup").setDescription("Set the staff role and blocked channels"))
    .toJSON();

  const rest = new REST().setToken(token);

  const registerForGuild = async (guildId: string, guildName: string) => {
    try {
      await rest.put(Routes.applicationGuildCommands(client.user!.id, guildId), {
        body: [setupCommand, setupJailCommand, annCommand, generalCommand, helpCommand, pingCommand, prefixCommand],
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
      } else if (name === "setup-reject") {
        await handleSetupRejectCommand(interaction as ChatInputCommandInteraction);
      } else if (name === "ann") {
        await handleAnnCommand(interaction as ChatInputCommandInteraction);
      } else if (name === "general") {
        await handleGeneralCommand(interaction as ChatInputCommandInteraction);
      } else if (name === "ping") {
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x5000ff)
              .setDescription(`Latency: **${Math.round(interaction.client.ws.ping)}ms**`)
              .setFooter({ text: "Night Stars \u2022 NS Bot" }),
          ],
          ephemeral: true,
        });
      } else if (name === "prefix") {
        await openPrefixPanel(interaction as ChatInputCommandInteraction);
      } else if (name === "help") {
        const [helpRoleIds, staffRoleId] = await Promise.all([
          getHelpRoleIds(interaction.guildId!),
          getStaffRoleId(interaction.guildId!),
        ]);
        const isAdmin = interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator) ?? false;
        const rawMember = interaction.member as any;
        const memberRoleIds: string[] = rawMember
          ? (Array.isArray(rawMember.roles) ? rawMember.roles : (rawMember._roles as string[] ?? []))
          : [];
        const isCore = staffRoleId ? memberRoleIds.includes(staffRoleId) : false;
        const isStaff = helpRoleIds.some(id => memberRoleIds.includes(id));
        const hasRole = isAdmin || isCore || isStaff;
        if (!hasRole) {
          await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xff4d4d).setDescription("\u274C You don't have permission to use `/help`.")], ephemeral: true });
          return;
        }
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
        "gp_save", "gp_reset",
        "pfx_edit",
        "ap_save", "ap_reset", "ap_event_color_open", "ap_color_event_title", "ap_color_event_desc", "ap_color_event_add", "ap_back",
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
      const { customId } = interaction;
      if (customId === "pfx_modal") {
        await handlePrefixModalSubmit(interaction as ModalSubmitInteraction);
      } else if (customId.startsWith("cp_") || customId.startsWith("ct_")) {
        try { await handleCtpDetailsModalSubmit(interaction as ModalSubmitInteraction); } catch (err) { console.error("CTP modal error:", err); }
        try { await handleCtpTagModalSubmit(interaction as ModalSubmitInteraction); } catch (err) { console.error("CTP tag modal error:", err); }
      } else if (customId === "ap_modal_event_title") {
        await handleAnnColorModalSubmit(interaction as ModalSubmitInteraction, "event_title");
      } else if (customId === "ap_modal_event_desc") {
        await handleAnnColorModalSubmit(interaction as ModalSubmitInteraction, "event_desc");
      } else if (customId === "ap_modal_event_add") {
        await handleAnnColorModalSubmit(interaction as ModalSubmitInteraction, "event_add");
      }
      return;
    }
  });
}

async function handleGeneralCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(0x5000ff).setDescription("\u274C You need **Administrator** permission to use this.")],
      ephemeral: true,
    });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  const sub = interaction.options.getSubcommand();
  if (sub === "setup") {
    await openGeneralSetupPanel(interaction as unknown as ButtonInteraction);
  }
}

async function handleSetupCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(0x5000ff).setDescription("\u274C You need **Administrator** permission to use this.")],
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
  }
}

async function handleSetupRejectCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(0x5000ff).setDescription("\u274C You need **Administrator** permission to use this.")],
      ephemeral: true,
    });
    return;
  }

  const hammerRole = interaction.options.getRole("role-hammer", true);
  const hammerRoles = [
    hammerRole,
    interaction.options.getRole("role-hammer-2"),
    interaction.options.getRole("role-hammer-3"),
    interaction.options.getRole("role-hammer-4"),
    interaction.options.getRole("role-hammer-5"),
  ].filter((role): role is NonNullable<typeof hammerRole> => !!role);
  const uniqueHammerRoleIds = [...new Set(hammerRoles.map((role) => role.id))];
  const jailedRole = interaction.options.getRole("role-rejected", true);
  const memberRole = interaction.options.getRole("role-member", true);
  const logsChannel = interaction.options.getChannel("logs-channel", true);
  const guildId = interaction.guildId!;

  const existing = await db.select().from(botConfigTable).where(eq(botConfigTable.guildId, guildId)).limit(1);
  const values = {
    jailHammerRoleId: uniqueHammerRoleIds[0],
    jailHammerRoleIdsJson: JSON.stringify(uniqueHammerRoleIds),
    jailRoleId: jailedRole.id,
    memberRoleId: memberRole.id,
    jailLogsChannelId: logsChannel.id,
    updatedAt: new Date(),
  };

  if (existing.length) {
    await db.update(botConfigTable).set(values).where(eq(botConfigTable.guildId, guildId));
  } else {
    await db.insert(botConfigTable).values({ guildId, ...values });
  }

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x00c851)
        .setTitle("\u2705 Rejection System Configured")
        .setDescription(
          `**Hammer Roles** — ${uniqueHammerRoleIds.map((id) => `<@&${id}>`).join(", ")}\n` +
          `**Rejected Role** — <@&${jailedRole.id}>\n` +
          `**Member Role** — <@&${memberRole.id}>\n` +
          `**Logs Channel** — <#${logsChannel.id}>\n\n` +
          "Hammers can now use `=reject @user reason` and `=unreject @user`."
        )
        .setFooter({ text: "Night Stars \u2022 Rejection System" })
        .setTimestamp(),
    ],
    ephemeral: true,
  });
}

async function handleAnnCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(0x5000ff).setDescription("\u274C You need **Administrator** permission to use this.")],
      ephemeral: true,
    });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  const sub = interaction.options.getSubcommand();
  if (sub === "setup") {
    await openAnnPanel(interaction as unknown as ButtonInteraction);
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
    } else if (customId === "gp_save") {
      await handleGeneralPanelSave(interaction);
    } else if (customId === "gp_reset") {
      await handleGeneralPanelReset(interaction);
    } else if (customId === "pfx_edit") {
      await handlePrefixEditButton(interaction);
    } else if (customId === "ap_save") {
      await handleAnnPanelSave(interaction);
    } else if (customId === "ap_reset") {
      await handleAnnPanelReset(interaction);
    } else if (customId === "ap_event_color_open") {
      await openAnnColorPanel(interaction);
    } else if (customId === "ap_color_event_title") {
      await openAnnColorModal(interaction, "event_title");
    } else if (customId === "ap_color_event_desc") {
      await openAnnColorModal(interaction, "event_desc");
    } else if (customId === "ap_color_event_add") {
      await openAnnColorModal(interaction, "event_add");
    } else if (customId === "ap_back") {
      await handleAnnColorBack(interaction);
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
    } else if (customId === "gp_staff_role") {
      await handleGeneralStaffRoleSelect(interaction);
    } else if (customId === "gp_help_roles") {
      await handleGeneralHelpRolesSelect(interaction);
    } else if (customId.startsWith("ct_")) {
      await handleCtpTagRoleSelect(interaction);
    } else if (customId === "ap_ann_role") {
      await handleAnnAnnRoleSelect(interaction);
    } else if (customId === "ap_event_role") {
      await handleAnnEventRoleSelect(interaction);
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
    } else if (customId === "ap_logs_channel") {
      await handleAnnLogsChannelSelect(interaction);
    } else if (customId === "gp_blocked_ch") {
      await handleGeneralBlockedChSelect(interaction);
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
    .setTitle("\u2699\uFE0F System Prefixes")
    .setDescription("These prefixes define how members trigger each bot system. Click **Edit Prefixes** to change them.")
    .addFields(
      { name: "\uD83C\uDFA7 PVS Prefix", value: `\`${pvs}\``, inline: true },
      { name: "\uD83C\uDFA7 Manager Prefix", value: `\`${mgr}\``, inline: true },
      { name: "\uD83C\uDFAE CTP Prefix", value: `\`${ctp}\``, inline: true },
      { name: "\uD83D\uDCE3 Announcements Prefix", value: `\`${ann}\``, inline: true },
    )
    .setFooter({ text: "Night Stars \u2022 NS Bot" });
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
    .setTitle("\u2705 Prefixes Updated")
    .addFields(
      { name: "\uD83C\uDFA7 PVS Prefix", value: `\`${pvs}\``, inline: true },
      { name: "\uD83C\uDFA7 Manager Prefix", value: `\`${mgr}\``, inline: true },
      { name: "\uD83C\uDFAE CTP Prefix", value: `\`${ctp}\``, inline: true },
      { name: "\uD83D\uDCE3 Announcements Prefix", value: `\`${ann}\``, inline: true },
    )
    .setFooter({ text: "Night Stars \u2022 NS Bot" });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("pfx_edit").setLabel("Edit Again").setStyle(ButtonStyle.Secondary),
  );
  await interaction.update({ embeds: [embed], components: [row] });
}
