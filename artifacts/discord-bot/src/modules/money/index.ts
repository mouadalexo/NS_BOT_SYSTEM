import {
  Client,
  TextChannel,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ButtonInteraction,
  Guild,
  MessageMentionOptions,
} from "discord.js";
import { resolveTags, resolveEmojiCodes } from "../announcements/index.js";
import { pool } from "@workspace/db";

// ─── Schema ───────────────────────────────────────────────────────────────────
export async function ensureMoneySchema(): Promise<void> {
  await pool.query(`
    create table if not exists money_config (
      guild_id text primary key,
      paypal_link text,
      cih_rib text,
      spanish_iban text,
      staff_channel_id text,
      donation_logs_channel_id text
    );
    alter table money_config add column if not exists donation_logs_channel_id text;

    create table if not exists donation_tiers (
      id serial primary key,
      guild_id text not null,
      name text not null,
      price text not null default '',
      sort_order int not null default 0,
      created_at timestamp default now()
    );
    create unique index if not exists donation_tiers_guild_name_idx
      on donation_tiers (guild_id, lower(name));

    create table if not exists donation_embeds (
      id serial primary key,
      guild_id text not null,
      slot int not null,
      color text not null default '5000FF',
      description text not null default '',
      image_url text,
      thumbnail_url text,
      updated_at timestamp default now()
    );
    create unique index if not exists donation_embeds_guild_slot_idx
      on donation_embeds (guild_id, slot);

    create table if not exists donation_published (
      guild_id text primary key,
      channel_id text not null,
      message_id text not null,
      updated_at timestamp default now()
    );
  `);
}

// ─── Types ────────────────────────────────────────────────────────────────────
export type DonationTier = { id: number; name: string; price: string; sortOrder: number };
export type DonationEmbedRow = {
  id: number;
  slot: number;
  color: string;
  description: string;
  imageUrl: string | null;
  thumbnailUrl: string | null;
};
export type DonationConfig = {
  paypalLink: string | null;
  cihRib: string | null;
  spanishIban: string | null;
  donationLogsChannelId: string | null;
};

interface DonationDmState {
  guildId: string;
  userId: string;
  username: string;
  step: "confirm" | "tier" | "payment" | "done";
  tierId?: number;
  tierName?: string;
  tierPrice?: string;
  paymentMethod?: "paypal" | "cih" | "spanish";
}

const donationDmState = new Map<string, DonationDmState>();

// ─── DB Helpers ───────────────────────────────────────────────────────────────
export async function getDonationConfig(guildId: string): Promise<DonationConfig> {
  const res = await pool.query<{
    paypal_link: string | null;
    cih_rib: string | null;
    spanish_iban: string | null;
    donation_logs_channel_id: string | null;
  }>(
    "SELECT paypal_link, cih_rib, spanish_iban, donation_logs_channel_id FROM money_config WHERE guild_id = $1",
    [guildId],
  );
  const row = res.rows[0];
  return {
    paypalLink:            row?.paypal_link              ?? null,
    cihRib:                row?.cih_rib                  ?? null,
    spanishIban:           row?.spanish_iban             ?? null,
    donationLogsChannelId: row?.donation_logs_channel_id ?? null,
  };
}

export async function getDonationTiers(guildId: string): Promise<DonationTier[]> {
  const res = await pool.query<{ id: number; name: string; price: string; sort_order: number }>(
    "SELECT id, name, price, sort_order FROM donation_tiers WHERE guild_id = $1 ORDER BY sort_order, id",
    [guildId],
  );
  return res.rows.map((r) => ({ id: r.id, name: r.name, price: r.price, sortOrder: r.sort_order }));
}

export async function getDonationEmbeds(guildId: string): Promise<DonationEmbedRow[]> {
  const res = await pool.query<{
    id: number;
    slot: number;
    color: string;
    description: string;
    image_url: string | null;
    thumbnail_url: string | null;
  }>(
    "SELECT id, slot, color, description, image_url, thumbnail_url FROM donation_embeds WHERE guild_id = $1 ORDER BY slot, id",
    [guildId],
  );
  return res.rows.map((r) => ({
    id: r.id,
    slot: r.slot,
    color: r.color,
    description: r.description,
    imageUrl: r.image_url,
    thumbnailUrl: r.thumbnail_url,
  }));
}

