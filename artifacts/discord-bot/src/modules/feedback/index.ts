import {
  Client,
  TextChannel,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { pool } from "@workspace/db";

// ─── Schema ───────────────────────────────────────────────────────────────────
export async function ensureFeedbackSchema(): Promise<void> {
  await pool.query(`
    create table if not exists feedback_config (
      guild_id text primary key,
      staff_channel_id text
    );
    create table if not exists feedback_cooldowns (
      guild_id text not null,
      user_id text not null,
      submitted_at timestamp default now(),
      primary key (guild_id, user_id)
    );
  `);
}

// ─── Types ────────────────────────────────────────────────────────────────────
type Lang = "en" | "ar" | "fr";

interface FeedbackDmState {
  guildId: string;
  userId: string;
  lang: Lang;
  rating: number | null;
  like: string | null;
  dislike: string | null;
  suggestion: string | null;
  step: "language" | "rating" | "like" | "dislike" | "suggestion" | "done";
}

export const feedbackDmState = new Map<string, FeedbackDmState>();

// ─── Translations ─────────────────────────────────────────────────────────────
const T: Record<Lang, Record<string, string>> = {
  en: {
    ratingPrompt:     "How satisfied are you with Night Stars? Rate from 1 to 10 ⭐",
    likePrompt:       "What do you like about the server? 😊",
    dislikePrompt:    "What do you dislike about the server? 😕",
    suggestionPrompt: "Do you have any suggestions for improving the server? 💡",
    thankYou:         "Thank you for your feedback! 💙\nWe will review this information anonymously.\nYour opinion helps us improve Night Stars! ⭐",
    cooldown:         "You can only submit feedback once every 7 days. Please try again later! ⏳",
    alreadyActive:    "You already have an active feedback session. Check your DMs! 📩",
  },
  ar: {
    ratingPrompt:     "كم تقييمك لـ Night Stars من 1 إلى 10 ⭐",
    likePrompt:       "ما الذي يعجبك في السيرفر؟ 😊",
    dislikePrompt:    "ما الذي لا يعجبك في السيرفر؟ 😕",
    suggestionPrompt: "هل لديك اقتراحات لتحسين السيرفر؟ 💡",
    thankYou:         "شكراً على ملاحظاتك! 💙\nسنراجع هذه المعلومات بشكل مجهول.\nرأيك يساعدنا في تحسين Night Stars! ⭐",
    cooldown:         "يمكنك تقديم ملاحظات مرة واحدة كل 7 أيام. حاول لاحقاً! ⏳",
    alreadyActive:    "لديك جلسة نشطة بالفعل. تحقق من رسائلك الخاصة! 📩",
  },
  fr: {
    ratingPrompt:     "Quelle est votre satisfaction envers Night Stars? Notez de 1 à 10 ⭐",
    likePrompt:       "Qu'est-ce que vous aimez sur le serveur? 😊",
    dislikePrompt:    "Qu'est-ce que vous n'aimez pas sur le serveur? 😕",
    suggestionPrompt: "Avez-vous des suggestions pour améliorer le serveur? 💡",
    thankYou:         "Merci pour votre avis! 💙\nNous examinerons ces informations de manière anonyme.\nVotre opinion nous aide à améliorer Night Stars! ⭐",
    cooldown:         "Vous ne pouvez soumettre des commentaires qu'une fois tous les 7 jours. Réessayez plus tard! ⏳",
    alreadyActive:    "Vous avez déjà une session active. Vérifiez vos DMs! 📩",
  },
};

// ─── DB Helpers ───────────────────────────────────────────────────────────────
export async function getFeedbackConfig(guildId: string): Promise<{ staffChannelId: string | null }> {
  const res = await pool.query<{ staff_channel_id: string | null }>(
    "SELECT staff_channel_id FROM feedback_config WHERE guild_id = $1",
    [guildId]
  );
  return { staffChannelId: res.rows[0]?.staff_channel_id ?? null };
}

async function checkCooldown(guildId: string, userId: string): Promise<boolean> {
  const res = await pool.query<{ submitted_at: Date }>(
    "SELECT submitted_at FROM feedback_cooldowns WHERE guild_id = $1 AND user_id = $2",
    [guildId, userId]
  );
  if (!res.rows[0]) return false;
  const diff = Date.now() - res.rows[0].submitted_at.getTime();
  return diff < 7 * 24 * 60 * 60 * 1000;
}

async function recordCooldown(guildId: string, userId: string): Promise<void> {
  await pool.query(
    `INSERT INTO feedback_cooldowns (guild_id, user_id, submitted_at) VALUES ($1, $2, now())
     ON CONFLICT (guild_id, user_id) DO UPDATE SET submitted_at = now()`,
    [guildId, userId]
  );
}

async function reportToStaff(client: Client, state: FeedbackDmState): Promise<void> {
  const cfg = await getFeedbackConfig(state.guildId);
  if (!cfg.staffChannelId) return;
  const ch = await client.channels.fetch(cfg.staffChannelId).catch(() => null) as TextChannel | null;
  if (!ch) return;
  const stars = state.rating ? "⭐".repeat(state.rating) + ` (${state.rating}/10)` : "N/A";
  const embed = new EmbedBuilder()
    .setColor(0xff005c)
    .setTitle("📝 Anonymous Feedback")
    .addFields(
      { name: "⭐ Satisfaction",  value: stars,                    inline: false },
      { name: "😊 What they liked",     value: state.like       || "—", inline: false },
      { name: "😕 What they disliked",  value: state.dislike    || "—", inline: false },
      { name: "💡 Suggestions",         value: state.suggestion || "—", inline: false },
    )
    .setTimestamp()
    .setFooter({ text: "Night Stars • Feedback System — Anonymous" });
  await ch.send({ embeds: [embed] }).catch(() => {});
}

// ─── DM Helpers ───────────────────────────────────────────────────────────────
function buildLangRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("ff_lang:en").setLabel("🇬🇧 English").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("ff_lang:ar").setLabel("🇲🇦 العربية").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("ff_lang:fr").setLabel("🇫🇷 Français").setStyle(ButtonStyle.Primary),
  );
}

