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
  RoleSelectMenuBuilder,
} from "discord.js";
import { isMainGuild } from "../utils/guildFilter.js";
import { handleSocialButton } from "../modules/social/index.js";
import { handleMoveButton } from "../modules/move/index.js";
import { db, pool } from "@workspace/db";
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
  handleCtpEditModalSubmit,
  handleCtpRemoveGame,
  handleCtpBackToManage,
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
  handleGeneralEventHosterSelect,
  handleGeneralBlockedChSelect,
  handleGeneralClearRolesSelect,
  handleGeneralMoveRolesSelect,
  handleGeneralMoveRequestRolesSelect,
  handleGeneralPanelNext,
  handleGeneralPanelBack,
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
import {
  openWelcomePanel,
  handleWelcomeButton,
  handleWelcomeChannelSelect,
  handleWelcomeStringSelect,
  handleWelcomeModalSubmit,
} from "./welcome.js";
import {
  openMovePanel,
  handleMovePowerfulSelect,
  handleMoveConfirmationSelect,
  handleMovePanelReset,
} from "./move.js";
import {
  openClearPanel,
  handleClearRolesSelect,
  handleClearPanelSave,
  handleClearPanelReset,
  handleClearPanelPreview,
} from "./clear.js";
import { handleMasterSetupButton } from "./master.js";
import {
  openMusicPanel,
  handleMusicDjRoleSelect,
  handleMusicChannelSelect,
  handleMusicPlaylistRoleSelect,
  handleMusicPlaylistChannelsSelect,
  handleMusicReset,
  handleMusicAddArtistButton,
  handleMusicAddModalSubmit,
  handleMusicPickButton,
  handleMusicPickCancel,
  handleMusicRemoveButton,
  handleMusicRemoveSelect,
} from "./music.js";
import {
  openAutoModPanel,
  handleAutoModButton,
  handleAutoModRoleSelect,
  handleAutoModChannelSelect,
  handleAutoModStringSelect,
  handleAutoModModal,
} from "./automod.js";
import {
  openServerLogsPanel,
  handleServerLogsButton,
  handleServerLogsChannelSelect,
} from "./server-logs.js";
import { sendStaffHelp, handleHelpButton, handleHelpSelect } from "../modules/help/index.js";
import {
  openMoneyPanel,
  handleMoneySetPayment,
  handleMoneyPaymentModal,
  handleMoneySetLogs,
  handleMoneyLogsChannelSelect,
  handleMoneyAddTier,
  handleMoneyAddTierModal,
  handleMoneyEditTier,
  handleMoneyEditTierSelect,
  handleMoneyEditTierModal,
  handleMoneyDeleteTier,
  handleMoneyDeleteTierSelect,
  handleMoneyAddEmbed,
  handleMoneyAddEmbedModal,
  handleMoneyEditEmbed,
  handleMoneyEditEmbedSelect,
  handleMoneyEditEmbedModal,
  handleMoneyDeleteEmbed,
  handleMoneyDeleteEmbedSelect,
  handleMoneyPublish,
  handleMoneyPublishChannelSelect,
  handleMoneyConfirmPublish,
  handleMoneyEditPosted,
  handleMoneyBackToPanel,
  handleMoneyBack,
} from "./money.js";
import {
  openFeedbackPanel,
  handleFeedbackSetStaff,
  handleFeedbackStaffChannelSelect,
  handleFeedbackSendEmbed,
  handleFeedbackEmbedChannelSelect,
  handleFeedbackConfirmSend,
  handleFeedbackBack,
} from "./feedback.js";
import { startDonationDmSession } from "../modules/money/index.js";
import { startFeedbackDmSession } from "../modules/feedback/index.js";
import {
  openFindModal,
  handleFindModalSubmit,
  handleFindPick,
} from "./findHelper.js";