export async function getPublishedDonationMessage(guildId: string) {
  const res = await pool.query<{ channel_id: string; message_id: string }>(
    "SELECT channel_id, message_id FROM donation_published WHERE guild_id = $1",
    [guildId],
  );
  return res.rows[0] ? { channelId: res.rows[0].channel_id, messageId: res.rows[0].message_id } : null;
}

export async function setPublishedDonationMessage(
  guildId: string,
  channelId: string,
  messageId: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO donation_published (guild_id, channel_id, message_id, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (guild_id) DO UPDATE
       SET channel_id = $2, message_id = $3, updated_at = now()`,
    [guildId, channelId, messageId],
  );
}

// ─── Build the donation post embeds + button ──────────────────────────────────
export function buildDonationPostEmbeds(rows: DonationEmbedRow[]): EmbedBuilder[] {
  if (rows.length === 0) {
    return [
      new EmbedBuilder()
        .setColor(0x5000ff)
        .setDescription(
          "*No donation embeds configured yet.*\n" +
          "Use `/donate` → **Manage Embeds** → **Add Embed** to build your post.",
        ),
    ];
  }
  return rows.map((r) => {
    const color = parseInt((r.color || "5000FF").replace(/^#/, ""), 16) || 0x5000ff;
    const e = new EmbedBuilder().setColor(color);
    if (r.description.trim()) e.setDescription(r.description);
    else e.setDescription("\u200b");
    if (r.imageUrl)     e.setImage(r.imageUrl);
    if (r.thumbnailUrl) e.setThumbnail(r.thumbnailUrl);
    return e;
  });
}

export function buildDonateButtonRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("dn_donate")
      .setLabel("Donate !")
      .setEmoji("💚")
      .setStyle(ButtonStyle.Success),
  );
}

// ─── Resolve =ann-style tags/emojis in donation embed text and emit a ping ───
// Discord embeds never trigger notifications, so we collect every role /
// @everyone / @here / user mention found inside the resolved text and put a
// tiny ping line in the message content (with allowedMentions) so the post
// actually pings.
export async function renderDonationPost(
  rows: DonationEmbedRow[],
  guild: Guild,
): Promise<{ embeds: EmbedBuilder[]; content: string; allowedMentions: MessageMentionOptions }> {
  if (rows.length === 0) {
    return {
      embeds: buildDonationPostEmbeds(rows),
      content: "",
      allowedMentions: { parse: [] },
    };
  }

  const resolvedRows = await Promise.all(
    rows.map(async (r) => {
      let desc = r.description ?? "";
      if (desc.trim()) {
        desc = await resolveTags(desc, guild);
        desc = await resolveEmojiCodes(desc, guild);
      }
      return { ...r, description: desc };
    }),
  );

  const embeds = buildDonationPostEmbeds(resolvedRows);

  const roleIds = new Set<string>();
  const userIds = new Set<string>();
  let hasEveryone = false;
  let hasHere = false;

  for (const r of resolvedRows) {
    const text = r.description ?? "";
    if (/@everyone\b/.test(text)) hasEveryone = true;
    if (/@here\b/.test(text)) hasHere = true;
    for (const m of text.matchAll(/<@&(\d{17,20})>/g)) roleIds.add(m[1]);
    for (const m of text.matchAll(/<@!?(\d{17,20})>/g)) userIds.add(m[1]);
  }

  const pingParts: string[] = [];
  if (hasEveryone) pingParts.push("@everyone");
  if (hasHere) pingParts.push("@here");
  for (const id of roleIds) pingParts.push(`<@&${id}>`);
  for (const id of userIds) pingParts.push(`<@${id}>`);

  const parse: ("everyone" | "roles" | "users")[] = [];
  if (hasEveryone || hasHere) parse.push("everyone");
  if (roleIds.size) parse.push("roles");
  if (userIds.size) parse.push("users");

  return {
    embeds,
    content: pingParts.length ? `-# ${pingParts.join(" ")}` : "",
    allowedMentions: { parse },
  };
}

