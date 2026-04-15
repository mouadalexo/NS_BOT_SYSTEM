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
  Guild,
  ButtonInteraction,
  ModalSubmitInteraction,
} from "discord.js";
import { db } from "@workspace/db";
import { botConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isMainGuild } from "../../utils/guildFilter.js";

// ── Bold Unicode (Math Sans-Serif Bold — letters + digits) ────────────────────
function toBold(text: string): string {
  // Split on any Discord-formatted tag (<#id>, <@id>, <@&id>, emojis, timestamps, etc.)
  const parts = text.split(/(<[^>]+>)/g);
  return parts.map((part, i) => {
    if (i % 2 === 1) return part; // emoji tag — keep as-is
    const result: string[] = [];
    for (const ch of part) {
      const c = ch.codePointAt(0)!;
      if (c >= 65 && c <= 90)       result.push(String.fromCodePoint(0x1D5D4 + c - 65));
      else if (c >= 97 && c <= 122) result.push(String.fromCodePoint(0x1D5EE + c - 97));
      else if (c >= 48 && c <= 57)  result.push(String.fromCodePoint(0x1D7EC + c - 48));
      else result.push(ch);
    }
    return result.join("");
  }).join("");
}

function isValidUrl(str: string): boolean {
  try { new URL(str); return true; } catch { return false; }
}

async function getAnnPrefix(guildId: string): Promise<string> {
  const [cfg] = await db
    .select({ pvsPrefix: botConfigTable.pvsPrefix })
    .from(botConfigTable)
    .where(eq(botConfigTable.guildId, guildId))
    .limit(1);
  return cfg?.pvsPrefix ?? "=";
}

async function resolveEmojiCodes(text: string, guild: Guild): Promise<string> {
  try { await guild.emojis.fetch(); } catch {}
  return text.replace(/;([a-zA-Z0-9_~]+)/g, (_match, name) => {
    const emoji =
      guild.emojis.cache.find((e) => e.name === name) ??
      guild.emojis.cache.find((e) => e.name?.toLowerCase() === name.toLowerCase());
    return emoji ? emoji.toString() : _match;
  });
}

async function getAnnColors(guildId: string) {
  const [cfg] = await db
    .select({
      annTitleColor:  botConfigTable.annTitleColor,
      annDescColor:   botConfigTable.annDescColor,
      annAddColor:    botConfigTable.annAddColor,
      eventColor:     botConfigTable.eventColor,
      eventDescColor: botConfigTable.eventDescColor,
      eventAddColor:  botConfigTable.eventAddColor,
    })
    .from(botConfigTable)
    .where(eq(botConfigTable.guildId, guildId))
    .limit(1);
  const parseHex = (s: string | null | undefined, fallback: number): ColorResolvable => {
    if (!s) return fallback as ColorResolvable;
    const num = parseInt(s.replace("#", ""), 16);
    return (isNaN(num) ? fallback : num) as ColorResolvable;
  };
  return {
    annTitleColor:  parseHex(cfg?.annTitleColor,  0xffe500),
    annDescColor:   parseHex(cfg?.annDescColor,   0xffe500),
    annAddColor:    parseHex(cfg?.annAddColor,    0xffe500),
    eventTitleColor: parseHex(cfg?.eventColor,    0x5865f2),
    eventDescColor:  parseHex(cfg?.eventDescColor, 0x5865f2),
    eventAddColor:   parseHex(cfg?.eventAddColor,  0x5865f2),
  };
}

