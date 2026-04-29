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
  ChannelType,
  ContainerBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  Interaction,
} from "discord.js";
import { db } from "@workspace/db";
import { botConfigTable, postTemplatesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
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

export async function resolveEmojiCodes(text: string, guild: Guild): Promise<string> {
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
  lastActivity?: number;
  savedThisSession?: boolean;   // true after user clicks 💾 Save in this session
  hasSavedTemplate?: boolean;   // true if a saved template exists in DB for this guild+mode
}

interface SavedAnnTemplate {
  title?: string;
  description?: string;
  additional?: string;
  modalImageUrl?: string;
  tagOn?: boolean;
}

async function loadSavedTemplate(
  guildId: string,
  mode: "ann" | "event",
): Promise<SavedAnnTemplate | null> {
  const [cfg] = await db
    .select({
      savedAnnTemplate: botConfigTable.savedAnnTemplate,
      savedEventTemplate: botConfigTable.savedEventTemplate,
    })
    .from(botConfigTable)
    .where(eq(botConfigTable.guildId, guildId))
    .limit(1);
  const raw = mode === "event" ? cfg?.savedEventTemplate : cfg?.savedAnnTemplate;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SavedAnnTemplate;
  } catch {
    return null;
  }
}

async function persistSavedTemplate(
  guildId: string,
  mode: "ann" | "event",
  template: SavedAnnTemplate | null,
): Promise<void> {
  const value = template ? JSON.stringify(template) : null;
  const updateData =
    mode === "event"
      ? { savedEventTemplate: value, updatedAt: new Date() }
      : { savedAnnTemplate: value, updatedAt: new Date() };
  const insertData =
    mode === "event"
      ? { guildId, savedEventTemplate: value }
      : { guildId, savedAnnTemplate: value };
  const existing = await db
    .select({ id: botConfigTable.id })
    .from(botConfigTable)
    .where(eq(botConfigTable.guildId, guildId))
    .limit(1);
  if (existing.length) {
    await db.update(botConfigTable).set(updateData).where(eq(botConfigTable.guildId, guildId));
  } else {
    await db.insert(botConfigTable).values(insertData);
  }
}

const annSetupState = new Map<string, AnnSetupState>();
const SEP = "\u2500".repeat(32);

// Sessions are kept alive as long as the user keeps interacting.
// Auto-cleanup only removes sessions inactive for over 2 hours.
const STATE_TTL_MS = 2 * 60 * 60 * 1000;
function touchState(state: AnnSetupState): void {
  state.lastActivity = Date.now();
  annSetupState.set(state.userId, state);
}
setInterval(() => {
  const now = Date.now();
  for (const [id, st] of annSetupState) {
    if (st.lastActivity && now - st.lastActivity > STATE_TTL_MS) {
      annSetupState.delete(id);
    }
  }
}, 30 * 60 * 1000).unref?.();

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
    if (state.savedThisSession) {
      lines.push("", "\uD83D\uDCBE **Saved as template** \u2014 will auto-load next time. Click **Clear** to start fresh.");
    } else {
      lines.push("", "-# Click **Send** to post, or \uD83D\uDCBE **Save** to reuse it later.");
    }
    embed.setDescription(lines.join("\n"));
  } else if (state.hasSavedTemplate) {
    embed.setDescription(
      "Fill in the details, then click **Send**.\n" +
      "-# A saved template exists \u2014 click \uD83D\uDCC2 **Load Saved** to prefill it.\n\n" +
      "-# Only you can use this panel."
    );
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

  const row2Buttons: ButtonBuilder[] = [];
  if (state.filled) {
    row2Buttons.push(
      new ButtonBuilder()
        .setCustomId(`an_preview:${uid}`)
        .setLabel("\uD83D\uDC41\uFE0F Preview")
        .setStyle(ButtonStyle.Secondary),
    );
    if (state.savedThisSession) {
      row2Buttons.push(
        new ButtonBuilder()
          .setCustomId(`an_save:${uid}`)
          .setLabel("\uD83D\uDDD1\uFE0F Clear")
          .setStyle(ButtonStyle.Danger),
      );
    } else {
      row2Buttons.push(
        new ButtonBuilder()
          .setCustomId(`an_save:${uid}`)
          .setLabel("\uD83D\uDCBE Save")
          .setStyle(ButtonStyle.Primary),
      );
    }
  } else if (state.hasSavedTemplate) {
    row2Buttons.push(
      new ButtonBuilder()
        .setCustomId(`an_load:${uid}`)
        .setLabel("\uD83D\uDCC2 Load Saved")
        .setStyle(ButtonStyle.Primary),
    );
  }
  if (row2Buttons.length) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...row2Buttons));
  }

  return rows;
}

function getAnnouncementOwnerId(customId: string): string | undefined {
  const parts = customId.split(":");
  return customId.startsWith("an_tc_cmodal:") ? parts[2] : parts[1];
}

