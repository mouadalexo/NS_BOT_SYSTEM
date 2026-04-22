import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  Message,
  PermissionsBitField,
} from "discord.js";
import { db, botConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const COLOR = 0x5000ff;
const FOOTER = "Night Stars \u2022 NS Bot";

type CategoryDef = {
  key: string;
  label: string;
  emoji: string;
  buildLines: (p: Prefixes) => string[];
};

type Prefixes = { pvs: string; mgr: string; ctp: string; ann: string };

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
    label: "Private Voice",
    emoji: "\uD83C\uDFA7",
    buildLines: (p) => [
      `\`${p.pvs}key @user\` \u2014 Give or remove access to your room`,
      `\`${p.pvs}pull @user\` \u2014 Pull a member from the waiting room`,
      `\`${p.pvs}see keys\` \u2014 List members with access`,
      `\`${p.pvs}clear keys\` \u2014 Remove all keys`,
      `\`${p.pvs}name <name>\` \u2014 Rename your voice room`,
      `\`${p.pvs}tlock\` / \`${p.pvs}tunlock\` \u2014 Lock or unlock the text chat`,
      `\`${p.pvs}kick @user\` \u2014 Disconnect someone from your room`,
    ],
  },
  {
    key: "ctp",
    label: "Call to Play",
    emoji: "\uD83C\uDFAE",
    buildLines: () => [
      "`tag` \u2014 Ping the game role for your current voice category",
      "`tag <gamename>` \u2014 One-tap ping in a temp voice category (e.g. `tag valorant`)",
      "`tagcd` \u2014 Show remaining tag cooldown for your category",
      "",
      "_These commands work without a prefix._",
    ],
  },
  {
    key: "social",
    label: "Social",
    emoji: "\uD83D\uDC95",
    buildLines: (p) => [
      `\`${p.pvs}relationship\` \u2014 Show your relationship status`,
      `\`${p.pvs}propose @user\` \u2014 Send a proposal (10-min window)`,
      `\`${p.pvs}accept\` / \`${p.pvs}reject\` \u2014 Respond to your latest pending request`,
      `\`${p.pvs}partner\` \u2014 Show your current partner`,
      `\`${p.pvs}breakup\` \u2014 End your relationship`,
      `\`${p.pvs}children\` \u2014 List your children (max 3)`,
      `\`${p.pvs}addchild @user\` \u2014 Send an adoption request`,
    ],
  },
];

// ── STAFF CATEGORIES ────────────────────────────────────────────────────────

const STAFF_CATEGORIES: CategoryDef[] = [
  {
    key: "setup",
    label: "Setup",
    emoji: "\u2699\uFE0F",
    buildLines: () => [
      "`/setup pvs` \u2014 Configure the Private Voice System",
      "`/setup ctp-category` \u2014 Configure CTP category games",
      "`/setup ctp-onetap` \u2014 Configure CTP one-tap (temp voice)",
      "`/setup-jail` \u2014 Configure the Jail system",
      "`/ann setup` \u2014 Configure Announcements",
      "`/welcome setup` \u2014 Configure the Welcome system",
      "`/setup-move` \u2014 Roles allowed to use `aji @user`",
      "`/setup-clear` \u2014 Roles allowed to use `mse7 N`",
      "`/general setup` \u2014 Staff role, blocked channels, hosters",
      "`/role-giver setup` \u2014 Open the Role Giver panel",
      "`/prefix` \u2014 View and change the bot prefix",
    ],
  },
  {
    key: "jail",
    label: "Jail",
    emoji: "\uD83D\uDD28",
    buildLines: (p) => [
      `\`${p.pvs}jail @user <reason>\` \u2014 Apply the jail role`,
      `\`${p.pvs}unjail @user\` \u2014 Remove jail and restore Member`,
      `\`${p.pvs}case @user\` \u2014 Show the active jail reason`,
    ],
  },
  {
    key: "stagelock",
    label: "Stage Lock",
    emoji: "\uD83C\uDFA4",
    buildLines: (p) => [
      `\`${p.pvs}stagelock\` \u2014 Block the Member role from connecting to your channel`,
      `\`${p.pvs}stageunlock\` \u2014 Re-allow the Member role to connect`,
    ],
  },
  {
    key: "manager",
    label: "PVS Manager",
    emoji: "\uD83D\uDD11",
    buildLines: (p) => [
      `\`${p.mgr}pv @user\` \u2014 Create a permanent private voice room`,
      `\`${p.mgr}pv delete @user\` \u2014 Remove a member's PVS room`,
    ],
  },
  {
    key: "ann",
    label: "Announcements",
    emoji: "\uD83D\uDCE2",
    buildLines: (p) => [
      `\`${p.ann}<message>\` \u2014 Send a styled announcement to the configured channel`,
      "Configure tag role, embed colors and logs via `/ann setup`.",
    ],
  },
  {
    key: "modtools",
    label: "Mod Tools",
    emoji: "\uD83D\uDEE0\uFE0F",
    buildLines: () => [
      "`aji @user` \u2014 Move a member into your current voice channel",
      "`mse7 N` \u2014 Clear the last N messages in this channel",
    ],
  },
  {
    key: "rolegiver",
    label: "Role Giver",
    emoji: "\uD83C\uDFAD",
    buildLines: (p) => [
      `Custom commands defined via \`/role-giver setup\`.`,
      `Format: \`${p.pvs}<commandName> @user\` toggles the configured role.`,
      `Example: if a rule is named \`mute\`, use \`${p.pvs}mute @user\`.`,
    ],
  },
];

