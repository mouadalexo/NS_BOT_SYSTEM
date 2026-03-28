import {
  Client,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ButtonInteraction,
  ChannelSelectMenuBuilder,
  ChannelSelectMenuInteraction,
  RoleSelectMenuInteraction,
  ModalSubmitInteraction,
  PermissionsBitField,
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  StringSelectMenuInteraction,
  TextChannel,
  ChannelType,
} from "discord.js";
import { isMainGuild } from "../utils/guildFilter.js";
import {
  openVerifyPanel,
  handleVerifyPanelSelect,
  handleVerifyPanelSave,
  handleVerifyPanelReset,
  openEditQuestionsModal,
  handleEditQuestionsSubmit,
  openEmbedCustomizeModal,
  handleEmbedCustomizeSubmit,
  handleEmbedPreviewBack,
} from "./verification.js";
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
  openStaffPanel,
  handleStaffPanelSelect,
  handleStaffPanelSave,
  handleStaffPanelReset,
} from "./staff.js";
import { deployVerificationPanel } from "../modules/verification/index.js";

function buildDeployChannelSelect() {
  return {
    embed: new EmbedBuilder()
      .setColor(0x5000ff)
      .setTitle("📌 Post Verification Panel")
      .setDescription("Select the channel to post the verification button in.")
      .setFooter({ text: "Night Stars • NSV" }),
    row: new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId("deploy_verify_channel")
        .setPlaceholder("Select a channel...")
        .addChannelTypes(ChannelType.GuildText)
        .setMinValues(1)
        .setMaxValues(1)
    ),
  };
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
      sub.setName("verification").setDescription("Set up the Night Stars Verification system (NSV)")
    )
    .addSubcommand((sub) =>
      sub.setName("pvs").setDescription("Set up the Private Voice System (PVS)")
    )
    .addSubcommand((sub) =>
      sub.setName("ping").setDescription("Set up the Call to Play system (CTP)")
    )
    .addSubcommand((sub) =>
      sub.setName("staff").setDescription("Set the staff role — grants access to all bot systems")
    )
    .toJSON();

  const helpCommand = new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show how to use Night Stars bot systems")
    .addSubcommand((sub) =>
      sub.setName("pvs").setDescription("Show all PVS (Private Voice System) commands")
    )
    .addSubcommand((sub) =>
      sub.setName("ctp").setDescription("Show all CTP (Call to Play) commands")
    )
    .toJSON();

  const rest = new REST().setToken(token);

  const registerForGuild = async (guildId: string, guildName: string) => {
    try {
      await rest.put(Routes.applicationGuildCommands(client.user!.id, guildId), {
        body: [setupCommand, helpCommand],
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
      } else if (name === "help") {
        const sub = (interaction as ChatInputCommandInteraction).options.getSubcommand();
        if (sub === "pvs") {
          await interaction.reply({ embeds: [buildPvsInfoEmbed()], ephemeral: true });
        } else if (sub === "ctp") {
          await interaction.reply({ embeds: [buildCtpInfoEmbed()], ephemeral: true });
        }
      }
      return;
    }

    if (interaction.isButton()) {
      const panelIds = [
        "panel_deploy_verify",
        "vp_save", "vp_reset", "vp_edit_questions", "vp_edit_embed", "vp_embed_back",
        "pp_save", "pp_reset",
        "cp_add_new", "cp_edit_game", "cp_remove_game", "cp_back_manage",
        "cp_open_details", "cp_save", "cp_reset",
        "sp_save", "sp_reset",
      ];
      if (panelIds.includes(interaction.customId)) {
        await handleButtonInteraction(interaction as ButtonInteraction);
      }
      return;
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === "cp_game_select") {
        try { await handleCtpGameSelect(interaction as StringSelectMenuInteraction); } catch (err) { console.error("CTP game select error:", err); }
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
      if (interaction.customId === "cp_details_modal") {
        try { await handleCtpDetailsModalSubmit(interaction as ModalSubmitInteraction); } catch (err) { console.error("CTP modal error:", err); }
      } else if (interaction.customId === "vp_questions_modal") {
        try { await handleEditQuestionsSubmit(interaction as ModalSubmitInteraction); } catch (err) { console.error("NSV questions modal error:", err); }
      } else if (interaction.customId === "vp_embed_modal") {
        try { await handleEmbedCustomizeSubmit(interaction as ModalSubmitInteraction); } catch (err) { console.error("NSV embed modal error:", err); }
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

  if (sub === "verification") {
    await openVerifyPanel(interaction as unknown as ButtonInteraction);
  } else if (sub === "pvs") {
    await openPvsPanel(interaction as unknown as ButtonInteraction);
  } else if (sub === "ping") {
    await openCtpManagePanel(interaction as unknown as ButtonInteraction);
  } else if (sub === "staff") {
    await openStaffPanel(interaction as unknown as ButtonInteraction);
  }
}

async function handleButtonInteraction(interaction: ButtonInteraction) {
  const { customId } = interaction;
  try {
    if (customId === "panel_deploy_verify") {
      const { embed, row } = buildDeployChannelSelect();
      await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    } else if (customId === "vp_save") {
      await handleVerifyPanelSave(interaction);
    } else if (customId === "vp_reset") {
      await handleVerifyPanelReset(interaction);
    } else if (customId === "vp_edit_questions") {
      await openEditQuestionsModal(interaction);
    } else if (customId === "vp_edit_embed") {
      await openEmbedCustomizeModal(interaction);
    } else if (customId === "vp_embed_back") {
      await handleEmbedPreviewBack(interaction);
    } else if (customId === "pp_save") {
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
    }
  } catch (err) {
    console.error("Panel button error:", err);
  }
}

async function handleRoleSelectInteraction(interaction: RoleSelectMenuInteraction) {
  const { customId } = interaction;
  try {
    if (customId.startsWith("vp_")) {
      await handleVerifyPanelSelect(interaction);
    } else if (customId.startsWith("pp_")) {
      await handlePvsPanelSelect(interaction);
    } else if (customId.startsWith("cp_")) {
      await handleCtpPanelSelect(interaction);
    } else if (customId.startsWith("sp_")) {
      await handleStaffPanelSelect(interaction);
    }
  } catch (err) {
    console.error("Panel role select error:", err);
  }
}

async function handleChannelSelectInteraction(interaction: ChannelSelectMenuInteraction) {
  const { customId } = interaction;
  try {
    if (customId === "deploy_verify_channel") {
      const channelId = interaction.values[0];
      const channel = interaction.guild!.channels.cache.get(channelId) as TextChannel | undefined;
      if (!channel || channel.type !== ChannelType.GuildText) {
        await interaction.reply({ content: "Invalid channel selected.", ephemeral: true });
        return;
      }
      await deployVerificationPanel(channel);
      await interaction.update({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5000ff)
            .setTitle("✅ Verification Panel Posted")
            .setDescription(`Panel posted in <#${channelId}>. Members will see the Start Verification button there.`)
            .setFooter({ text: "Night Stars • NSV" }),
        ],
        components: [],
      });
    } else if (customId.startsWith("vp_")) {
      await handleVerifyPanelSelect(interaction);
    } else if (customId.startsWith("pp_")) {
      await handlePvsPanelSelect(interaction);
    } else if (customId.startsWith("cp_")) {
      await handleCtpPanelSelect(interaction);
    }
  } catch (err) {
    console.error("Panel channel select error:", err);
  }
}