export function buildAllCommandsEmbed(pvs = "=", mgr = "+", ctp = "-", ann = "!") {
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
          "`/tag-category` \u2014 Configure Tag Category (games with their own category)",
          "`/tag-onetap` \u2014 Configure Tag One-Tap (temp voice game tagging)",
          "`/general setup` \u2014 Set staff role & blocked channels",
          "`/setup-jail` \u2014 Configure hammer, jail, member, and logs channel",
          "`/ann setup` \u2014 Configure announcements (roles, event colors)",
          "`/auto-delete` \u2014 Block words server-wide & per-channel/category content rules",
          "`/prefix` \u2014 View and edit command prefixes",
          "`/ping` \u2014 Check bot latency",
        ].join("\n"),
        inline: false,
      },
      {
        name: "\uD83D\uDDBC\uFE0F Utilities (everyone)",
        value: "`A @user` \u2014 Show a member's global & server avatar",
        inline: false,
      },
      {
        name: "\uD83D\uDD04 Move (Move Role required)",
        value: "`aji @user` \u2014 Move that member to your current voice channel",
        inline: false,
      },
      {
        name: "\uD83E\uDDF9 Clear (Clear Role or Admin)",
        value: "`mse7 N` \u2014 Delete the last N messages in this channel (max 99)",
        inline: false,
      },
      {
        name: "\uD83D\uDC4B Welcome (Admin)",
        value: "`/welcome setup` \u2014 Configure server channel & DM welcome messages",
        inline: false,
      },
      {
        name: "\uD83C\uDFA4 Stage Lock (Admin or Event Hoster)",
        value: [
          "`=stagelock`" + " \u2014 In a voice/stage channel: block the Member role from connecting",
          "`=stageunlock`" + " \u2014 Re-allow the Member role to connect to that channel",
        ].join("\n"),
        inline: false,
      },
      { name: "\u200B", value: "** **", inline: false },
            { name: "\u200B", value: "** **", inline: false },

      { name: "\u200B", value: "** **", inline: false },
      {
        name: "\uD83C\uDFB5 Music Releases (DJ Role or Admin)",
        value: [
          "`=post <link>` \u2014 Post a music release (Deezer, Spotify, Apple Music, etc.)",
          "`=add <artist name>` \u2014 Add an artist to auto-release tracking",
          "`/music` \u2014 Configure DJ role and notification channel (Admin only)",
        ].join("\n"),
        inline: false,
      },
      { name: "\u200B", value: "** **", inline: false },
      {
        name: "\uD83D\uDC9E Social System (everyone)",
        value: [
          "`=relationship @user` \u2014 View your or another member's relationship status",
          "`=propose @user` \u2014 Send a marriage proposal (target gets Accept/Reject DM)",
          "`=breakup` \u2014 End your current relationship",
          "`=children` \u2014 View your children list",
          "`=adopt @user` \u2014 Send an adoption request",
        ].join("\n"),
        inline: false,
      },
      {
        name: "\uD83D\uDD12 Jail System (Hammer Role required)",
        value: [
          "`=jail @user reason`" + " \u2014 Jail a member (removes their roles and applies the jail role)",
          "`=unjail @user`" + " \u2014 Remove jail and restore the member role",
          "`=case @user`" + " \u2014 Check the jail reason of a currently jailed member",
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

  const pvsCommand = new SlashCommandBuilder()
    .setName("pvs")
    .setDescription("Configure the Private Voice System (PVS)")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .toJSON();

  const ctpCategoryCommand = new SlashCommandBuilder()
    .setName("tag-category")
    .setDescription("Configure Tag Category \u2014 games with their own category")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .toJSON();

  const ctpOnetapCommand = new SlashCommandBuilder()
    .setName("tag-onetap")
    .setDescription("Configure Tag One-Tap \u2014 temp voice game tagging")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .toJSON();

  const jailCommand = new SlashCommandBuilder()
    .setName("jail")
    .setDescription("Configure the jail system")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addRoleOption((option) =>
      option.setName("role-hammer").setDescription("Role allowed to use =jail and =unjail").setRequired(true),
    )
    .addRoleOption((option) =>
      option.setName("role-rejected").setDescription("Role given to rejected members").setRequired(true),
    )
    .addRoleOption((option) =>
      option.setName("role-member").setDescription("Member role restored after unjail").setRequired(true),
    )
    .addChannelOption((option) =>
      option
        .setName("logs-channel")
        .setDescription("Channel for jail logs")
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
    .setDescription("Configure the announcements system (tag role, embed colors)")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
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
    .setDescription("Set the staff role and blocked channels")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .toJSON();

  const roleGiverCommand = new SlashCommandBuilder()
    .setName("role-giver")
    .setDescription("Open the Role Giver panel")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .toJSON();

  const welcomeCommand = new SlashCommandBuilder()
    .setName("welcome")
    .setDescription("Configure the welcome system")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .toJSON();

  const automodCommand = new SlashCommandBuilder()
    .setName("automod")
    .setDescription("Open the Auto-Mod panel (links, spam, channel modes, auto-responses)")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .toJSON();

  const logsCommand = new SlashCommandBuilder()
    .setName("logs")
    .setDescription("Configure server event logging (auto-creates a log channel per event)")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .toJSON();

  const buildRoleSet = (builder: SlashCommandBuilder) =>
    builder
      .addRoleOption((o) => o.setName("role-1").setDescription("Allowed role").setRequired(true))
      .addRoleOption((o) => o.setName("role-2").setDescription("Additional allowed role").setRequired(false))
      .addRoleOption((o) => o.setName("role-3").setDescription("Additional allowed role").setRequired(false))
      .addRoleOption((o) => o.setName("role-4").setDescription("Additional allowed role").setRequired(false))
      .addRoleOption((o) => o.setName("role-5").setDescription("Additional allowed role").setRequired(false));

  // /move now takes TWO role groups: powerful (instant move, no confirmation)
  // and confirmation (target gets accept/reject buttons). Anyone with the
  // Move Members permission is auto-allowed for the confirmation flow even
  // without a configured role.
  const moveCommand = new SlashCommandBuilder()
    .setName("move")
    .setDescription("Open the Move setup panel (powerful + confirmation roles)")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .toJSON();

  const clearCommand = new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Open the Clear setup panel (roles allowed to use mse7)")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .toJSON();

  const musicCommand = new SlashCommandBuilder()
    .setName("music")
    .setDescription("Configure the Music Release system (DJ role, notification channel)")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .toJSON();

  const moneyCommand = new SlashCommandBuilder()
    .setName("donate")
    .setDescription("Configure the donation system: tiers, payment info, logs, embeds, and publish")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .toJSON();

  const feedbackCommand = new SlashCommandBuilder()
    .setName("feedback")
    .setDescription("Configure the anonymous feedback system and send feedback embed")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .toJSON();

  const rest = new REST().setToken(token);

  const registerForGuild = async (guildId: string, guildName: string) => {
    try {
      await rest.put(Routes.applicationGuildCommands(client.user!.id, guildId), {
        body: [
          pvsCommand,
          ctpCategoryCommand,
          ctpOnetapCommand,
          jailCommand,
          annCommand,
          generalCommand,
          roleGiverCommand,
          welcomeCommand,
          automodCommand,
          logsCommand,
          moveCommand,
          clearCommand,
          musicCommand,
          moneyCommand,
          feedbackCommand,
          helpCommand,
          pingCommand,
          prefixCommand,
        ],
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
      if (name === "pvs" || name === "tag-category" || name === "tag-onetap") {
        await handleSetupCommand(interaction as ChatInputCommandInteraction);
      } else if (name === "jail") {
        await handleSetupRejectCommand(interaction as ChatInputCommandInteraction);
      } else if (name === "ann") {
        await handleAnnCommand(interaction as ChatInputCommandInteraction);
      } else if (name === "general") {
        await handleGeneralCommand(interaction as ChatInputCommandInteraction);
      } else if (name === "role-giver") {
        await handleRoleGiverCommand(interaction as ChatInputCommandInteraction);
      } else if (name === "welcome") {
        if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
          await interaction.reply({
            embeds: [new EmbedBuilder().setColor(0x5000ff).setDescription("\u274C You need **Administrator** permission to use this.")],
            ephemeral: true,
          });
        } else {
          await openWelcomePanel(interaction as ChatInputCommandInteraction);
        }
      } else if (name === "automod") {
        if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
          await interaction.reply({
            embeds: [new EmbedBuilder().setColor(0x5000ff).setDescription("\u274C You need **Administrator** permission to use this.")],
            ephemeral: true,
          });
        } else {
          await openAutoModPanel(interaction as ChatInputCommandInteraction);
        }
      } else if (name === "logs") {
        if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
          await interaction.reply({
            embeds: [new EmbedBuilder().setColor(0x5000ff).setDescription("\u274C You need **Administrator** permission to use this.")],
            ephemeral: true,
          });
        } else {
          await openServerLogsPanel(interaction as ChatInputCommandInteraction);
        }
      } else if (name === "move") {
        await openMovePanel(interaction as ChatInputCommandInteraction);
      } else if (name === "clear") {
        await openClearPanel(interaction as ChatInputCommandInteraction);
      } else if (name === "music") {
        await openMusicPanel(interaction as ChatInputCommandInteraction);
      } else if (name === "donate") {
        if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
          await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xff4d4d).setDescription("❌ You need **Administrator** permission to use this.")], ephemeral: true });
          return;
        }
        await interaction.deferReply({ ephemeral: true });
        await openMoneyPanel(interaction as unknown as ButtonInteraction);
      } else if (name === "feedback") {
        if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
          await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xff4d4d).setDescription("❌ You need **Administrator** permission to use this.")], ephemeral: true });
          return;
        }
        await interaction.deferReply({ ephemeral: true });
        await openFeedbackPanel(interaction as unknown as ButtonInteraction);
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
        await sendStaffHelp(interaction as ChatInputCommandInteraction);
      }
      return;
    }

    if (interaction.isButton()) {
      if (interaction.customId.startsWith("find:btn:")) {
        try { await openFindModal(interaction as ButtonInteraction); } catch (err) { console.error("Find button error:", err); }
        return;
      }
      if (interaction.customId.startsWith("help_")) {
        try { await handleHelpButton(interaction as ButtonInteraction); } catch (err) { console.error("Help button error:", err); }
        return;
      }
      const panelIds = [
        "pp_save", "pp_reset",
        "cp_add_new", "cp_edit_game", "cp_remove_game", "cp_back_manage",
        "cp_save", "cp_reset",
        "gp_save", "gp_reset", "gp_next", "gp_back",
        "pfx_edit",
        "ap_save", "ap_reset", "ap_event_color_open", "ap_color_event_title", "ap_color_event_desc", "ap_color_event_add", "ap_back",
        "rg_add", "rg_edit", "rg_preview", "rg_delete", "rg_save", "rg_cancel", "rg_back",
      ];
      if (interaction.customId.startsWith("wc_")) {
        try { await handleWelcomeButton(interaction as ButtonInteraction); } catch (err) { console.error("Welcome button error:", err); }
        return;
      }
      if (interaction.customId.startsWith("am_")) {
        try { await handleAutoModButton(interaction as ButtonInteraction); } catch (err) { console.error("AutoMod button error:", err); }
        return;
      }
      if (interaction.customId.startsWith("sl_")) {
        try { await handleServerLogsButton(interaction as ButtonInteraction); } catch (err) { console.error("ServerLogs button error:", err); }
        return;
      }
      if (interaction.customId.startsWith("ms_")) {
        try { await handleMasterSetupButton(interaction as ButtonInteraction); } catch (err) { console.error("Master setup button error:", err); }
        return;
      }
      if (interaction.customId.startsWith("soc_")) {
        try { await handleSocialButton(interaction as ButtonInteraction); } catch (err) { console.error("Social button error:", err); }
        return;
      }
      if (interaction.customId.startsWith("mu_")) {
        try {
          if (interaction.customId === "mu_reset") {
            await handleMusicReset(interaction as ButtonInteraction);
          } else if (interaction.customId === "mu_add_artist") {
            await handleMusicAddArtistButton(interaction as ButtonInteraction);
          } else if (interaction.customId === "mu_remove_artist") {
            await handleMusicRemoveButton(interaction as ButtonInteraction);
          } else if (interaction.customId.startsWith("mu_pick_cancel:")) {
            await handleMusicPickCancel(interaction as ButtonInteraction);
          } else if (interaction.customId.startsWith("mu_pick:")) {
            await handleMusicPickButton(interaction as ButtonInteraction);
          } else if (interaction.customId.startsWith("mu_link:")) {
            // 🔗 link button on a release/playlist post: drop the link into
            // the clicker's voice channel text chat as two plain messages
            // (intro line + the URL on its own), and reply ephemerally with
            // an embed in the album's color so the response visually matches
            // the post they clicked.
            const btn = interaction as ButtonInteraction;
            const url = btn.customId.slice("mu_link:".length);
            const sourceEmbed = btn.message.embeds?.[0];
            const albumColor = sourceEmbed?.color ?? 0x5000ff;
            const authorName = sourceEmbed?.author?.name ?? "";
            const isPlaylist = /playlist/i.test(authorName);
            const kind = isPlaylist ? "playlist" : "album";
            const member = await btn.guild!.members.fetch(btn.user.id).catch(() => null);
            const voiceChannel = member?.voice?.channel;
            if (!voiceChannel || (voiceChannel.type !== ChannelType.GuildVoice && voiceChannel.type !== ChannelType.GuildStageVoice)) {
              await btn.reply({
                embeds: [
                  new EmbedBuilder()
                    .setColor(albumColor)
                    .setDescription(`Join a voice channel first, then click 🔗 again to get the ${kind} link in your voice chat.`),
                ],
                ephemeral: true,
              });
              return;
            }
            try {
              await voiceChannel.send({
                content: `<@${btn.user.id}> here is your ${kind} link — enjoy!`,
                allowedMentions: { users: [btn.user.id] },
              });
              await voiceChannel.send({
                content: url,
                allowedMentions: { parse: [] },
              });
              await btn.reply({
                embeds: [
                  new EmbedBuilder()
                    .setColor(albumColor)
                    .setDescription(`You got the ${kind} link in your voice chat (<#${voiceChannel.id}>).`),
                ],
                ephemeral: true,
              });
            } catch (err) {
              console.error("Music link send error:", err);
              await btn.reply({
                embeds: [
                  new EmbedBuilder()
                    .setColor(albumColor)
                    .setDescription("I couldn't send the link there. Make sure I have **View Channel** + **Send Messages** in your voice channel."),
                ],
                ephemeral: true,
              });
            }
          }
        } catch (err) {
          console.error("Music button error:", err);
        }
        return;
      }
      if (interaction.customId.startsWith("mp_")) {
        try {
          const cid = interaction.customId;
          if      (cid === "mp_set_payment")     await handleMoneySetPayment(interaction as ButtonInteraction);
          else if (cid === "mp_set_logs")        await handleMoneySetLogs(interaction as ButtonInteraction);
          else if (cid === "mp_add_tier")        await handleMoneyAddTier(interaction as ButtonInteraction);
          else if (cid === "mp_edit_tier")       await handleMoneyEditTier(interaction as ButtonInteraction);
          else if (cid === "mp_delete_tier")     await handleMoneyDeleteTier(interaction as ButtonInteraction);
          else if (cid === "mp_add_embed")       await handleMoneyAddEmbed(interaction as ButtonInteraction);
          else if (cid === "mp_edit_embed")      await handleMoneyEditEmbed(interaction as ButtonInteraction);
          else if (cid === "mp_delete_embed")    await handleMoneyDeleteEmbed(interaction as ButtonInteraction);
          else if (cid === "mp_publish")         await handleMoneyPublish(interaction as ButtonInteraction);
          else if (cid === "mp_confirm_publish") await handleMoneyConfirmPublish(interaction as ButtonInteraction);
          else if (cid === "mp_edit_posted")     await handleMoneyEditPosted(interaction as ButtonInteraction);
          else if (cid === "mp_back_to_panel")   await handleMoneyBackToPanel(interaction as ButtonInteraction);
          else if (cid === "mp_back")            await handleMoneyBack(interaction as ButtonInteraction);
        } catch (err) { console.error("Donate panel button error:", err); }
        return;
      }
      if (interaction.customId === "dn_donate") {
        try { await startDonationDmSession(interaction as ButtonInteraction); } catch (err) { console.error("Donate button error:", err); }
        return;
      }
      if (interaction.customId.startsWith("fb_")) {
        try {
          const cid = interaction.customId;
          if (cid === "fb_set_staff") {
            await handleFeedbackSetStaff(interaction as ButtonInteraction);
          } else if (cid === "fb_send_embed") {
            await handleFeedbackSendEmbed(interaction as ButtonInteraction);
          } else if (cid === "fb_confirm_send") {
            await handleFeedbackConfirmSend(interaction as ButtonInteraction);
          } else if (cid === "fb_back") {
            await handleFeedbackBack(interaction as ButtonInteraction);
          }
        } catch (err) { console.error("Feedback panel button error:", err); }
        return;
      }
      if (interaction.customId === "feedback_open") {
        try { await startFeedbackDmSession(interaction as ButtonInteraction); } catch (err) { console.error("Feedback open button error:", err); }
        return;
      }
      if (interaction.customId.startsWith("mv_")) {
        if (interaction.customId.startsWith("mv_accept:") || interaction.customId.startsWith("mv_reject:")) {
          try { await handleMoveButton(interaction as ButtonInteraction); } catch (err) { console.error("Move button error:", err); }
        } else {
          await handleButtonInteraction(interaction as ButtonInteraction);
        }
        return;
      }
      if (panelIds.includes(interaction.customId) || interaction.customId.startsWith("ct_") || interaction.customId.startsWith("rg_")) {
        await handleButtonInteraction(interaction as ButtonInteraction);
      }
      return;
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId.startsWith("find:pick:")) {
        try { await handleFindPick(interaction as StringSelectMenuInteraction); } catch (err) { console.error("Find pick error:", err); }
        return;
      }
      if (interaction.customId.startsWith("help_") && interaction.customId.endsWith("_select")) {
        try { await handleHelpSelect(interaction as StringSelectMenuInteraction); } catch (err) { console.error("Help select error:", err); }
        return;
      }
      if (interaction.customId.startsWith("am_")) {
        try { await handleAutoModStringSelect(interaction as StringSelectMenuInteraction); } catch (err) { console.error("AutoMod string select error:", err); }
        return;
      }
      if (interaction.customId === "mp_edit_tier_select") {
        try { await handleMoneyEditTierSelect(interaction as StringSelectMenuInteraction); } catch (err) { console.error("Donate edit tier select error:", err); }
        return;
      }
      if (interaction.customId === "mp_delete_tier_select") {
        try { await handleMoneyDeleteTierSelect(interaction as StringSelectMenuInteraction); } catch (err) { console.error("Donate delete tier select error:", err); }
        return;
      }
      if (interaction.customId === "mp_edit_embed_select") {
        try { await handleMoneyEditEmbedSelect(interaction as StringSelectMenuInteraction); } catch (err) { console.error("Donate edit embed select error:", err); }
        return;
      }
      if (interaction.customId === "mp_delete_embed_select") {
        try { await handleMoneyDeleteEmbedSelect(interaction as StringSelectMenuInteraction); } catch (err) { console.error("Donate delete embed select error:", err); }
        return;
      }
      if (interaction.customId === "cp_game_select") {
        try { await handleCtpGameSelect(interaction as StringSelectMenuInteraction); } catch (err) { console.error("CTP game select error:", err); }
      } else if (interaction.customId.startsWith("ct_")) {
        try { await handleCtpTagStringSelect(interaction as StringSelectMenuInteraction); } catch (err) { console.error("CTP temp select error:", err); }
      } else if (interaction.customId.startsWith("wc_")) {
        try { await handleWelcomeStringSelect(interaction as StringSelectMenuInteraction); } catch (err) { console.error("Welcome select error:", err); }
      } else if (interaction.customId === "mu_remove_select") {
        try { await handleMusicRemoveSelect(interaction as StringSelectMenuInteraction); } catch (err) { console.error("Music remove select error:", err); }
      }
      return;
    }

    if (interaction.isRoleSelectMenu()) {
      if (interaction.customId.startsWith("am_")) {
        try { await handleAutoModRoleSelect(interaction as RoleSelectMenuInteraction); } catch (err) { console.error("AutoMod role select error:", err); }
        return;
      }
      if (interaction.customId === "mu_dj_role") {
        try { await handleMusicDjRoleSelect(interaction as RoleSelectMenuInteraction); } catch (err) { console.error("Music role select error:", err); }
        return;
      }
      if (interaction.customId === "mu_playlist_role") {
        try { await handleMusicPlaylistRoleSelect(interaction as RoleSelectMenuInteraction); } catch (err) { console.error("Music playlist role select error:", err); }
        return;
      }
      await handleRoleSelectInteraction(interaction as RoleSelectMenuInteraction);
      return;
    }

    if (interaction.isChannelSelectMenu()) {
      if (interaction.customId.startsWith("wc_")) {
        try { await handleWelcomeChannelSelect(interaction as ChannelSelectMenuInteraction); } catch (err) { console.error("Welcome channel select error:", err); }
        return;
      }
      if (interaction.customId.startsWith("am_")) {
        try { await handleAutoModChannelSelect(interaction as ChannelSelectMenuInteraction); } catch (err) { console.error("AutoMod channel select error:", err); }
        return;
      }
      if (interaction.customId.startsWith("sl_")) {
        try { await handleServerLogsChannelSelect(interaction as ChannelSelectMenuInteraction); } catch (err) { console.error("ServerLogs channel select error:", err); }
        return;
      }
      if (interaction.customId === "mu_channel") {
        try { await handleMusicChannelSelect(interaction as ChannelSelectMenuInteraction); } catch (err) { console.error("Music channel select error:", err); }
        return;
      }
      if (interaction.customId === "mu_playlist_channels") {
        try { await handleMusicPlaylistChannelsSelect(interaction as ChannelSelectMenuInteraction); } catch (err) { console.error("Music playlist channels select error:", err); }
        return;
      }
      if (interaction.customId === "mp_logs_ch") {
        try { await handleMoneyLogsChannelSelect(interaction as ChannelSelectMenuInteraction); } catch (err) { console.error("Donate logs channel select error:", err); }
        return;
      }
      if (interaction.customId === "mp_publish_ch") {
        try { await handleMoneyPublishChannelSelect(interaction as ChannelSelectMenuInteraction); } catch (err) { console.error("Donate publish channel select error:", err); }
        return;
      }
      if (interaction.customId === "fb_staff_ch") {
        try { await handleFeedbackStaffChannelSelect(interaction as ChannelSelectMenuInteraction); } catch (err) { console.error("Feedback staff channel select error:", err); }
        return;
      }
      if (interaction.customId === "fb_embed_ch") {
        try { await handleFeedbackEmbedChannelSelect(interaction as ChannelSelectMenuInteraction); } catch (err) { console.error("Feedback embed channel select error:", err); }
        return;
      }
      await handleChannelSelectInteraction(interaction as ChannelSelectMenuInteraction);
      return;
    }

    if (interaction.isModalSubmit()) {
      const { customId } = interaction;
      if (customId.startsWith("find:mod:")) {
        try { await handleFindModalSubmit(interaction as ModalSubmitInteraction); } catch (err) { console.error("Find modal error:", err); }
        return;
      }
      if (customId.startsWith("am_")) {
        try { await handleAutoModModal(interaction as ModalSubmitInteraction); } catch (err) { console.error("AutoMod modal error:", err); }
        return;
      }
      if (customId === "pfx_modal") {
        await handlePrefixModalSubmit(interaction as ModalSubmitInteraction);
      } else if (customId.startsWith("cp_")) {
        try { await handleCtpEditModalSubmit(interaction as ModalSubmitInteraction); } catch (err) { console.error("CTP modal error:", err); }
      } else if (customId.startsWith("ct_")) {
        try { await handleCtpTagModalSubmit(interaction as ModalSubmitInteraction); } catch (err) { console.error("CTP tag modal error:", err); }
      } else if (customId === "ap_modal_event_title") {
        await handleAnnColorModalSubmit(interaction as ModalSubmitInteraction, "event_title");
      } else if (customId === "ap_modal_event_desc") {
        await handleAnnColorModalSubmit(interaction as ModalSubmitInteraction, "event_desc");
      } else if (customId === "ap_modal_event_add") {
        await handleAnnColorModalSubmit(interaction as ModalSubmitInteraction, "event_add");
      } else if (customId.startsWith("rg_")) {
        await handleRoleGiverModalSubmit(interaction as ModalSubmitInteraction);
      } else if (customId.startsWith("wc_modal_")) {
        try { await handleWelcomeModalSubmit(interaction as ModalSubmitInteraction); } catch (err) { console.error("Welcome modal error:", err); }
      } else if (customId === "mu_add_modal") {
        try { await handleMusicAddModalSubmit(interaction as ModalSubmitInteraction); } catch (err) { console.error("Music add modal error:", err); }
      } else if (customId === "mp_payment_modal") {
        try { await handleMoneyPaymentModal(interaction as ModalSubmitInteraction); } catch (err) { console.error("Donate payment modal error:", err); }
      } else if (customId === "mp_add_tier_modal") {
        try { await handleMoneyAddTierModal(interaction as ModalSubmitInteraction); } catch (err) { console.error("Donate add tier modal error:", err); }
      } else if (customId.startsWith("mp_edit_tier_modal:")) {
        try { await handleMoneyEditTierModal(interaction as ModalSubmitInteraction); } catch (err) { console.error("Donate edit tier modal error:", err); }
      } else if (customId === "mp_add_embed_modal") {
        try { await handleMoneyAddEmbedModal(interaction as ModalSubmitInteraction); } catch (err) { console.error("Donate add embed modal error:", err); }
      } else if (customId.startsWith("mp_edit_embed_modal:")) {
        try { await handleMoneyEditEmbedModal(interaction as ModalSubmitInteraction); } catch (err) { console.error("Donate edit embed modal error:", err); }
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
  await openGeneralSetupPanel(interaction as unknown as ButtonInteraction);
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
  const name = interaction.commandName;
  if (name === "pvs") {
    await openPvsPanel(interaction as unknown as ButtonInteraction);
  } else if (name === "tag-category") {
    await openCtpManagePanel(interaction as unknown as ButtonInteraction);
  } else if (name === "tag-onetap") {
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
        .setTitle("\u2705 Jail System Configured")
        .setDescription(
          `**Hammer Roles** — ${uniqueHammerRoleIds.map((id) => `<@&${id}>`).join(", ")}\n` +
          `**Jail Role** — <@&${jailedRole.id}>\n` +
          `**Member Role** — <@&${memberRole.id}>\n` +
          `**Logs Channel** — <#${logsChannel.id}>\n\n` +
          "Hammers can now use `=jail @user reason` and `=unjail @user`."
        )
        .setFooter({ text: "Night Stars \u2022 Jail System" })
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
  await openAnnPanel(interaction as unknown as ButtonInteraction);
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
    } else if (customId === "cp_save") {
      await handleCtpPanelSave(interaction);
    } else if (customId === "cp_reset") {
      await handleCtpPanelReset(interaction);
    } else if (customId === "gp_save") {
      await handleGeneralPanelSave(interaction);
    } else if (customId === "gp_reset") {
      await handleGeneralPanelReset(interaction);
    } else if (customId === "gp_next") {
      await handleGeneralPanelNext(interaction);
    } else if (customId === "gp_back") {
      await handleGeneralPanelBack(interaction);
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
    } else if (customId.startsWith("rg_")) {
      await handleRoleGiverButton(interaction);
    } else if (customId === "mv_reset") {
      await handleMovePanelReset(interaction);
    } else if (customId === "cl_save") {
      await handleClearPanelSave(interaction);
    } else if (customId === "cl_reset") {
      await handleClearPanelReset(interaction);
    } else if (customId === "cl_preview") {
      await handleClearPanelPreview(interaction);
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
    } else if (customId === "gp_event_hoster") {
      await handleGeneralEventHosterSelect(interaction);
    } else if (customId === "gp_clear_roles") {
      await handleGeneralClearRolesSelect(interaction);
    } else if (customId === "gp_move_roles") {
      await handleGeneralMoveRolesSelect(interaction);
    } else if (customId === "gp_move_request_roles") {
      await handleGeneralMoveRequestRolesSelect(interaction);
    } else if (customId.startsWith("ct_")) {
      await handleCtpTagRoleSelect(interaction);
    } else if (customId === "ap_ann_role") {
      await handleAnnAnnRoleSelect(interaction);
    } else if (customId === "ap_event_role") {
      await handleAnnEventRoleSelect(interaction);
    } else if (customId.startsWith("rg_")) {
      await handleRoleGiverRoleSelect(interaction);
    } else if (customId === "mv_powerful_roles") {
      await handleMovePowerfulSelect(interaction);
    } else if (customId === "mv_confirmation_roles") {
      await handleMoveConfirmationSelect(interaction);
    } else if (customId === "cl_roles") {
      await handleClearRolesSelect(interaction);
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

export async function getGuildPrefixes(guildId: string) {
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
  const { pvs } = await getGuildPrefixes(interaction.guildId!);
  const embed = new EmbedBuilder()
    .setColor(0x5000ff)
    .setTitle("\u2699\uFE0F Bot Prefix")
    .setDescription("This prefix triggers all bot commands (PVS, Manager, CTP staff commands, Announcements, Jail, `setup`).\n\nNote: the CTP `tag` and one-tap `tag <game>` commands always work without a prefix.")
    .addFields(
      { name: "\uD83E\uDDE9 Current Prefix", value: `\`${pvs}\``, inline: true },
    )
    .setFooter({ text: "Night Stars \u2022 NS Bot" });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("pfx_edit").setLabel("Edit Prefix").setStyle(ButtonStyle.Primary),
  );
  await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
}

async function handlePrefixEditButton(interaction: ButtonInteraction) {
  const { pvs } = await getGuildPrefixes(interaction.guildId!);
  const modal = new ModalBuilder().setCustomId("pfx_modal").setTitle("Edit Bot Prefix");
  const pvsInput = new TextInputBuilder()
    .setCustomId("pfx_pvs").setLabel("Bot Prefix (used by all systems)").setStyle(TextInputStyle.Short)
    .setValue(pvs).setMinLength(1).setMaxLength(5).setRequired(true);
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(pvsInput),
  );
  await interaction.showModal(modal);
}

async function handlePrefixModalSubmit(interaction: ModalSubmitInteraction) {
  const guildId = interaction.guildId!;
  const pvs = interaction.fields.getTextInputValue("pfx_pvs").trim();
  // Single unified prefix — mirror it across all four columns so every
  // module (which may read any of them) sees the same value.
  await db
    .update(botConfigTable)
    .set({ pvsPrefix: pvs, managerPrefix: pvs, ctpPrefix: pvs, annPrefix: pvs })
    .where(eq(botConfigTable.guildId, guildId));
  const embed = new EmbedBuilder()
    .setColor(0x00c851)
    .setTitle("\u2705 Bot Prefix Updated")
    .addFields(
      { name: "\uD83E\uDDE9 New Prefix", value: `\`${pvs}\``, inline: true },
    )
    .setFooter({ text: "Night Stars \u2022 NS Bot" });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("pfx_edit").setLabel("Edit Again").setStyle(ButtonStyle.Secondary),
  );
  await (interaction as any).update({ embeds: [embed], components: [row] });
}