async function isAuthorized(message: Message): Promise<{ authorized: boolean; eventHosterOnly: boolean }> {
  const member = message.member;
  if (!member || !message.guildId) return { authorized: false, eventHosterOnly: false };
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return { authorized: true, eventHosterOnly: false };
  const [cfg] = await db
    .select({
      announcementsRoleId: botConfigTable.announcementsRoleId,
      eventHosterRoleId:   botConfigTable.eventHosterRoleId,
    })
    .from(botConfigTable)
    .where(eq(botConfigTable.guildId, message.guildId))
    .limit(1);
  const hasAnnRole   = !!(cfg?.announcementsRoleId && member.roles.cache.has(cfg.announcementsRoleId));
  const hasEventRole = !!(cfg?.eventHosterRoleId   && member.roles.cache.has(cfg.eventHosterRoleId));
  if (hasAnnRole)   return { authorized: true, eventHosterOnly: false };
  if (hasEventRole) return { authorized: true, eventHosterOnly: true };
  return { authorized: false, eventHosterOnly: false };
}

async function getAllowedChannels(guildId: string): Promise<string[]> {
  const [cfg] = await db
    .select({ announcementChannelsJson: botConfigTable.announcementChannelsJson })
    .from(botConfigTable)
    .where(eq(botConfigTable.guildId, guildId))
    .limit(1);
  if (!cfg?.announcementChannelsJson) return [];
  try { return JSON.parse(cfg.announcementChannelsJson) as string[]; } catch { return []; }
}

async function tempReply(message: Message, text: string, ms = 8000) {
  const reply = await message.reply(text);
  setTimeout(() => reply.delete().catch(() => {}), ms);
}

// ── State ─────────────────────────────────────────────────────────────────────
interface AnnSetupState {
  userId: string;
  guildId: string;
  channelId: string;        // channel where the ann will be posted
  panelChannelId: string;   // channel where the setup panel is
  panelMessageId?: string;  // message ID of the setup panel
  title: string;
  description: string;
  additional: string;
  modalImageUrl: string;
  attachmentImageUrl?: string;
  tagOn: boolean;
  mode: "ann" | "event";
  lockedToEvent: boolean;
  filled: boolean;
  panelInteraction?: ButtonInteraction;
}

const annSetupState = new Map<string, AnnSetupState>();
const SEP = "\u2500".repeat(32);

// ── Panel Embed & Components ──────────────────────────────────────────────────
function buildSetupPanelEmbed(state: AnnSetupState): EmbedBuilder {
  const isEvent = state.mode === "event";
  const color = (isEvent ? 0x5865f2 : 0xffe500) as ColorResolvable;
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(isEvent ? "\uD83C\uDF89 Event Setup" : "\uD83D\uDCE3 Announcement Setup");

  if (state.filled) {
    const lines: string[] = [];
    if (state.title) lines.push(`**Title:** ${state.title}`);
    const desc = state.description.length > 120 ? state.description.slice(0, 120) + "\u2026" : state.description;
    lines.push(`**Description:** ${desc}`);
    if (state.additional) {
      const add = state.additional.length > 80 ? state.additional.slice(0, 80) + "\u2026" : state.additional;
      lines.push(`**Additional:** ${add}`);
    }
    if (state.modalImageUrl) lines.push("**Image:** set \u2705");
    lines.push("", "-# Click **Send** to post.");
    embed.setDescription(lines.join("\n"));
  } else {
    embed.setDescription(
      "Fill in the details, then click **Send**.\n\n" +
      "-# Only you can use this panel."
    );
  }
  return embed;
}