// ── EMBED + COMPONENT BUILDERS ──────────────────────────────────────────────

function commandCount(cat: CategoryDef, p: Prefixes): number {
  return cat.buildLines(p).filter((l) => l.includes("`")).length;
}

function buildMainEmbed(scope: "m" | "s", cats: CategoryDef[], p: Prefixes): EmbedBuilder {
  const title = scope === "m" ? "\uD83D\uDCDC Member Commands" : "\u2699\uFE0F Staff & Setup Commands";
  const desc = cats
    .map((c) => `${c.emoji} **${c.label}** \u2014 _View ${commandCount(c, p)} command(s)_`)
    .join("\n");
  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle("Select A Command Category!")
    .setAuthor({ name: title })
    .setDescription(desc)
    .setFooter({ text: FOOTER });
}

function buildCategoryEmbed(cat: CategoryDef, p: Prefixes): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(`${cat.emoji} ${cat.label} \u2014 Commands`)
    .setDescription(cat.buildLines(p).join("\n"))
    .setFooter({ text: FOOTER });
}

function buildMainComponents(scope: "m" | "s", cats: CategoryDef[], closeId: string): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  let row = new ActionRowBuilder<ButtonBuilder>();
  let inRow = 0;
  for (const c of cats) {
    if (inRow === 5) {
      rows.push(row);
      row = new ActionRowBuilder<ButtonBuilder>();
      inRow = 0;
    }
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`help_${scope}_cat_${c.key}`)
        .setLabel(c.label)
        .setEmoji(c.emoji)
        .setStyle(ButtonStyle.Secondary),
    );
    inRow++;
  }
  if (inRow > 0) rows.push(row);

  // Close row
  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(closeId).setLabel("Close").setEmoji("\u2716\uFE0F").setStyle(ButtonStyle.Danger),
    ),
  );
  return rows;
}

function buildCategoryComponents(scope: "m" | "s", closeId: string): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`help_${scope}_back`)
        .setLabel("Select A Command Category!")
        .setEmoji("\u2B05\uFE0F")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(closeId).setLabel("Close").setEmoji("\u2716\uFE0F").setStyle(ButtonStyle.Danger),
    ),
  ];
}

// ── ENTRY POINTS ────────────────────────────────────────────────────────────

export async function sendMemberHelp(message: Message): Promise<void> {
  if (!message.guild) return;
  const p = await getPrefixes(message.guild.id);
  // Encode original message ID + author ID in close-id so we can delete both
  const closeId = `help_m_close_${message.id}_${message.author.id}`;
  const embed = buildMainEmbed("m", MEMBER_CATEGORIES, p);
  const components = buildMainComponents("m", MEMBER_CATEGORIES, closeId);
  await message.channel.send({ embeds: [embed], components }).catch(() => {});
}

export async function sendStaffHelp(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) return;
  const p = await getPrefixes(interaction.guildId);
  const closeId = `help_s_close_${interaction.user.id}`;
  const embed = buildMainEmbed("s", STAFF_CATEGORIES, p);
  const components = buildMainComponents("s", STAFF_CATEGORIES, closeId);
  await interaction.reply({ embeds: [embed], components, ephemeral: true });
}

// ── INTERACTION ROUTER ──────────────────────────────────────────────────────

export async function handleHelpButton(interaction: ButtonInteraction): Promise<void> {
  const id = interaction.customId;
  if (!id.startsWith("help_")) return;

  const scope: "m" | "s" = id.startsWith("help_m_") ? "m" : "s";
  const cats = scope === "m" ? MEMBER_CATEGORIES : STAFF_CATEGORIES;

  // Close
  if (id.startsWith(`help_${scope}_close_`)) {
    const parts = id.split("_");
    // help / m|s / close / origMsgId? / origAuthorId
    if (scope === "m") {
      const origMsgId = parts[3];
      const origAuthorId = parts[4];
      // Permission: only the original author or anyone with Manage Messages
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
    // staff (ephemeral) — only requester can close
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

  // Back
  if (id === `help_${scope}_back`) {
    // Re-derive close-id from message components (the close button is still on the panel originally — but we replaced components, so reconstruct)
    // For simplicity, rebuild a fresh close id (member: use panel msg id + interaction user; staff: user id)
    const closeId =
      scope === "m"
        ? `help_m_close_${interaction.message.id}_${interaction.user.id}`
        : `help_s_close_${interaction.user.id}`;
    await interaction.update({
      embeds: [buildMainEmbed(scope, cats, p)],
      components: buildMainComponents(scope, cats, closeId),
    });
    return;
  }

  // Category
  const catPrefix = `help_${scope}_cat_`;
  if (id.startsWith(catPrefix)) {
    const key = id.slice(catPrefix.length);
    const cat = cats.find((c) => c.key === key);
    if (!cat) return;
    const closeId =
      scope === "m"
        ? `help_m_close_${interaction.message.id}_${interaction.user.id}`
        : `help_s_close_${interaction.user.id}`;
    await interaction.update({
      embeds: [buildCategoryEmbed(cat, p)],
      components: buildCategoryComponents(scope, closeId),
    });
    return;
  }
}
