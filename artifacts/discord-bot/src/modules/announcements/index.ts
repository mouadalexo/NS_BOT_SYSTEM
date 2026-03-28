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
const TEST_COLOR = 0xff6b00 as ColorResolvable;

// userId → channelId  (where to post the final event)
const pendingEventChannels = new Map<string, string>();
// userId → isTest flag
const pendingEventTestMode = new Map<string, boolean>();

// ── Permission check ──────────────────────────────────────────────────────────
async function isAuthorized(message: Message): Promise<boolean> {
  const member = message.member;
  if (!member || !message.guildId) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;

  const [cfg] = await db
    .select({ announcementsRoleId: botConfigTable.announcementsRoleId })
    .from(botConfigTable)
    .where(eq(botConfigTable.guildId, message.guildId))
    .limit(1);

  const roleId = cfg?.announcementsRoleId;
  if (!roleId) return false;
  return member.roles.cache.has(roleId);
}

// ── Allowed channels check ────────────────────────────────────────────────────
async function getAllowedChannels(guildId: string): Promise<string[]> {
  const [cfg] = await db
    .select({ announcementChannelsJson: botConfigTable.announcementChannelsJson })
    .from(botConfigTable)
    .where(eq(botConfigTable.guildId, guildId))
    .limit(1);

  if (!cfg?.announcementChannelsJson) return [];
  try {
    return JSON.parse(cfg.announcementChannelsJson) as string[];
  } catch {
    return [];
  }
}

// ── Temp reply then auto-delete ───────────────────────────────────────────────
async function tempReply(message: Message, text: string, ms = 8000) {
  const reply = await message.reply(text);
  setTimeout(() => reply.delete().catch(() => {}), ms);
}

// ── Announcement embed ────────────────────────────────────────────────────────
function buildAnnouncementEmbed(
  guild: { name: string; iconURL: () => string | null },
  text: string,
  imageUrl?: string,
  isTest = false,
) {
  const embed = new EmbedBuilder()
    .setColor(isTest ? TEST_COLOR : GOLD)
    .setAuthor({
      name: isTest ? `[TEST] ${guild.name}` : guild.name,
      iconURL: guild.iconURL() ?? undefined,
    })
    .setDescription(text)
    .setTimestamp();

  if (imageUrl) embed.setImage(imageUrl);
  if (isTest) {
    embed.setFooter({ text: "🧪 Test mode — not sent to @everyone" });
  }
  return embed;
}