function buildRatingRow(): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...[1, 2, 3, 4, 5].map((n) =>
      new ButtonBuilder().setCustomId(`ff_rate:${n}`).setLabel(`${n}`).setStyle(ButtonStyle.Secondary)
    )
  );
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...[6, 7, 8, 9, 10].map((n) =>
      new ButtonBuilder().setCustomId(`ff_rate:${n}`).setLabel(`${n}`).setStyle(ButtonStyle.Secondary)
    )
  );
  return [row1, row2];
}

// ─── Module Registration ──────────────────────────────────────────────────────
export function registerFeedbackModule(client: Client): void {
  // Free-text answers via DM messages
  client.on("messageCreate", async (message) => {
    if (message.author.bot || message.guild) return;
    const state = feedbackDmState.get(message.author.id);
    if (!state) return;
    const text = message.content.trim();
    if (!text) return;

    if (state.step === "like") {
      state.like = text;
      state.step = "dislike";
      feedbackDmState.set(message.author.id, state);
      await message.channel.send({ content: T[state.lang].dislikePrompt });
      return;
    }

    if (state.step === "dislike") {
      state.dislike = text;
      state.step = "suggestion";
      feedbackDmState.set(message.author.id, state);
      await message.channel.send({ content: T[state.lang].suggestionPrompt });
      return;
    }

    if (state.step === "suggestion") {
      state.suggestion = text;
      state.step = "done";
      feedbackDmState.delete(message.author.id);
      await message.channel.send({ content: T[state.lang].thankYou });
      await recordCooldown(state.guildId, state.userId);
      await reportToStaff(client, state);
      return;
    }
  });

  // DM button interactions
  client.on("interactionCreate", async (interaction) => {
    if (interaction.guild || !interaction.isButton()) return;
    const { customId, user } = interaction;
    if (!customId.startsWith("ff_")) return;

    if (customId.startsWith("ff_lang:")) {
      const lang = customId.split(":")[1] as Lang;
      const state = feedbackDmState.get(user.id);
      if (!state) { await interaction.reply({ content: "❌ Session expired. Please click the Feedback button again.", ephemeral: true }); return; }
      state.lang = lang;
      state.step = "rating";
      feedbackDmState.set(user.id, state);
      await interaction.deferUpdate().catch(() => {});
      await interaction.channel!.send({ content: T[lang].ratingPrompt, components: buildRatingRow() });
      return;
    }

    if (customId.startsWith("ff_rate:")) {
      const rating = parseInt(customId.split(":")[1]);
      const state = feedbackDmState.get(user.id);
      if (!state) { await interaction.reply({ content: "❌ Session expired.", ephemeral: true }); return; }
      state.rating = rating;
      state.step = "like";
      feedbackDmState.set(user.id, state);
      await interaction.deferUpdate().catch(() => {});
      await interaction.channel!.send({ content: T[state.lang].likePrompt });
      return;
    }
  });
}

// ─── Start DM Session ─────────────────────────────────────────────────────────
export async function startFeedbackDmSession(client: Client, userId: string, guildId: string): Promise<"ok" | "cooldown" | "already_active" | "dm_failed"> {
  const onCooldown = await checkCooldown(guildId, userId);
  if (onCooldown) return "cooldown";
  const existing = feedbackDmState.get(userId);
  if (existing && existing.step !== "done") return "already_active";
  const user = await client.users.fetch(userId).catch(() => null);
  if (!user) return "dm_failed";
  const dm = await user.createDM().catch(() => null);
  if (!dm) return "dm_failed";
  const state: FeedbackDmState = { guildId, userId, lang: "en", rating: null, like: null, dislike: null, suggestion: null, step: "language" };
  feedbackDmState.set(userId, state);
  await dm.send({ content: "🌐 Choose your language / اختر لغتك / Choisissez votre langue", components: [buildLangRow()] });
  return "ok";
}