// ─── Donation logs helper ─────────────────────────────────────────────────────
async function logToDonationChannel(
  client: Client,
  guildId: string,
  embed: EmbedBuilder,
): Promise<void> {
  const cfg = await getDonationConfig(guildId);
  if (!cfg.donationLogsChannelId) return;
  const ch = (await client.channels.fetch(cfg.donationLogsChannelId).catch(() => null)) as TextChannel | null;
  if (!ch) return;
  await ch.send({ embeds: [embed] }).catch(() => {});
}

// ─── DM Step Helpers ──────────────────────────────────────────────────────────
function buildConfirmMessage() {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(0x5000ff)
        .setTitle("💚 Confirm Your Donation")
        .setDescription(
          "Are you sure you want to **donate to Night Stars server**?\n\n" +
          "Your support keeps the community alive — thank you for considering it. ⭐",
        )
        .setFooter({ text: "Night Stars • Donations" }),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("dn_yes").setLabel("Yes, donate").setEmoji("✅").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("dn_no").setLabel("No, cancel").setEmoji("✖").setStyle(ButtonStyle.Danger),
      ),
    ],
  };
}

async function buildTierMessage(guildId: string) {
  const tiers = await getDonationTiers(guildId);
  if (!tiers.length) {
    return {
      embeds: [
        new EmbedBuilder()
          .setColor(0xff4d4d)
          .setTitle("⚠️ No Tiers Configured")
          .setDescription(
            "An admin hasn't set up any donation tiers yet.\n" +
            "Please contact the staff and try again later.",
          )
          .setFooter({ text: "Night Stars • Donations" }),
      ],
      components: [],
    };
  }
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  let cur = new ActionRowBuilder<ButtonBuilder>();
  for (let i = 0; i < Math.min(tiers.length, 25); i++) {
    if (i > 0 && i % 5 === 0) {
      rows.push(cur);
      cur = new ActionRowBuilder<ButtonBuilder>();
    }
    const t = tiers[i];
    const label = t.price ? `${t.name} — ${t.price}` : t.name;
    cur.addComponents(
      new ButtonBuilder()
        .setCustomId(`dn_tier:${t.id}`)
        .setLabel(label.slice(0, 80))
        .setStyle(ButtonStyle.Primary),
    );
  }
  if (cur.components.length > 0) rows.push(cur);
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(0x5000ff)
        .setTitle("🎁 Choose Your Tier")
        .setDescription("Which tier would you like to purchase?")
        .setFooter({ text: "Night Stars • Donations" }),
    ],
    components: rows,
  };
}

async function buildPaymentMessage(guildId: string) {
  const cfg = await getDonationConfig(guildId);
  const buttons: ButtonBuilder[] = [];
  if (cfg.paypalLink) {
    buttons.push(
      new ButtonBuilder().setCustomId("dn_pay:paypal").setLabel("PayPal").setEmoji("💳").setStyle(ButtonStyle.Primary),
    );
  }
  if (cfg.cihRib) {
    buttons.push(
      new ButtonBuilder().setCustomId("dn_pay:cih").setLabel("CIH Bank").setEmoji("🏦").setStyle(ButtonStyle.Primary),
    );
  }
  if (cfg.spanishIban) {
    buttons.push(
      new ButtonBuilder().setCustomId("dn_pay:spanish").setLabel("Spanish Bank Transfer").setEmoji("🏦").setStyle(ButtonStyle.Primary),
    );
  }
  if (!buttons.length) {
    return {
      embeds: [
        new EmbedBuilder()
          .setColor(0xff4d4d)
          .setTitle("⚠️ No Payment Methods")
          .setDescription("No payment methods are configured. Please contact the staff.")
          .setFooter({ text: "Night Stars • Donations" }),
      ],
      components: [],
    };
  }
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(0x5000ff)
        .setTitle("💳 Choose Payment Method")
        .setDescription("Which payment method would you like to use?")
        .setFooter({ text: "Night Stars • Donations" }),
    ],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons)],
  };
}

function formatPaymentDescription(state: DonationDmState): string {
  const date = new Date().toISOString().slice(0, 10);
  return `${state.username} - ${state.tierName ?? "Tier"} - ${date}`;
}