function isAnnouncementCustomId(customId: string): boolean {
  if (customId.startsWith("anb_")) return true;
  if (customId.startsWith("post_")) return true;
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
    customId.startsWith("an_save:")           ||
    customId.startsWith("an_load:")           ||
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

async function deleteSetupLauncher(interaction: ButtonInteraction, client: Client, state: AnnSetupState): Promise<void> {
  const launcherMessageId = state.panelMessageId ?? interaction.message.id;
  const launcherChannelId = state.panelChannelId ?? interaction.channelId;

  try {
    await interaction.message.delete();
    delete state.panelMessageId;
    return;
  } catch {}

  const channel = await client.channels.fetch(launcherChannelId).catch(() => null);
  const textChannel = channel as TextChannel | null;
  const fetchedMessage = await textChannel?.messages.fetch(launcherMessageId).catch(() => null);

  if (fetchedMessage) {
    try {
      await fetchedMessage.delete();
      delete state.panelMessageId;
      return;
    } catch {}

    await fetchedMessage.edit({
      content: " ",
      embeds: [],
      components: [],
    }).catch(() => {});
  }
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

  // Auto-load saved template if one exists for this guild + mode.
  const saved = await loadSavedTemplate(message.guild!.id, mode).catch(() => null);
  const hasSavedTemplate = !!saved;

  const state: AnnSetupState = {
    userId: message.author.id,
    guildId: message.guild!.id,
    channelId: message.channelId,
    panelChannelId: message.channelId,
    title: saved?.title ?? "",
    description: saved?.description ?? "",
    additional: saved?.additional ?? "",
    modalImageUrl: saved?.modalImageUrl ?? "",
    tagOn: saved?.tagOn ?? true,
    mode,
    lockedToEvent: mode === "event",
    filled: !!saved?.description,
    attachmentImageUrl,
    hasSavedTemplate,
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
  touchState(state);
  // Keep the launcher visible for 30 minutes so staff have time to come back.
  setTimeout(() => {
    launcher.delete().catch(() => {});
  }, 30 * 60 * 1000);
}

// ── =an inline announcement helpers ──────────────────────────────────────────
export async function resolveTags(text: string, guild: Guild): Promise<string> {
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
    } else if (name.startsWith("#")) {
      const chName = name.slice(1).toLowerCase();
      const ch = guild.channels.cache.find((c) => c.name?.toLowerCase() === chName);
      if (ch) resolved = `<#${ch.id}>`;
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

// Find Discord voice/stage channel references in text and turn each into a
// "Join" Link button row, similar to how Discord renders voice links in chat.
//
// We accept three forms so the staff don't have to worry about how they wrote
// it:
//   1. Full link:  https://discord.com/channels/<guildId>/<channelId>
//   2. Channel mention from the autocomplete:  <#channelId>
//   3. Bare channel ID (17-20 digits) — last-resort fallback so a copy-pasted
//      ID still becomes a button.
function buildVoiceChannelButtons(
  text: string,
  guild: Guild,
): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  const seen = new Set<string>();
  const candidates: string[] = [];

  // Form 1: full discord channel URLs (any subdomain).
  const linkRe = /https?:\/\/(?:www\.|ptb\.|canary\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)/g;
  for (let m: RegExpExecArray | null; (m = linkRe.exec(text)) !== null; ) {
    const [, gId, cId] = m;
    if (gId === guild.id) candidates.push(cId);
  }

  // Form 2: <#channelId> mentions.
  const mentionRe = /<#(\d{17,20})>/g;
  for (let m: RegExpExecArray | null; (m = mentionRe.exec(text)) !== null; ) {
    candidates.push(m[1]);
  }

  // Form 3: bare numeric IDs (only if they look like Discord snowflakes and
  // are not already part of a link/mention we matched above).
  const bareRe = /(?<![\/<\d])(\d{17,20})(?![\/>\d])/g;
  for (let m: RegExpExecArray | null; (m = bareRe.exec(text)) !== null; ) {
    candidates.push(m[1]);
  }

  let current = new ActionRowBuilder<ButtonBuilder>();
  let count = 0;
  for (const cId of candidates) {
    if (seen.has(cId)) continue;
    const ch = guild.channels.cache.get(cId);
    if (!ch) continue;
    const isVoice =
      ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildStageVoice;
    if (!isVoice) continue;
    seen.add(cId);
    const url = `https://discord.com/channels/${guild.id}/${cId}`;
    const label = `🔊 Join ${ch.name ?? "Voice"}`.slice(0, 80);
    current.addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label).setURL(url),
    );
    count++;
    if (count % 5 === 0) {
      rows.push(current);
      current = new ActionRowBuilder<ButtonBuilder>();
    }
    if (rows.length >= 5) break;
  }
  if (current.components.length > 0 && rows.length < 5) rows.push(current);
  return rows;
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
      const afterAnn = raw.slice((prefix + "ann").length).trim();
      const editId = /^\d{17,20}$/.test(afterAnn) ? afterAnn : undefined;
      await openAnnBuilderInChannel(message, editId);
      return;
    }

    if (raw === prefix + "event" || raw.startsWith(prefix + "event ")) {
      await openAnnSetupInChannel(message, "event");
      return;
    }

    if (raw === prefix + "post" || raw.startsWith(prefix + "post ")) {
      const afterPost = raw.slice((prefix + "post").length).trim();
      const editId = /^\d{17,20}$/.test(afterPost) ? afterPost : undefined;
      await openPostBuilderInChannel(message, editId);
      return;
    }

    if (raw === prefix + "an" || raw.startsWith(prefix + "an ")) {
      await handleInlineAnn(message, prefix);
      return;
    }
  });

  // ── Interactions ──────────────────────────────────────────────────────────
  client.on("interactionCreate", async (interaction) => {
    const customId =
      interaction.isButton() ||
      interaction.isModalSubmit() ||
      interaction.isStringSelectMenu()
        ? interaction.customId
        : "";
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
        cid.startsWith("an_tc_color_back:")  ||
        cid.startsWith("an_preview:")        ||
        cid.startsWith("an_save:")           ||
        cid.startsWith("an_load:")
      ) {
        await handleAnnButton(interaction as ButtonInteraction, client);
        return;
      }
    }

    // Post builder (post_) interactions
    if (customId.startsWith("post_")) {
      const puid = customId.split(":")[1];
      if (
        (interaction.isButton() || interaction.isStringSelectMenu()) &&
        interaction.user.id !== puid
      ) {
        await interaction.reply({ content: "\u274C This builder belongs to someone else.", ephemeral: true });
        return;
      }
      await handlePostBuilderInteraction(
        interaction as ButtonInteraction | ModalSubmitInteraction | StringSelectMenuInteraction,
        client,
      );
      return;
    }

    // New ann builder (anb_) interactions
    if (interaction.customId.startsWith("anb_")) {
      const buid = interaction.customId.split(":")[1];
      if (interaction.isButton() && interaction.user.id !== buid) {
        await interaction.reply({ content: "\u274C This builder belongs to someone else.", ephemeral: true });
        return;
      }
      await handleAnnBuilderInteraction(
        interaction as ButtonInteraction | ModalSubmitInteraction,
        client,
      );
      return;
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
  touchState(state);

  // Open: post the setup panel as a normal channel message (NOT ephemeral) so
  // it doesn't expire after 15 minutes — staff need plenty of time to write
  // long announcements. Ownership is enforced on every button click.
  if (customId.startsWith("an_open:")) {
    await interaction.deferUpdate().catch(() => {});
    await deleteSetupLauncher(interaction, client, state);
    const channel = await client.channels
      .fetch(state.panelChannelId)
      .catch(() => null) as TextChannel | null;
    if (!channel) return;
    const panel = await channel.send({
      embeds: [buildSetupPanelEmbed(state)],
      components: buildSetupPanelComponents(state),
    }).catch(() => null);
    if (panel) {
      state.panelMessageId = panel.id;
    }
    delete state.panelInteraction;
    touchState(state);
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
    const addColor:   ColorResolvable = isEvent ? colors.eventAddColor   : colors.annAddColor;

    const titleResolved = state.title      ? await resolveEmojiCodes(await resolveTags(state.title, guild), guild)      : "";
    const descResolved  =                    await resolveEmojiCodes(await resolveTags(state.description, guild), guild);
    const addResolved   = state.additional ? await resolveEmojiCodes(await resolveTags(state.additional, guild), guild) : "";
    const imageUrl      = state.modalImageUrl || state.attachmentImageUrl;

    const previewEmbeds = buildAnnouncementEmbeds(
      titleResolved, descResolved, addResolved,
      titleColor, descColor, addColor, imageUrl
    );
    const voiceRows = buildVoiceChannelButtons(`${titleResolved}\n${descResolved}\n${addResolved}`, guild);

    await interaction.reply({
      content: "-# 👁️ Preview — not posted yet. Use **✏️ Edit Details** to change or **✅ Send** to post.",
      embeds: previewEmbeds,
      components: voiceRows,
      ephemeral: true,
    });
    return;
  }

  // Cancel — silently dismiss the click and delete the panel message so the
  // channel is left clean.
  if (customId.startsWith("an_cancel:")) {
    annSetupState.delete(ownerId);
    await interaction.deferUpdate().catch(() => {});
    if (interaction.message?.deletable) {
      await interaction.message.delete().catch(() => {});
    }
    return;
  }

  // Save / Clear toggle
  // - First click (state filled, not yet saved): persist current panel as a
  //   reusable template for this guild + mode and mark the panel as Saved.
  // - Second click (already Saved this session): clear the panel back to empty
  //   so the user can start a fresh announcement.
  if (customId.startsWith("an_save:")) {
    // For =event mode: always save to DB (no toggle/clear behaviour).
    // To remove the template, the user empties all fields and clicks Save again
    // — that saves an empty template which is then treated as "no template".
    if (state.mode === "event") {
      await persistSavedTemplate(state.guildId, "event", {
        title: state.title,
        description: state.description,
        additional: state.additional,
        modalImageUrl: state.modalImageUrl,
        tagOn: state.tagOn,
      }).catch(() => {});
      state.savedThisSession = true;
      state.hasSavedTemplate = !!state.description;
      touchState(state);
      await interaction.update({
        embeds: [buildSetupPanelEmbed(state)],
        components: buildSetupPanelComponents(state),
      });
      return;
    }

    // For =ann mode: keep the original toggle (save → then second click clears panel).
    if (state.savedThisSession) {
      state.title = "";
      state.description = "";
      state.additional = "";
      state.modalImageUrl = "";
      state.tagOn = true;
      state.filled = false;
      state.savedThisSession = false;
      const stillSaved = await loadSavedTemplate(state.guildId, state.mode).catch(() => null);
      state.hasSavedTemplate = !!stillSaved;
      touchState(state);
      await interaction.update({
        embeds: [buildSetupPanelEmbed(state)],
        components: buildSetupPanelComponents(state),
      });
      return;
    }
    if (!state.filled) {
      await interaction.reply({
        content: "\u274C Fill in the details first before saving.",
        ephemeral: true,
      });
      return;
    }
    await persistSavedTemplate(state.guildId, state.mode, {
      title: state.title,
      description: state.description,
      additional: state.additional,
      modalImageUrl: state.modalImageUrl,
      tagOn: state.tagOn,
    }).catch(() => {});
    state.savedThisSession = true;
    state.hasSavedTemplate = true;
    touchState(state);
    await interaction.update({
      embeds: [buildSetupPanelEmbed(state)],
      components: buildSetupPanelComponents(state),
    });
    return;
  }

  // Load saved template into the empty panel.
  if (customId.startsWith("an_load:")) {
    const saved = await loadSavedTemplate(state.guildId, state.mode).catch(() => null);
    if (!saved) {
      state.hasSavedTemplate = false;
      touchState(state);
      await interaction.update({
        embeds: [buildSetupPanelEmbed(state)],
        components: buildSetupPanelComponents(state),
      });
      return;
    }
    state.title = saved.title ?? "";
    state.description = saved.description ?? "";
    state.additional = saved.additional ?? "";
    state.modalImageUrl = saved.modalImageUrl ?? "";
    state.tagOn = saved.tagOn ?? true;
    state.filled = !!saved.description;
    state.savedThisSession = true;
    state.hasSavedTemplate = true;
    touchState(state);
    await interaction.update({
      embeds: [buildSetupPanelEmbed(state)],
      components: buildSetupPanelComponents(state),
    });
    return;
  }

  // Send
  if (customId.startsWith("an_send:")) {
    if (!state.filled) {
      await interaction.reply({ content: "\u274C Please fill in the details first.", ephemeral: true });
      return;
    }

    // For =event: auto-save the current content as the persistent template
    // so staff never need to re-type the same event text each time.
    if (state.mode === "event") {
      await persistSavedTemplate(state.guildId, "event", {
        title: state.title,
        description: state.description,
        additional: state.additional,
        modalImageUrl: state.modalImageUrl,
        tagOn: state.tagOn,
      }).catch(() => {});
    }

    annSetupState.delete(ownerId);
    // Acknowledge the click silently and remove the panel message from the
    // channel so we don't leave a "Sending…" status hanging around. The actual
    // announcement is posted below.
    await interaction.deferUpdate().catch(() => {});
    if (interaction.message?.deletable) {
      await interaction.message.delete().catch(() => {});
    }

    const guild = client.guilds.cache.get(state.guildId);
    if (!guild) return;

    const colors = await getAnnColors(state.guildId);
    const isEvent = state.mode === "event";
    const titleColor: ColorResolvable = isEvent ? colors.eventTitleColor : colors.annTitleColor;
    const descColor:  ColorResolvable = isEvent ? colors.eventDescColor  : colors.annDescColor;
    const addColor:   ColorResolvable = isEvent ? colors.eventAddColor   : colors.annAddColor;

    const titleResolved = state.title      ? await resolveEmojiCodes(await resolveTags(state.title,       guild), guild) : "";
    const descResolved  =                    await resolveEmojiCodes(await resolveTags(state.description,  guild), guild);
    const addResolved   = state.additional ? await resolveEmojiCodes(await resolveTags(state.additional,   guild), guild) : "";
    const imageUrl = state.modalImageUrl || state.attachmentImageUrl;

    const channel = await guild.channels.fetch(state.channelId).catch(() => null) as TextChannel | null;
    if (!channel) return;

    // Send @everyone / role tag FIRST if tag is on, then auto-delete after 5s
    // so the ping fires the notification but the message doesn't clutter the
    // channel.
    if (state.tagOn) {
      const boldTitle = titleResolved ? toBold(titleResolved.replace(/^##\s*/, "").trim()) : "";
      const pingContent = boldTitle ? `${boldTitle} @everyone` : "@everyone";
      const ping = await channel.send({
        content: pingContent,
        allowedMentions: { parse: ["everyone", "roles", "users"] },
      });
      setTimeout(() => ping.delete().catch(() => {}), 5000);
    }

    const embeds = buildAnnouncementEmbeds(
      titleResolved, descResolved, addResolved,
      titleColor, descColor, addColor, imageUrl
    );
    const voiceRows = buildVoiceChannelButtons(
      `${titleResolved}\n${descResolved}\n${addResolved}`,
      guild,
    );
    await channel.send({
      embeds,
      ...(voiceRows.length ? { components: voiceRows } : {}),
      allowedMentions: { parse: ["everyone", "roles", "users"] },
    });

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
          .setColor(isEvent ? colors.eventTitleColor : colors.annTitleColor)
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

  const newDescription = interaction.fields.getTextInputValue("an_description").trim();
  const wasFilled = state.filled;
  state.title         = interaction.fields.getTextInputValue("an_title").trim();
  state.description   = newDescription;
  state.additional    = interaction.fields.getTextInputValue("an_additional").trim();
  state.modalImageUrl = interaction.fields.getTextInputValue("an_image").trim();
  state.filled        = !!state.description;
  // Editing details after a save means the saved-this-session marker no longer
  // matches the panel — show "Save" again so they can re-save the new content.
  if (wasFilled && state.savedThisSession) state.savedThisSession = false;
  touchState(state);

  // Always edit the stored panel message by ID so we don't depend on the
  // ephemeral webhook token (which expires after 15 min). Fall back to the
  // legacy panelInteraction path only if we somehow have no message ID.
  if (state.panelMessageId) {
    await editStoredSetupPanel(client, state);
  } else if (state.panelInteraction) {
    try {
      await state.panelInteraction.editReply({
        embeds: [buildSetupPanelEmbed(state)],
        components: buildSetupPanelComponents(state),
      });
    } catch {}
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
  if (state?.panelMessageId) {
    await editStoredSetupPanel(client, state);
  } else if (state?.panelInteraction) {
    try {
      await state.panelInteraction.editReply({
        embeds: [buildSetupPanelEmbed(state)],
        components: buildSetupPanelComponents(state),
      });
    } catch {}
  }
}


// ════════════════════════════════════════════════════════════════════════════
// NEW =ann MULTI-EMBED BUILDER
// ════════════════════════════════════════════════════════════════════════════

interface AnnBuilderSlot {
  color: string;         // 6-char hex, no #  (e.g. "FFE500")
  title: string;         // optional embed title
  description: string;   // body — markdown, [tags], ;emojis all supported
  imageUrl: string;      // big bottom image URL
  thumbnailUrl: string;  // small top-right image URL
}

interface AnnBuilderState {
  userId: string;
  guildId: string;
  channelId: string;
  panelChannelId: string;
  panelMessageId?: string;
  slots: AnnBuilderSlot[];
  tagOn: boolean;
  editMessageId?: string;   // set when =ann <messageId> is used
  lastActivity: number;
  timeoutHandle?: NodeJS.Timeout;
}

const annBuilderState = new Map<string, AnnBuilderState>();

function touchBuilderState(s: AnnBuilderState): void {
  s.lastActivity = Date.now();
  if (s.timeoutHandle) clearTimeout(s.timeoutHandle);
  s.timeoutHandle = setTimeout(() => annBuilderState.delete(s.userId), 30 * 60 * 1000);
}

function normalizeAnnHeadings(text: string): string {
  return text.split("\n").map((line) => {
    const m = line.match(/^(\s*)(#{1,3})(?!\s|#)(\S.*)$/);
    return m ? `${m[1]}${m[2]} ${m[3]}` : line;
  }).join("\n");
}

function buildBuilderPanelEmbed(state: AnnBuilderState): EmbedBuilder {
  const lines = state.slots.length
    ? state.slots.map((s, i) => {
        const col = `#${s.color}`;
        const ti  = s.title ? ` — "${s.title.slice(0, 25)}${s.title.length > 25 ? "\u2026" : ""}"` : "";
        const di  = (s.description || "*(empty)*").replace(/\n/g, " ").slice(0, 55);
        const im  = [s.imageUrl ? "\uD83D\uDDBC\uFE0F" : "", s.thumbnailUrl ? "\uD83D\uDD33" : ""].filter(Boolean).join(" ");
        return `**${i + 1}.** \`${col}\`${ti}\n\u2570 ${di}${im ? "  " + im : ""}`;
      }).join("\n\n")
    : "*No embeds yet — click Add Embed to start.*";

  return new EmbedBuilder()
    .setColor(0x5000ff)
    .setTitle("\uD83D\uDCE3 Announcement Builder")
    .setDescription(
      (state.editMessageId
        ? `\u270F\uFE0F Editing message \`${state.editMessageId}\`\n`
        : "\uD83D\uDCE8 New announcement\n") +
      `Tag @everyone: ${state.tagOn ? "\uD83D\uDFE2 ON" : "\uD83D\uDD34 OFF"}\n\n` +
      lines,
    )
    .setFooter({ text: "Night Stars \u2022 Announcements" });
}

function buildBuilderPanelComponents(state: AnnBuilderState): ActionRowBuilder<ButtonBuilder>[] {
  const uid      = state.userId;
  const hasSlots = state.slots.length > 0;
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`anb_add:${uid}`).setLabel("\u2795 Add Embed").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`anb_edit:${uid}`).setLabel("\u270F\uFE0F Edit Embed").setStyle(ButtonStyle.Secondary).setDisabled(!hasSlots),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`anb_tag:${uid}`)
        .setLabel(state.tagOn ? "\uD83D\uDFE2 Tag: ON" : "\uD83D\uDD34 Tag: OFF")
        .setStyle(state.tagOn ? ButtonStyle.Success : ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`anb_preview:${uid}`).setLabel("\uD83D\uDC41\uFE0F Preview").setStyle(ButtonStyle.Secondary).setDisabled(!hasSlots),
      new ButtonBuilder()
        .setCustomId(`anb_send:${uid}`)
        .setLabel(state.editMessageId ? "\u270F\uFE0F Update Message" : "\u2705 Send")
        .setStyle(ButtonStyle.Success)
        .setDisabled(!hasSlots),
      new ButtonBuilder().setCustomId(`anb_cancel:${uid}`).setLabel("\u2716 Cancel").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function buildSlotPickerComponents(
  uid: string,
  slots: AnnBuilderSlot[],
  action: "edit" | "del",
): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  let cur = new ActionRowBuilder<ButtonBuilder>();
  for (let i = 0; i < slots.length; i++) {
    if (i > 0 && i % 5 === 0) {
      rows.push(cur);
      cur = new ActionRowBuilder<ButtonBuilder>();
      if (rows.length >= 4) break;
    }
    const s     = slots[i];
    const label = (s.title || s.description || `Embed ${i + 1}`).replace(/\n/g, " ").slice(0, 28);
    cur.addComponents(
      new ButtonBuilder()
        .setCustomId(`anb_${action}_pick:${uid}:${i}`)
        .setLabel(`${i + 1}. ${label}`)
        .setStyle(action === "del" ? ButtonStyle.Danger : ButtonStyle.Primary),
    );
  }
  if (cur.components.length) rows.push(cur);
  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`anb_back:${uid}`).setLabel("\u2190 Back").setStyle(ButtonStyle.Secondary),
    ),
  );
  return rows;
}