function buildSetupPanelComponents(state: AnnSetupState): ActionRowBuilder<ButtonBuilder>[] {
  const uid = state.userId;
  const isEvent = state.mode === "event";

  const row1Buttons: ButtonBuilder[] = [
    new ButtonBuilder()
      .setCustomId(`an_fill:${uid}`)
      .setLabel(state.filled ? "\u270F\uFE0F Edit Details" : "\uD83D\uDCDD Fill Details")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`an_tag:${uid}`)
      .setLabel(state.tagOn ? "\uD83D\uDFE2 Tag: ON" : "\uD83D\uDD34 Tag: OFF")
      .setStyle(state.tagOn ? ButtonStyle.Success : ButtonStyle.Danger),
  ];

  // Color button only for ann mode
  if (!isEvent) {
    row1Buttons.push(
      new ButtonBuilder()
        .setCustomId(`an_tc_color_open:${uid}`)
        .setLabel("\uD83C\uDFA8 Color")
        .setStyle(ButtonStyle.Secondary)
    );
  }

  row1Buttons.push(
    new ButtonBuilder()
      .setCustomId(`an_send:${uid}`)
      .setLabel("\u2705 Send")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!state.filled),
    new ButtonBuilder()
      .setCustomId(`an_cancel:${uid}`)
      .setLabel("\u2715 Cancel")
      .setStyle(ButtonStyle.Secondary),
  );

  const rows: ActionRowBuilder<ButtonBuilder>[] = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(...row1Buttons),
  ];

  if (state.filled) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`an_preview:${uid}`)
          .setLabel("👁️ Preview")
          .setStyle(ButtonStyle.Secondary),
      )
    );
  }

  return rows;
}

function getAnnouncementOwnerId(customId: string): string | undefined {
  const parts = customId.split(":");
  return customId.startsWith("an_tc_cmodal:") ? parts[2] : parts[1];
}

function isAnnouncementCustomId(customId: string): boolean {
  return (
    customId.startsWith("an_open:")           ||
    customId.startsWith("an_fill:")           ||
    customId.startsWith("an_tag:")            ||
    customId.startsWith("an_send:")           ||
    customId.startsWith("an_cancel:")         ||
    customId.startsWith("an_tc_color_open:")  ||
    customId.startsWith("an_tc_color_title:") ||
    customId.startsWith("an_tc_color_desc:")  ||
    customId.startsWith("an_tc_color_add:")   ||
    customId.startsWith("an_tc_color_back:")  ||
    customId.startsWith("an_preview:")        ||
    customId.startsWith("an_modal:")          ||
    customId.startsWith("an_tc_cmodal:")
  );
}

async function editStoredSetupPanel(client: Client, state: AnnSetupState): Promise<void> {
  if (!state.panelMessageId) return;
  const channel = await client.channels.fetch(state.panelChannelId).catch(() => null);
  const messages = (channel as { messages?: { fetch: (id: string) => Promise<Message> } } | null)?.messages;
  if (!messages) return;
  const panel = await messages.fetch(state.panelMessageId).catch(() => null);
  await panel?.edit({
    embeds: [buildSetupPanelEmbed(state)],
    components: buildSetupPanelComponents(state),
  }).catch(() => {});
}

function buildColorSubPanelEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x5000ff)
    .setTitle("\uD83C\uDFA8 Ann Colors")
    .setDescription(
      "Click a button to set the embed color for that section.\n" +
      "Type a hex code, e.g. `FFE500`.\n\n" +
      "**Title** \u2014 the separator/heading embed\n" +
      "**Description** \u2014 the main body embed\n" +
      "**Additional** \u2014 the extra bottom embed"
    )
    .setFooter({ text: "Night Stars \u2022 Announcements" });
}

function buildColorSubPanelComponents(uid: string): ActionRowBuilder<ButtonBuilder>[] {
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`an_tc_color_title:${uid}`).setLabel("Title Color").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`an_tc_color_desc:${uid}`).setLabel("Description Color").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`an_tc_color_add:${uid}`).setLabel("Additional Color").setStyle(ButtonStyle.Primary),
  );
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`an_tc_color_back:${uid}`).setLabel("\u2190 Back").setStyle(ButtonStyle.Secondary),
  );
  return [row1, row2];
}