type RoleGiverDraft = {
  commandName: string;
  linkedCategory: string | null;
  targetRoleId?: string;
  giverRoleIds: string[];
};

const roleGiverDrafts = new Map<string, RoleGiverDraft>();

function roleGiverDraftKey(interaction: { guildId: string | null; user: { id: string } }) {
  return `${interaction.guildId}:${interaction.user.id}`;
}

function normalizeRoleGiverCommandName(raw: string) {
  return raw.trim().toLowerCase().replace(/^=/, "");
}

function validRoleGiverCommandName(commandName: string) {
  return /^[a-z0-9_-]{2,32}$/.test(commandName);
}

function buildRoleGiverPanelEmbed() {
  return new EmbedBuilder()
    .setColor(0x5000ff)
    .setTitle("Role Giver Setup Panel")
    .setDescription(
      "Manage all role-giver commands from this one panel.\n\n" +
      "Enter the command name, select Add role, and optionally enter a category name. Members will use `=[cmd name] @user`, for example `=legend @user`.\n\n" +
      "If 2 or 3 roles use the same category, giving one of them to a user removes the other roles from that same category first. Leave category empty if this role should not remove anything."
    )
    .setFooter({ text: "Night Stars • Role Giver" })
    .setTimestamp();
}

function buildRoleGiverPanelRows() {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("rg_add").setLabel("Add Role").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("rg_edit").setLabel("Edit Role").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("rg_preview").setLabel("Preview Commands").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("rg_delete").setLabel("Delete Role").setStyle(ButtonStyle.Danger),
    ),
  ];
}

