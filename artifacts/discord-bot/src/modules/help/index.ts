import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  Message,
  PermissionsBitField,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
} from "discord.js";
import { db, botConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const COLOR = 0x5000ff;
const FOOTER = "Night Stars \u2022 NS Bot";

type Command = { syntax: string; desc: string };
type Prefixes = { pvs: string; mgr: string; ctp: string; ann: string };
type CategoryDef = {
  key: string;
  label: string;
  emoji: string;
  buildCommands: (p: Prefixes) => Command[];
};

async function getPrefixes(guildId: string): Promise<Prefixes> {
  const rows = await db.select().from(botConfigTable).where(eq(botConfigTable.guildId, guildId)).limit(1);
  const r = rows[0];
  return {
    pvs: r?.pvsPrefix ?? "=",
    mgr: r?.managerPrefix ?? "+",
    ctp: r?.ctpPrefix ?? "-",
    ann: r?.annPrefix ?? "!",
  };
}

// ── MEMBER CATEGORIES ───────────────────────────────────────────────────────

const MEMBER_CATEGORIES: CategoryDef[] = [
  {
    key: "pvs",
    label: "Private Voice Commands",
    emoji: "\uD83C\uDFA7",
    buildCommands: (p) => [
      { syntax: `${p.pvs}key @user`, desc: "Give or remove a member's access to your room" },
      { syntax: `${p.pvs}pull @user`, desc: "Pull a member from the waiting room into your room" },
      { syntax: `${p.pvs}see keys`, desc: "List all members who have access to your room" },
      { syntax: `${p.pvs}clear keys`, desc: "Remove every key — your room becomes fully private" },
      { syntax: `${p.pvs}name <name>`, desc: "Rename your private voice room" },
      { syntax: `${p.pvs}tlock`, desc: "Lock the room's text chat for non-keyholders" },
      { syntax: `${p.pvs}tunlock`, desc: "Unlock the room's text chat" },
      { syntax: `${p.pvs}kick @user`, desc: "Disconnect someone from your voice room" },
    ],
  },
  {
    key: "ctp",
    label: "Call to Play Commands",
    emoji: "\uD83C\uDFAE",
    buildCommands: (p) => [
      { syntax: "tag [message]", desc: "CTP Category — ping your game role from inside the game's voice or text channel (message optional, max 20 chars)" },
      { syntax: "tag <gamename> [message]", desc: "CTP Onetap — ping a game role in a gaming chat or onetap voice (message optional, max 20 chars)" },
      { syntax: `${p.pvs}tag list`, desc: "Show all available CTP Onetap games with their cooldown status" },
      { syntax: "tagcd", desc: "Show the remaining tag cooldown for your current category or game" },
    ],
  },
  {
    key: "social",
    label: "Social Commands",
    emoji: "\uD83D\uDC95",
    buildCommands: (p) => [
      { syntax: `${p.pvs}relationship [@user]`, desc: "Show your or another member's relationship & partner status" },
      { syntax: `${p.pvs}propose @user`, desc: "Send a marriage proposal — target gets Accept/Reject buttons" },
      { syntax: `${p.pvs}breakup`, desc: "End your current relationship" },
      { syntax: `${p.pvs}children`, desc: "List your children (max 3)" },
      { syntax: `${p.pvs}adopt @user`, desc: "Send an adoption request — target accepts/rejects via buttons" },
    ],
  },
  {
    key: "music",
    label: "Music Commands",
    emoji: "\uD83C\uDFB5",
    buildCommands: () => [
      { syntax: "=playlist <link>", desc: "Post playlist in the playlist channel" },
      { syntax: "=artists", desc: "List all artists tracked for auto new-release notifications" },
    ],
  },
];

// ── STAFF CATEGORIES ────────────────────────────────────────────────────────

const STAFF_CATEGORIES: CategoryDef[] = [
  {
    key: "setup",
    label: "Setup Commands",
    emoji: "\u2699\uFE0F",
    buildCommands: () => [
      { syntax: "/pvs", desc: "Configure the Private Voice System" },
      { syntax: "/tag-category", desc: "Configure CTP Category — games with their own voice category" },
      { syntax: "/tag-onetap", desc: "Configure CTP Onetap — temp voice game tagging" },
      { syntax: "/jail", desc: "Configure the Jail system" },
      { syntax: "/ann", desc: "Configure Announcements" },
      { syntax: "/welcome", desc: "Configure the Welcome system" },
      { syntax: "/move", desc: "Set powerful (instant) and confirmation move roles" },
      { syntax: "/clear", desc: "Set roles allowed to use mse7 N" },
      { syntax: "/logs", desc: "Configure server event logging channels" },
      { syntax: "/general", desc: "Staff role, blocked channels, event hosters" },
      { syntax: "/role-giver", desc: "Open the Role Giver setup panel" },
      { syntax: "/prefix", desc: "View and change the bot prefix" },
    ],
  },
  {
    key: "tag",
    label: "Tag Commands",
    emoji: "🎮",
    buildCommands: (p) => [
      { syntax: "/tag-category", desc: "Configure CTP Category — games with their own voice category" },
      { syntax: "/tag-onetap", desc: "Configure CTP Onetap — temp voice game tagging" },
      { syntax: "tag [message]", desc: "Member: CTP Category ping from inside the game's voice or text channel (message optional, max 20 chars)" },
      { syntax: "tag <gamename> [message]", desc: "Member: CTP Onetap ping in a gaming chat or onetap voice (message optional, max 20 chars)" },
      { syntax: `${p.pvs}tag list`, desc: "Member: show all available CTP Onetap games with cooldown status" },
      { syntax: "tagcd", desc: "Member: show the remaining tag cooldown for the current category or game" },
    ],
  },
  {
    key: "jail",
    label: "Jail Commands",
    emoji: "\uD83D\uDD28",
    buildCommands: (p) => [
      { syntax: `${p.pvs}jail @user <reason>`, desc: "Apply the jail role to a member" },
      { syntax: `${p.pvs}unjail @user`, desc: "Remove jail and restore the Member role" },
      { syntax: `${p.pvs}case @user`, desc: "Show the active jail reason for a member" },
    ],
  },
  {
    key: "stagelock",
    label: "Stage Lock Commands",
    emoji: "\uD83C\uDFA4",
    buildCommands: (p) => [
      { syntax: `${p.pvs}stagelock`, desc: "Block the Member role from connecting to your channel" },
      { syntax: `${p.pvs}stageunlock`, desc: "Re-allow the Member role to connect" },
    ],
  },
  {
    key: "manager",
    label: "PVS Manager Commands",
    emoji: "\uD83D\uDD11",
    buildCommands: (p) => [
      { syntax: `${p.mgr}pv @user`, desc: "Create a permanent private voice room for a member" },
      { syntax: `${p.mgr}pv delete @user`, desc: "Remove a member's PVS room" },
    ],
  },
  {
    key: "music",
    label: "Music Commands",
    emoji: "\uD83C\uDFB5",
    buildCommands: () => [
      { syntax: "=album <link>", desc: "Post an album/single embed (DJ role required) — Deezer, Spotify, Apple Music, etc." },
      { syntax: "=playlist <link>", desc: "Post playlist required member role" },
      { syntax: "=artists", desc: "List all artists tracked for auto new-release notifications" },
      { syntax: "=add <artist name>", desc: "Add an artist to auto new-release tracking (DJ role required)" },
    ],
  },
  {
    key: "ann",
    label: "Announcement Commands",
    emoji: "\uD83D\uDCE2",
    buildCommands: () => [
      { syntax: "=an <message>", desc: "Post a quick inline announcement directly to the channel — supports [RoleName] tags and emoji codes" },
      { syntax: "=ann", desc: "Open the full announcement builder panel (title, description, image, tags, save/load template)" },
      { syntax: "=event", desc: "Open the event announcement builder panel (event hoster role required)" },
    ],
  },
  {
    key: "modtools",
    label: "Mod Tools",
    emoji: "\uD83D\uDEE0\uFE0F",
    buildCommands: () => [
      { syntax: "aji @user", desc: "Move a member into your current voice channel" },
      { syntax: "mse7 N", desc: "Clear the last N messages in this channel" },
    ],
  },
  {
    key: "rolegiver",
    label: "Role Giver Commands",
    emoji: "\uD83C\uDFAD",
    buildCommands: (p) => [
      { syntax: `${p.pvs}<rule-name> @user`, desc: "Toggle the role bound to that rule (configured via /role-giver setup)" },
    ],
  },
];

// ── EMBED + COMPONENT BUILDERS ──────────────────────────────────────────────

function buildMainEmbed(scope: "m" | "s"): EmbedBuilder {
  const title = scope === "m" ? "ns System members help" : "ns System staff help";
  const sub   = scope === "m" ? "Member Commands" : "Staff & Setup Commands";
  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(title)
    .setDescription(`Choose which category of help you want to check below.\n\n_${sub}_`)
    .setFooter({ text: FOOTER });
}

function buildSelectRow(scope: "m" | "s", cats: CategoryDef[], p: Prefixes): ActionRowBuilder<StringSelectMenuBuilder> {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`help_${scope}_select`)
    .setPlaceholder("Select a category !");
  for (const c of cats) {
    const count = c.buildCommands(p).length;
    menu.addOptions({
      label: c.label,
      value: c.key,
      description: `View ${count} command${count === 1 ? "" : "s"}`,
      emoji: c.emoji,
    });
  }
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

function buildMainComponents(scope: "m" | "s", cats: CategoryDef[], p: Prefixes, closeId: string) {
  return [
    buildSelectRow(scope, cats, p),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(closeId).setLabel("Close").setEmoji("\u2716\uFE0F").setStyle(ButtonStyle.Danger),
    ),
  ];
}