function buildEmbedModal(
  uid: string,
  slotIdx: number | null,
  prefill?: Partial<AnnBuilderSlot>,
): ModalBuilder {
  const isNew = slotIdx === null;
  const modal = new ModalBuilder()
    .setCustomId(isNew ? `anb_add_modal:${uid}` : `anb_edit_modal:${uid}:${slotIdx}`)
    .setTitle(isNew ? "Add Embed" : `Edit Embed ${(slotIdx ?? 0) + 1}`);
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("color")
        .setLabel("Color HEX (e.g. FFE500)")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(7)
        .setValue(prefill?.color ?? "5000FF"),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("title")
        .setLabel("Title (optional)")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(256)
        .setValue(prefill?.title ?? ""),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("description")
        .setLabel("Description (tags, emojis, markdown)")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(4000)
        .setValue(prefill?.description ?? ""),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("image")
        .setLabel("Big image URL (bottom) \u2014 optional")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(500)
        .setValue(prefill?.imageUrl ?? ""),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("thumb")
        .setLabel("Small image URL (top-right) \u2014 optional")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(500)
        .setValue(prefill?.thumbnailUrl ?? ""),
    ),
  );
  return modal;
}

function parseSlotFromModal(interaction: ModalSubmitInteraction): AnnBuilderSlot {
  const rawColor = interaction.fields.getTextInputValue("color").trim().replace(/^#/, "").toUpperCase();
  const color    = /^[0-9A-F]{6}$/.test(rawColor) ? rawColor : "5000FF";
  return {
    color,
    title:       interaction.fields.getTextInputValue("title").trim(),
    description: interaction.fields.getTextInputValue("description").trim(),
    imageUrl:    interaction.fields.getTextInputValue("image").trim(),
    thumbnailUrl: interaction.fields.getTextInputValue("thumb").trim(),
  };
}

async function refreshBuilderPanel(client: Client, state: AnnBuilderState): Promise<void> {
  if (!state.panelMessageId) return;
  try {
    const ch  = await client.channels.fetch(state.panelChannelId).catch(() => null) as TextChannel | null;
    const msg = await ch?.messages.fetch(state.panelMessageId).catch(() => null);
    await msg?.edit({
      embeds:     [buildBuilderPanelEmbed(state)],
      components: buildBuilderPanelComponents(state),
    });
  } catch {}
}

// Search every text channel in the guild for a message by ID.
// Returns [channel, message] if found, null otherwise.
async function findMessageInGuild(
  guild: Guild,
  messageId: string,
): Promise<[TextChannel, Message] | null> {
  const channels = guild.channels.cache.filter(
    (c) => c.isTextBased() && !c.isDMBased(),
  );
  for (const [, ch] of channels) {
    try {
      const msg = await (ch as TextChannel).messages.fetch(messageId).catch(() => null);
      if (msg) return [ch as TextChannel, msg];
    } catch {}
  }
  return null;
}

export async function openAnnBuilderInChannel(message: Message, editMessageId?: string): Promise<void> {
  const auth = await isAuthorized(message);
  if (!auth.authorized) {
    await tempReply(message, "\u274C You don\u2019t have permission to post announcements.");
    return;
  }
  if (auth.eventHosterOnly) {
    await tempReply(message, "\u274C You can only post events. Use `=event` instead.");
    return;
  }

  // When editing: find the target message across all channels first,
  // then use its channel as the announcement channel (bypasses the
  // allowed-channels restriction that applies only to new posts).
  let targetChannelId = message.channelId;

  if (editMessageId) {
    const found = await findMessageInGuild(message.guild!, editMessageId);
    if (!found) {
      await tempReply(message, "\u274C Could not find that message in this server. Make sure the ID is correct.");
      return;
    }
    const [targetCh] = found;
    targetChannelId = targetCh.id;

    const state: AnnBuilderState = {
      userId:         message.author.id,
      guildId:        message.guild!.id,
      channelId:      targetChannelId,
      panelChannelId: message.channelId,
      slots:          [],
      tagOn:          false,   // no @everyone when editing
      editMessageId,
      lastActivity:   Date.now(),
    };

    // Pre-load all embeds from the found message
    const [, existingMsg] = found;
    if (existingMsg.embeds.length) {
      for (const em of existingMsg.embeds) {
        state.slots.push({
          color:        em.color != null ? em.color.toString(16).toUpperCase().padStart(6, "0") : "5000FF",
          title:        em.title ?? "",
          description:  em.description ?? "",
          imageUrl:     em.image?.url ?? "",
          thumbnailUrl: em.thumbnail?.url ?? "",
        });
      }
    }

    await message.delete().catch(() => {});
    annBuilderState.set(state.userId, state);

    const panel = await (message.channel as TextChannel).send({
      embeds:     [buildBuilderPanelEmbed(state)],
      components: buildBuilderPanelComponents(state),
    });
    state.panelMessageId = panel.id;
    touchBuilderState(state);
    return;
  }

  // New announcement — enforce allowed channels
  const allowed = await getAllowedChannels(message.guild!.id);
  if (allowed.length && !allowed.includes(message.channelId)) {
    await tempReply(message, `\u274C Announcements can only be posted from: ${allowed.map((id) => `<#${id}>`).join(", ")}`);
    return;
  }

  const state: AnnBuilderState = {
    userId:         message.author.id,
    guildId:        message.guild!.id,
    channelId:      message.channelId,
    panelChannelId: message.channelId,
    slots:          [],
    tagOn:          true,
    editMessageId:  undefined,
    lastActivity:   Date.now(),
  };

  await message.delete().catch(() => {});
  annBuilderState.set(state.userId, state);

  const panel = await (message.channel as TextChannel).send({
    embeds:     [buildBuilderPanelEmbed(state)],
    components: buildBuilderPanelComponents(state),
  });
  state.panelMessageId = panel.id;
  touchBuilderState(state);
}

async function handleAnnBuilderInteraction(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  client: Client,
): Promise<void> {
  const cid    = interaction.customId;
  const parts  = cid.split(":");
  const action = parts[0];
  const uid    = parts[1];
  const state  = annBuilderState.get(uid);

  if (!state && action !== "anb_cancel") {
    if (interaction.isButton()) {
      await interaction.reply({ content: "\u274C Session expired. Run `=ann` again.", ephemeral: true }).catch(() => {});
    }
    return;
  }
  if (state) touchBuilderState(state);

  // ── Add Embed → show modal ────────────────────────────────────────────────
  if (action === "anb_add" && interaction.isButton()) {
    await interaction.showModal(buildEmbedModal(uid, null));
    return;
  }

  // ── Add modal submit ──────────────────────────────────────────────────────
  if (action === "anb_add_modal" && interaction.isModalSubmit()) {
    state!.slots.push(parseSlotFromModal(interaction as ModalSubmitInteraction));
    await (interaction as ModalSubmitInteraction).deferUpdate().catch(() => {});
    await refreshBuilderPanel(client, state!);
    return;
  }

  // ── Edit Embed ────────────────────────────────────────────────────────────
  if (action === "anb_edit" && interaction.isButton()) {
    if (state!.slots.length === 1) {
      await interaction.showModal(buildEmbedModal(uid, 0, state!.slots[0]));
    } else {
      await interaction.update({
        embeds:     [new EmbedBuilder().setColor(0x5000ff).setTitle("\u270F\uFE0F Pick an embed to edit").setFooter({ text: "Night Stars \u2022 Announcements" })],
        components: buildSlotPickerComponents(uid, state!.slots, "edit"),
      });
    }
    return;
  }

  // ── Edit pick → modal pre-filled ─────────────────────────────────────────
  if (action === "anb_edit_pick" && interaction.isButton()) {
    const idx = parseInt(parts[2], 10);
    await interaction.showModal(buildEmbedModal(uid, idx, state!.slots[idx]));
    return;
  }

  // ── Edit modal submit ─────────────────────────────────────────────────────
  if (action === "anb_edit_modal" && interaction.isModalSubmit()) {
    const idx = parseInt(parts[2], 10);
    state!.slots[idx] = parseSlotFromModal(interaction as ModalSubmitInteraction);
    await (interaction as ModalSubmitInteraction).deferUpdate().catch(() => {});
    await refreshBuilderPanel(client, state!);
    return;
  }

  // ── Delete Embed ──────────────────────────────────────────────────────────
  if (action === "anb_del" && interaction.isButton()) {
    if (state!.slots.length === 1) {
      state!.slots.splice(0, 1);
      await interaction.update({ embeds: [buildBuilderPanelEmbed(state!)], components: buildBuilderPanelComponents(state!) });
    } else {
      await interaction.update({
        embeds:     [new EmbedBuilder().setColor(0xff4d4d).setTitle("\uD83D\uDDD1\uFE0F Pick an embed to delete").setFooter({ text: "Night Stars \u2022 Announcements" })],
        components: buildSlotPickerComponents(uid, state!.slots, "del"),
      });
    }
    return;
  }

  // ── Delete pick ───────────────────────────────────────────────────────────
  if (action === "anb_del_pick" && interaction.isButton()) {
    const idx = parseInt(parts[2], 10);
    state!.slots.splice(idx, 1);
    await interaction.update({ embeds: [buildBuilderPanelEmbed(state!)], components: buildBuilderPanelComponents(state!) });
    return;
  }

  // ── Back to main panel ────────────────────────────────────────────────────
  if (action === "anb_back" && interaction.isButton()) {
    await interaction.update({ embeds: [buildBuilderPanelEmbed(state!)], components: buildBuilderPanelComponents(state!) });
    return;
  }

  // ── Toggle Tag ────────────────────────────────────────────────────────────
  if (action === "anb_tag" && interaction.isButton()) {
    state!.tagOn = !state!.tagOn;
    await interaction.update({ embeds: [buildBuilderPanelEmbed(state!)], components: buildBuilderPanelComponents(state!) });
    return;
  }

  // ── Preview (ephemeral) ───────────────────────────────────────────────────
  if (action === "anb_preview" && interaction.isButton()) {
    const guild = client.guilds.cache.get(state!.guildId);
    if (!guild) { await interaction.reply({ content: "\u274C Guild not found.", ephemeral: true }); return; }
    const resolved = await Promise.all(
      state!.slots.map(async (s) => ({
        ...s,
        title:       s.title       ? await resolveEmojiCodes(await resolveTags(s.title, guild), guild)       : "",
        description: s.description ? await resolveEmojiCodes(await resolveTags(s.description, guild), guild) : "",
      })),
    );
    const embeds = resolved.map((s) => {
      const color = parseInt(s.color, 16) || 0x5000ff;
      const e = new EmbedBuilder().setColor(color);
      if (s.title)       e.setTitle(s.title);
      if (s.description) e.setDescription(normalizeAnnHeadings(s.description));
      if (s.imageUrl && isValidUrl(s.imageUrl))       e.setImage(s.imageUrl);
      if (s.thumbnailUrl && isValidUrl(s.thumbnailUrl)) e.setThumbnail(s.thumbnailUrl);
      return e;
    });
    await interaction.reply({ embeds: embeds.slice(0, 10), ephemeral: true });
    return;
  }

  // ── Send / Update ─────────────────────────────────────────────────────────
  if (action === "anb_send" && interaction.isButton()) {
    if (!state!.slots.length) {
      await interaction.reply({ content: "\u274C Add at least one embed first.", ephemeral: true });
      return;
    }
    annBuilderState.delete(uid);
    if (state!.timeoutHandle) clearTimeout(state!.timeoutHandle);
    await interaction.deferUpdate().catch(() => {});
    if ((interaction as ButtonInteraction).message?.deletable) {
      await (interaction as ButtonInteraction).message.delete().catch(() => {});
    }

    const guild = client.guilds.cache.get(state!.guildId);
    if (!guild) return;

    const resolved = await Promise.all(
      state!.slots.map(async (s) => ({
        ...s,
        title:       s.title       ? await resolveEmojiCodes(await resolveTags(s.title, guild), guild)       : "",
        description: s.description ? await resolveEmojiCodes(await resolveTags(s.description, guild), guild) : "",
      })),
    );
    const embeds = resolved.map((s) => {
      const color = parseInt(s.color, 16) || 0x5000ff;
      const e = new EmbedBuilder().setColor(color);
      if (s.title)       e.setTitle(s.title);
      if (s.description) e.setDescription(normalizeAnnHeadings(s.description));
      if (s.imageUrl && isValidUrl(s.imageUrl))       e.setImage(s.imageUrl);
      if (s.thumbnailUrl && isValidUrl(s.thumbnailUrl)) e.setThumbnail(s.thumbnailUrl);
      return e;
    });

    const allText = resolved.map((s) => `${s.title}\n${s.description}`).join("\n");
    const voiceRows = buildVoiceChannelButtons(allText, guild);

    const ch = await guild.channels.fetch(state!.channelId).catch(() => null) as TextChannel | null;
    if (!ch) return;

    if (state!.editMessageId) {
      // Edit existing posted message
      const existing = await ch.messages.fetch(state!.editMessageId).catch(() => null);
      if (existing) {
        await existing.edit({
          embeds: embeds.slice(0, 10),
          components: voiceRows.length ? voiceRows : [],
          allowedMentions: { parse: [] },
        });
      }
    } else {
      // New announcement
      if (state!.tagOn) {
        const ping = await ch.send({ content: "@everyone", allowedMentions: { parse: ["everyone"] } });
        setTimeout(() => ping.delete().catch(() => {}), 5000);
      }
      await ch.send({
        embeds: embeds.slice(0, 10),
        ...(voiceRows.length ? { components: voiceRows } : {}),
        allowedMentions: { parse: [] },
      });
    }

    // Log
    const [cfg] = await db
      .select({ annLogsChannelId: botConfigTable.annLogsChannelId })
      .from(botConfigTable)
      .where(eq(botConfigTable.guildId, state!.guildId))
      .limit(1);
    if (cfg?.annLogsChannelId) {
      const logCh = await guild.channels.fetch(cfg.annLogsChannelId).catch(() => null) as TextChannel | null;
      if (logCh) {
        await logCh.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0x5000ff)
              .setTitle(state!.editMessageId ? "\u270F\uFE0F Announcement Updated" : "\uD83D\uDCE3 Announcement Posted")
              .addFields(
                { name: "Posted by", value: `<@${uid}>`, inline: true },
                { name: "Channel",   value: `<#${state!.channelId}>`, inline: true },
                { name: "Embeds",    value: String(embeds.length), inline: true },
              )
              .setTimestamp()
              .setFooter({ text: "Night Stars \u2022 Announcements" }),
          ],
        }).catch(() => {});
      }
    }
    return;
  }

  // ── Cancel ────────────────────────────────────────────────────────────────
  if (action === "anb_cancel" && interaction.isButton()) {
    if (state) {
      annBuilderState.delete(uid);
      if (state.timeoutHandle) clearTimeout(state.timeoutHandle);
    }
    await interaction.update({
      embeds:     [new EmbedBuilder().setColor(0x9aa0a6).setDescription("Announcement cancelled.")],
      components: [],
    }).catch(() => {});
    setTimeout(() => (interaction as ButtonInteraction).message?.delete().catch(() => {}), 4000);
    return;
  }
}