async function handleRoleGiverCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(0xff4d4d).setDescription("You need **Administrator** permission to use this.")],
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    embeds: [buildRoleGiverPanelEmbed()],
    components: buildRoleGiverPanelRows(),
    ephemeral: true,
  });
}

async function handleRoleGiverButton(interaction: ButtonInteraction) {
  if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
    await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xff4d4d).setDescription("You need **Administrator** permission to use this.")], ephemeral: true });
    return;
  }

  if (interaction.customId === "rg_add") {
    const modal = new ModalBuilder().setCustomId("rg_add_modal").setTitle("Add Role Giver");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("rg_command")
          .setLabel("Command name")
          .setPlaceholder("legend  ->  =legend @user")
          .setStyle(TextInputStyle.Short)
          .setMinLength(2)
          .setMaxLength(32)
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("rg_category")
          .setLabel("Category name (optional)")
          .setPlaceholder("level")
          .setStyle(TextInputStyle.Short)
          .setMaxLength(32)
          .setRequired(false),
      ),
    );
    await interaction.showModal(modal);
    return;
  }

  if (interaction.customId === "rg_preview") {
    await handleRoleGiverPreview(interaction);
    return;
  }

  if (interaction.customId === "rg_edit") {
    const modal = new ModalBuilder().setCustomId("rg_edit_modal").setTitle("Edit Role Giver");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("rg_edit_command")
          .setLabel("Command name to edit")
          .setPlaceholder("legend  ->  =legend @user")
          .setStyle(TextInputStyle.Short)
          .setMinLength(2)
          .setMaxLength(32)
          .setRequired(true),
      ),
    );
    await interaction.showModal(modal);
    return;
  }

  if (interaction.customId === "rg_delete") {
    const modal = new ModalBuilder().setCustomId("rg_delete_modal").setTitle("Delete Role Giver");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("rg_delete_command")
          .setLabel("Command name to delete")
          .setPlaceholder("legend  ->  =legend @user")
          .setStyle(TextInputStyle.Short)
          .setMinLength(2)
          .setMaxLength(32)
          .setRequired(true),
      ),
    );
    await interaction.showModal(modal);
    return;
  }

  if (interaction.customId === "rg_back" || interaction.customId === "rg_cancel") {
    roleGiverDrafts.delete(roleGiverDraftKey(interaction));
    await interaction.update({ embeds: [buildRoleGiverPanelEmbed()], components: buildRoleGiverPanelRows() });
    return;
  }

  if (interaction.customId === "rg_save") {
    await handleRoleGiverSave(interaction);
  }
}

