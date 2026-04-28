import {
  ButtonInteraction,
  ChannelSelectMenuInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  TextChannel,
} from "discord.js";
import { pool } from "@workspace/db";
import { getFeedbackConfig } from "../modules/feedback/index.js";
import { findButton, findButtonRow, registerFindHandler } from "./findHelper.js";

interface FeedbackPanelState {
  pendingChannelId?: string;
}

export const feedbackPanelState = new Map<string, FeedbackPanelState>();

// ─── Main Panel ───────────────────────────────────────────────────────────────
async function buildFeedbackPanelEmbed(guildId: string): Promise<EmbedBuilder> {
  const cfg = await getFeedbackConfig(guildId);
  return new EmbedBuilder()
    .setColor(0xff005c)
    .setTitle("📝 Feedback System")
    .setDescription(
      `**Staff Channel:** ${cfg.staffChannelId ? `<#${cfg.staffChannelId}>` : "❌ Not set"}\n\n` +
      "Use the buttons below to configure and send the feedback embed.\n" +
      "All feedback is **100% anonymous** — member identity is never shown in reports."
    )
    .setFooter({ text: "Night Stars • Feedback System" });
}

function buildFeedbackPanelComponents(): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("fb_send_embed").setLabel("📢 Send Feedback Embed").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("fb_set_staff").setLabel("📣 Set Staff Channel").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

export async function openFeedbackPanel(interaction: ButtonInteraction | any): Promise<void> {
  const embed = await buildFeedbackPanelEmbed(interaction.guild!.id);
  const fn = typeof interaction.update === "function" ? interaction.update.bind(interaction) : interaction.editReply.bind(interaction);
  await fn({ embeds: [embed], components: buildFeedbackPanelComponents() });
}

// ─── Set Staff Channel ────────────────────────────────────────────────────────
export async function handleFeedbackSetStaff(interaction: ButtonInteraction): Promise<void> {
  await interaction.reply({
    embeds: [new EmbedBuilder().setColor(0xff005c).setDescription("Select the **staff channel** where anonymous feedback reports will be sent:").setFooter({ text: "Night Stars • Feedback System" })],
    components: [
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder().setCustomId("fb_staff_ch").setPlaceholder("Select staff channel…").addChannelTypes(ChannelType.GuildText)
      ),
      findButtonRow(findButton("feedback", "staff", "text", "Find Staff Channel")),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("fb_back").setLabel("← Cancel").setStyle(ButtonStyle.Secondary),
      ),
    ],
    ephemeral: true,
  });
}

export async function handleFeedbackStaffChannelSelect(interaction: ChannelSelectMenuInteraction): Promise<void> {
  const channelId = interaction.values[0];
  const guildId = interaction.guild!.id;
  await pool.query(
    `INSERT INTO feedback_config (guild_id, staff_channel_id) VALUES ($1, $2)
     ON CONFLICT (guild_id) DO UPDATE SET staff_channel_id = $2`,
    [guildId, channelId]
  );
  await interaction.update({
    embeds: [new EmbedBuilder().setColor(0x00c851).setDescription(`✅ Staff channel set to <#${channelId}>. Feedback reports will be sent there.`).setFooter({ text: "Night Stars • Feedback System" })],
    components: [],
  });
}

// ─── Send Feedback Embed ──────────────────────────────────────────────────────
export async function handleFeedbackSendEmbed(interaction: ButtonInteraction): Promise<void> {
  await interaction.reply({
    embeds: [new EmbedBuilder().setColor(0xff005c).setDescription("Select the channel to send the feedback embed to:").setFooter({ text: "Night Stars • Feedback System" })],
    components: [
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder().setCustomId("fb_embed_ch").setPlaceholder("Select target channel…").addChannelTypes(ChannelType.GuildText)
      ),
      findButtonRow(findButton("feedback", "embed", "text", "Find Target Channel")),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("fb_back").setLabel("← Cancel").setStyle(ButtonStyle.Secondary),
      ),
    ],
    ephemeral: true,
  });
}

