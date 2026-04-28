import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelSelectMenuInteraction,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  ModalSubmitInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextChannel,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { pool } from "@workspace/db";
import {
  getDonationConfig,
  getDonationEmbeds,
  getDonationTiers,
  getPublishedDonationMessage,
  setPublishedDonationMessage,
  buildDonationPostEmbeds,
  buildDonateButtonRow,
  renderDonationPost,
  type DonationEmbedRow,
} from "../modules/money/index.js";

// ─── Panel state (per guild+user) ─────────────────────────────────────────────
type PanelStep =
  | { kind: "idle" }
  | { kind: "publish_pick_channel"; channelId?: string };

const panelState = new Map<string, PanelStep>();
const stateKey = (guildId: string, userId: string) => `${guildId}:${userId}`;

function getState(guildId: string, userId: string): PanelStep {
  return panelState.get(stateKey(guildId, userId)) ?? { kind: "idle" };
}
function setState(guildId: string, userId: string, s: PanelStep) {
  panelState.set(stateKey(guildId, userId), s);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtTier(t: { name: string; price: string }): string {
  return t.price ? `**${t.name}** — ${t.price}` : `**${t.name}**`;
}
function shorten(s: string, n: number): string {
  if (!s) return "*(empty)*";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
function colorPreview(hex: string): string {
  const clean = hex.replace(/^#/, "").toUpperCase();
  return `\`#${clean}\``;
}

async function buildOverviewEmbed(guildId: string): Promise<EmbedBuilder> {
  const [cfg, tiers, embeds, published] = await Promise.all([
    getDonationConfig(guildId),
    getDonationTiers(guildId),
    getDonationEmbeds(guildId),
    getPublishedDonationMessage(guildId),
  ]);

  const paymentLines: string[] = [];
  paymentLines.push(`PayPal: ${cfg.paypalLink ? "✅" : "❌"}`);
  paymentLines.push(`CIH RIB: ${cfg.cihRib ? "✅" : "❌"}`);
  paymentLines.push(`Spanish IBAN: ${cfg.spanishIban ? "✅" : "❌"}`);

  const tierLines = tiers.length
    ? tiers.map((t, i) => `${i + 1}. ${fmtTier(t)}`).join("\n")
    : "*No tiers yet — add at least one.*";

  const embedLines = embeds.length
    ? embeds
        .map(
          (e, i) =>
            `**Embed ${i + 1}** ${colorPreview(e.color)} — ${shorten(e.description.replace(/\n/g, " "), 60)}` +
            (e.imageUrl ? "  🖼️" : "") +
            (e.thumbnailUrl ? "  🔳" : ""),
        )
        .join("\n")
    : "*No embeds yet — add at least one.*";

  return new EmbedBuilder()
    .setColor(0x5000ff)
    .setTitle("💚 Donate Setup Panel")
    .setDescription(
      "Configure tiers, payment info, the donation post, and the logs channel.\n" +
      "When ready, publish the embed to a channel — members will click **Donate !** and complete the flow in DM.",
    )
    .addFields(
      { name: "💳 Payment Methods",      value: paymentLines.join("\n"), inline: true },
      { name: "📒 Donation Logs",       value: cfg.donationLogsChannelId ? `<#${cfg.donationLogsChannelId}>` : "❌ not set", inline: true },
      { name: "📢 Published Embed",     value: published ? `<#${published.channelId}> · [jump](https://discord.com/channels/${guildId}/${published.channelId}/${published.messageId})` : "❌ not yet published", inline: true },
      { name: "🎁 Tiers",                value: tierLines.slice(0, 1024) },
      { name: "🧱 Embeds",               value: embedLines.slice(0, 1024) },
    )
    .setFooter({ text: "Night Stars • /donate" });
}

function buildPanelRows(): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("mp_set_payment").setLabel("Set Payment Info").setEmoji("💳").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("mp_set_logs").setLabel("Set Donation Logs").setEmoji("📒").setStyle(ButtonStyle.Primary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("mp_add_tier").setLabel("Add Tier").setEmoji("➕").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("mp_edit_tier").setLabel("Edit Tier").setEmoji("✏").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("mp_delete_tier").setLabel("Delete Tier").setEmoji("🗑").setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("mp_add_embed").setLabel("Add Embed").setEmoji("➕").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("mp_edit_embed").setLabel("Edit Embed").setEmoji("✏").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("mp_delete_embed").setLabel("Delete Embed").setEmoji("🗑").setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("mp_publish").setLabel("Publish").setEmoji("📢").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("mp_edit_posted").setLabel("Update Posted").setEmoji("🔁").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("mp_back").setLabel("Close").setEmoji("✖").setStyle(ButtonStyle.Danger),
    ),
  ];
}

async function refreshPanel(interaction: ButtonInteraction | StringSelectMenuInteraction | ChannelSelectMenuInteraction | ModalSubmitInteraction): Promise<void> {
  const guildId = interaction.guild!.id;
  const embed = await buildOverviewEmbed(guildId);
  const rows = buildPanelRows();
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ embeds: [embed], components: rows });
  } else if ("update" in interaction && typeof (interaction as any).update === "function") {
    await (interaction as any).update({ embeds: [embed], components: rows });
  } else {
    await interaction.reply({ embeds: [embed], components: rows, ephemeral: true });
  }
}