// ── Embeds Builder ────────────────────────────────────────────────────────────
function buildAnnouncementEmbeds(
  title: string,
  description: string,
  additional: string,
  titleColor: ColorResolvable,
  descColor: ColorResolvable,
  addColor: ColorResolvable,
  imageUrl?: string,
): EmbedBuilder[] {
  const embeds: EmbedBuilder[] = [];

  if (title) {
    const isHeading = title.startsWith("## ");
    const t = isHeading ? title.slice(3).trim() : title;
    const line = isHeading ? `## ${toBold(t)}` : toBold(t);
    embeds.push(new EmbedBuilder().setColor(titleColor).setDescription(line));
  }

  const bodyText = imageUrl ? `${toBold(description)}\n\u200b` : toBold(description);
  const bodyEmbed = new EmbedBuilder().setColor(descColor).setDescription(bodyText);
  if (imageUrl && isValidUrl(imageUrl)) bodyEmbed.setImage(imageUrl);
  embeds.push(bodyEmbed);

  if (additional) {
    embeds.push(new EmbedBuilder().setColor(addColor).setDescription(toBold(additional)));
  }

  return embeds;
}

// ── Shared: open setup panel in channel ───────────────────────────────────────
async function openAnnSetupInChannel(message: Message, mode: "ann" | "event"): Promise<void> {
  const auth = await isAuthorized(message);
  if (!auth.authorized) {
    await tempReply(message, "\u274C You don\u2019t have permission to post announcements.");
    return;
  }

  // For =ann command, only non-event-only users
  if (mode === "ann" && auth.eventHosterOnly) {
    await tempReply(message, "\u274C You can only post events. Use `=event` instead.");
    return;
  }

  const allowed = await getAllowedChannels(message.guild!.id);
  if (allowed.length && !allowed.includes(message.channelId)) {
    await tempReply(message, `\u274C Announcements can only be posted from: ${allowed.map(id => `<#${id}>`).join(", ")}`);
    return;
  }

  const attachmentImageUrl = message.attachments.first()?.url;
  const state: AnnSetupState = {
    userId: message.author.id,
    guildId: message.guild!.id,
    channelId: message.channelId,
    panelChannelId: message.channelId,
    title: "", description: "", additional: "", modalImageUrl: "",
    tagOn: true,
    mode,
    lockedToEvent: mode === "event",
    filled: false,
    attachmentImageUrl,
  };

  await message.delete().catch(() => {});

  annSetupState.set(state.userId, state);

  const launcher = await (message.channel as TextChannel).send({
    content: "-# Setup panel ready.",
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`an_open:${state.userId}`)
          .setLabel("📋 Open Setup Panel")
          .setStyle(ButtonStyle.Primary)
      ),
    ],
  });

  state.panelMessageId = launcher.id;
  annSetupState.set(state.userId, state);
}

// ── =an inline announcement helpers ──────────────────────────────────────────
async function resolveTags(text: string, guild: Guild): Promise<string> {
  const tagPattern = /\[([^\]]+)\]/g;
  const matches: { match: string; name: string; index: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = tagPattern.exec(text)) !== null) {
    matches.push({ match: m[0], name: m[1], index: m.index });
  }
  if (matches.length === 0) return text;

  try { await guild.roles.fetch(); } catch {}

  let result = text;
  for (let i = matches.length - 1; i >= 0; i--) {
    const { match, name, index } = matches[i];
    let resolved = match;
    const lower = name.toLowerCase();

    if (lower === "everyone") {
      resolved = "@everyone";
    } else if (lower === "here") {
      resolved = "@here";
    } else {
      const role = guild.roles.cache.find((r) => r.name.toLowerCase() === lower);
      if (role) {
        resolved = `<@&${role.id}>`;
      } else {
        try { await guild.members.fetch({ query: name, limit: 5 }); } catch {}
        const member = guild.members.cache.find(
          (mem) =>
            mem.user.username.toLowerCase() === lower ||
            mem.displayName.toLowerCase() === lower ||
            (mem.user.globalName?.toLowerCase() ?? "") === lower,
        );
        if (member) resolved = `<@${member.id}>`;
      }
    }
    result = result.slice(0, index) + resolved + result.slice(index + match.length);
  }
  return result;
}

