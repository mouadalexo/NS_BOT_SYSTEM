import {
  Client,
  TextChannel,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ButtonInteraction,
  Guild,
  Message,
  MessageMentionOptions,
} from "discord.js";
import { resolveTags, resolveEmojiCodes } from "../announcements/index.js";
import { pool } from "@workspace/db";

const EMOJI_LOVE   = "<:love:1335194187934597170>";
const EMOJI_NSLOGO = "<a:nslogo:1469099919666188542>";
const EMOJI_VIP    = "<a:vip:1213138769348395058>";
const BRAND_PURPLE = 0x5000ff;
const SESSION_TIMEOUT_MS = 60_000;

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
    alter table money_config add column if not exists button_mode text default 'dm';
    alter table money_config add column if not exists button_link text;

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
  buttonMode: "dm" | "link";
  buttonLink: string | null;
};

type Lang = "en" | "ar" | "fr";

interface DonationDmState {
  guildId: string;
  userId: string;
  username: string;
  step: "lang" | "confirm" | "tier" | "payment" | "done";
  lang?: Lang;
  tierId?: number;
  tierName?: string;
  tierPrice?: string;
  tierColor?: number;
  paymentMethod?: "paypal" | "cih" | "spanish";
  dmMessageIds: string[];
  timeoutHandle?: NodeJS.Timeout;
}

const donationDmState = new Map<string, DonationDmState>();