// ─── Entry ────────────────────────────────────────────────────────────────────
export async function openMoneyPanel(interaction: ButtonInteraction): Promise<void> {
  const guildId = interaction.guild?.id;
  if (!guildId) return;
  const embed = await buildOverviewEmbed(guildId);
  const rows = buildPanelRows();
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ embeds: [embed], components: rows });
  } else {
    await interaction.reply({ embeds: [embed], components: rows, ephemeral: true });
  }
}

export async function handleMoneyBack(interaction: ButtonInteraction): Promise<void> {
  await interaction.update({
    embeds: [new EmbedBuilder().setColor(0x9aa0a6).setDescription("Closed. Run `/donate` again to reopen.")],
    components: [],
  }).catch(() => {});
}

// ─── Payment Info ─────────────────────────────────────────────────────────────
export async function handleMoneySetPayment(interaction: ButtonInteraction): Promise<void> {
  const cfg = await getDonationConfig(interaction.guild!.id);
  const modal = new ModalBuilder().setCustomId("mp_payment_modal").setTitle("Set Payment Info");
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("paypal")
        .setLabel("PayPal link")
        .setPlaceholder("paypal.me/yourname — leave empty to clear")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(200)
        .setValue(cfg.paypalLink ?? ""),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("cih")
        .setLabel("CIH RIB (Morocco)")
        .setPlaceholder("Leave empty to clear")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(200)
        .setValue(cfg.cihRib ?? ""),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("spanish")
        .setLabel("Spanish IBAN")
        .setPlaceholder("Leave empty to clear")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(200)
        .setValue(cfg.spanishIban ?? ""),
    ),
  );
  await interaction.showModal(modal);
}

export async function handleMoneyPaymentModal(interaction: ModalSubmitInteraction): Promise<void> {
  const guildId = interaction.guild!.id;
  const paypal  = interaction.fields.getTextInputValue("paypal").trim()  || null;
  const cih     = interaction.fields.getTextInputValue("cih").trim()     || null;
  const spanish = interaction.fields.getTextInputValue("spanish").trim() || null;
  await pool.query(
    `INSERT INTO money_config (guild_id, paypal_link, cih_rib, spanish_iban)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (guild_id) DO UPDATE SET paypal_link=$2, cih_rib=$3, spanish_iban=$4`,
    [guildId, paypal, cih, spanish],
  );
  await interaction.deferUpdate();
  await refreshPanel(interaction);
}

// ─── Donation Logs Channel ────────────────────────────────────────────────────
export async function handleMoneySetLogs(interaction: ButtonInteraction): Promise<void> {
  const row = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("mp_logs_ch")
      .setPlaceholder("Pick a channel for donation logs")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setMinValues(1)
      .setMaxValues(1),
  );
  const cancel = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("mp_back_to_panel").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );
  await interaction.update({
    embeds: [new EmbedBuilder().setColor(0x5000ff).setDescription("📒 Choose the channel where donation events will be logged.")],
    components: [row, cancel],
  });
}

export async function handleMoneyLogsChannelSelect(interaction: ChannelSelectMenuInteraction): Promise<void> {
  const channelId = interaction.values[0];
  await pool.query(
    `INSERT INTO money_config (guild_id, donation_logs_channel_id)
     VALUES ($1, $2)
     ON CONFLICT (guild_id) DO UPDATE SET donation_logs_channel_id=$2`,
    [interaction.guild!.id, channelId],
  );
  await interaction.update({
    embeds: [new EmbedBuilder().setColor(0x00c851).setDescription(`✅ Donation logs channel set to <#${channelId}>.`)],
    components: [],
  });
  // Re-open the panel
  setTimeout(() => { void openMoneyPanel(interaction as unknown as ButtonInteraction); }, 600);
}