async function deliverPaymentInfo(
  client: Client,
  state: DonationDmState,
  channel: TextChannel,
  method: "paypal" | "cih" | "spanish",
): Promise<void> {
  const cfg = await getDonationConfig(state.guildId);

  // Message 1 — a small header embed for context, then the raw payment
  // detail as a PLAIN message so PayPal renders as a clickable link and
  // RIB/IBAN code blocks can be tap-and-hold copied on mobile.
  if (method === "paypal" && cfg.paypalLink) {
    const url = cfg.paypalLink.startsWith("http") ? cfg.paypalLink : `https://${cfg.paypalLink}`;
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x009cde)
          .setTitle("💳 PayPal")
          .setDescription("Click the link below to pay:")
          .setFooter({ text: "Night Stars • Donations" }),
      ],
    });
    // Plain message — Discord auto-linkifies the URL and shows a preview.
    await channel.send({ content: url, allowedMentions: { parse: [] } });
  } else if (method === "cih" && cfg.cihRib) {
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x008753)
          .setTitle("🏦 CIH Bank — RIB")
          .setDescription("Tap the RIB below to copy it:")
          .setFooter({ text: "Night Stars • Donations" }),
      ],
    });
    // Plain message with code block — tap-and-hold to copy on mobile.
    await channel.send({
      content: "```\n" + cfg.cihRib + "\n```",
      allowedMentions: { parse: [] },
    });
  } else if (method === "spanish" && cfg.spanishIban) {
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0xc60b1e)
          .setTitle("🏦 Spanish Bank Transfer — IBAN")
          .setDescription("Tap the IBAN below to copy it:")
          .setFooter({ text: "Night Stars • Donations" }),
      ],
    });
    await channel.send({
      content: "```\n" + cfg.spanishIban + "\n```",
      allowedMentions: { parse: [] },
    });
  } else {
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0xff4d4d)
          .setDescription("⚠️ Payment info not available. Please contact the staff."),
      ],
    });
  }

  // Message 2 — instruction
  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0xffaa00)
        .setDescription("📋 **Copy & paste this in your Payment description:**")
        .setFooter({ text: "Night Stars • Donations" }),
    ],
  });

  // Message 3 — the description text in code block (easy copy)
  const desc = formatPaymentDescription(state);
  await channel.send({ content: "```\n" + desc + "\n```" });

  // Message 4 — thank you / unlock notice
  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0x00c851)
        .setTitle("⭐ Thank You!")
        .setDescription(
          "Once we receive your donation, all your **tier features** will be unlocked for you.\n\n" +
          "We truly appreciate your support — see you in the server! 💚",
        )
        .setFooter({ text: "Night Stars • Donations" }),
    ],
  });

  // Logs — completion
  await logToDonationChannel(
    client,
    state.guildId,
    new EmbedBuilder()
      .setColor(0x00c851)
      .setTitle("💚 Donation Request Completed")
      .addFields(
        { name: "Member",  value: `<@${state.userId}>\n\`${state.username}\` (${state.userId})`, inline: true },
        { name: "Tier",    value: state.tierName ?? "—",                                          inline: true },
        { name: "Method",  value: method === "paypal" ? "PayPal" : method === "cih" ? "CIH Bank" : "Spanish Bank Transfer", inline: true },
        { name: "Payment Description", value: "```\n" + desc + "\n```",                          inline: false },
      )
      .setTimestamp()
      .setFooter({ text: "Night Stars • Donations" }),
  );

  state.step = "done";
  donationDmState.delete(state.userId);
}

// ─── Entry point: called when member clicks the green Donate button ──────────
export async function startDonationDmSession(interaction: ButtonInteraction): Promise<void> {
  const guildId  = interaction.guild?.id ?? "";
  const userId   = interaction.user.id;
  const username = interaction.user.username;

  if (!guildId) {
    await interaction.reply({ content: "❌ This button only works in a server.", ephemeral: true });
    return;
  }

  const existing = donationDmState.get(userId);
  if (existing && existing.step !== "done") {
    await interaction.reply({
      content: "📩 You already have an active donation session — please check your DMs.",
      ephemeral: true,
    });
    return;
  }

  const dm = await interaction.user.createDM().catch(() => null);
  if (!dm) {
    await interaction.reply({
      content: "❌ I couldn't DM you. Please **enable DMs from server members** and try again.",
      ephemeral: true,
    });
    return;
  }

  const state: DonationDmState = { guildId, userId, username, step: "confirm" };
  donationDmState.set(userId, state);

  await dm.send(buildConfirmMessage());

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x00c851)
        .setDescription("📩 Check your **DMs** to continue your donation."),
    ],
    ephemeral: true,
  });
}