// ─── Translations ─────────────────────────────────────────────────────────────
const LANG: Record<Lang, {
  pickLangTitle: string; pickLangDesc: string;
  confirmTitle: string; confirmDesc: string;
  yes: string; no: string;
  cancelled: string; great: string;
  tierTitle: string; tierDesc: string;
  tierSelected: (n: string, p: string) => string;
  payTitle: string; payDesc: string; sendingPayment: string;
  paypalTitle: string; paypalDesc: string;
  cihTitle: string; cihDesc: string;
  spanishTitle: string; spanishDesc: string;
  descPrompt: string;
  thankTitle: string; thankDesc: string;
  sessionExpired: string; timeout: string;
  noTiersTitle: string; noTiers: string;
  noPayTitle: string; noPay: string;
  notAvail: string;
}> = {
  en: {
    pickLangTitle: `${EMOJI_LOVE} Welcome — choose your language`,
    pickLangDesc: "Please pick your language to continue:",
    confirmTitle: `${EMOJI_LOVE} Confirm Your Donation`,
    confirmDesc: "Are you sure you want to **donate to Night Stars server**?\n\nYour support keeps the community alive — thank you for considering it.",
    yes: "Yes, donate", no: "No, cancel",
    cancelled: "Donation cancelled. You can come back anytime — thank you for considering it!",
    great: "Great! Let's continue.",
    tierTitle: "🎁 Choose Your Tier", tierDesc: "Which tier would you like to purchase?",
    tierSelected: (n, p) => `Tier selected: **${n}**${p ? ` (${p})` : ""}`,
    payTitle: "💳 Choose Payment Method", payDesc: "Which payment method would you like to use?",
    sendingPayment: "Sending you the payment details…",
    paypalTitle: "💳 PayPal", paypalDesc: "Click the link below to pay:",
    cihTitle: "🏦 CIH Bank — RIB", cihDesc: "Long-press (mobile) or double-click (desktop) the message below to copy:",
    spanishTitle: "🏦 Spanish Bank Transfer — IBAN", spanishDesc: "Long-press (mobile) or double-click (desktop) the message below to copy:",
    descPrompt: "📋 **Copy & paste this in your Payment description:**",
    thankTitle: `${EMOJI_NSLOGO} Thank You!`,
    thankDesc: `Once we receive your donation, all your **tier features** will be unlocked for you.\n\nWe truly appreciate your support — see you in the server! ${EMOJI_LOVE}`,
    sessionExpired: "❌ Session expired. Please click **Donate** again on the server.",
    timeout: "⏰ Session timed out — your donation request was cancelled. You can start again anytime from the server.",
    noTiersTitle: "⚠️ No Tiers Configured",
    noTiers: "An admin hasn't set up any donation tiers yet.\nPlease contact the staff and try again later.",
    noPayTitle: "⚠️ No Payment Methods",
    noPay: "No payment methods are configured. Please contact the staff.",
    notAvail: "⚠️ Payment info not available. Please contact the staff.",
  },
  ar: {
    pickLangTitle: `${EMOJI_LOVE} أهلاً — اختر لغتك`,
    pickLangDesc: "من فضلك اختر لغتك للمتابعة:",
    confirmTitle: `${EMOJI_LOVE} تأكيد التبرع`,
    confirmDesc: "هل أنت متأكد أنك تريد **التبرع لسيرفر Night Stars**؟\n\nدعمك هو ما يحافظ على المجتمع — شكراً لك على التفكير في الأمر.",
    yes: "نعم، تبرّع", no: "لا، إلغاء",
    cancelled: "تم إلغاء التبرع. يمكنك العودة في أي وقت — شكراً لتفكيرك في الأمر!",
    great: "ممتاز! لنكمل.",
    tierTitle: "🎁 اختر باقتك", tierDesc: "ما الباقة التي تريد شراءها؟",
    tierSelected: (n, p) => `تم اختيار الباقة: **${n}**${p ? ` (${p})` : ""}`,
    payTitle: "💳 اختر طريقة الدفع", payDesc: "ما طريقة الدفع التي تريد استخدامها؟",
    sendingPayment: "جاري إرسال تفاصيل الدفع إليك…",
    paypalTitle: "💳 PayPal", paypalDesc: "انقر على الرابط أدناه للدفع:",
    cihTitle: "🏦 بنك CIH — RIB", cihDesc: "اضغط مطولاً (هاتف) أو انقر مرتين (حاسوب) على الرسالة أدناه للنسخ:",
    spanishTitle: "🏦 تحويل بنكي إسباني — IBAN", spanishDesc: "اضغط مطولاً (هاتف) أو انقر مرتين (حاسوب) على الرسالة أدناه للنسخ:",
    descPrompt: "📋 **انسخ والصق هذا في وصف الدفع:**",
    thankTitle: `${EMOJI_NSLOGO} شكراً لك!`,
    thankDesc: `بمجرد استلامنا لتبرعك، سيتم فتح جميع **مميزات الباقة** الخاصة بك.\n\nنشكرك بصدق على دعمك — نراك في السيرفر! ${EMOJI_LOVE}`,
    sessionExpired: "❌ انتهت الجلسة. يرجى النقر على **Donate** مرة أخرى في السيرفر.",
    timeout: "⏰ انتهت مهلة الجلسة — تم إلغاء طلب التبرع. يمكنك البدء من جديد في أي وقت من السيرفر.",
    noTiersTitle: "⚠️ لا توجد باقات",
    noTiers: "لم يقم المسؤول بإعداد أي باقات تبرع بعد.\nيرجى التواصل مع الإدارة والمحاولة لاحقاً.",
    noPayTitle: "⚠️ لا توجد طرق دفع",
    noPay: "لم يتم إعداد أي طرق دفع. يرجى التواصل مع الإدارة.",
    notAvail: "⚠️ معلومات الدفع غير متوفرة. يرجى التواصل مع الإدارة.",
  },
  fr: {
    pickLangTitle: `${EMOJI_LOVE} Bienvenue — choisissez votre langue`,
    pickLangDesc: "Veuillez choisir votre langue pour continuer :",
    confirmTitle: `${EMOJI_LOVE} Confirmer Votre Don`,
    confirmDesc: "Êtes-vous sûr de vouloir **faire un don au serveur Night Stars** ?\n\nVotre soutien fait vivre la communauté — merci d'y penser.",
    yes: "Oui, faire un don", no: "Non, annuler",
    cancelled: "Don annulé. Vous pouvez revenir à tout moment — merci d'y avoir pensé !",
    great: "Parfait ! Continuons.",
    tierTitle: "🎁 Choisissez Votre Niveau", tierDesc: "Quel niveau souhaitez-vous acheter ?",
    tierSelected: (n, p) => `Niveau sélectionné : **${n}**${p ? ` (${p})` : ""}`,
    payTitle: "💳 Choisissez le Mode de Paiement", payDesc: "Quel mode de paiement souhaitez-vous utiliser ?",
    sendingPayment: "Envoi des détails de paiement…",
    paypalTitle: "💳 PayPal", paypalDesc: "Cliquez sur le lien ci-dessous pour payer :",
    cihTitle: "🏦 Banque CIH — RIB", cihDesc: "Appuyez longuement (mobile) ou double-cliquez (PC) sur le message ci-dessous pour copier :",
    spanishTitle: "🏦 Virement Bancaire Espagnol — IBAN", spanishDesc: "Appuyez longuement (mobile) ou double-cliquez (PC) sur le message ci-dessous pour copier :",
    descPrompt: "📋 **Copiez et collez ceci dans la description du paiement :**",
    thankTitle: `${EMOJI_NSLOGO} Merci !`,
    thankDesc: `Dès que nous recevons votre don, toutes les **fonctionnalités de votre niveau** seront débloquées.\n\nNous apprécions sincèrement votre soutien — à bientôt sur le serveur ! ${EMOJI_LOVE}`,
    sessionExpired: "❌ Session expirée. Veuillez cliquer à nouveau sur **Donate** sur le serveur.",
    timeout: "⏰ Session expirée — votre demande de don a été annulée. Vous pouvez recommencer à tout moment depuis le serveur.",
    noTiersTitle: "⚠️ Aucun Niveau Configuré",
    noTiers: "Aucun niveau de don n'est configuré.\nVeuillez contacter le staff et réessayer plus tard.",
    noPayTitle: "⚠️ Aucun Moyen de Paiement",
    noPay: "Aucun moyen de paiement n'est configuré. Veuillez contacter le staff.",
    notAvail: "⚠️ Informations de paiement non disponibles. Veuillez contacter le staff.",
  },
};