// ════════════════════════════════════════════════════════════════════════════
// =post  GENERAL POST BUILDER (Moon Night style)
// ════════════════════════════════════════════════════════════════════════════

const POST_COLOR = 0x4752C4;
const POST_DEFAULT_FOOTER = "\u00A9 2026 Night Stars. All rights reserved.";
const POST_EMOJI_CHANNEL = "<a:channelutility:1499052204038819962>";
const POST_EMOJI_ARROW   = "<:arrowblancasincentro:1499052207419428875>";

interface PostEntry {
  channelRef: string;  // "<#id>"
  description: string;
}

interface PostBuilderState {
  userId: string;
  guildId: string;
  channelId: string;
  panelChannelId: string;
  panelMessageId?: string;
  title: string;
  imageUrl: string;
  entries: PostEntry[];
  footer: string;
  color: number;
  editMessageId?: string;
  awaitingImage?: boolean;
  lastActivity: number;
  timeoutHandle?: NodeJS.Timeout;
}

function parseHexColor(raw: string): number | null {
  const cleaned = raw.trim().replace(/^#/, "").replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return null;
  return parseInt(cleaned, 16);
}

function colorToHex(n: number): string {
  return "#" + n.toString(16).padStart(6, "0").toUpperCase();
}

const postBuilderState = new Map<string, PostBuilderState>();

function touchPostState(s: PostBuilderState): void {
  s.lastActivity = Date.now();
  if (s.timeoutHandle) clearTimeout(s.timeoutHandle);
  s.timeoutHandle = setTimeout(() => postBuilderState.delete(s.userId), 30 * 60 * 1000);
}

function normaliseChannelRef(raw: string): string {
  const bare = raw.trim().replace(/^<#(\d+)>$/, "$1").replace(/\D/g, "");
  return bare ? `<#${bare}>` : raw.trim();
}

// Try to parse a Components V2 (ContainerBuilder) post back into builder state.
function parseV2Post(msg: Message): {
  title: string; imageUrl: string; footer: string; entries: PostEntry[]; color: number;
} | null {
  const top = (msg.components ?? []) as unknown as Array<Record<string, unknown>>;
  const containerRaw = top.find((c) => {
    const t = (c as { type?: number; data?: { type?: number } }).type
      ?? (c as { data?: { type?: number } }).data?.type;
    return t === 17;
  });
  if (!containerRaw) return null;

  const c = containerRaw as {
    components?: unknown[];
    accent_color?: number;
    accentColor?: number;
    data?: { components?: unknown[]; accent_color?: number };
  };
  const items = (c.components ?? c.data?.components ?? []) as Array<Record<string, unknown>>;
  if (!items.length) return null;

  let title = "";
  let imageUrl = "";
  let footer = "";
  const entries: PostEntry[] = [];
  const color = c.accentColor ?? c.accent_color ?? c.data?.accent_color ?? POST_COLOR;

  for (const it of items) {
    const t = (it.type as number | undefined)
      ?? ((it as { data?: { type?: number } }).data?.type);
    if (t === 10) {
      const content = (it.content as string | undefined)
        ?? ((it as { data?: { content?: string } }).data?.content)
        ?? "";
      const titleM  = content.match(/^#\s*__(.+?)__\s*$/m);
      const footerM = content.match(/^-#\s*`(.+?)`\s*$/m);
      // Match either the new emoji style or the old plain-symbol style.
      const entryM  =
        content.match(/<a?:[a-zA-Z0-9_]+:\d+>\s*\*\*\u21DD\s*<#(\d{17,20})>\*\*\s*\n<a?:[a-zA-Z0-9_]+:\d+>\s*`(.+?)`\s*$/) ||
        content.match(/^\u250A\u2192\s*<#(\d{17,20})>\s*\n\u21B3\s*`(.+?)`\s*$/);
      if (entryM) {
        entries.push({ channelRef: `<#${entryM[1]}>`, description: entryM[2] });
      } else if (titleM && !title) {
        title = titleM[1].trim();
      } else if (footerM && entries.length > 0) {
        footer = footerM[1].trim();
      }
    } else if (t === 12) {
      const gallery = it as {
        items?: Array<{ media?: { url?: string; proxy_url?: string } }>;
        data?: { items?: Array<{ media?: { url?: string; proxy_url?: string } }> };
      };
      const mediaItems = gallery.items ?? gallery.data?.items ?? [];
      const first = mediaItems[0];
      if (first?.media?.url && !imageUrl) imageUrl = first.media.url;
      else if (first?.media?.proxy_url && !imageUrl) imageUrl = first.media.proxy_url;
    }
  }

  if (!entries.length && !title) return null;
  return { title, imageUrl, footer, entries, color };
}

// Parse an existing post back into builder state.
// Tries Components V2 first, then falls back to the old multi-embed format.
function parseExistingPost(msg: Message): {
  title: string; imageUrl: string; footer: string; entries: PostEntry[]; color: number;
} {
  const v2 = parseV2Post(msg);
  if (v2) return v2;

  let title = "";
  let imageUrl = "";
  let footer = "";
  let color = POST_COLOR;
  const entries: PostEntry[] = [];

  const e1 = msg.embeds[0];
  if (e1) {
    const desc = e1.description || "";
    const m = desc.match(/^#\s*__(.+?)__\s*$/m);
    if (m) title = m[1].trim();
    else if (e1.title) title = e1.title;
    if (e1.image?.url) imageUrl = e1.image.url;
    if (typeof e1.color === "number") color = e1.color;
  }

  // Look at remaining embeds for entries + footer
  for (let i = 1; i < msg.embeds.length; i++) {
    const e = msg.embeds[i];
    if (e.footer?.text && !footer) footer = e.footer.text;
    const d = e.description || "";
    const re = /<#(\d{17,20})>\s*\n[\u21B3\u2570]\s*`?([^`\n]+?)`?\s*(?:\n|$)/g;
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(d)) !== null) {
      entries.push({ channelRef: `<#${mm[1]}>`, description: mm[2].trim() });
    }
  }

  return { title, imageUrl, footer, entries, color };
}

// Build the Components V2 container for a post.
function buildPostContainer(opts: {
  title: string;
  bannerName?: string;
  bannerUrl?: string;
  entries: PostEntry[];
  footer: string;
  color?: number;
  skipTitleDivider?: boolean;
}): ContainerBuilder {
  const c = new ContainerBuilder().setAccentColor(opts.color ?? POST_COLOR);

  // Title
  c.addTextDisplayComponents((td) => td.setContent(`# __${opts.title}__`));
  if (!opts.skipTitleDivider) {
    c.addSeparatorComponents((s) =>
      s.setDivider(true).setSpacing(SeparatorSpacingSize.Small),
    );
  }

  // Optional banner
  const mediaUrl = opts.bannerName ? `attachment://${opts.bannerName}` : opts.bannerUrl;
  if (mediaUrl) {
    c.addMediaGalleryComponents((mg) =>
      mg.addItems(new MediaGalleryItemBuilder().setURL(mediaUrl)),
    );
    c.addSeparatorComponents((s) =>
      s.setDivider(true).setSpacing(SeparatorSpacingSize.Small),
    );
  }

  // Entries (with a divider after each)
  for (const e of opts.entries) {
    const safeDesc = e.description.replace(/`/g, "\u02BC");
    c.addTextDisplayComponents((td) =>
      td.setContent(
        `${POST_EMOJI_CHANNEL} **\u21DD ${e.channelRef}**\n${POST_EMOJI_ARROW} \`${safeDesc}\``,
      ),
    );
    c.addSeparatorComponents((s) =>
      s.setDivider(true).setSpacing(SeparatorSpacingSize.Small),
    );
  }

  // Footer (small subtext) — only when set; empty footer shows nothing.
  if (opts.footer && opts.footer.trim().length > 0) {
    c.addTextDisplayComponents((td) => td.setContent(`-# \`${opts.footer}\``));
  }

  return c;
}

function buildPostPanelEmbed(state: PostBuilderState): EmbedBuilder {
  const titleLine  = state.title    ? `"${state.title.slice(0, 50)}${state.title.length > 50 ? "\u2026" : ""}"` : "*not set*";
  const imageLine  = state.imageUrl ? "\u2705 Set" : "*not set*";
  const footerLine = state.footer   ? `"${state.footer.slice(0, 60)}${state.footer.length > 60 ? "\u2026" : ""}"` : "*none (empty)*";
  const colorLine  = `\`${colorToHex(state.color)}\``;
  const entryLines = state.entries.length
    ? state.entries.map((e, i) => `**${i + 1}.** ${e.channelRef}\n\u2570 ${e.description.slice(0, 60)}`).join("\n\n")
    : "*No entries yet \u2014 use Add Entry or Bulk Add.*";

  return new EmbedBuilder()
    .setColor(state.color)
    .setTitle("\u2728 Post Builder")
    .setDescription(
      (state.editMessageId
        ? `\u270F\uFE0F Editing \`${state.editMessageId}\`\n`
        : "\uD83D\uDCE8 New post\n") +
      `**Title:** ${titleLine}\n**Image:** ${imageLine}\n**Color:** ${colorLine}\n**Footer:** ${footerLine}\n\n${entryLines}` +
      (state.awaitingImage ? "\n\n\u23F3 *Waiting for image upload \u2014 send an image in this channel.*" : ""),
    )
    .setFooter({ text: "Post Builder \u2022 Tip: use Templates to save & reuse posts" });
}

function buildPostPanelComponents(state: PostBuilderState): ActionRowBuilder<ButtonBuilder>[] {
  const uid      = state.userId;
  const hasEntries = state.entries.length > 0;
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`post_header:${uid}`).setLabel("\uD83D\uDCDD Title & Image URL").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`post_upload:${uid}`).setLabel("\uD83D\uDCF7 Upload Image").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`post_color:${uid}`).setLabel("\uD83C\uDFA8 Color").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`post_footer:${uid}`).setLabel("\uD83D\uDCCB Footer").setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`post_add:${uid}`).setLabel("\u2795 Add Entry").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`post_bulk:${uid}`).setLabel("\uD83D\uDCDC Bulk Add").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`post_edit:${uid}`).setLabel("\u270F\uFE0F Edit Entry").setStyle(ButtonStyle.Secondary).setDisabled(!hasEntries),
      new ButtonBuilder().setCustomId(`post_delete:${uid}`).setLabel("\uD83D\uDDD1 Remove Entry").setStyle(ButtonStyle.Secondary).setDisabled(!hasEntries),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`post_save:${uid}`).setLabel("\uD83D\uDCBE Save Template").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`post_load:${uid}`).setLabel("\uD83D\uDCC2 Load Template").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`post_deltpl:${uid}`).setLabel("\uD83D\uDDD1 Delete Template").setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`post_send:${uid}`).setLabel(state.editMessageId ? "\u270F\uFE0F Update" : "\u2705 Post").setStyle(ButtonStyle.Success).setDisabled(!hasEntries),
      new ButtonBuilder().setCustomId(`post_cancel:${uid}`).setLabel("\u2716 Cancel").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function buildPostEntryPickerComponents(
  uid: string,
  entries: PostEntry[],
  action: "edit" | "delete",
): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  let cur = new ActionRowBuilder<ButtonBuilder>();
  for (let i = 0; i < entries.length; i++) {
    if (i > 0 && i % 5 === 0) {
      rows.push(cur);
      cur = new ActionRowBuilder<ButtonBuilder>();
      if (rows.length >= 4) break;
    }
    const label = (entries[i].description || entries[i].channelRef || `Entry ${i + 1}`).slice(0, 30);
    cur.addComponents(
      new ButtonBuilder()
        .setCustomId(`post_${action}_pick:${uid}:${i}`)
        .setLabel(`${i + 1}. ${label}`)
        .setStyle(action === "delete" ? ButtonStyle.Danger : ButtonStyle.Primary),
    );
  }
  if (cur.components.length) rows.push(cur);
  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`post_back:${uid}`).setLabel("\u2190 Back").setStyle(ButtonStyle.Secondary),
    ),
  );
  return rows;
}