function buildCategoryEmbed(cat: CategoryDef, p: Prefixes): EmbedBuilder {
  const cmds = cat.buildCommands(p);
  const desc = cmds.map((c) => `\`${c.syntax}\`\n\u2502 ${c.desc}`).join("\n\n");
  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(`${cat.emoji} ${cat.label}`)
    .setDescription(desc || "_No commands._")
    .setFooter({ text: FOOTER });
}

function buildCategoryComponents(scope: "m" | "s", closeId: string) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`help_${scope}_back`)
        .setLabel("← Back")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(closeId).setLabel("Close").setEmoji("\u2716\uFE0F").setStyle(ButtonStyle.Danger),
    ),
  ];
}

// ── ENTRY POINTS ────────────────────────────────────────────────────────────

export async function sendMemberHelp(message: Message): Promise<void> {
  if (!message.guild) return;
  const p = await getPrefixes(message.guild.id);
  const closeId = `help_m_close_${message.id}_${message.author.id}`;
  await message.channel
    .send({ embeds: [buildMainEmbed("m")], components: buildMainComponents("m", MEMBER_CATEGORIES, p, closeId) })
    .catch(() => {});
}

export async function sendStaffHelp(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) return;
  const p = await getPrefixes(interaction.guildId);
  const closeId = `help_s_close_${interaction.user.id}`;
  await interaction.reply({
    embeds: [buildMainEmbed("s")],
    components: buildMainComponents("s", STAFF_CATEGORIES, p, closeId),
    ephemeral: true,
  });
}