// ── Event embed ───────────────────────────────────────────────────────────────
function buildEventEmbed(
  guild: { name: string; iconURL: () => string | null },
  name: string,
  datetime: string,
  description: string,
  imageUrl?: string,
  isTest = false,
) {
  const embed = new EmbedBuilder()
    .setColor(isTest ? TEST_COLOR : BLURPLE)
    .setAuthor({
      name: isTest ? `[TEST] ${guild.name}` : guild.name,
      iconURL: guild.iconURL() ?? undefined,
    })
    .setTitle(`🎉  ${name}`)
    .addFields(
      { name: "📅  Date & Time", value: datetime, inline: false },
      { name: "📝  Details",     value: description, inline: false },
    )
    .setTimestamp();

  if (imageUrl) embed.setImage(imageUrl);
  if (isTest) {
    embed.setFooter({ text: "🧪 Test mode — not sent to @everyone" });
  }
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

    // ── !addannouncechannel #channel ────────────────────────────────────────
    if (raw.startsWith("!addannouncechannel")) {
      if (!message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
        await tempReply(message, "❌ Only admins can configure announcement channels.");
        return;
      }
      const match = raw.match(/<#(\d+)>/);
      if (!match) {
        await tempReply(message, "❌ Mention a channel: `!addannouncechannel #channel`");
        return;
      }
      const channelId = match[1];
      const current = await getAllowedChannels(message.guild.id);
      if (current.includes(channelId)) {
        await tempReply(message, `⚠️ <#${channelId}> is already in the list.`);
        return;
      }
      if (current.length >= 4) {
        await tempReply(message, "❌ You can only have up to 4 announcement channels. Remove one first with `!removeannouncechannel`.");
        return;
      }
      current.push(channelId);
      await db
        .update(botConfigTable)
        .set({ announcementChannelsJson: JSON.stringify(current) })
        .where(eq(botConfigTable.guildId, message.guild.id));

      await message.delete().catch(() => {});
      const confirm = await message.channel.send(
        `✅ <#${channelId}> added. Announcement commands now work in: ${current.map(id => `<#${id}>`).join(", ")}`
      );
      setTimeout(() => confirm.delete().catch(() => {}), 10000);
      return;
    }

    // ── !removeannouncechannel #channel ─────────────────────────────────────
    if (raw.startsWith("!removeannouncechannel")) {
      if (!message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
        await tempReply(message, "❌ Only admins can configure announcement channels.");
        return;
      }
      const match = raw.match(/<#(\d+)>/);
      if (!match) {
        await tempReply(message, "❌ Mention a channel: `!removeannouncechannel #channel`");
        return;
      }
      const channelId = match[1];
      const current = await getAllowedChannels(message.guild.id);
      const updated = current.filter(id => id !== channelId);
      if (updated.length === current.length) {
        await tempReply(message, `⚠️ <#${channelId}> is not in the list.`);
        return;
      }
      await db
        .update(botConfigTable)
        .set({ announcementChannelsJson: updated.length ? JSON.stringify(updated) : null })
        .where(eq(botConfigTable.guildId, message.guild.id));

      await message.delete().catch(() => {});
      const confirm = await message.channel.send(
        updated.length
          ? `✅ <#${channelId}> removed. Remaining: ${updated.map(id => `<#${id}>`).join(", ")}`
          : `✅ <#${channelId}> removed. Announcement commands now work in **any channel**.`
      );
      setTimeout(() => confirm.delete().catch(() => {}), 10000);
      return;
    }

    // ── !announcechannels ────────────────────────────────────────────────────
    if (raw === "!announcechannels") {
      if (!message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
        await tempReply(message, "❌ Only admins can view announcement channel config.");
        return;
      }
      const current = await getAllowedChannels(message.guild.id);
      const reply = current.length
        ? `📢 Announcement commands are restricted to: ${current.map(id => `<#${id}>`).join(", ")}`
        : `📢 No restriction set — announcement commands work in **any channel**.`;
      await tempReply(message, reply, 12000);
      return;
    }

    // ── !announce [text] ────────────────────────────────────────────────────
    if (raw.startsWith("!announce")) {
      if (!await isAuthorized(message)) {
        await tempReply(message, "❌ You don't have permission to post announcements.");
        return;
      }

      const allowed = await getAllowedChannels(message.guild.id);
      if (allowed.length && !allowed.includes(message.channelId)) {
        await tempReply(message, `❌ Announcements can only be posted from: ${allowed.map(id => `<#${id}>`).join(", ")}`);
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

    // ── !testannounce [text] ────────────────────────────────────────────────
    if (raw.startsWith("!testannounce")) {
      if (!await isAuthorized(message)) {
        await tempReply(message, "❌ You don't have permission to test announcements.");
        return;
      }

      const text = raw.slice("!testannounce".length).trim();
      const attachment = message.attachments.first();
      const imageUrl = attachment?.url;

      if (!text && !imageUrl) {
        await tempReply(message, "❌ Write your announcement after `!testannounce`, or attach an image.");
        return;
      }

      const embed = buildAnnouncementEmbed(
        { name: message.guild.name, iconURL: () => message.guild!.iconURL() },
        text || " ",
        imageUrl,
        true
      );

      await message.reply({ embeds: [embed] });
      return;
    }

    // ── !event ──────────────────────────────────────────────────────────────
    if (raw === "!event") {
      if (!await isAuthorized(message)) {
        await tempReply(message, "❌ You don't have permission to post events.");
        return;
      }

      const allowed = await getAllowedChannels(message.guild.id);
      if (allowed.length && !allowed.includes(message.channelId)) {
        await tempReply(message, `❌ Events can only be posted from: ${allowed.map(id => `<#${id}>`).join(", ")}`);
        return;
      }

      const channel = message.channel as TextChannel;
      pendingEventChannels.set(message.author.id, channel.id);
      pendingEventTestMode.set(message.author.id, false);
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

    // ── !testevent ──────────────────────────────────────────────────────────
    if (raw === "!testevent") {
      if (!await isAuthorized(message)) {
        await tempReply(message, "❌ You don't have permission to test events.");
        return;
      }

      const channel = message.channel as TextChannel;
      pendingEventChannels.set(message.author.id, channel.id);
      pendingEventTestMode.set(message.author.id, true);
      await message.delete().catch(() => {});

      const setupEmbed = new EmbedBuilder()
        .setColor(TEST_COLOR)
        .setTitle("🧪  Event Test Setup")
        .setDescription(
          "Click **Fill Event Details** to open the event form.\n" +
          "The event will be posted **without @everyone** and marked as a test.\n\n" +
          "-# This message disappears when the event is posted or cancelled."
        )
        .setFooter({ text: `Test by ${message.author.tag}` });

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

      const isTest = pendingEventTestMode.get(userId) ?? false;

      const modal = new ModalBuilder()
        .setCustomId(`announce_event_modal:${interaction.message.id}:${isTest ? "test" : "live"}`)
        .setTitle(isTest ? "🧪  Test Event" : "🎉  New Event");

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
      pendingEventTestMode.delete(userId);
      await interaction.message.delete().catch(() => {});
      await interaction.reply({ content: "✅ Event setup cancelled.", ephemeral: true });
      return;
    }
  });

  // ── Modal submit ──────────────────────────────────────────────────────────
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isModalSubmit() || !interaction.guild) return;
    if (!interaction.customId.startsWith("announce_event_modal:")) return;

    // customId format: announce_event_modal:<setupMessageId>:<live|test>
    const parts = interaction.customId.slice("announce_event_modal:".length).split(":");
    const setupMessageId = parts[0];
    const isTest = parts[1] === "test";

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
    pendingEventTestMode.delete(interaction.user.id);

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
      eventImage,
      isTest
    );

    if (isTest) {
      await postChannel.send({ embeds: [embed] });
      await interaction.reply({ content: "🧪 Test event posted — no @everyone was sent.", ephemeral: true });
    } else {
      await postChannel.send({ content: "@everyone", embeds: [embed] });
      await interaction.reply({ content: "✅ Event posted!", ephemeral: true });
    }
  });
}
