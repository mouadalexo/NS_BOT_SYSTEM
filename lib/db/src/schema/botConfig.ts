import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const botConfigTable = pgTable("bot_config", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull().unique(),
  systemRoleId: text("system_role_id"),
  jailRoleId: text("jail_role_id"),
  gameManagerRoleId: text("game_manager_role_id"),
  assistanceCategoryId: text("assistance_category_id"),
  pvsCategoryId: text("pvs_category_id"),
  pvsCreateChannelId: text("pvs_create_channel_id"),
  pvsManagerRoleId: text("pvs_manager_role_id"),
  pvsWaitingRoomChannelId: text("pvs_waiting_room_channel_id"),
  staffRoleId: text("staff_role_id"),
  announcementsRoleId: text("announcements_role_id"),
  announcementChannelsJson: text("announcement_channels_json"),
  panelEmbedTitle: text("panel_embed_title"),
  panelEmbedDescription: text("panel_embed_description"),
  pvsPrefix: text("pvs_prefix").default("="),
  managerPrefix: text("manager_prefix").default("+"),
  ctpPrefix: text("ctp_prefix").default("-"),
  annPrefix: text("ann_prefix").default("!"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type BotConfig = typeof botConfigTable.$inferSelect;
export type InsertBotConfig = typeof botConfigTable.$inferInsert;