// ── INTERACTION ROUTERS ─────────────────────────────────────────────────────

function deriveCloseId(scope: "m" | "s", interaction: ButtonInteraction | StringSelectMenuInteraction): string {
  const rows = interaction.message?.components ?? [];
  for (const row of rows) {
    for (const comp of (row as any).components ?? []) {
      const cid: string = comp.customId ?? comp.custom_id ?? "";
      if (cid.startsWith(`help_${scope}_close_`)) return cid;
    }
  }
  return scope === "m"
    ? `help_m_close_${interaction.message.id}_${interaction.user.id}`
    : `help_s_close_${interaction.user.id}`;
}

export async function handleHelpSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const id = interaction.customId;
  if (!id.startsWith("help_") || !id.endsWith("_select")) return;
  const scope: "m" | "s" = id.startsWith("help_m_") ? "m" : "s";
  const cats = scope === "m" ? MEMBER_CATEGORIES : STAFF_CATEGORIES;
  const key = interaction.values[0];
  const cat = cats.find((c) => c.key === key);
  if (!cat) return;
  const p = await getPrefixes(interaction.guildId!);
  const closeId = deriveCloseId(scope, interaction);
  await interaction.update({
    embeds: [buildCategoryEmbed(cat, p)],
    components: buildCategoryComponents(scope, closeId),
  });
}

export async function handleHelpButton(interaction: ButtonInteraction): Promise<void> {
  const id = interaction.customId;
  if (!id.startsWith("help_")) return;
  const scope: "m" | "s" = id.startsWith("help_m_") ? "m" : "s";
  const cats = scope === "m" ? MEMBER_CATEGORIES : STAFF_CATEGORIES;

  // Close
  if (id.startsWith(`help_${scope}_close_`)) {
    const parts = id.split("_");
    if (scope === "m") {
      const origMsgId = parts[3];
      const origAuthorId = parts[4];
      const memberPerms = interaction.memberPermissions;
      const allowed =
        interaction.user.id === origAuthorId ||
        (memberPerms && memberPerms.has(PermissionsBitField.Flags.ManageMessages));
      if (!allowed) {
        await interaction.reply({
          embeds: [new EmbedBuilder().setColor(0xff4d4d).setDescription("Only the requester can close this panel.")],
          ephemeral: true,
        });
        return;
      }
      await interaction.message.delete().catch(() => {});
      if (origMsgId && interaction.channel && "messages" in interaction.channel) {
        await interaction.channel.messages.delete(origMsgId).catch(() => {});
      }
      return;
    }
    const origAuthorId = parts[3];
    if (interaction.user.id !== origAuthorId) {
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(0xff4d4d).setDescription("Only the requester can close this panel.")],
        ephemeral: true,
      });
      return;
    }
    await interaction.update({
      embeds: [new EmbedBuilder().setColor(COLOR).setDescription("Help panel closed.").setFooter({ text: FOOTER })],
      components: [],
    });
    return;
  }

  const p = await getPrefixes(interaction.guildId!);

  // Back to main
  if (id === `help_${scope}_back`) {
    const closeId = deriveCloseId(scope, interaction);
    await interaction.update({
      embeds: [buildMainEmbed(scope)],
      components: buildMainComponents(scope, cats, p, closeId),
    });
    return;
  }

}