async function handleRoleGiverModalSubmit(interaction: ModalSubmitInteraction) {
  if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
    await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xff4d4d).setDescription("You need **Administrator** permission to use this.")], ephemeral: true });
    return;
  }

  if (interaction.customId === "rg_add_modal") {
    const commandName = normalizeRoleGiverCommandName(interaction.fields.getTextInputValue("rg_command"));
    if (!validRoleGiverCommandName(commandName)) {
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xff4d4d).setDescription("Command must be 2-32 characters: letters, numbers, `_`, or `-` only. Example: `legend`.")], ephemeral: true });
      return;
    }

    const linkedCategoryRaw = interaction.fields.getTextInputValue("rg_category")?.trim() ?? "";
    const draft: RoleGiverDraft = {
      commandName,
      linkedCategory: linkedCategoryRaw ? linkedCategoryRaw.toLowerCase() : null,
      giverRoleIds: [],
    };
    roleGiverDrafts.set(roleGiverDraftKey(interaction), draft);
    await interaction.reply({ embeds: [buildRoleGiverDraftEmbed(draft)], components: buildRoleGiverDraftRows(), ephemeral: true });
    return;
  }

  if (interaction.customId === "rg_edit_modal") {
    const commandName = normalizeRoleGiverCommandName(interaction.fields.getTextInputValue("rg_edit_command"));
    if (!validRoleGiverCommandName(commandName)) {
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xff4d4d).setDescription("Command must be 2-32 characters: letters, numbers, `_`, or `-` only. Example: `legend`.")], ephemeral: true });
      return;
    }

    const result = await pool.query<{
      command_name: string;
      target_role_id: string;
      giver_role_ids_json: string;
      linked_category: string | null;
    }>(
      "select command_name, target_role_id, giver_role_ids_json, linked_category from role_giver_rules where guild_id = $1 and command_name = $2 and enabled = true limit 1",
      [interaction.guildId!, commandName],
    );

    const row = result.rows[0];
    if (!row) {
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xff4d4d).setDescription(`No role-giver command named \`=${commandName}\` was found.`)], ephemeral: true });
      return;
    }

    let giverRoleIds: string[] = [];
    try { giverRoleIds = JSON.parse(row.giver_role_ids_json); } catch {}
    const draft: RoleGiverDraft = {
      commandName: row.command_name,
      linkedCategory: row.linked_category,
      targetRoleId: row.target_role_id,
      giverRoleIds,
    };
    roleGiverDrafts.set(roleGiverDraftKey(interaction), draft);
    await interaction.reply({ embeds: [buildRoleGiverDraftEmbed(draft)], components: buildRoleGiverDraftRows(), ephemeral: true });
    return;
  }

  if (interaction.customId === "rg_delete_modal") {
    const commandName = normalizeRoleGiverCommandName(interaction.fields.getTextInputValue("rg_delete_command"));
    const result = await pool.query(
      "delete from role_giver_rules where guild_id = $1 and command_name = $2",
      [interaction.guildId!, commandName],
    );
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(result.rowCount ? 0x00c851 : 0xff4d4d)
          .setDescription(result.rowCount ? `Deleted role-giver command \`=${commandName}\`.` : `No role-giver command named \`=${commandName}\` was found.`)
          .setFooter({ text: "Night Stars • Role Giver" }),
      ],
      components: buildRoleGiverPanelRows(),
      ephemeral: true,
    });
  }
}