// ─── DB helpers ───────────────────────────────────────────────────────────────
export async function getDonationConfig(guildId: string): Promise<DonationConfig> {
  const r = await pool.query(
    "SELECT paypal_link, cih_rib, spanish_iban, donation_logs_channel_id, button_mode, button_link FROM money_config WHERE guild_id=$1",
    [guildId],
  );
  if (!r.rowCount) return { paypalLink: null, cihRib: null, spanishIban: null, donationLogsChannelId: null, buttonMode: "dm", buttonLink: null };
  const row = r.rows[0];
  return {
    paypalLink: row.paypal_link,
    cihRib: row.cih_rib,
    spanishIban: row.spanish_iban,
    donationLogsChannelId: row.donation_logs_channel_id,
    buttonMode: (row.button_mode === "link" ? "link" : "dm") as "dm" | "link",
    buttonLink: row.button_link ?? null,
  };
}

export async function getDonationTiers(guildId: string): Promise<DonationTier[]> {
  const r = await pool.query(
    "SELECT id, name, price, sort_order FROM donation_tiers WHERE guild_id = $1 ORDER BY sort_order, id",
    [guildId],
  );
  return r.rows.map((x: any) => ({ id: x.id, name: x.name, price: x.price, sortOrder: x.sort_order }));
}