async function refreshPostPanel(client: Client, state: PostBuilderState): Promise<void> {
  if (!state.panelMessageId) return;
  try {
    const ch  = await client.channels.fetch(state.panelChannelId).catch(() => null) as TextChannel | null;
    const msg = await ch?.messages.fetch(state.panelMessageId).catch(() => null);
    await msg?.edit({ embeds: [buildPostPanelEmbed(state)], components: buildPostPanelComponents(state) });
  } catch {}
}

export async function openPostBuilderInChannel(message: Message, editMessageId?: string): Promise<void> {
  const member = message.member;
  if (!member?.permissions.has(PermissionFlagsBits.Administrator)) {
    await tempReply(message, "\u274C You need Administrator permission to use `=post`.");
    return;
  }

  let targetChannelId = message.channelId;
  let prefill = { title: "", imageUrl: "", footer: "", entries: [] as PostEntry[], color: POST_COLOR };

  if (editMessageId) {
    const found = await findMessageInGuild(message.guild!, editMessageId);
    if (!found) {
      await tempReply(message, "\u274C Could not find that message in this server. Make sure the ID is correct.");
      return;
    }
    targetChannelId = found[0].id;
    if (found[1].author.id !== message.client.user!.id) {
      await tempReply(message, "\u274C I can only edit messages that I posted myself.");
      return;
    }
    prefill = parseExistingPost(found[1]);
  }

  const state: PostBuilderState = {
    userId:         message.author.id,
    guildId:        message.guild!.id,
    channelId:      targetChannelId,
    panelChannelId: message.channelId,
    title:          prefill.title,
    imageUrl:       prefill.imageUrl,
    entries:        prefill.entries,
    footer:         prefill.footer,
    color:          prefill.color,
    editMessageId,
    lastActivity:   Date.now(),
  };

  await message.delete().catch(() => {});
  postBuilderState.set(state.userId, state);

  const panel = await (message.channel as TextChannel).send({
    embeds:     [buildPostPanelEmbed(state)],
    components: buildPostPanelComponents(state),
  });
  state.panelMessageId = panel.id;
  touchPostState(state);
}

