import {
  Client,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  TextChannel,
  PermissionFlagsBits,
  Message,
  ColorResolvable,
} from "discord.js";
import { db } from "@workspace/db";
import { botConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isMainGuild } from "../../utils/guildFilter.js";

// ── Colors ────────────────────────────────────────────────────────────────────
const GOLD    = 0xffe500 as ColorResolvable;
const BLURPLE = 0x5865f2 as ColorResolvable;

// userId → channelId  (where to post the final event)
const pendingEventChannels = new Map<string, string>();

// ── Permission check ──────────────────────────────────────────────────────────
async function isAuthorized(message: Message): Promise<boolean> {
  const member = message.member;
  if (!member || !message.guildId) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  try {
    const [config] = await db
      .select()
      .from(botConfigTable)
      .where(eq(botConfigTable.guildId, message.guildId))
      .limit(1);
    if (config?.announcementsRoleId && member.roles.cache.has(config.announcementsRoleId)) return true;
    if (config?.staffRoleId && member.roles.cache.has(config.staffRoleId)) return true;
  } catch {}
  return false;
}

// ── Temp reply that auto-deletes ──────────────────────────────────────────────
async function tempReply(message: Message, text: string, ms = 6000) {
  const r = await message.reply(text).catch(() => null);
  if (r) setTimeout(() => r.delete().catch(() => {}), ms);
}

// ── Embed builders ────────────────────────────────────────────────────────────
function buildAnnouncementEmbed(guild: { name: string; iconURL: () => string | null }, text: string, imageUrl?: string) {
  const embed = new EmbedBuilder()
    .setColor(GOLD)
    .setAuthor({
      name: `📣  ${guild.name}`,
      iconURL: guild.iconURL() ?? undefined,
    })
    .setDescription(
      `> ${text.split("\n").join("\n> ")}`
    )
    .setTimestamp()
    .setFooter({ text: "Night Stars  •  Announcement" });

  if (imageUrl) embed.setImage(imageUrl);
  return embed;
}

function buildEventEmbed(
  guild: { name: string; iconURL: () => string | null },
  name: string,
  datetime: string,
  description: string,
  imageUrl?: string
) {
  const embed = new EmbedBuilder()
    .setColor(BLURPLE)
    .setAuthor({
      name: guild.name,
      iconURL: guild.iconURL() ?? undefined,
    })
    .setTitle(`🎉  ${name}`)
    .addFields(
      {
        name: "📅  Date & Time",
        value: `\`\`\`${datetime}\`\`\``,
        inline: false,
      },
      {
        name: "📋  Description",
        value: description,
        inline: false,
      }
    )
    .setTimestamp()
    .setFooter({ text: "Night Stars  •  Events" });

  if (imageUrl) embed.setImage(imageUrl);
  return embed;
}