export async function getDonationEmbeds(guildId: string): Promise<DonationEmbedRow[]> {
  const r = await pool.query(
    "SELECT id, slot, color, description, image_url, thumbnail_url FROM donation_embeds WHERE guild_id = $1 ORDER BY slot, id",
    [guildId],
  );
  return r.rows.map((x: any) => ({
    id: x.id,
    slot: x.slot,
    color: x.color,
    description: x.description,
    imageUrl: x.image_url,
    thumbnailUrl: x.thumbnail_url,
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

// ─── Bigtext fix: turn `#text`/`##text`/`###text` into `# text`/etc. ──────────
function normalizeHeadings(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const m = line.match(/^(\s*)(#{1,3})(?!\s|#)(\S.*)$/);
      if (!m) return line;
      return `${m[1]}${m[2]} ${m[3]}`;
    })
    .join("\n");
}

// ─── Public donation post (in the channel) ────────────────────────────────────
export function buildDonationPostEmbeds(rows: DonationEmbedRow[]): EmbedBuilder[] {
  if (rows.length === 0) {
    return [
      new EmbedBuilder()
        .setColor(BRAND_PURPLE)
        .setTitle(`${EMOJI_LOVE} Donations`)
        .setDescription("No donation embeds are configured yet. Use the panel to set them up."),
    ];
  }
  return rows.map((r) => {
    const color = parseInt((r.color || "5000FF").replace(/^#/, ""), 16) || BRAND_PURPLE;
    const e = new EmbedBuilder().setColor(color);
    if (r.description.trim()) e.setDescription(normalizeHeadings(r.description));
    if (r.imageUrl)     e.setImage(r.imageUrl);
    if (r.thumbnailUrl) e.setThumbnail(r.thumbnailUrl);
    return e;
  });
}

export function buildDonateButtonRow(mode: "dm" | "link" = "dm", linkUrl?: string | null): ActionRowBuilder<ButtonBuilder> {
  if (mode === "link" && linkUrl) {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel("Donate")
        .setEmoji({ id: "1213138769348395058", name: "vip", animated: true })
        .setStyle(ButtonStyle.Link)
        .setURL(linkUrl),
    );
  }
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("dn_donate")
      .setLabel("Donate")
      .setEmoji({ id: "1213138769348395058", name: "vip", animated: true })
      .setStyle(ButtonStyle.Primary),
  );
}

// ─── Resolve =ann-style tags/emojis in donation embed text and emit a ping ───
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
        desc = normalizeHeadings(desc);
      }
      return { ...r, description: desc };
    }),
  );

  return {
    embeds: buildDonationPostEmbeds(resolvedRows),
    content: "",
    allowedMentions: { parse: [] },
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

// ─── DM session helpers (cleanup / timeout) ──────────────────────────────────
async function deleteAllStepMessages(channel: TextChannel, state: DonationDmState): Promise<void> {
  const ids = state.dmMessageIds.splice(0);
  for (const id of ids) {
    await channel.messages.delete(id).catch(() => {});
  }
}

function clearTimer(state: DonationDmState): void {
  if (state.timeoutHandle) {
    clearTimeout(state.timeoutHandle);
    state.timeoutHandle = undefined;
  }
}

function armSessionTimeout(channel: TextChannel, state: DonationDmState): void {
  clearTimer(state);
  state.timeoutHandle = setTimeout(async () => {
    if (state.step === "done") return;
    const lang = state.lang ?? "en";
    await deleteAllStepMessages(channel, state);
    const notice = await channel
      .send({ embeds: [new EmbedBuilder().setColor(0x9aa0a6).setDescription(LANG[lang].timeout)] })
      .catch(() => null);
    if (notice) {
      setTimeout(() => notice.delete().catch(() => {}), 15_000);
    }
    donationDmState.delete(state.userId);
  }, SESSION_TIMEOUT_MS);
}

async function sendStep(
  channel: TextChannel,
  state: DonationDmState,
  payload: Parameters<TextChannel["send"]>[0],
): Promise<void> {
  await deleteAllStepMessages(channel, state);
  const sent = await channel.send(payload).catch(() => null);
  if (sent) state.dmMessageIds.push(sent.id);
  armSessionTimeout(channel, state);
}

// ─── Tier color mapping (by tier sort index → embed slot) ────────────────────
async function getTierColorByIndex(guildId: string, tierIndex: number): Promise<number> {
  const embeds = await getDonationEmbeds(guildId);
  if (!embeds.length) return BRAND_PURPLE;
  const target = embeds[tierIndex] ?? embeds[0];
  const parsed = parseInt((target.color || "5000FF").replace(/^#/, ""), 16);
  return Number.isFinite(parsed) ? parsed : BRAND_PURPLE;
}

// ─── DM step builders ────────────────────────────────────────────────────────
function buildLangPickerMessage() {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(BRAND_PURPLE)
        .setTitle(`${EMOJI_LOVE} Welcome — choose your language`)
        .setDescription(
          "🇬🇧 **English** — Please pick your language to continue.\n" +
          "🇸🇦 **العربية** — من فضلك اختر لغتك للمتابعة.\n" +
          "🇫🇷 **Français** — Veuillez choisir votre langue pour continuer.",
        )
        .setFooter({ text: "Night Stars • Donations" }),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("dn_lang:en").setLabel("English").setEmoji("🇬🇧").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("dn_lang:ar").setLabel("العربية").setEmoji("🇸🇦").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("dn_lang:fr").setLabel("Français").setEmoji("🇫🇷").setStyle(ButtonStyle.Primary),
      ),
    ],
  };
}

