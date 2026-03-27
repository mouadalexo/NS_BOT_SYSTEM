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
  TextChannel,
  ChannelType,
} from "discord.js";
import {
  openVerifyPanel,
  handleVerifyPanelSelect,
  handleVerifyPanelSave,
  handleVerifyPanelReset,
  openEditQuestionsModal,
  handleEditQuestionsSubmit,
} from "./verification.js";
import {
  openPvsPanel,
  handlePvsPanelSelect,
  handlePvsPanelSave,
  handlePvsPanelReset,
} from "./pvs.js";
import {
  openCtpPanel,
  handleCtpPanelSelect,
  openCtpDetailsModal,
  handleCtpDetailsModalSubmit,
  handleCtpPanelSave,
  handleCtpPanelReset,
} from "./ctp.js";
import { deployVerificationPanel } from "../modules/verification/index.js";

function buildMainPanel() {
  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle("Night Stars — Admin Panel")
    .setDescription(
      "Use the buttons below to configure each system.\nAll changes take effect immediately."
    )
    .addFields(
      {
        name: "① NSV — Night Stars Verification",
        value: "Set up roles, the logs channel, and post the panel in your welcome channel.",
        inline: false,
      },
      {
        name: "② PVS — Private Voice System",
        value: "Let members create their own private voice rooms with key access control.",
        inline: false,
      },
      {
        name: "③ CTP — Call to Play",
        value: "Allow members in voice channels to ping their game role with a quick message.",
        inline: false,
      }
    )
    .setFooter({ text: "Administrator access required • Night Stars Bot" });

  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("panel_open_verify")
      .setLabel("NSV")
      .setEmoji("🛡️")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("panel_open_pvs")
      .setLabel("PVS")
      .setEmoji("🎙️")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("panel_open_ctp")
      .setLabel("CTP")
      .setEmoji("🎮")
      .setStyle(ButtonStyle.Success)
  );

  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("panel_deploy_verify")
      .setLabel("Post Verification Panel in a Channel")
      .setEmoji("📌")
      .setStyle(ButtonStyle.Danger)
  );

  return { embed, rows: [row1, row2] };
}

function buildDeployChannelSelect() {
  return {
    embed: new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("📌 Post Verification Panel")
      .setDescription(
        "Choose the channel where the verification panel will be posted.\n\n" +
        "New members will see a **Start Verification** button — their answers go straight to your logs channel for review."
      )
      .setFooter({ text: "The panel will be posted as soon as you select a channel." }),
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
    .setColor(0x9b59b6)
    .setTitle("🎙️ PVS — Private Voice System Commands")
    .setDescription("Commands for private voice room owners:")
    .addFields(
      { name: "`=key @user`", value: "Give or remove a member's access to your room.", inline: false },
      { name: "`=see keys`", value: "List all members who have access to your room.", inline: false },
      { name: "`=clear keys`", value: "Remove all keys — your room becomes fully private.", inline: false },
      { name: "`=name NewName`", value: "Rename your voice room.", inline: false },
      { name: "\u200B", value: "**Staff Command** (PVS Manager Role required)", inline: false },
      { name: "`+pv @member`", value: "Create a private voice room for a member directly.", inline: false },
    )
    .setFooter({ text: "Night Stars • PVS" });
}

function buildCtpInfoEmbed() {
  return new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle("🎮 CTP — Call to Play Commands")
    .setDescription("Commands for calling players to your game:")
    .addFields(
      {
        name: "`-your message`",
        value:
          "Ping the game role with your message.\n" +
          "You must be in a voice channel under the configured game category.\n" +
          "Example: `-we need one more for ranked!`",
        inline: false,
      },
      {
        name: "Cooldown",
        value: "Each category has its own cooldown (set in `/setup`). If active, the bot will tell you how long to wait.",
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
    .setDescription("Open the Night Stars admin panel")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .toJSON();

  const pvsCommand = new SlashCommandBuilder()
    .setName("pvs")
    .setDescription("Show all PVS (Private Voice System) commands")
    .toJSON();

  const ctpCommand = new SlashCommandBuilder()
    .setName("ctp")
    .setDescription("Show all CTP (Call to Play) commands")
    .toJSON();

  const rest = new REST().setToken(token);

  for (const guild of client.guilds.cache.values()) {
    try {
      await rest.put(Routes.applicationGuildCommands(client.user!.id, guild.id), {
        body: [setupCommand, pvsCommand, ctpCommand],
      });
      console.log(`Registered slash commands for guild: ${guild.name}`);
    } catch (err) {
      console.error(`Failed to register commands for guild ${guild.name}:`, err);
    }
  }

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.guild) return;

    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "setup") {
        await handleSetupCommand(interaction as ChatInputCommandInteraction);
      } else if (interaction.commandName === "pvs") {
        await interaction.reply({ embeds: [buildPvsInfoEmbed()], ephemeral: true });
      } else if (interaction.commandName === "ctp") {
        await interaction.reply({ embeds: [buildCtpInfoEmbed()], ephemeral: true });
      }
      return;
    }

    if (interaction.isButton()) {
      const panelIds = [
        "panel_open_verify", "panel_open_pvs", "panel_open_ctp", "panel_deploy_verify",
        "vp_save", "vp_reset", "vp_edit_questions",
        "pp_save", "pp_reset",
        "cp_open_details", "cp_save", "cp_reset",
      ];
      if (panelIds.includes(interaction.customId)) {
        await handleButtonInteraction(interaction as ButtonInteraction);
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
      }
    }
  });
}

async function handleSetupCommand(interaction: ChatInputCommandInteraction) {
  const member = interaction.guild!.members.cache.get(interaction.user.id);
  if (!member?.permissions.has(PermissionsBitField.Flags.Administrator)) {
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(0xe74c3c).setDescription("❌ You need **Administrator** permission to use this.")],
      ephemeral: true,
    });
    return;
  }

  const { embed, rows } = buildMainPanel();
  await interaction.reply({ embeds: [embed], components: rows, ephemeral: true });
}

async function handleButtonInteraction(interaction: ButtonInteraction) {
  const { customId } = interaction;
  try {
    if (customId === "panel_open_verify") {
      await openVerifyPanel(interaction);
    } else if (customId === "panel_open_pvs") {
      await openPvsPanel(interaction);
    } else if (customId === "panel_open_ctp") {
      await openCtpPanel(interaction);
    } else if (customId === "panel_deploy_verify") {
      const { embed, row } = buildDeployChannelSelect();
      await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    } else if (customId === "vp_save") {
      await handleVerifyPanelSave(interaction);
    } else if (customId === "vp_reset") {
      await handleVerifyPanelReset(interaction);
    } else if (customId === "vp_edit_questions") {
      await openEditQuestionsModal(interaction);
    } else if (customId === "pp_save") {
      await handlePvsPanelSave(interaction);
    } else if (customId === "pp_reset") {
      await handlePvsPanelReset(interaction);
    } else if (customId === "cp_open_details") {
      await openCtpDetailsModal(interaction);
    } else if (customId === "cp_save") {
      await handleCtpPanelSave(interaction);
    } else if (customId === "cp_reset") {
      await handleCtpPanelReset(interaction);
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
            .setColor(0x2ecc71)
            .setTitle("✅ Verification Panel Posted!")
            .setDescription(
              `The panel has been posted in <#${channelId}>.\n\n` +
              "Members will see a **Start Verification** button — once they submit, their answers appear in your logs channel for staff to review."
            )
            .setFooter({ text: "Make sure unverified members can see this channel." }),
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