// ── Main registration ─────────────────────────────────────────────────────────
export function registerAnnouncementsModule(client: Client): void {

  client.on("messageCreate", async (message) => {
    if (!message.guild || message.author.bot) return;
    if (!isMainGuild(message.guild.id)) return;

    const raw = message.content.trim();

    // ── !setannouncerole @role ──────────────────────────────────────────────
    if (raw.startsWith("!setannouncerole")) {
      if (!message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
        await tempReply(message, "❌ Only admins can set the announcements role.");
        return;
      }
      const match = raw.match(/<@&(\d+)>/);
      if (!match) {
        await tempReply(message, "❌ Please mention a role: `!setannouncerole @Role`");
        return;
      }
      const roleId = match[1];
      await db
        .update(botConfigTable)
        .set({ announcementsRoleId: roleId })
        .where(eq(botConfigTable.guildId, message.guild.id));

      await message.delete().catch(() => {});
      const confirm = await message.channel.send(
        `✅ Announcements role set to <@&${roleId}>. Members with this role can now use \`!announce\` and \`!event\`.`
      );
      setTimeout(() => confirm.delete().catch(() => {}), 8000);
      return;
    }

    // ── !announce [text] ────────────────────────────────────────────────────
    if (raw.startsWith("!announce")) {
      if (!await isAuthorized(message)) {
        await tempReply(message, "❌ You don't have permission to post announcements.");
        return;
      }

      const text = raw.slice("!announce".length).trim();
      const attachment = message.attachments.first();
      const imageUrl = attachment?.url;

      if (!text && !imageUrl) {
        await tempReply(message, "❌ Write your announcement after `!announce`, or attach an image.");
        return;
      }

      const channel = message.channel as TextChannel;
      await message.delete().catch(() => {});

      const embed = buildAnnouncementEmbed(
        { name: message.guild.name, iconURL: () => message.guild!.iconURL() },
        text || " ",
        imageUrl
      );

      await channel.send({ content: "@everyone", embeds: [embed] });
      return;
    }

    // ── !event ──────────────────────────────────────────────────────────────
    if (raw === "!event") {
      if (!await isAuthorized(message)) {
        await tempReply(message, "❌ You don't have permission to post events.");
        return;
      }

      const channel = message.channel as TextChannel;
      pendingEventChannels.set(message.author.id, channel.id);
      await message.delete().catch(() => {});

      const setupEmbed = new EmbedBuilder()
        .setColor(BLURPLE)
        .setTitle("🎉  Event Setup")
        .setDescription(
          "Click **Fill Event Details** to open the event form.\n" +
          "Once you submit, the event will be posted here with `@everyone`.\n\n" +
          "-# This message disappears when the event is posted or cancelled."
        )
        .setFooter({ text: `Requested by ${message.author.tag}` });

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`announce_fill_event:${message.author.id}`)
          .setLabel("📋  Fill Event Details")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`announce_cancel_event:${message.author.id}`)
          .setLabel("✕  Cancel")
          .setStyle(ButtonStyle.Danger),
      );

      await channel.send({ embeds: [setupEmbed], components: [row] });
      return;
    }
  });

  // ── Button handler ────────────────────────────────────────────────────────
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isButton() || !interaction.guild) return;

    if (interaction.customId.startsWith("announce_fill_event:")) {
      const userId = interaction.customId.slice("announce_fill_event:".length);
      if (interaction.user.id !== userId) {
        await interaction.reply({ content: "❌ This button is not for you.", ephemeral: true });
        return;
      }

      const modal = new ModalBuilder()
        .setCustomId(`announce_event_modal:${interaction.message.id}`)
        .setTitle("🎉  New Event");

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("event_name")
            .setLabel("Event Name")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("e.g. Night Stars Tournament")
            .setRequired(true)
            .setMaxLength(100)
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("event_datetime")
            .setLabel("Date & Time")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("e.g. Saturday 20 April at 8PM (GMT+1)")
            .setRequired(true)
            .setMaxLength(100)
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("event_description")
            .setLabel("Description")
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder("Event details, rules, prizes, how to join...")
            .setRequired(true)
            .setMaxLength(1000)
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("event_image")
            .setLabel("Image URL (optional)")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("https://...")
            .setRequired(false)
            .setMaxLength(500)
        ),
      );

      await interaction.showModal(modal);
      return;
    }

    if (interaction.customId.startsWith("announce_cancel_event:")) {
      const userId = interaction.customId.slice("announce_cancel_event:".length);
      if (interaction.user.id !== userId) {
        await interaction.reply({ content: "❌ This button is not for you.", ephemeral: true });
        return;
      }
      pendingEventChannels.delete(userId);
      await interaction.message.delete().catch(() => {});
      await interaction.reply({ content: "✅ Event setup cancelled.", ephemeral: true });
      return;
    }
  });

  // ── Modal submit ──────────────────────────────────────────────────────────
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isModalSubmit() || !interaction.guild) return;
    if (!interaction.customId.startsWith("announce_event_modal:")) return;

    const setupMessageId = interaction.customId.slice("announce_event_modal:".length);
    const channelId = pendingEventChannels.get(interaction.user.id);

    const eventName        = interaction.fields.getTextInputValue("event_name").trim();
    const eventDatetime    = interaction.fields.getTextInputValue("event_datetime").trim();
    const eventDescription = interaction.fields.getTextInputValue("event_description").trim();
    const eventImage       = interaction.fields.getTextInputValue("event_image").trim() || undefined;

    // Delete the setup message
    try {
      const ch = channelId
        ? await interaction.guild.channels.fetch(channelId) as TextChannel
        : interaction.channel as TextChannel;
      const setupMsg = await ch.messages.fetch(setupMessageId).catch(() => null);
      await setupMsg?.delete().catch(() => {});
    } catch {}

    pendingEventChannels.delete(interaction.user.id);

    const postChannel = channelId
      ? (await interaction.guild.channels.fetch(channelId).catch(() => null) as TextChannel | null)
      : (interaction.channel as TextChannel);

    if (!postChannel) {
      await interaction.reply({ content: "❌ Could not find the target channel.", ephemeral: true });
      return;
    }

    const embed = buildEventEmbed(
      { name: interaction.guild.name, iconURL: () => interaction.guild!.iconURL() },
      eventName,
      eventDatetime,
      eventDescription,
      eventImage
    );

    await postChannel.send({ content: "@everyone", embeds: [embed] });
    await interaction.reply({ content: "✅ Event posted!", ephemeral: true });
  });
}