function buildConfirmMessage(lang: Lang, color: number) {
  const t = LANG[lang];
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(color)
        .setTitle(t.confirmTitle)
        .setDescription(t.confirmDesc)
        .setFooter({ text: "Night Stars • Donations" }),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("dn_yes").setLabel(t.yes).setEmoji("✅").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("dn_no").setLabel(t.no).setEmoji("✖").setStyle(ButtonStyle.Danger),
      ),
    ],
  };
}

async function buildTierMessage(guildId: string, lang: Lang, color: number) {
  const t = LANG[lang];
  const tiers = await getDonationTiers(guildId);
  if (!tiers.length) {
    return {
      embeds: [
        new EmbedBuilder()
          .setColor(0xff4d4d)
          .setTitle(t.noTiersTitle)
          .setDescription(t.noTiers)
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
    const tier = tiers[i];
    const label = tier.price ? `${tier.name} — ${tier.price}` : tier.name;
    cur.addComponents(
      new ButtonBuilder()
        .setCustomId(`dn_tier:${tier.id}`)
        .setLabel(label.slice(0, 80))
        .setStyle(ButtonStyle.Primary),
    );
  }
  if (cur.components.length > 0) rows.push(cur);
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(color)
        .setTitle(t.tierTitle)
        .setDescription(t.tierDesc)
        .setFooter({ text: "Night Stars • Donations" }),
    ],
    components: rows,
  };
}

async function buildPaymentMessage(guildId: string, lang: Lang, color: number) {
  const t = LANG[lang];
  const cfg = await getDonationConfig(guildId);
  const buttons: ButtonBuilder[] = [];
  if (cfg.paypalLink) {
    buttons.push(new ButtonBuilder().setCustomId("dn_pay:paypal").setLabel("PayPal").setEmoji("💳").setStyle(ButtonStyle.Primary));
  }
  if (cfg.cihRib) {
    buttons.push(new ButtonBuilder().setCustomId("dn_pay:cih").setLabel("CIH Bank").setEmoji("🏦").setStyle(ButtonStyle.Primary));
  }
  if (cfg.spanishIban) {
    buttons.push(new ButtonBuilder().setCustomId("dn_pay:spanish").setLabel("Spanish Bank Transfer").setEmoji("🏦").setStyle(ButtonStyle.Primary));
  }
  if (!buttons.length) {
    return {
      embeds: [
        new EmbedBuilder()
          .setColor(0xff4d4d)
          .setTitle(t.noPayTitle)
          .setDescription(t.noPay)
          .setFooter({ text: "Night Stars • Donations" }),
      ],
      components: [],
    };
  }
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(color)
        .setTitle(t.payTitle)
        .setDescription(t.payDesc)
        .setFooter({ text: "Night Stars • Donations" }),
    ],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons)],
  };
}

function formatPaymentDescription(state: DonationDmState): string {
  const date = new Date().toISOString().slice(0, 10);
  return `${state.username} - ${state.tierName ?? "Tier"} - ${date}`;
}

