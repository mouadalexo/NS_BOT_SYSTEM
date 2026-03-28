import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const ctpCategoriesTable = pgTable("ctp_categories", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  categoryId: text("category_id").notNull(),
  gameName: text("game_name").notNull(),
  gameRoleId: text("game_role_id").notNull(),
  cooldownSeconds: integer("cooldown_seconds").notNull().default(60),
  pingMessage: text("ping_message"),
  outputChannelId: text("output_channel_id"),
  enabled: integer("enabled").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow(),
});

export type CtpCategory = typeof ctpCategoriesTable.$inferSelect;
export type InsertCtpCategory = typeof ctpCategoriesTable.$inferInsert;