async function handlePostBuilderInteraction(
  interaction: ButtonInteraction | ModalSubmitInteraction | StringSelectMenuInteraction,
  client: Client,
): Promise<void> {
  const parts  = interaction.customId.split(":");
  const action = parts[0];
  const uid    = parts[1];
  const state  = postBuilderState.get(uid);

  if (!state && action !== "post_cancel") {
    if (interaction.isButton() || interaction.isStringSelectMenu()) {
      await interaction.reply({ content: "\u274C Session expired. Run `=post` again.", ephemeral: true }).catch(() => {});
    }
    return;
  }
  if (state) touchPostState(state);

  // ── Set Header (title + image URL) ────────────────────────────────────────
  if (action === "post_header" && interaction.isButton()) {
    const modal = new ModalBuilder()
      .setCustomId(`post_header_modal:${uid}`)
      .setTitle("Set Title & Image URL");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("title")
          .setLabel("Title (rendered as big underlined heading)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(200)
          .setValue(state!.title),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("image")
          .setLabel("Image URL (or use Upload Image button)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(500)
          .setValue(state!.imageUrl),
      ),
    );
    await interaction.showModal(modal);
    return;
  }

  if (action === "post_header_modal" && interaction.isModalSubmit()) {
    state!.title    = (interaction as ModalSubmitInteraction).fields.getTextInputValue("title").trim();
    state!.imageUrl = (interaction as ModalSubmitInteraction).fields.getTextInputValue("image").trim();
    await (interaction as ModalSubmitInteraction).deferUpdate().catch(() => {});
    await refreshPostPanel(client, state!);
    return;
  }

  // ── Upload Image (collect next message attachment) ───────────────────────
  if (action === "post_upload" && interaction.isButton()) {
    if (state!.awaitingImage) {
      await interaction.reply({ content: "\u23F3 Already waiting for an image \u2014 send one in this channel.", ephemeral: true }).catch(() => {});
      return;
    }
    state!.awaitingImage = true;
    await interaction.reply({
      content: "\uD83D\uDCF7 Send the image as an attachment in this channel within 60 seconds. Type `cancel` to abort.",
      ephemeral: true,
    }).catch(() => {});
    await refreshPostPanel(client, state!);

    const ch = await client.channels.fetch(state!.panelChannelId).catch(() => null) as TextChannel | null;
    if (!ch) {
      state!.awaitingImage = false;
      await refreshPostPanel(client, state!);
      return;
    }
    try {
      const collected = await ch.awaitMessages({
        filter: (m) => m.author.id === state!.userId,
        max: 1,
        time: 60_000,
        errors: ["time"],
      });
      const m = collected.first();
      if (!m) {
        state!.awaitingImage = false;
        await refreshPostPanel(client, state!);
        return;
      }
      if (m.content.trim().toLowerCase() === "cancel") {
        await m.delete().catch(() => {});
        state!.awaitingImage = false;
        await refreshPostPanel(client, state!);
        await interaction.followUp({ content: "Cancelled.", ephemeral: true }).catch(() => {});
        return;
      }
      const att = m.attachments.find(
        (a) => (a.contentType ?? "").startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(a.name ?? ""),
      );
      if (!att) {
        await m.delete().catch(() => {});
        state!.awaitingImage = false;
        await refreshPostPanel(client, state!);
        await interaction.followUp({ content: "\u274C No image attachment found. Try again.", ephemeral: true }).catch(() => {});
        return;
      }
      state!.imageUrl = att.url;
      await m.delete().catch(() => {});
      state!.awaitingImage = false;
      await refreshPostPanel(client, state!);
      await interaction.followUp({ content: "\u2705 Image set.", ephemeral: true }).catch(() => {});
    } catch {
      state!.awaitingImage = false;
      await refreshPostPanel(client, state!);
      await interaction.followUp({ content: "\u231B Image upload timed out.", ephemeral: true }).catch(() => {});
    }
    return;
  }

  // ── Set Footer ────────────────────────────────────────────────────────────
  if (action === "post_footer" && interaction.isButton()) {
    const modal = new ModalBuilder()
      .setCustomId(`post_footer_modal:${uid}`)
      .setTitle("Set Footer Text");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("footer")
          .setLabel("Footer text (leave empty for no footer)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(200)
          .setValue(state!.footer),
      ),
    );
    await interaction.showModal(modal);
    return;
  }

  if (action === "post_footer_modal" && interaction.isModalSubmit()) {
    state!.footer = (interaction as ModalSubmitInteraction).fields.getTextInputValue("footer").trim();
    await (interaction as ModalSubmitInteraction).deferUpdate().catch(() => {});
    await refreshPostPanel(client, state!);
    return;
  }

  // ── Add Entry ─────────────────────────────────────────────────────────────
  if (action === "post_add" && interaction.isButton()) {
    const modal = new ModalBuilder()
      .setCustomId(`post_add_modal:${uid}`)
      .setTitle("Add Channel Entry");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("chan")
          .setLabel("Channel ID (right-click channel \u2192 Copy ID)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(30),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("desc")
          .setLabel("Description (shown in code-block style)")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(300),
      ),
    );
    await interaction.showModal(modal);
    return;
  }

  if (action === "post_add_modal" && interaction.isModalSubmit()) {
    const rawChan = (interaction as ModalSubmitInteraction).fields.getTextInputValue("chan").trim();
    const desc    = (interaction as ModalSubmitInteraction).fields.getTextInputValue("desc").trim();
    state!.entries.push({ channelRef: normaliseChannelRef(rawChan), description: desc });
    await (interaction as ModalSubmitInteraction).deferUpdate().catch(() => {});
    await refreshPostPanel(client, state!);
    return;
  }

  // ── Edit Entry ────────────────────────────────────────────────────────────
  if (action === "post_edit" && interaction.isButton()) {
    if (state!.entries.length === 1) {
      await openPostEntryModal(interaction, uid, 0, state!.entries[0]);
    } else {
      await interaction.update({
        embeds:     [new EmbedBuilder().setColor(POST_COLOR).setTitle("\u270F\uFE0F Pick an entry to edit").setFooter({ text: "Night Stars \u2022 Post Builder" })],
        components: buildPostEntryPickerComponents(uid, state!.entries, "edit"),
      });
    }
    return;
  }

  if (action === "post_edit_pick" && interaction.isButton()) {
    const idx = parseInt(parts[2], 10);
    await openPostEntryModal(interaction, uid, idx, state!.entries[idx]);
    return;
  }

  if (action === "post_edit_modal" && interaction.isModalSubmit()) {
    const idx     = parseInt(parts[2], 10);
    const rawChan = (interaction as ModalSubmitInteraction).fields.getTextInputValue("chan").trim();
    const desc    = (interaction as ModalSubmitInteraction).fields.getTextInputValue("desc").trim();
    state!.entries[idx] = { channelRef: normaliseChannelRef(rawChan), description: desc };
    await (interaction as ModalSubmitInteraction).deferUpdate().catch(() => {});
    await refreshPostPanel(client, state!);
    return;
  }

  // ── Delete Entry ──────────────────────────────────────────────────────────
  if (action === "post_delete" && interaction.isButton()) {
    if (state!.entries.length === 1) {
      state!.entries.splice(0, 1);
      await (interaction as ButtonInteraction).deferUpdate().catch(() => {});
      await refreshPostPanel(client, state!);
    } else {
      await interaction.update({
        embeds:     [new EmbedBuilder().setColor(0xff4d4d).setTitle("\uD83D\uDDD1 Pick an entry to remove").setFooter({ text: "Night Stars \u2022 Post Builder" })],
        components: buildPostEntryPickerComponents(uid, state!.entries, "delete"),
      });
    }
    return;
  }

  if (action === "post_delete_pick" && interaction.isButton()) {
    const idx = parseInt(parts[2], 10);
    if (idx >= 0 && idx < state!.entries.length) state!.entries.splice(idx, 1);
    await interaction.update({ embeds: [buildPostPanelEmbed(state!)], components: buildPostPanelComponents(state!) });
    return;
  }

  // ── Back ──────────────────────────────────────────────────────────────────
  if (action === "post_back" && interaction.isButton()) {
    await interaction.update({ embeds: [buildPostPanelEmbed(state!)], components: buildPostPanelComponents(state!) });
    return;
  }

  // ── Color ─────────────────────────────────────────────────────────────────
  if (action === "post_color" && interaction.isButton()) {
    const modal = new ModalBuilder()
      .setCustomId(`post_color_modal:${uid}`)
      .setTitle("Set Accent Color");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("hex")
          .setLabel("Hex color (e.g. #2B2D31, F5A623)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(9)
          .setValue(colorToHex(state!.color)),
      ),
    );
    await interaction.showModal(modal);
    return;
  }

  if (action === "post_color_modal" && interaction.isModalSubmit()) {
    const raw = (interaction as ModalSubmitInteraction).fields.getTextInputValue("hex");
    const parsed = parseHexColor(raw);
    if (parsed === null) {
      await interaction.reply({ content: "\u274C Invalid hex color. Use a 6-digit hex like `#2B2D31`.", ephemeral: true }).catch(() => {});
      return;
    }
    state!.color = parsed;
    await (interaction as ModalSubmitInteraction).deferUpdate().catch(() => {});
    await refreshPostPanel(client, state!);
    return;
  }

  // ── Bulk Add ──────────────────────────────────────────────────────────────
  if (action === "post_bulk" && interaction.isButton()) {
    const modal = new ModalBuilder()
      .setCustomId(`post_bulk_modal:${uid}`)
      .setTitle("Bulk Add Entries");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("bulk")
          .setLabel("One per line: <channel-id> | <description>")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(4000)
          .setPlaceholder("123456789012345678 | Welcome channel\n234567890123456789 | Rules"),
      ),
    );
    await interaction.showModal(modal);
    return;
  }

  if (action === "post_bulk_modal" && interaction.isModalSubmit()) {
    const raw = (interaction as ModalSubmitInteraction).fields.getTextInputValue("bulk");
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    let added = 0;
    const skipped: string[] = [];
    for (const line of lines) {
      // Accept "<#id> | desc", "id | desc", "id desc", "id - desc", "id : desc"
      const m = line.match(/^(?:<#)?(\d{17,20})>?\s*[|\-:\u2013\u2014]?\s*(.+)$/);
      if (!m) { skipped.push(line); continue; }
      const id = m[1];
      const desc = m[2].trim();
      if (!desc) { skipped.push(line); continue; }
      state!.entries.push({ channelRef: `<#${id}>`, description: desc });
      added++;
    }
    await (interaction as ModalSubmitInteraction).deferUpdate().catch(() => {});
    await refreshPostPanel(client, state!);
    if (added > 0 || skipped.length > 0) {
      const msg = `\u2705 Added ${added} entr${added === 1 ? "y" : "ies"}.` +
        (skipped.length ? ` \u26A0\uFE0F Skipped ${skipped.length} unparseable line${skipped.length === 1 ? "" : "s"}.` : "");
      await (interaction as ModalSubmitInteraction).followUp({ content: msg, ephemeral: true }).catch(() => {});
    }
    return;
  }

  // ── Save Template ─────────────────────────────────────────────────────────
  if (action === "post_save" && interaction.isButton()) {
    const modal = new ModalBuilder()
      .setCustomId(`post_save_modal:${uid}`)
      .setTitle("Save Post Template");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("name")
          .setLabel("Template name (a-z, 0-9, _-, max 50)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(50)
          .setPlaceholder("e.g. server-map"),
      ),
    );
    await interaction.showModal(modal);
    return;
  }

  if (action === "post_save_modal" && interaction.isModalSubmit()) {
    const rawName = (interaction as ModalSubmitInteraction).fields.getTextInputValue("name").trim().toLowerCase();
    const name = rawName.replace(/[^a-z0-9_\-]/g, "-").slice(0, 50);
    if (!name) {
      await (interaction as ModalSubmitInteraction).reply({ content: "\u274C Invalid template name.", ephemeral: true }).catch(() => {});
      return;
    }
    try {
      const payload = {
        guildId: state!.guildId,
        name,
        title: state!.title,
        imageUrl: state!.imageUrl,
        footer: state!.footer,
        color: state!.color,
        entriesJson: JSON.stringify(state!.entries),
        updatedBy: state!.userId,
        updatedAt: new Date(),
      };
      await db.insert(postTemplatesTable).values(payload).onConflictDoUpdate({
        target: [postTemplatesTable.guildId, postTemplatesTable.name],
        set: {
          title: payload.title,
          imageUrl: payload.imageUrl,
          footer: payload.footer,
          color: payload.color,
          entriesJson: payload.entriesJson,
          updatedBy: payload.updatedBy,
          updatedAt: payload.updatedAt,
        },
      });
      await (interaction as ModalSubmitInteraction).reply({ content: `\u2705 Saved template \`${name}\`.`, ephemeral: true }).catch(() => {});
    } catch (err) {
      await (interaction as ModalSubmitInteraction).reply({ content: `\u274C Failed to save: ${(err as Error).message}`, ephemeral: true }).catch(() => {});
    }
    return;
  }

  // ── Load Template ─────────────────────────────────────────────────────────
  if (action === "post_load" && interaction.isButton()) {
    const rows = await db.select().from(postTemplatesTable)
      .where(eq(postTemplatesTable.guildId, state!.guildId));
    if (!rows.length) {
      await interaction.reply({ content: "\u2139\uFE0F No saved templates yet. Use \uD83D\uDCBE Save Template first.", ephemeral: true }).catch(() => {});
      return;
    }
    const opts = rows.slice(0, 25).map((r) => ({
      label: r.name.slice(0, 100),
      value: r.name.slice(0, 100),
      description: (r.title || "(untitled)").slice(0, 100),
    }));
    const select = new StringSelectMenuBuilder()
      .setCustomId(`post_load_select:${uid}`)
      .setPlaceholder("Pick a template to load")
      .addOptions(opts);
    await interaction.reply({
      content: "\uD83D\uDCC2 Load template:",
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
      ephemeral: true,
    }).catch(() => {});
    return;
  }

  if (action === "post_load_select" && interaction.isStringSelectMenu()) {
    const name = interaction.values[0];
    const rows = await db.select().from(postTemplatesTable).where(
      and(eq(postTemplatesTable.guildId, state!.guildId), eq(postTemplatesTable.name, name)),
    );
    const tpl = rows[0];
    if (!tpl) {
      await interaction.update({ content: "\u274C Template not found.", components: [] }).catch(() => {});
      return;
    }
    state!.title    = tpl.title    ?? "";
    state!.imageUrl = tpl.imageUrl ?? "";
    state!.footer   = tpl.footer   ?? "";
    state!.color    = tpl.color    ?? POST_COLOR;
    try {
      state!.entries = JSON.parse(tpl.entriesJson ?? "[]") as PostEntry[];
    } catch {
      state!.entries = [];
    }
    await interaction.update({ content: `\u2705 Loaded \`${name}\`.`, components: [] }).catch(() => {});
    await refreshPostPanel(client, state!);
    return;
  }

  // ── Delete Template ───────────────────────────────────────────────────────
  if (action === "post_deltpl" && interaction.isButton()) {
    const rows = await db.select().from(postTemplatesTable)
      .where(eq(postTemplatesTable.guildId, state!.guildId));
    if (!rows.length) {
      await interaction.reply({ content: "\u2139\uFE0F No saved templates to delete.", ephemeral: true }).catch(() => {});
      return;
    }
    const opts = rows.slice(0, 25).map((r) => ({
      label: r.name.slice(0, 100),
      value: r.name.slice(0, 100),
      description: (r.title || "(untitled)").slice(0, 100),
    }));
    const select = new StringSelectMenuBuilder()
      .setCustomId(`post_deltpl_select:${uid}`)
      .setPlaceholder("Pick a template to delete")
      .addOptions(opts);
    await interaction.reply({
      content: "\uD83D\uDDD1 Delete template:",
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
      ephemeral: true,
    }).catch(() => {});
    return;
  }

  if (action === "post_deltpl_select" && interaction.isStringSelectMenu()) {
    const name = interaction.values[0];
    await db.delete(postTemplatesTable).where(
      and(eq(postTemplatesTable.guildId, state!.guildId), eq(postTemplatesTable.name, name)),
    );
    await interaction.update({ content: `\u2705 Deleted template \`${name}\`.`, components: [] }).catch(() => {});
    return;
  }

  if (action === "post_send" && interaction.isButton()) {
    if (!state!.entries.length) {
      await interaction.reply({ content: "\u274C Add at least one channel entry first.", ephemeral: true });
      return;
    }
    await interaction.deferUpdate().catch(() => {});

    const ch = await client.channels.fetch(state!.channelId).catch(() => null) as TextChannel | null;
    if (!ch) {
      await interaction.followUp({ content: "\u274C Target channel not accessible.", ephemeral: true }).catch(() => {});
      return;
    }

    const titleText  = state!.title  || "\u2728\uD83C\uDF19 Night Stars";
    // Empty footer means: no footer at all (not the default).
    const footerText = state!.footer;

    // Re-attach the image so the post is self-contained (URL won't break later)
    let files: { attachment: Buffer; name: string }[] | undefined;
    let bannerName: string | undefined;
    let bannerFallbackUrl: string | undefined;
    if (state!.imageUrl && isValidUrl(state!.imageUrl)) {
      try {
        const resp = await fetch(state!.imageUrl);
        if (resp.ok) {
          const buf = Buffer.from(await resp.arrayBuffer());
          const ct  = (resp.headers.get("content-type") || "").toLowerCase();
          let ext = "png";
          if (ct.includes("jpeg") || ct.includes("jpg")) ext = "jpg";
          else if (ct.includes("gif"))  ext = "gif";
          else if (ct.includes("webp")) ext = "webp";
          bannerName = `image.${ext}`;
          files = [{ attachment: buf, name: bannerName }];
        } else {
          bannerFallbackUrl = state!.imageUrl;
        }
      } catch {
        bannerFallbackUrl = state!.imageUrl;
      }
    }

    // Components V2: ContainerBuilder with TextDisplay + Separator + MediaGallery
    // gives a tight, divider-line look (no inter-embed gaps).
    // Discord limit: max 40 components inside a Container.
    // Each entry = 2 components (TextDisplay + Separator). Header takes
    // up to 4 components (title + sep + media + sep), footer takes 1.
    // → safe cap at 17 entries.
    const MAX_ENTRIES = 17;
    const entriesUsed = state!.entries.slice(0, MAX_ENTRIES);
    const truncated   = state!.entries.length > MAX_ENTRIES;

    const container = buildPostContainer({
      title: titleText,
      bannerName,
      bannerUrl: bannerFallbackUrl,
      entries: entriesUsed,
      footer: footerText,
      color: state!.color,
    });

    // Cast to `any` because discord.js BaseMessageOptions.flags has a
     // restricted union type that doesn't include MessageFlags.IsComponentsV2,
     // even though the runtime accepts it.
     // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v2Payload: any = {
      flags: MessageFlags.IsComponentsV2,
      components: [container],
      files: files ?? [],
      allowedMentions: { parse: [] as never[] },
    };

    try {
      if (state!.editMessageId) {
        const existing = await ch.messages.fetch(state!.editMessageId).catch(() => null);
        if (existing) {
          try {
            await existing.edit({
              ...v2Payload,
              content: "",
              embeds: [],
              attachments: [],
            });
          } catch (editErr) {
            // Old (non-V2) message that won't accept the V2 flag on edit:
            // delete and resend so the user gets the new style.
            if (existing.author.id === client.user!.id) {
              await existing.delete().catch(() => {});
              const sent = await ch.send(v2Payload);
              await interaction.followUp({
                content: `\u2139\uFE0F Original message couldn\u2019t be edited so I reposted it. New message ID: \`${sent.id}\``,
                ephemeral: true,
              }).catch(() => {});
            } else {
              throw editErr;
            }
          }
        } else {
          await ch.send(v2Payload);
        }
      } else {
        await ch.send(v2Payload);
      }
      if (truncated) {
        await interaction.followUp({
          content: `\u26A0\uFE0F Only the first ${MAX_ENTRIES} entries were used (Discord component limit).`,
          ephemeral: true,
        }).catch(() => {});
      }
    } catch (err) {
      await interaction.followUp({
        content: `\u274C Failed to ${state!.editMessageId ? "update" : "send"}: ${(err as Error).message}`,
        ephemeral: true,
      }).catch(() => {});
      return;
    }

    postBuilderState.delete(uid);
    if (state!.timeoutHandle) clearTimeout(state!.timeoutHandle);
    if ((interaction as ButtonInteraction).message?.deletable) {
      await (interaction as ButtonInteraction).message.delete().catch(() => {});
    }
    await interaction.followUp({
      content: state!.editMessageId ? "\u2705 Post updated." : `\u2705 Posted in <#${state!.channelId}>.`,
      ephemeral: true,
    }).catch(() => {});
    return;
  }

  // ── Cancel ────────────────────────────────────────────────────────────────
  if (action === "post_cancel" && interaction.isButton()) {
    if (state) {
      postBuilderState.delete(uid);
      if (state.timeoutHandle) clearTimeout(state.timeoutHandle);
    }
    await interaction.update({
      embeds:     [new EmbedBuilder().setDescription("Post cancelled.")],
      components: [],
    }).catch(() => {});
    setTimeout(() => (interaction as ButtonInteraction).message?.delete().catch(() => {}), 4000);
    return;
  }
}

async function openPostEntryModal(
  interaction: ButtonInteraction,
  uid: string,
  idx: number,
  prefill?: PostEntry,
): Promise<void> {
  const modal = new ModalBuilder()
    .setCustomId(`post_edit_modal:${uid}:${idx}`)
    .setTitle(`Edit Entry ${idx + 1}`);
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("chan")
        .setLabel("Channel ID")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(30)
        .setValue(prefill?.channelRef.replace(/[<>#]/g, "") ?? ""),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("desc")
        .setLabel("Description")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(300)
        .setValue(prefill?.description ?? ""),
    ),
  );
  await interaction.showModal(modal);
}
