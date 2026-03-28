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
    .setColor(0x1a1a2e)
    .setTitle("⭐ Night Stars — Control Panel")
    .setDescription(
      "Welcome to the Night Stars Bot control panel.\nSelect a system below to configure it."
    )
    .addFields(
      {
        name: "🛡️ Verification System",
        value: "Configure roles, logs channel, and categories. Post the panel in a channel.",
      },
      {
        name: "🎙️ Private Voice System (PVS)",
        value: "Set the create channel and category for private voice rooms.",
      },
      {
        name: "🎮 Call to Play (CTP)",
        value: "Link a voice category to a game role for quick player call-outs.",
      }
    )
    .setFooter({ text: "Only staff with Administrator permission can use this panel." });

  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("panel_open_verify")
      .setLabel("🛡️ Verification Setup")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("panel_open_pvs")
      .setLabel("🎙️ PVS Setup")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("panel_open_ctp")
      .setLabel("🎮 CTP Setup")
      .setStyle(ButtonStyle.Success)
  );

  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("panel_deploy_verify")
      .setLabel("📌 Post Verification Panel")
      .setStyle(ButtonStyle.Danger)
  );

  return { embed, rows: [row1, row2] };
}

function buildDeployChannelSelect() {
  return {
    embed: new EmbedBuilder()
      .setColor(0x1a1a2e)
      .setTitle("📌 Post Verification Panel")
      .setDescription(
        "Select the channel where the verification panel will be permanently posted.\n\n" +
        "Members who join will need to see this channel and click **Start Verification** to submit their answers."
      )
      .setFooter({ text: "The panel will be posted immediately." }),
    row: new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId("deploy_verify_channel")
        .setPlaceholder("Select verification channel")
        .addChannelTypes(ChannelType.GuildText)
        .setMinValues(1)
        .setMaxValues(1)
    ),
  };
}

export async function registerPanelCommands(client: Client) {
  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error("DISCORD_TOKEN is missing");

  const panelCommand = new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Open the Night Stars Bot control panel")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .toJSON();

  const rest = new REST().setToken(token);

  for (const guild of client.guilds.cache.values()) {
    try {
      const existing = (await rest.get(
        Routes.applicationGuildCommands(client.user!.id, guild.id)
      )) as { name: string }[];

      const alreadyExists = existing.some((c) => c.name === "panel");
      if (!alreadyExists) {
        await rest.post(Routes.applicationGuildCommands(client.user!.id, guild.id), {
          body: panelCommand,
        });
      }
    } catch (err) {
      console.error(`Failed to register /panel for guild ${guild.name}:`, err);
    }
  }

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.guild) return;

    if (interaction.isChatInputCommand() && interaction.commandName === "panel") {
      await handlePanelCommand(interaction as ChatInputCommandInteraction);
      return;
    }

    if (interaction.isButton()) {
      const panelIds = [
        "panel_open_verify", "panel_open_pvs", "panel_open_ctp", "panel_deploy_verify",
        "vp_save", "vp_reset", "pp_save", "pp_reset",
        "cp_open_details", "cp_save", "cp_reset",
      ];
      if (panelIds.includes(interaction.customId)) {
        await handleButtonInteraction(interaction);
      }
      return;
    }

    if (interaction.isRoleSelectMenu()) {
      await handleRoleSelectInteraction(interaction);
      return;
    }

    if (interaction.isChannelSelectMenu()) {
      await handleChannelSelectInteraction(interaction);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === "cp_details_modal") {
      try {
        await handleCtpDetailsModalSubmit(interaction);
      } catch (err) {
        console.error("CTP modal error:", err);
      }
    }
  });
}

async function handlePanelCommand(interaction: ChatInputCommandInteraction) {
  const member = interaction.guild!.members.cache.get(interaction.user.id);
  if (!member?.permissions.has(PermissionsBitField.Flags.Administrator)) {
    await interaction.reply({
      content: "You need Administrator permission to use this.",
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
              `The verification panel has been posted in <#${channelId}>.\n\n` +
              "Members can now click **Start Verification** to submit their answers."
            )
            .setFooter({ text: "Make sure new members can see this channel." }),
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