// ─── Tiers: Add ───────────────────────────────────────────────────────────────
export async function handleMoneyAddTier(interaction: ButtonInteraction): Promise<void> {
  const modal = new ModalBuilder().setCustomId("mp_add_tier_modal").setTitle("Add Donation Tier");
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("name").setLabel("Tier name (e.g. Premium, Luxury)")
        .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("price").setLabel("Price label (optional, e.g. €15 / lifetime)")
        .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(50),
    ),
  );
  await interaction.showModal(modal);
}

export async function handleMoneyAddTierModal(interaction: ModalSubmitInteraction): Promise<void> {
  const guildId = interaction.guild!.id;
  const name  = interaction.fields.getTextInputValue("name").trim();
  const price = interaction.fields.getTextInputValue("price").trim();
  if (!name) {
    await interaction.reply({ content: "❌ Name is required.", ephemeral: true });
    return;
  }
  const sortRes = await pool.query<{ max: number }>(
    "SELECT COALESCE(MAX(sort_order), -1) AS max FROM donation_tiers WHERE guild_id = $1",
    [guildId],
  );
  const nextSort = (sortRes.rows[0]?.max ?? -1) + 1;
  try {
    await pool.query(
      "INSERT INTO donation_tiers (guild_id, name, price, sort_order) VALUES ($1, $2, $3, $4)",
      [guildId, name, price, nextSort],
    );
  } catch (err: any) {
    if (String(err?.message ?? "").includes("duplicate")) {
      await interaction.reply({ content: `❌ A tier named **${name}** already exists.`, ephemeral: true });
      return;
    }
    throw err;
  }
  await interaction.deferUpdate();
  await refreshPanel(interaction);
}

// ─── Tiers: Edit ──────────────────────────────────────────────────────────────
export async function handleMoneyEditTier(interaction: ButtonInteraction): Promise<void> {
  const tiers = await getDonationTiers(interaction.guild!.id);
  if (!tiers.length) {
    await interaction.reply({ content: "❌ No tiers to edit.", ephemeral: true });
    return;
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId("mp_edit_tier_select")
    .setPlaceholder("Pick a tier to edit")
    .addOptions(
      tiers.slice(0, 25).map((t) => ({
        label: t.name.slice(0, 100),
        description: t.price ? t.price.slice(0, 100) : undefined,
        value: String(t.id),
      })),
    );
  await interaction.update({
    embeds: [new EmbedBuilder().setColor(0x5000ff).setDescription("✏ Pick a tier to edit:")],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("mp_back_to_panel").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
}

export async function handleMoneyEditTierSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const tierId = parseInt(interaction.values[0], 10);
  const res = await pool.query<{ name: string; price: string }>(
    "SELECT name, price FROM donation_tiers WHERE id = $1 AND guild_id = $2",
    [tierId, interaction.guild!.id],
  );
  const t = res.rows[0];
  if (!t) {
    await interaction.reply({ content: "❌ Tier not found.", ephemeral: true });
    return;
  }
  const modal = new ModalBuilder().setCustomId(`mp_edit_tier_modal:${tierId}`).setTitle(`Edit Tier — ${t.name}`.slice(0, 45));
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("name").setLabel("Tier name").setStyle(TextInputStyle.Short)
        .setRequired(true).setMaxLength(80).setValue(t.name),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("price").setLabel("Price label").setStyle(TextInputStyle.Short)
        .setRequired(false).setMaxLength(50).setValue(t.price ?? ""),
    ),
  );
  await interaction.showModal(modal);
}

export async function handleMoneyEditTierModal(interaction: ModalSubmitInteraction): Promise<void> {
  const tierId = parseInt(interaction.customId.split(":")[1], 10);
  const name  = interaction.fields.getTextInputValue("name").trim();
  const price = interaction.fields.getTextInputValue("price").trim();
  if (!name) { await interaction.reply({ content: "❌ Name required.", ephemeral: true }); return; }
  await pool.query(
    "UPDATE donation_tiers SET name=$1, price=$2 WHERE id=$3 AND guild_id=$4",
    [name, price, tierId, interaction.guild!.id],
  );
  await interaction.deferUpdate();
  await refreshPanel(interaction);
}