async function handleInlineAnn(message: Message, prefix: string): Promise<void> {
  const auth = await isAuthorized(message);
  if (!auth.authorized) {
    await tempReply(message, "\u274C You don\u2019t have permission to post announcements.");
    return;
  }
  if (auth.eventHosterOnly) {
    await tempReply(message, "\u274C You can only post events. Use `=event` instead.");
    return;
  }

  const allowed = await getAllowedChannels(message.guild!.id);
  if (allowed.length && !allowed.includes(message.channelId)) {
    await tempReply(
      message,
      `\u274C Announcements can only be posted from: ${allowed.map((id) => `<#${id}>`).join(", ")}`,
    );
    return;
  }

  const raw = message.content.trim();
  const body = raw.slice((prefix + "an ").length).trim();
  if (!body) {
    await tempReply(message, `\u274C Usage: \`${prefix}an Your message [RoleName] ;emoji\``);
    return;
  }

  const guild = message.guild!;
  let resolved = await resolveTags(body, guild);
  resolved = await resolveEmojiCodes(resolved, guild);

  // Delete the trigger message as fast as possible
  await message.delete().catch(() => {});

  await (message.channel as TextChannel).send({
    content: resolved,
    allowedMentions: { parse: ["everyone", "roles", "users"] },
  });
}

// ── Module Registration ───────────────────────────────────────────────────────
export function registerAnnouncementsModule(client: Client): void {

  // ── Prefix commands: =ann and =event ──────────────────────────────────────
  client.on("messageCreate", async (message) => {
    if (!message.guild || message.author.bot) return;
    if (!isMainGuild(message.guild.id)) return;

    const raw    = message.content.trim();
    const prefix = await getAnnPrefix(message.guild.id);

    if (raw === prefix + "ann" || raw.startsWith(prefix + "ann ")) {
      await openAnnSetupInChannel(message, "ann");
      return;
    }

    if (raw === prefix + "event" || raw.startsWith(prefix + "event ")) {
      await openAnnSetupInChannel(message, "event");
      return;
    }

    if (raw === prefix + "an" || raw.startsWith(prefix + "an ")) {
      await handleInlineAnn(message, prefix);
      return;
    }
  });

  // ── Interactions ──────────────────────────────────────────────────────────
  client.on("interactionCreate", async (interaction) => {
    const customId = interaction.isButton() || interaction.isModalSubmit() ? interaction.customId : "";
    if (!customId || !isAnnouncementCustomId(customId)) return;
    const ownerId = getAnnouncementOwnerId(customId);
    const state = ownerId ? annSetupState.get(ownerId) : undefined;
    const guildId = interaction.guild?.id ?? state?.guildId;
    if (!guildId) return;
    if (!isMainGuild(guildId)) return;

    if (interaction.isButton()) {
      const cid = interaction.customId;
      if (
        cid.startsWith("an_open:")           ||
        cid.startsWith("an_fill:")           ||
        cid.startsWith("an_tag:")            ||
        cid.startsWith("an_send:")           ||
        cid.startsWith("an_cancel:")         ||
        cid.startsWith("an_tc_color_open:")  ||
        cid.startsWith("an_tc_color_title:") ||
        cid.startsWith("an_tc_color_desc:")  ||
        cid.startsWith("an_tc_color_add:")   ||
        cid.startsWith("an_tc_color_back:") ||
        cid.startsWith("an_preview:")
      ) {
        await handleAnnButton(interaction as ButtonInteraction, client);
        return;
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith("an_modal:")) {
        await handleAnnModal(interaction as ModalSubmitInteraction, client);
        return;
      }
      if (interaction.customId.startsWith("an_tc_cmodal:")) {
        await handleAnnColorModal(interaction as ModalSubmitInteraction, client);
        return;
      }
    }
  });
}