// ─── Module Registration ──────────────────────────────────────────────────────
export function registerMoneyModule(client: Client): void {
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isButton()) return;
    if (interaction.guild) return; // DM-only
    const customId = interaction.customId;
    if (!customId.startsWith("dn_")) return;

    const userId = interaction.user.id;
    const state = donationDmState.get(userId);
    const channel = interaction.channel as TextChannel | null;
    if (!channel) return;

    // Yes / No on confirm
    if (customId === "dn_yes") {
      if (!state || state.step !== "confirm") {
        await interaction.update({
          embeds: [new EmbedBuilder().setColor(0xff4d4d).setDescription("❌ Session expired. Please click **Donate !** again on the server.")],
          components: [],
        }).catch(() => {});
        return;
      }
      state.step = "tier";
      donationDmState.set(userId, state);
      const next = await buildTierMessage(state.guildId);
      await interaction.update({
        embeds: [
          new EmbedBuilder()
            .setColor(0x00c851)
            .setDescription("✅ Great! Let's continue."),
        ],
        components: [],
      }).catch(() => {});
      await channel.send(next);

      // Log: started donation
      await logToDonationChannel(
        client,
        state.guildId,
        new EmbedBuilder()
          .setColor(0xffaa00)
          .setTitle("📥 New Donation Started")
          .setDescription(`<@${state.userId}> (\`${state.username}\`) confirmed they want to donate.`)
          .setTimestamp()
          .setFooter({ text: "Night Stars • Donations" }),
      );
      return;
    }

    if (customId === "dn_no") {
      donationDmState.delete(userId);
      await interaction.update({
        embeds: [
          new EmbedBuilder()
            .setColor(0x9aa0a6)
            .setDescription("❎ Donation cancelled. You can come back anytime — thank you for considering it!"),
        ],
        components: [],
      }).catch(() => {});
      return;
    }

    // Tier choice
    if (customId.startsWith("dn_tier:")) {
      if (!state || state.step !== "tier") {
        await interaction.reply({ content: "❌ Session expired. Please start again.", ephemeral: true });
        return;
      }
      const tierId = parseInt(customId.split(":")[1], 10);
      const tiers = await getDonationTiers(state.guildId);
      const tier = tiers.find((t) => t.id === tierId);
      if (!tier) {
        await interaction.reply({ content: "❌ That tier no longer exists.", ephemeral: true });
        return;
      }
      state.tierId = tier.id;
      state.tierName = tier.name;
      state.tierPrice = tier.price;
      state.step = "payment";
      donationDmState.set(userId, state);
      await interaction.update({
        embeds: [
          new EmbedBuilder()
            .setColor(0x00c851)
            .setDescription(`✅ Tier selected: **${tier.name}**${tier.price ? ` (${tier.price})` : ""}`),
        ],
        components: [],
      }).catch(() => {});
      const next = await buildPaymentMessage(state.guildId);
      await channel.send(next);
      return;
    }

    // Payment method
    if (customId.startsWith("dn_pay:")) {
      if (!state || state.step !== "payment") {
        await interaction.reply({ content: "❌ Session expired. Please start again.", ephemeral: true });
        return;
      }
      const method = customId.split(":")[1] as "paypal" | "cih" | "spanish";
      state.paymentMethod = method;
      donationDmState.set(userId, state);
      await interaction.update({
        embeds: [
          new EmbedBuilder()
            .setColor(0x00c851)
            .setDescription("✅ Sending you the payment details…"),
        ],
        components: [],
      }).catch(() => {});
      await deliverPaymentInfo(client, state, channel, method);
      return;
    }
  });
}