// ─── Tiers: Delete ────────────────────────────────────────────────────────────
export async function handleMoneyDeleteTier(interaction: ButtonInteraction): Promise<void> {
  const tiers = await getDonationTiers(interaction.guild!.id);
  if (!tiers.length) {
    await interaction.reply({ content: "❌ No tiers to delete.", ephemeral: true });
    return;
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId("mp_delete_tier_select")
    .setPlaceholder("Pick a tier to delete")
    .addOptions(
      tiers.slice(0, 25).map((t) => ({
        label: t.name.slice(0, 100),
        description: t.price ? t.price.slice(0, 100) : undefined,
        value: String(t.id),
      })),
    );
  await interaction.update({
    embeds: [new EmbedBuilder().setColor(0xff4d4d).setDescription("🗑 Pick a tier to delete (no confirmation):")],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("mp_back_to_panel").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
}

export async function handleMoneyDeleteTierSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const tierId = parseInt(interaction.values[0], 10);
  await pool.query("DELETE FROM donation_tiers WHERE id=$1 AND guild_id=$2", [tierId, interaction.guild!.id]);
  await interaction.update({
    embeds: [new EmbedBuilder().setColor(0x00c851).setDescription("✅ Tier deleted.")],
    components: [],
  });
  setTimeout(() => { void openMoneyPanel(interaction as unknown as ButtonInteraction); }, 500);
}

// ─── Embeds: Add ──────────────────────────────────────────────────────────────
export async function handleMoneyAddEmbed(interaction: ButtonInteraction): Promise<void> {
  const modal = new ModalBuilder().setCustomId("mp_add_embed_modal").setTitle("Add Donation Embed");
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("color").setLabel("Color HEX (e.g. 5000FF)")
        .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(7).setValue("5000FF"),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("description").setLabel("Description (markdown supported)")
        .setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(4000),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("image").setLabel("Big image URL (bottom) — optional")
        .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(500),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("thumb").setLabel("Small image URL (top right) — optional")
        .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(500),
    ),
  );
  await interaction.showModal(modal);
}

export async function handleMoneyAddEmbedModal(interaction: ModalSubmitInteraction): Promise<void> {
  const guildId = interaction.guild!.id;
  const color = (interaction.fields.getTextInputValue("color").trim() || "5000FF").replace(/^#/, "").toUpperCase();
  const desc  = interaction.fields.getTextInputValue("description").trim();
  const image = interaction.fields.getTextInputValue("image").trim() || null;
  const thumb = interaction.fields.getTextInputValue("thumb").trim() || null;

  if (!/^[0-9A-F]{6}$/.test(color)) {
    await interaction.reply({ content: "❌ Color must be a 6-digit hex like `5000FF`.", ephemeral: true });
    return;
  }
  const slotRes = await pool.query<{ max: number }>(
    "SELECT COALESCE(MAX(slot), 0) AS max FROM donation_embeds WHERE guild_id=$1", [guildId],
  );
  const nextSlot = (slotRes.rows[0]?.max ?? 0) + 1;
  if (nextSlot > 10) {
    await interaction.reply({ content: "❌ Discord allows at most 10 embeds per message.", ephemeral: true });
    return;
  }
  await pool.query(
    `INSERT INTO donation_embeds (guild_id, slot, color, description, image_url, thumbnail_url)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [guildId, nextSlot, color, desc, image, thumb],
  );
  await interaction.deferUpdate();
  await refreshPanel(interaction);
}

// ─── Embeds: Edit ─────────────────────────────────────────────────────────────
export async function handleMoneyEditEmbed(interaction: ButtonInteraction): Promise<void> {
  const embeds = await getDonationEmbeds(interaction.guild!.id);
  if (!embeds.length) { await interaction.reply({ content: "❌ No embeds to edit.", ephemeral: true }); return; }
  const select = new StringSelectMenuBuilder()
    .setCustomId("mp_edit_embed_select")
    .setPlaceholder("Pick an embed to edit")
    .addOptions(
      embeds.slice(0, 25).map((e, i) => ({
        label: `Embed ${i + 1} (#${e.color})`.slice(0, 100),
        description: shorten(e.description.replace(/\n/g, " "), 90) || "(no description)",
        value: String(e.id),
      })),
    );
  await interaction.update({
    embeds: [new EmbedBuilder().setColor(0x5000ff).setDescription("✏ Pick an embed to edit:")],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("mp_back_to_panel").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
}

export async function handleMoneyEditEmbedSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const embedId = parseInt(interaction.values[0], 10);
  const res = await pool.query<DonationEmbedRow & { description: string }>(
    "SELECT id, slot, color, description, image_url AS \"imageUrl\", thumbnail_url AS \"thumbnailUrl\" FROM donation_embeds WHERE id=$1 AND guild_id=$2",
    [embedId, interaction.guild!.id],
  );
  const e = res.rows[0];
  if (!e) { await interaction.reply({ content: "❌ Embed not found.", ephemeral: true }); return; }
  const modal = new ModalBuilder().setCustomId(`mp_edit_embed_modal:${embedId}`).setTitle(`Edit Embed (slot ${e.slot})`);
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("color").setLabel("Color HEX").setStyle(TextInputStyle.Short)
        .setRequired(false).setMaxLength(7).setValue(e.color),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("description").setLabel("Description").setStyle(TextInputStyle.Paragraph)
        .setRequired(false).setMaxLength(4000).setValue(e.description ?? ""),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("image").setLabel("Big image URL (bottom)").setStyle(TextInputStyle.Short)
        .setRequired(false).setMaxLength(500).setValue(e.imageUrl ?? ""),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("thumb").setLabel("Small image URL (top right)").setStyle(TextInputStyle.Short)
        .setRequired(false).setMaxLength(500).setValue(e.thumbnailUrl ?? ""),
    ),
  );
  await interaction.showModal(modal);
}