// ─── Final delivery (these messages are kept; not deleted on next step) ──────
async function deliverPaymentInfo(
  client: Client,
  state: DonationDmState,
  channel: TextChannel,
  method: "paypal" | "cih" | "spanish",
): Promise<void> {
  const cfg = await getDonationConfig(state.guildId);
  const lang = state.lang ?? "en";
  const t = LANG[lang];
  const color = state.tierColor ?? BRAND_PURPLE;

  // Header embed for the chosen method
  if (method === "paypal" && cfg.paypalLink) {
    const url = cfg.paypalLink.startsWith("http") ? cfg.paypalLink : `https://${cfg.paypalLink}`;
    await channel.send({
      embeds: [new EmbedBuilder().setColor(color).setTitle(t.paypalTitle).setDescription(t.paypalDesc).setFooter({ text: "Night Stars • Donations" })],
    }).catch(() => {});
    // Plain url — auto-linkifies, clickable, easy to copy
    await channel.send({ content: url, allowedMentions: { parse: [] } }).catch(() => {});
  } else if (method === "cih" && cfg.cihRib) {
    await channel.send({
      embeds: [new EmbedBuilder().setColor(color).setTitle(t.cihTitle).setDescription(t.cihDesc).setFooter({ text: "Night Stars • Donations" })],
    }).catch(() => {});
    // Plain message — value alone, easy long-press → Copy on mobile, double-click on desktop
    await channel.send({ content: cfg.cihRib, allowedMentions: { parse: [] } }).catch(() => {});
  } else if (method === "spanish" && cfg.spanishIban) {
    await channel.send({
      embeds: [new EmbedBuilder().setColor(color).setTitle(t.spanishTitle).setDescription(t.spanishDesc).setFooter({ text: "Night Stars • Donations" })],
    }).catch(() => {});
    await channel.send({ content: cfg.spanishIban, allowedMentions: { parse: [] } }).catch(() => {});
  } else {
    await channel.send({
      embeds: [new EmbedBuilder().setColor(0xff4d4d).setDescription(t.notAvail)],
    }).catch(() => {});
  }

  // Payment description prompt
  await channel.send({
    embeds: [new EmbedBuilder().setColor(color).setDescription(t.descPrompt).setFooter({ text: "Night Stars • Donations" })],
  }).catch(() => {});

  // Plain message with the description — easy to copy
  const desc = formatPaymentDescription(state);
  await channel.send({ content: desc, allowedMentions: { parse: [] } }).catch(() => {});

  // Thank you (uses nslogo + love emojis)
  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(color)
        .setTitle(t.thankTitle)
        .setDescription(t.thankDesc)
        .setFooter({ text: "Night Stars • Donations" }),
    ],
  }).catch(() => {});

  // Logs — completion
  await logToDonationChannel(
    client,
    state.guildId,
    new EmbedBuilder()
      .setColor(0x00c851)
      .setTitle(`${EMOJI_LOVE} Donation Request Completed`)
      .addFields(
        { name: "Member",  value: `<@${state.userId}>\n\`${state.username}\` (${state.userId})`, inline: true },
        { name: "Tier",    value: state.tierName ?? "—",                                          inline: true },
        { name: "Method",  value: method === "paypal" ? "PayPal" : method === "cih" ? "CIH Bank" : "Spanish Bank Transfer", inline: true },
        { name: "Lang",    value: lang.toUpperCase(),                                             inline: true },
        { name: "Payment Description", value: "```\n" + desc + "\n```",                          inline: false },
      )
      .setTimestamp()
      .setFooter({ text: "Night Stars • Donations" }),
  );

  state.step = "done";
  clearTimer(state);
  donationDmState.delete(state.userId);
}

