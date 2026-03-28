import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const botConfigTable = pgTable("bot_config", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull().unique(),
  unverifiedRoleId: text("unverified_role_id"),
  verifiedRoleId: text("verified_role_id"),
  jailRoleId: text("jail_role_id"),
  verificatorsRoleId: text("verificators_role_id"),
  gameManagerRoleId: text("game_manager_role_id"),
  verificationLogsChannelId: text("verification_logs_channel_id"),
  verificationCategoryId: text("verification_category_id"),
  assistanceCategoryId: text("assistance_category_id"),
  pvsCategoryId: text("pvs_category_id"),
  pvsCreateChannelId: text("pvs_create_channel_id"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type BotConfig = typeof botConfigTable.$inferSelect;
export type InsertBotConfig = typeof botConfigTable.$inferInsert;