// ── Ann Button Handler ────────────────────────────────────────────────────────
async function handleAnnButton(interaction: ButtonInteraction, client: Client): Promise<void> {
  const { customId } = interaction;
  const ownerId = customId.split(":")[1];

  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: "\u274C This panel belongs to someone else.", ephemeral: true });
    return;
  }

  const state = annSetupState.get(ownerId);
  if (!state) {
    await interaction.reply({ content: "\u274C Session expired. Run the command again.", ephemeral: true });
    return;
  }

  // Open: reply ephemerally, store interaction for later updates
  if (customId.startsWith("an_open:")) {
    await interaction.reply({
      ephemeral: true,
      embeds: [buildSetupPanelEmbed(state)],
      components: buildSetupPanelComponents(state),
    });
    await interaction.message.delete().catch(() => {});
    state.panelInteraction = interaction;
    annSetupState.set(ownerId, state);
    return;
  }

  // Fill Details — show modal
  if (customId.startsWith("an_fill:")) {
    const modal = new ModalBuilder()
      .setCustomId(`an_modal:${ownerId}`)
      .setTitle(state.mode === "event" ? "Event Details" : "Announcement Details");

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("an_title")
          .setLabel("Title (optional \u2014 use ## for big heading)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue(state.title)
          .setMaxLength(100)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("an_description")
          .setLabel("Description")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setValue(state.description)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("an_additional")
          .setLabel("Additional (optional \u2014 separate embed)")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setValue(state.additional)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("an_image")
          .setLabel("Image URL (optional)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue(state.modalImageUrl)
          .setPlaceholder("https://...")
          .setMaxLength(500)
      ),
    );
    await interaction.showModal(modal);
    return;
  }

  // Tag toggle
  if (customId.startsWith("an_tag:")) {
    state.tagOn = !state.tagOn;
    annSetupState.set(ownerId, state);
    await interaction.update({
      embeds: [buildSetupPanelEmbed(state)],
      components: buildSetupPanelComponents(state),
    });
    return;
  }

  // Color panel — open
  if (customId.startsWith("an_tc_color_open:")) {
    await interaction.update({
      embeds: [buildColorSubPanelEmbed()],
      components: buildColorSubPanelComponents(ownerId),
    });
    return;
  }

  // Color panel — back to main panel
  if (customId.startsWith("an_tc_color_back:")) {
    await interaction.update({
      embeds: [buildSetupPanelEmbed(state)],
      components: buildSetupPanelComponents(state),
    });
    return;
  }

  // Color panel — open modal for a specific color type
  if (
    customId.startsWith("an_tc_color_title:") ||
    customId.startsWith("an_tc_color_desc:")  ||
    customId.startsWith("an_tc_color_add:")
  ) {
    const type = customId.startsWith("an_tc_color_title:") ? "ann_title"
               : customId.startsWith("an_tc_color_desc:")  ? "ann_desc"
               : "ann_add";
    const labels: Record<string, string> = {
      ann_title: "Ann Title Color (hex, e.g. FFE500)",
      ann_desc:  "Ann Description Color (hex, e.g. FFE500)",
      ann_add:   "Ann Additional Color (hex, e.g. FFE500)",
    };
    const modal = new ModalBuilder()
      .setCustomId(`an_tc_cmodal:${type}:${ownerId}`)
      .setTitle("Set Color");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("hex_color")
          .setLabel(labels[type])
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder("FFE500")
          .setMaxLength(7)
      )
    );
    await interaction.showModal(modal);
    return;
  }

  // Preview
  if (customId.startsWith("an_preview:")) {
    if (!state.filled) {
      await interaction.reply({ content: "❌ Fill in the details first.", ephemeral: true });
      return;
    }
    const guild = client.guilds.cache.get(state.guildId);
    if (!guild) { await interaction.reply({ content: "❌ Guild not found.", ephemeral: true }); return; }

    const colors = await getAnnColors(state.guildId);
    const isEvent = state.mode === "event";
    const titleColor: ColorResolvable = isEvent ? colors.eventTitleColor : colors.annTitleColor;
    const descColor:  ColorResolvable = isEvent ? colors.eventDescColor  : colors.annDescColor;
    const addColor:   ColorResolvable = isEvent ? colors.eventColor      : colors.annAddColor;

    const titleResolved = state.title      ? await resolveEmojiCodes(state.title, guild)      : "";
    const descResolved  =                    await resolveEmojiCodes(state.description, guild);
    const addResolved   = state.additional ? await resolveEmojiCodes(state.additional, guild) : "";
    const imageUrl      = state.modalImageUrl || state.attachmentImageUrl;

    const previewEmbeds = buildAnnouncementEmbeds(
      titleResolved, descResolved, addResolved,
      titleColor, descColor, addColor, imageUrl
    );

    await interaction.reply({
      content: "-# 👁️ Preview — not posted yet. Use **✏️ Edit Details** to change or **✅ Send** to post.",
      embeds: previewEmbeds,
      ephemeral: true,
    });
    return;
  }

  // Cancel
  if (customId.startsWith("an_cancel:")) {
    annSetupState.delete(ownerId);
    await interaction.update({ content: "\u2716\uFE0F Cancelled.", embeds: [], components: [] });
    return;
  }

  // Send
  if (customId.startsWith("an_send:")) {
    if (!state.filled) {
      await interaction.reply({ content: "\u274C Please fill in the details first.", ephemeral: true });
      return;
    }

    annSetupState.delete(ownerId);
    await interaction.update({ content: "\u2705 Sending\u2026", embeds: [], components: [] });

    const guild = client.guilds.cache.get(state.guildId);
    if (!guild) return;

    const colors = await getAnnColors(state.guildId);
    const isEvent = state.mode === "event";
    const titleColor: ColorResolvable = isEvent ? colors.eventTitleColor : colors.annTitleColor;
    const descColor:  ColorResolvable = isEvent ? colors.eventDescColor  : colors.annDescColor;
    const addColor:   ColorResolvable = isEvent ? colors.eventColor : colors.annAddColor;

    const titleResolved = state.title      ? await resolveEmojiCodes(state.title,       guild) : "";
    const descResolved  =                    await resolveEmojiCodes(state.description,  guild);
    const addResolved   = state.additional ? await resolveEmojiCodes(state.additional,   guild) : "";
    const imageUrl = state.modalImageUrl || state.attachmentImageUrl;

    const channel = await guild.channels.fetch(state.channelId).catch(() => null) as TextChannel | null;
    if (!channel) return;

    // Send @everyone / role tag FIRST if tag is on, delete after 5s
    if (state.tagOn) {
      const boldTitle = titleResolved ? toBold(titleResolved.replace(/^##\s*/, "").trim()) : "";
      const pingContent = boldTitle ? `${boldTitle} @everyone` : "@everyone";
      const ping = await channel.send({ content: pingContent });
      setTimeout(() => ping.delete().catch(() => {}), 5000);
    }

    const embeds = buildAnnouncementEmbeds(
      titleResolved, descResolved, addResolved,
      titleColor, descColor, addColor, imageUrl
    );
    await channel.send({ embeds });

    // Logs
    const [cfg] = await db
      .select({ annLogsChannelId: botConfigTable.annLogsChannelId })
      .from(botConfigTable)
      .where(eq(botConfigTable.guildId, state.guildId))
      .limit(1);

    if (cfg?.annLogsChannelId) {
      const logsChannel = await guild.channels.fetch(cfg.annLogsChannelId).catch(() => null) as TextChannel | null;
      if (logsChannel) {
        const logEmbed = new EmbedBuilder()
          .setColor(isEvent ? colors.eventColor : colors.annTitleColor)
          .setTitle(isEvent ? "\uD83C\uDF89 Event Posted" : "\uD83D\uDCE3 Announcement Posted")
          .addFields(
            { name: "Posted by", value: `<@${ownerId}>`,         inline: true },
            { name: "Channel",   value: `<#${state.channelId}>`, inline: true },
            { name: "Type",      value: isEvent ? "Event" : "Announcement", inline: true },
          )
          .setTimestamp();
        await logsChannel.send({ embeds: [logEmbed] }).catch(() => {});
      }
    }
    return;
  }
}

// ── Ann Modal Submit (fill details) ──────────────────────────────────────────
async function handleAnnModal(interaction: ModalSubmitInteraction, client: Client): Promise<void> {
  const ownerId = interaction.customId.split(":")[1];
  const state = annSetupState.get(ownerId);
  if (!state) { await interaction.reply({ content: "\u274C Session expired.", ephemeral: true }); return; }

  state.title         = interaction.fields.getTextInputValue("an_title").trim();
  state.description   = interaction.fields.getTextInputValue("an_description").trim();
  state.additional    = interaction.fields.getTextInputValue("an_additional").trim();
  state.modalImageUrl = interaction.fields.getTextInputValue("an_image").trim();
  state.filled        = !!state.description;
  annSetupState.set(ownerId, state);

  if (state.panelInteraction) {
    try {
      await state.panelInteraction.editReply({
        embeds: [buildSetupPanelEmbed(state)],
        components: buildSetupPanelComponents(state),
      });
    } catch {}
  } else {
    await editStoredSetupPanel(client, state);
  }

  await interaction.reply({ content: "\u2705 Details saved!", ephemeral: true });
}

// ── Ann Color Modal Submit (text command color change) ────────────────────────
async function handleAnnColorModal(interaction: ModalSubmitInteraction, client: Client): Promise<void> {
  const parts = interaction.customId.split(":");
  const type    = parts[1]; // ann_title | ann_desc | ann_add
  const ownerId = parts[2];

  const raw = interaction.fields.getTextInputValue("hex_color").replace("#", "").trim().toUpperCase();
  const num = parseInt(raw, 16);
  if (isNaN(num) || raw.length < 3 || raw.length > 6) {
    await interaction.reply({
      content: "\u274C Invalid hex color. Use something like `FFE500` or `#FFE500`.",
      ephemeral: true,
    });
    return;
  }

  const state2 = annSetupState.get(ownerId);
  const guildId = state2?.guildId ?? interaction.guild?.id ?? "";
  if (!guildId) return;
  const updateData =
    type === "ann_title" ? { annTitleColor: raw, updatedAt: new Date() } :
    type === "ann_desc"  ? { annDescColor:  raw, updatedAt: new Date() } :
                           { annAddColor:   raw, updatedAt: new Date() };
  const insertData =
    type === "ann_title" ? { guildId, annTitleColor: raw } :
    type === "ann_desc"  ? { guildId, annDescColor:  raw } :
                           { guildId, annAddColor:   raw };

  const existing = await db.select().from(botConfigTable).where(eq(botConfigTable.guildId, guildId)).limit(1);
  if (existing.length) {
    await db.update(botConfigTable).set(updateData).where(eq(botConfigTable.guildId, guildId));
  } else {
    await db.insert(botConfigTable).values(insertData);
  }

  const labels: Record<string, string> = {
    ann_title: "Ann \u2014 Title",
    ann_desc:  "Ann \u2014 Description",
    ann_add:   "Ann \u2014 Additional",
  };

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(num)
        .setDescription(`\u2705 **${labels[type] ?? type}** color set to \`#${raw}\``)
        .setFooter({ text: "Night Stars \u2022 Announcements" }),
    ],
    ephemeral: true,
  });

  const state = annSetupState.get(ownerId);
  if (state?.panelInteraction) {
    try {
      await state.panelInteraction.editReply({
        embeds: [buildSetupPanelEmbed(state)],
        components: buildSetupPanelComponents(state),
      });
    } catch {}
  } else if (state) {
    await editStoredSetupPanel(client, state);
  }
}