export async function handleMoneyEditEmbedModal(interaction: ModalSubmitInteraction): Promise<void> {
  const embedId = parseInt(interaction.customId.split(":")[1], 10);
  const color = (interaction.fields.getTextInputValue("color").trim() || "5000FF").replace(/^#/, "").toUpperCase();
  const desc  = interaction.fields.getTextInputValue("description").trim();
  const image = interaction.fields.getTextInputValue("image").trim() || null;
  const thumb = interaction.fields.getTextInputValue("thumb").trim() || null;
  if (!/^[0-9A-F]{6}$/.test(color)) {
    await interaction.reply({ content: "❌ Color must be a 6-digit hex like `5000FF`.", ephemeral: true });
    return;
  }
  await pool.query(
    `UPDATE donation_embeds SET color=$1, description=$2, image_url=$3, thumbnail_url=$4, updated_at=now()
     WHERE id=$5 AND guild_id=$6`,
    [color, desc, image, thumb, embedId, interaction.guild!.id],
  );
  await interaction.deferUpdate();
  await refreshPanel(interaction);
}

// ─── Embeds: Delete ───────────────────────────────────────────────────────────
export async function handleMoneyDeleteEmbed(interaction: ButtonInteraction): Promise<void> {
  const embeds = await getDonationEmbeds(interaction.guild!.id);
  if (!embeds.length) { await interaction.reply({ content: "❌ No embeds to delete.", ephemeral: true }); return; }
  const select = new StringSelectMenuBuilder()
    .setCustomId("mp_delete_embed_select")
    .setPlaceholder("Pick an embed to delete")
    .addOptions(
      embeds.slice(0, 25).map((e, i) => ({
        label: `Embed ${i + 1} (#${e.color})`.slice(0, 100),
        description: shorten(e.description.replace(/\n/g, " "), 90) || "(no description)",
        value: String(e.id),
      })),
    );
  await interaction.update({
    embeds: [new EmbedBuilder().setColor(0xff4d4d).setDescription("🗑 Pick an embed to delete:")],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("mp_back_to_panel").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
}

export async function handleMoneyDeleteEmbedSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const embedId = parseInt(interaction.values[0], 10);
  await pool.query("DELETE FROM donation_embeds WHERE id=$1 AND guild_id=$2", [embedId, interaction.guild!.id]);
  await interaction.update({
    embeds: [new EmbedBuilder().setColor(0x00c851).setDescription("✅ Embed deleted.")],
    components: [],
  });
  setTimeout(() => { void openMoneyPanel(interaction as unknown as ButtonInteraction); }, 500);
}

// ─── Publish ──────────────────────────────────────────────────────────────────
export async function handleMoneyPublish(interaction: ButtonInteraction): Promise<void> {
  const embeds = await getDonationEmbeds(interaction.guild!.id);
  if (!embeds.length) {
    await interaction.reply({ content: "❌ Add at least one embed before publishing.", ephemeral: true });
    return;
  }
  setState(interaction.guild!.id, interaction.user.id, { kind: "publish_pick_channel" });
  const row = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("mp_publish_ch")
      .setPlaceholder("Pick the channel to publish in")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setMinValues(1).setMaxValues(1),
  );
  await interaction.update({
    embeds: [new EmbedBuilder().setColor(0x5000ff).setDescription("📢 Pick the channel to publish the donation embed in.")],
    components: [
      row,
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("mp_back_to_panel").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
}

export async function handleMoneyPublishChannelSelect(interaction: ChannelSelectMenuInteraction): Promise<void> {
  const channelId = interaction.values[0];
  setState(interaction.guild!.id, interaction.user.id, { kind: "publish_pick_channel", channelId });
  await interaction.update({
    embeds: [new EmbedBuilder().setColor(0x5000ff).setDescription(`Publish to <#${channelId}>?\nThis will send a new message there.`)],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("mp_confirm_publish").setLabel("Publish").setEmoji("✅").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("mp_back_to_panel").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
}

export async function handleMoneyConfirmPublish(interaction: ButtonInteraction): Promise<void> {
  const st = getState(interaction.guild!.id, interaction.user.id);
  if (st.kind !== "publish_pick_channel" || !st.channelId) {
    await interaction.reply({ content: "❌ Pick a channel first.", ephemeral: true });
    return;
  }
  const channel = (await interaction.client.channels.fetch(st.channelId).catch(() => null)) as TextChannel | null;
  if (!channel) {
    await interaction.reply({ content: "❌ Couldn't access that channel.", ephemeral: true });
    return;
  }
  const rows = await getDonationEmbeds(interaction.guild!.id);
  const rendered = await renderDonationPost(rows, interaction.guild!);
  const sent = await channel.send({
    content: rendered.content || undefined,
    embeds: rendered.embeds,
    components: [buildDonateButtonRow()],
    allowedMentions: rendered.allowedMentions,
  });
  await setPublishedDonationMessage(interaction.guild!.id, channel.id, sent.id);
  setState(interaction.guild!.id, interaction.user.id, { kind: "idle" });
  await interaction.update({
    embeds: [new EmbedBuilder().setColor(0x00c851).setDescription(`✅ Published to <#${channel.id}>.`)],
    components: [],
  });
  setTimeout(() => { void openMoneyPanel(interaction as unknown as ButtonInteraction); }, 700);
}

// ─── Update posted ────────────────────────────────────────────────────────────
export async function handleMoneyEditPosted(interaction: ButtonInteraction): Promise<void> {
  const published = await getPublishedDonationMessage(interaction.guild!.id);
  if (!published) {
    await interaction.reply({ content: "❌ Nothing has been published yet — use **Publish** first.", ephemeral: true });
    return;
  }
  const channel = (await interaction.client.channels.fetch(published.channelId).catch(() => null)) as TextChannel | null;
  if (!channel) {
    await interaction.reply({ content: "❌ The channel where it was posted is gone. Re-publish.", ephemeral: true });
    return;
  }
  const msg = await channel.messages.fetch(published.messageId).catch(() => null);
  const rows = await getDonationEmbeds(interaction.guild!.id);
  const rendered = await renderDonationPost(rows, interaction.guild!);
  if (!msg) {
    const sent = await channel.send({
      content: rendered.content || undefined,
      embeds: rendered.embeds,
      components: [buildDonateButtonRow()],
      allowedMentions: rendered.allowedMentions,
    });
    await setPublishedDonationMessage(interaction.guild!.id, channel.id, sent.id);
    await interaction.reply({ content: `♻️ Original message was deleted — re-posted in <#${channel.id}>.`, ephemeral: true });
    return;
  }
  await msg.edit({
    content: rendered.content || null,
    embeds: rendered.embeds,
    components: [buildDonateButtonRow()],
    allowedMentions: rendered.allowedMentions,
  });
  await interaction.reply({ content: `🔁 Updated the posted message in <#${channel.id}>.`, ephemeral: true });
}

// ─── Back-to-panel helper ─────────────────────────────────────────────────────
export async function handleMoneyBackToPanel(interaction: ButtonInteraction): Promise<void> {
  setState(interaction.guild!.id, interaction.user.id, { kind: "idle" });
  await openMoneyPanel(interaction);
}