function buildRoleGiverDraftEmbed(draft: RoleGiverDraft) {
  return new EmbedBuilder()
    .setColor(0x5000ff)
    .setTitle("Add Role Giver")
    .setDescription(
      `**Command name** — \`=${draft.commandName} @user\`\n` +
      `**Add role** — ${draft.targetRoleId ? `<@&${draft.targetRoleId}>` : "Not selected"}\n` +
      `**Allowed giver roles** — ${draft.giverRoleIds.length ? draft.giverRoleIds.map((id) => `<@&${id}>`).join(", ") : "Not selected"}\n` +
      `**Category name** — ${draft.linkedCategory ? `\`${draft.linkedCategory}\`` : "No category"}\n\n` +
      "Select Add role and the giver roles allowed to use this command, then click Save. Roles in the same category replace each other."
    )
    .setFooter({ text: "Night Stars • Role Giver" })
    .setTimestamp();
}

function buildRoleGiverDraftRows() {
  return [
    new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId("rg_target_role")
        .setPlaceholder("Add role")
        .setMinValues(1)
        .setMaxValues(1),
    ),
    new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId("rg_giver_roles")
        .setPlaceholder("Select role(s) allowed to give it")
        .setMinValues(1)
        .setMaxValues(5),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("rg_save").setLabel("Save Role").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("rg_cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

async function handleRoleGiverRoleSelect(interaction: RoleSelectMenuInteraction) {
  const draft = roleGiverDrafts.get(roleGiverDraftKey(interaction));
  if (!draft) {
    await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xff4d4d).setDescription("This setup session expired. Open `/role-giver setup` again.")], ephemeral: true });
    return;
  }

  if (interaction.customId === "rg_target_role") {
    draft.targetRoleId = interaction.values[0];
  } else if (interaction.customId === "rg_giver_roles") {
    draft.giverRoleIds = [...new Set(interaction.values)];
  }

  roleGiverDrafts.set(roleGiverDraftKey(interaction), draft);
  await interaction.update({ embeds: [buildRoleGiverDraftEmbed(draft)], components: buildRoleGiverDraftRows() });
}

async function handleRoleGiverSave(interaction: ButtonInteraction) {
  const draft = roleGiverDrafts.get(roleGiverDraftKey(interaction));
  if (!draft) {
    await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xff4d4d).setDescription("This setup session expired. Open `/role-giver setup` again.")], ephemeral: true });
    return;
  }

  if (!draft.targetRoleId || !draft.giverRoleIds.length) {
    await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xff4d4d).setDescription("Select both the role to give and at least one giver role before saving.")], ephemeral: true });
    return;
  }

  await pool.query(
    `insert into role_giver_rules (guild_id, command_name, target_role_id, giver_role_ids_json, linked_category, enabled, updated_at)
     values ($1, $2, $3, $4, $5, true, now())
     on conflict (guild_id, command_name)
     do update set target_role_id = excluded.target_role_id,
       giver_role_ids_json = excluded.giver_role_ids_json,
       linked_category = excluded.linked_category,
       enabled = true,
       updated_at = now()`,
    [interaction.guildId!, draft.commandName, draft.targetRoleId, JSON.stringify(draft.giverRoleIds), draft.linkedCategory],
  );
  roleGiverDrafts.delete(roleGiverDraftKey(interaction));

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(0x00c851)
        .setTitle("Role Giver Command Saved")
        .setDescription(
          `**Command name** — \`=${draft.commandName} @user\`\n` +
          `**Add role** — <@&${draft.targetRoleId}>\n` +
          `**Allowed giver roles** — ${draft.giverRoleIds.map((id) => `<@&${id}>`).join(", ")}\n` +
          `**Category name** — ${draft.linkedCategory ? `\`${draft.linkedCategory}\`` : "No category"}`,
        )
        .setFooter({ text: "Night Stars • Role Giver" })
        .setTimestamp(),
    ],
    components: buildRoleGiverPanelRows(),
  });
}

async function handleRoleGiverPreview(interaction: ButtonInteraction) {
  const result = await pool.query<{
    command_name: string;
    target_role_id: string;
    giver_role_ids_json: string;
    linked_category: string | null;
  }>(
    "select command_name, target_role_id, giver_role_ids_json, linked_category from role_giver_rules where guild_id = $1 and enabled = true order by command_name",
    [interaction.guildId!],
  );

  const rows = result.rows;
  const description = rows.length
    ? rows.map((row) => {
      let giverIds: string[] = [];
      try { giverIds = JSON.parse(row.giver_role_ids_json); } catch {}
      return `**=${row.command_name} @user** → <@&${row.target_role_id}>\nAllowed: ${giverIds.map((id) => `<@&${id}>`).join(", ") || "None"}\nLinked: ${row.linked_category ? `\`${row.linked_category}\`` : "Not linked"}`;
    }).join("\n\n")
    : "No role-giver commands are configured yet. Click Add Role first.";

  await interaction.update({
    embeds: [new EmbedBuilder().setColor(0x5000ff).setTitle("Role Giver Commands").setDescription(description).setFooter({ text: "Night Stars • Role Giver" })],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("rg_add").setLabel("Add Role").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("rg_edit").setLabel("Edit Role").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("rg_delete").setLabel("Delete Role").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("rg_back").setLabel("Back to Panel").setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
}