registerFindHandler("feedback", async (interaction, fieldKey, selectedId) => {
  const guildId = interaction.guild!.id;
  if (fieldKey === "staff") {
    await pool.query(
      `INSERT INTO feedback_config (guild_id, staff_channel_id) VALUES ($1, $2)
       ON CONFLICT (guild_id) DO UPDATE SET staff_channel_id = $2`,
      [guildId, selectedId],
    );
    await interaction.update({
      embeds: [
        new EmbedBuilder()
          .setColor(0x00c851)
          .setDescription(`✅ Staff channel set to <#${selectedId}>. Feedback reports will be sent there.`)
          .setFooter({ text: "Night Stars • Feedback System" }),
      ],
      components: [],
    });
    return;
  }
  if (fieldKey === "embed") {
    feedbackPanelState.set(interaction.user.id, { pendingChannelId: selectedId });
    await interaction.update({
      embeds: [
        new EmbedBuilder()
          .setColor(0xff005c)
          .setDescription(`Ready to send feedback embed to <#${selectedId}>. Click **Confirm** to post it.`)
          .setFooter({ text: "Night Stars • Feedback System" }),
      ],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId("fb_confirm_send").setLabel("✅ Confirm Send").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId("fb_back").setLabel("← Cancel").setStyle(ButtonStyle.Secondary),
        ),
      ],
    });
  }
});

export async function handleFeedbackEmbedChannelSelect(interaction: ChannelSelectMenuInteraction): Promise<void> {
  const channelId = interaction.values[0];
  feedbackPanelState.set(interaction.user.id, { pendingChannelId: channelId });
  await interaction.update({
    embeds: [new EmbedBuilder().setColor(0xff005c).setDescription(`Ready to send feedback embed to <#${channelId}>. Click **Confirm** to post it.`).setFooter({ text: "Night Stars • Feedback System" })],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("fb_confirm_send").setLabel("✅ Confirm Send").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("fb_back").setLabel("← Cancel").setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
}

export async function handleFeedbackConfirmSend(interaction: ButtonInteraction): Promise<void> {
  const state = feedbackPanelState.get(interaction.user.id);
  if (!state?.pendingChannelId) { await interaction.reply({ content: "❌ No channel selected.", ephemeral: true }); return; }
  const ch = await interaction.client.channels.fetch(state.pendingChannelId).catch(() => null) as TextChannel | null;
  if (!ch) { await interaction.reply({ content: "❌ Channel not found.", ephemeral: true }); return; }
  feedbackPanelState.delete(interaction.user.id);

  const embed = new EmbedBuilder()
    .setColor(0xff005c)
    .setTitle("📝 Share Your Feedback")
    .setDescription(
      "Your opinion matters to us! ⭐\n\n" +
      "All feedback is **100% anonymous** — your identity will never be shared.\n\n" +
      "Rate your experience and help us make **Night Stars** even better!"
    )
    .setFooter({ text: "Night Stars • Feedback System" });

  await ch.send({
    embeds: [embed],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("feedback_open").setLabel("📝 Leave Feedback").setStyle(ButtonStyle.Primary),
      ),
    ],
  });

  await interaction.update({
    embeds: [new EmbedBuilder().setColor(0x00c851).setDescription(`✅ Feedback embed sent to <#${state.pendingChannelId}>!`).setFooter({ text: "Night Stars • Feedback System" })],
    components: [],
  });
}

// ─── Back ─────────────────────────────────────────────────────────────────────
export async function handleFeedbackBack(interaction: ButtonInteraction): Promise<void> {
  const embed = await buildFeedbackPanelEmbed(interaction.guild!.id);
  if (interaction.message) {
    await interaction.update({ embeds: [embed], components: buildFeedbackPanelComponents() }).catch(async () => {
      await interaction.reply({ embeds: [embed], components: buildFeedbackPanelComponents(), ephemeral: true });
    });
  } else {
    await interaction.reply({ embeds: [embed], components: buildFeedbackPanelComponents(), ephemeral: true });
  }
}