// ─── Entry point: called when member clicks the Donate button ─────────────────
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

  const state: DonationDmState = {
    guildId, userId, username,
    step: "lang",
    dmMessageIds: [],
  };
  donationDmState.set(userId, state);

  await sendStep(dm as unknown as TextChannel, state, buildLangPickerMessage());

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

    // Language pick
    if (customId.startsWith("dn_lang:")) {
      if (!state || state.step !== "lang") {
        await interaction.reply({ content: LANG.en.sessionExpired, ephemeral: true }).catch(() => {});
        return;
      }
      const lang = customId.split(":")[1] as Lang;
      if (!["en", "ar", "fr"].includes(lang)) return;
      state.lang = lang;
      state.step = "confirm";
      await interaction.deferUpdate().catch(() => {});
      await sendStep(channel, state, buildConfirmMessage(lang, BRAND_PURPLE));
      return;
    }

    // Yes / No on confirm
    if (customId === "dn_yes") {
      if (!state || state.step !== "confirm") {
        await interaction.reply({ content: LANG[state?.lang ?? "en"].sessionExpired, ephemeral: true }).catch(() => {});
        return;
      }
      const lang = state.lang ?? "en";
      state.step = "tier";
      donationDmState.set(userId, state);
      await interaction.deferUpdate().catch(() => {});
      await sendStep(channel, state, await buildTierMessage(state.guildId, lang, BRAND_PURPLE));

      await logToDonationChannel(
        client,
        state.guildId,
        new EmbedBuilder()
          .setColor(0xffaa00)
          .setTitle("📥 New Donation Started")
          .setDescription(`<@${state.userId}> (\`${state.username}\`) confirmed they want to donate. Lang: **${lang.toUpperCase()}**`)
          .setTimestamp()
          .setFooter({ text: "Night Stars • Donations" }),
      );
      return;
    }

    if (customId === "dn_no") {
      const lang = state?.lang ?? "en";
      if (state) {
        clearTimer(state);
        await deleteAllStepMessages(channel, state);
        donationDmState.delete(userId);
      }
      await interaction.deferUpdate().catch(() => {});
      const notice = await channel
        .send({ embeds: [new EmbedBuilder().setColor(0x9aa0a6).setDescription(`❎ ${LANG[lang].cancelled}`)] })
        .catch(() => null);
      if (notice) setTimeout(() => notice.delete().catch(() => {}), 12_000);
      return;
    }

    // Tier choice
    if (customId.startsWith("dn_tier:")) {
      if (!state || state.step !== "tier") {
        await interaction.reply({ content: LANG[state?.lang ?? "en"].sessionExpired, ephemeral: true }).catch(() => {});
        return;
      }
      const lang = state.lang ?? "en";
      const tierId = parseInt(customId.split(":")[1], 10);
      const tiers = await getDonationTiers(state.guildId);
      const tierIdx = tiers.findIndex((x) => x.id === tierId);
      const tier = tiers[tierIdx];
      if (!tier) {
        await interaction.reply({ content: "❌ That tier no longer exists.", ephemeral: true }).catch(() => {});
        return;
      }
      state.tierId = tier.id;
      state.tierName = tier.name;
      state.tierPrice = tier.price;
      state.tierColor = await getTierColorByIndex(state.guildId, tierIdx);
      state.step = "payment";
      donationDmState.set(userId, state);
      await interaction.deferUpdate().catch(() => {});
      await sendStep(channel, state, await buildPaymentMessage(state.guildId, lang, state.tierColor));
      return;
    }

    // Payment method
    if (customId.startsWith("dn_pay:")) {
      if (!state || state.step !== "payment") {
        await interaction.reply({ content: LANG[state?.lang ?? "en"].sessionExpired, ephemeral: true }).catch(() => {});
        return;
      }
      const method = customId.split(":")[1] as "paypal" | "cih" | "spanish";
      state.paymentMethod = method;
      donationDmState.set(userId, state);
      await interaction.deferUpdate().catch(() => {});
      // Clean up the prior step (the "Choose payment method" embed) before delivering details
      await deleteAllStepMessages(channel, state);
      clearTimer(state);
      await deliverPaymentInfo(client, state, channel, method);
      return;
    }
  });
}

// silence unused import warnings if any
export type { Message };
